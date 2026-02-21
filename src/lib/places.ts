import { addMinutesIso } from '@/lib/time';
import { locateOnRoute } from '@/lib/route-helpers';
import { FacilityEquipmentFilter, FacilityTypeFilter, RouteSummary, StopCandidate } from '@/lib/types';
import { fetchWithTimeout, timeoutErrorLabel } from '@/lib/fetch-timeout';

type NearbyResult = {
  place_id: string;
  name: string;
  vicinity?: string;
  geometry?: { location?: { lat: number; lng: number } };
  types?: string[];
  business_status?: string;
};

type NearbyResponse = {
  status: string;
  results: NearbyResult[];
  error_message?: string;
};

type PlaceDetailsResponse = {
  status: string;
  result?: {
    name?: string;
    formatted_address?: string;
    types?: string[];
    opening_hours?: {
      periods?: Array<unknown>;
      weekday_text?: string[];
    };
  };
};

function samplePoints(route: RouteSummary): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  const stepKm = Math.max(90, Math.ceil(route.totalDistanceKm / 3));
  let next = 0;
  for (const p of route.points) {
    if (p.cumulativeDistanceKm >= next) {
      out.push({ lat: p.lat, lng: p.lng });
      next += stepKm;
    }
  }
  return out.slice(0, 3);
}

function inferTags(name: string): { isSaPa: boolean; isMichiNoEki: boolean; isExpresswayRest: boolean } {
  return {
    isSaPa: /SA|PA|サービスエリア|パーキングエリア/i.test(name),
    isMichiNoEki: /道の駅/.test(name),
    isExpresswayRest: /ハイウェイオアシス|休憩/.test(name)
  };
}

function matchTypeFilter(name: string, filter: FacilityTypeFilter): boolean {
  const active = filter.saPa || filter.expresswayRest || filter.michiNoEki;
  if (!active) return true;
  const tags = inferTags(name);
  return (
    (filter.saPa && tags.isSaPa) ||
    (filter.expresswayRest && tags.isExpresswayRest) ||
    (filter.michiNoEki && tags.isMichiNoEki)
  );
}

function isOpen24hFromWeekdayText(lines: string[] | undefined): boolean {
  if (!lines || lines.length === 0) return false;
  const one = lines.join(' ');
  return /24時間営業|24 時間営業|24 hours/i.test(one);
}

function inferEquipment(name: string, types: string[] | undefined, details: PlaceDetailsResponse['result']) {
  const typeSet = new Set((types ?? []).concat(details?.types ?? []));
  const fullName = `${name} ${details?.name ?? ''}`;
  const weekdayText = details?.opening_hours?.weekday_text;

  return {
    shower: /シャワー/.test(fullName),
    open24h: isOpen24hFromWeekdayText(weekdayText),
    convenience: typeSet.has('convenience_store') || /コンビニ/.test(fullName),
    largeParking: typeSet.has('parking') || /大型|トラック/.test(fullName)
  };
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

async function fetchPlaceDetails(
  key: string,
  placeId: string,
  timeoutMs: number
): Promise<PlaceDetailsResponse['result'] | undefined> {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('language', 'ja');
    url.searchParams.set('fields', 'name,formatted_address,types,opening_hours');
    url.searchParams.set('key', key);

    const res = await fetchWithTimeout(url.toString(), undefined, timeoutMs);
    if (!res.ok) return undefined;
    const body = (await res.json()) as PlaceDetailsResponse;
    if (body.status !== 'OK') return undefined;
    return body.result;
  } catch {
    return undefined;
  }
}

function buildKeywords(filter: FacilityTypeFilter): string[] {
  const out = new Set<string>();
  if (filter.saPa || filter.expresswayRest) {
    out.add('サービスエリア');
  }
  if (filter.michiNoEki) {
    out.add('道の駅');
  }
  if (out.size === 0) {
    out.add('サービスエリア');
    out.add('道の駅');
  }
  return Array.from(out);
}

export async function fetchRestCandidatesFromGooglePlaces(input: {
  route: RouteSummary;
  departAtIso: string;
  facilityTypes: FacilityTypeFilter;
  equipment: FacilityEquipmentFilter;
}): Promise<StopCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const points = samplePoints(input.route);
  const keywords = buildKeywords(input.facilityTypes);
  const all: StopCandidate[] = [];
  const seen = new Set<string>();
  const nearbyTimeoutMs = Number(process.env.PLACES_NEARBY_TIMEOUT_MS ?? '4500');
  const detailsTimeoutMs = Number(process.env.PLACES_DETAILS_TIMEOUT_MS ?? '2500');
  const totalBudgetMs = Number(process.env.PLACES_TOTAL_BUDGET_MS ?? '8000');
  const deadline = Date.now() + totalBudgetMs;
  const needsDetails =
    input.equipment.shower || input.equipment.open24h || input.equipment.convenience || input.equipment.largeParking;

  for (const p of points) {
    if (Date.now() >= deadline) break;
    for (const kw of keywords) {
      if (Date.now() >= deadline) break;
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${p.lat},${p.lng}`);
      url.searchParams.set('radius', '12000');
      url.searchParams.set('language', 'ja');
      url.searchParams.set('keyword', kw);
      url.searchParams.set('key', key);

      let res: Response;
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        res = await fetchWithTimeout(url.toString(), undefined, Math.min(nearbyTimeoutMs, remainingMs));
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(timeoutErrorLabel('Places NearbySearch', nearbyTimeoutMs));
        }
        throw e;
      }
      if (!res.ok) continue;
      const body = (await res.json()) as NearbyResponse;
      if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') continue;

      for (const r of body.results.slice(0, 6)) {
        if (Date.now() >= deadline || all.length >= 20) break;
        const lat = r.geometry?.location?.lat;
        const lng = r.geometry?.location?.lng;
        if (lat == null || lng == null) continue;
        if (seen.has(r.place_id)) continue;
        if (r.business_status === 'CLOSED_PERMANENTLY') continue;
        if (!matchTypeFilter(r.name, input.facilityTypes)) continue;

        const pos = locateOnRoute(input.route, { lat, lng });
        if (pos.distanceFromRouteKm > 12) continue;

        const details =
          needsDetails && deadline - Date.now() > 500
            ? await fetchPlaceDetails(key, r.place_id, Math.min(detailsTimeoutMs, deadline - Date.now()))
            : undefined;
        const eq = inferEquipment(r.name, r.types, details);
        if (!matchEquipmentFilter(eq, input.equipment)) continue;

        seen.add(r.place_id);
        const tags = inferTags(r.name);
        all.push({
          id: r.place_id,
          kind: 'REST',
          name: details?.name ?? r.name,
          address: details?.formatted_address ?? r.vicinity ?? '',
          lat,
          lng,
          source: 'GOOGLE',
          isHighway: tags.isSaPa || tags.isExpresswayRest,
          distanceFromRouteKm: Number(pos.distanceFromRouteKm.toFixed(2)),
          distanceFromStartKm: Number(pos.distanceFromStartKm.toFixed(1)),
          etaIso: addMinutesIso(input.departAtIso, pos.durationFromStartMin),
          equipment: eq,
          tags: [tags.isSaPa ? 'SA/PA' : '', tags.isMichiNoEki ? '道の駅' : '', tags.isExpresswayRest ? '高速休憩所' : '']
            .filter(Boolean)
        });
      }
    }
  }

  return all.sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm).slice(0, 40);
}
