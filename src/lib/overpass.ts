import { addMinutesIso } from '@/lib/time';
import { locateOnRoute } from '@/lib/route-helpers';
import { FacilityEquipmentFilter, FacilityTypeFilter, RouteSummary, StopCandidate } from '@/lib/types';
import { fetchWithTimeout, timeoutErrorLabel } from '@/lib/fetch-timeout';

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OverpassElement[];
};

function samplePoints(route: RouteSummary): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  const stepKm = 35;
  let nextTarget = 0;

  for (const p of route.points) {
    if (p.cumulativeDistanceKm >= nextTarget) {
      points.push({ lat: p.lat, lng: p.lng });
      nextTarget += stepKm;
    }
  }

  if (points.length === 0 && route.points[0]) {
    points.push({ lat: route.points[0].lat, lng: route.points[0].lng });
  }

  return points.slice(0, 25);
}

function buildQuery(route: RouteSummary, radiusM: number): string {
  const points = samplePoints(route);
  const clauses = points
    .map((p) => `node(around:${radiusM},${p.lat},${p.lng})["highway"~"services|rest_area"];way(around:${radiusM},${p.lat},${p.lng})["highway"~"services|rest_area"];node(around:${radiusM},${p.lat},${p.lng})["name"~"道の駅"];way(around:${radiusM},${p.lat},${p.lng})["name"~"道の駅"];`)
    .join('\n');

  return `[out:json][timeout:40];(
${clauses}
);out center tags;`;
}

function classify(tags: Record<string, string> | undefined): {
  isSaPa: boolean;
  isExpresswayRest: boolean;
  isMichiNoEki: boolean;
  equipment: { shower: boolean; open24h: boolean; convenience: boolean; largeParking: boolean };
} {
  const name = (tags?.name ?? '').toLowerCase();
  const highway = (tags?.highway ?? '').toLowerCase();

  const isSaPa = highway === 'services' || /sa|pa|サービスエリア|パーキングエリア/.test(name);
  const isExpresswayRest = highway === 'rest_area' || /休憩/.test(name);
  const isMichiNoEki = /道の駅/.test(tags?.name ?? '');

  return {
    isSaPa,
    isExpresswayRest,
    isMichiNoEki,
    equipment: {
      shower: tags?.shower === 'yes' || /シャワー/.test(name),
      open24h: tags?.opening_hours === '24/7' || tags?.['service_times'] === '24h',
      convenience: tags?.shop === 'convenience' || tags?.convenience === 'yes' || /コンビニ/.test(name),
      largeParking: tags?.hgv === 'yes' || tags?.['parking:lane'] === 'truck' || /大型/.test(name)
    }
  };
}

export async function fetchRestCandidatesFromOverpass(input: {
  route: RouteSummary;
  departAtIso: string;
  facilityTypes: FacilityTypeFilter;
  equipment: FacilityEquipmentFilter;
}): Promise<StopCandidate[]> {
  const endpoints = buildEndpointPriorityList(
    process.env.OVERPASS_API_URLS ??
      process.env.OVERPASS_API_URL ??
      'https://overpass.kumi.systems/api/interpreter,https://overpass-api.de/api/interpreter'
  );
  const radiusKm = Number(process.env.ROUTE_BUFFER_KM ?? '8');
  const radiusM = Math.round(radiusKm * 1000);
  const query = buildQuery(input.route, radiusM);

  let body: OverpassResponse | null = null;
  let lastError = '';
  const timeoutMs = Number(process.env.OVERPASS_TIMEOUT_MS ?? '12000');
  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: query
        },
        timeoutMs
      );
      if (!res.ok) {
        lastError = `Overpass API失敗(${endpoint}): ${res.status}`;
        continue;
      }
      body = (await res.json()) as OverpassResponse;
      break;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        lastError = timeoutErrorLabel(`Overpass API失敗(${endpoint})`, timeoutMs);
        continue;
      }
      lastError = `Overpass API失敗(${endpoint}): ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (!body) {
    throw new Error(lastError || 'Overpass API失敗');
  }
  const seen = new Set<string>();
  const out: StopCandidate[] = [];

  for (const el of body.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const key = `${el.type}-${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cls = classify(el.tags);
    if (!matchTypeFilter(cls, input.facilityTypes)) continue;
    if (!matchEquipmentFilter(cls.equipment, input.equipment)) continue;

    const pos = locateOnRoute(input.route, { lat, lng });
    if (pos.distanceFromRouteKm > radiusKm) continue;

    out.push({
      id: key,
      kind: 'REST',
      name: el.tags?.name ?? '名称不明施設',
      address: [el.tags?.['addr:full'], el.tags?.['addr:city'], el.tags?.['addr:street']].filter(Boolean).join(' '),
      lat,
      lng,
      source: 'OSM',
      isHighway: cls.isSaPa || cls.isExpresswayRest,
      distanceFromRouteKm: Number(pos.distanceFromRouteKm.toFixed(2)),
      distanceFromStartKm: Number(pos.distanceFromStartKm.toFixed(1)),
      etaIso: addMinutesIso(input.departAtIso, pos.durationFromStartMin),
      equipment: cls.equipment,
      tags: [
        cls.isSaPa ? 'SA/PA' : '',
        cls.isExpresswayRest ? '高速休憩所' : '',
        cls.isMichiNoEki ? '道の駅' : ''
      ].filter(Boolean)
    });
  }

  return out.sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);
}

function buildEndpointPriorityList(raw: string): string[] {
  const endpoints = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const priorityHosts = ['overpass.kumi.systems', 'overpass-api.de', 'lz4.overpass-api.de', 'z.overpass-api.de'];

  return endpoints.sort((a, b) => hostPriorityScore(a, priorityHosts) - hostPriorityScore(b, priorityHosts));
}

function hostPriorityScore(endpoint: string, priorities: string[]): number {
  try {
    const host = new URL(endpoint).hostname;
    const idx = priorities.findIndex((p) => host.includes(p));
    return idx === -1 ? priorities.length + 1 : idx;
  } catch {
    return priorities.length + 2;
  }
}

function matchTypeFilter(
  cls: { isSaPa: boolean; isExpresswayRest: boolean; isMichiNoEki: boolean },
  filter: FacilityTypeFilter
): boolean {
  const active = [filter.saPa, filter.expresswayRest, filter.michiNoEki].some(Boolean);
  if (!active) return true;

  return (
    (filter.saPa && cls.isSaPa) ||
    (filter.expresswayRest && cls.isExpresswayRest) ||
    (filter.michiNoEki && cls.isMichiNoEki)
  );
}

function matchEquipmentFilter(
  eq: { shower: boolean; open24h: boolean; convenience: boolean; largeParking: boolean },
  filter: FacilityEquipmentFilter
): boolean {
  if (filter.shower && !eq.shower) return false;
  if (filter.open24h && !eq.open24h) return false;
  if (filter.convenience && !eq.convenience) return false;
  if (filter.largeParking && !eq.largeParking) return false;
  return true;
}
