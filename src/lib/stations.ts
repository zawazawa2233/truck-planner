import { FuelStation } from '@prisma/client';
import { prisma } from '@/lib/db';
import { addMinutesIso } from '@/lib/time';
import { locateOnRoute } from '@/lib/route-helpers';
import { FuelBrand, RouteSummary, StopCandidate } from '@/lib/types';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

function acceptedBrands(input: FuelBrand): Array<'EW' | 'USAMI'> {
  if (input === 'BOTH') return ['EW', 'USAMI'];
  if (input === 'EW') return ['EW'];
  return ['USAMI'];
}

function toCandidate(station: FuelStation, route: RouteSummary, departAtIso: string): StopCandidate {
  const pos = locateOnRoute(route, { lat: station.lat, lng: station.lng });
  return {
    id: station.id,
    kind: 'FUEL',
    name: station.name,
    address: station.address,
    lat: station.lat,
    lng: station.lng,
    source: 'MASTER',
    isHighway: station.isHighway,
    distanceFromRouteKm: Number(pos.distanceFromRouteKm.toFixed(2)),
    distanceFromStartKm: Number(pos.distanceFromStartKm.toFixed(1)),
    etaIso: addMinutesIso(departAtIso, pos.durationFromStartMin),
    equipment: {
      shower: station.shower,
      open24h: station.service24h,
      convenience: station.convenience,
      largeParking: station.largeParking
    },
    tags: [station.isHighway ? '高速道路内SS' : '一般道SS'],
    brand: station.brand as 'EW' | 'USAMI'
  };
}

function samplePoints(route: RouteSummary): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  const stepKm = Math.max(80, Math.ceil(route.totalDistanceKm / 8));
  let next = 0;
  for (const p of route.points) {
    if (p.cumulativeDistanceKm >= next) {
      out.push({ lat: p.lat, lng: p.lng });
      next += stepKm;
    }
  }
  return out.slice(0, 8);
}

function brandKeywordList(brand: 'EW' | 'USAMI'): string[] {
  if (brand === 'EW') return ['ENEOSウイング', 'エネオスウイング'];
  return ['宇佐美', 'Usappy'];
}

function matchesBrand(name: string, brand: 'EW' | 'USAMI'): boolean {
  if (brand === 'EW') return /eneos\s*wing|eneosウイング|エネオスウイング/i.test(name);
  return /宇佐美|usappy|usami/i.test(name);
}

async function fetchFuelCandidatesFromGooglePlaces(input: {
  route: RouteSummary;
  departAtIso: string;
  brands: Array<'EW' | 'USAMI'>;
}): Promise<StopCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  type NearbyItem = {
    place_id: string;
    name?: string;
    vicinity?: string;
    geometry?: { location?: { lat: number; lng: number } };
    types?: string[];
  };
  type NearbyResponse = { status: string; results: NearbyItem[] };

  const out: StopCandidate[] = [];
  const seen = new Set<string>();
  const points = samplePoints(input.route);
  const timeoutMs = Number(process.env.FUEL_PLACES_TIMEOUT_MS ?? '4000');
  const budgetMs = Number(process.env.FUEL_PLACES_TOTAL_BUDGET_MS ?? '9000');
  const deadline = Date.now() + budgetMs;

  for (const brand of input.brands) {
    if (Date.now() >= deadline) break;
    for (const point of points) {
      if (Date.now() >= deadline) break;
      for (const keyword of brandKeywordList(brand)) {
        if (Date.now() >= deadline) break;
        const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
        url.searchParams.set('location', `${point.lat},${point.lng}`);
        url.searchParams.set('radius', '18000');
        url.searchParams.set('type', 'gas_station');
        url.searchParams.set('language', 'ja');
        url.searchParams.set('keyword', keyword);
        url.searchParams.set('key', key);

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        let res: Response;
        try {
          res = await fetchWithTimeout(url.toString(), undefined, Math.min(timeoutMs, remainingMs));
        } catch {
          continue;
        }
        if (!res.ok) continue;
        const body = (await res.json()) as NearbyResponse;
        if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') continue;

        for (const item of body.results.slice(0, 8)) {
          const name = item.name?.trim() ?? '';
          const lat = item.geometry?.location?.lat;
          const lng = item.geometry?.location?.lng;
          if (!name || lat == null || lng == null) continue;
          if (!matchesBrand(name, brand)) continue;
          if (seen.has(item.place_id)) continue;

          const pos = locateOnRoute(input.route, { lat, lng });
          if (pos.distanceFromRouteKm > 12) continue;

          seen.add(item.place_id);
          const isHighway = /SA|PA|サービスエリア|パーキングエリア|ハイウェイ/.test(name);
          out.push({
            id: `google-fuel-${item.place_id}`,
            kind: 'FUEL',
            name,
            address: item.vicinity ?? '',
            lat,
            lng,
            source: 'GOOGLE',
            isHighway,
            distanceFromRouteKm: Number(pos.distanceFromRouteKm.toFixed(2)),
            distanceFromStartKm: Number(pos.distanceFromStartKm.toFixed(1)),
            etaIso: addMinutesIso(input.departAtIso, pos.durationFromStartMin),
            equipment: {
              shower: false,
              open24h: false,
              convenience: item.types?.includes('convenience_store') ?? false,
              largeParking: /大型|トラック/.test(name)
            },
            tags: [isHighway ? '高速道路内SS' : '一般道SS'],
            brand
          });
        }
      }
    }
  }

  return out;
}

function dedupeFuelCandidates(list: StopCandidate[]): StopCandidate[] {
  const byGeoBrand = new Map<string, StopCandidate>();
  for (const item of list) {
    const key = `${item.brand ?? 'X'}:${item.name}:${item.lat.toFixed(3)}:${item.lng.toFixed(3)}`;
    const prev = byGeoBrand.get(key);
    if (!prev) {
      byGeoBrand.set(key, item);
      continue;
    }
    if (prev.source !== 'MASTER' && item.source === 'MASTER') {
      byGeoBrand.set(key, item);
    }
  }
  return Array.from(byGeoBrand.values());
}

function scoreCandidate(
  c: StopCandidate,
  fuelRangeKm: number,
  prioritizeHighwayStations: boolean
): number {
  let score = 0;
  if (prioritizeHighwayStations && c.isHighway) score += 1000;
  if (c.distanceFromStartKm <= fuelRangeKm) score += 500;
  score += Math.max(0, 200 - c.distanceFromRouteKm * 20);
  score += Math.max(0, 120 - Math.abs(c.distanceFromStartKm - fuelRangeKm) * 1.2);
  return score;
}

export async function fetchFuelCandidates(input: {
  route: RouteSummary;
  departAtIso: string;
  fuelBrand: FuelBrand;
  fuelRangeKm: number;
  prioritizeHighwayStations: boolean;
}): Promise<StopCandidate[]> {
  const brands = acceptedBrands(input.fuelBrand);
  const stations = await prisma.fuelStation.findMany({
    where: {
      brand: { in: brands },
      lat: { not: 0 },
      lng: { not: 0 }
    }
  });

  const fromMaster = stations
    .map((station) => toCandidate(station, input.route, input.departAtIso))
    .filter((s) => s.distanceFromRouteKm <= 12);

  const fromGoogle = await fetchFuelCandidatesFromGooglePlaces({
    route: input.route,
    departAtIso: input.departAtIso,
    brands
  });

  const merged = dedupeFuelCandidates([...fromMaster, ...fromGoogle]).sort((a, b) => {
    const scoreA = scoreCandidate(a, input.fuelRangeKm, input.prioritizeHighwayStations);
    const scoreB = scoreCandidate(b, input.fuelRangeKm, input.prioritizeHighwayStations);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.distanceFromStartKm - b.distanceFromStartKm;
  });

  return merged.slice(0, 20);
}
