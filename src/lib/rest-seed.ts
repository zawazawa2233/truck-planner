import fs from 'node:fs/promises';
import path from 'node:path';
import { addMinutesIso } from '@/lib/time';
import { locateOnRoute } from '@/lib/route-helpers';
import { FacilityEquipmentFilter, FacilityTypeFilter, RouteSummary, StopCandidate } from '@/lib/types';

type SeedRest = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isHighway: boolean;
  tags: string[];
  equipment: { shower: boolean; open24h: boolean; convenience: boolean; largeParking: boolean };
};

function matchType(tags: string[], filter: FacilityTypeFilter): boolean {
  const active = filter.saPa || filter.expresswayRest || filter.michiNoEki;
  if (!active) return true;
  return (
    (filter.saPa && tags.includes('SA/PA')) ||
    (filter.expresswayRest && tags.includes('高速休憩所')) ||
    (filter.michiNoEki && tags.includes('道の駅'))
  );
}

function matchEquipment(eq: SeedRest['equipment'], filter: FacilityEquipmentFilter): boolean {
  if (filter.shower && !eq.shower) return false;
  if (filter.open24h && !eq.open24h) return false;
  if (filter.convenience && !eq.convenience) return false;
  if (filter.largeParking && !eq.largeParking) return false;
  return true;
}

export async function fetchRestCandidatesFromSeed(input: {
  route: RouteSummary;
  departAtIso: string;
  facilityTypes: FacilityTypeFilter;
  equipment: FacilityEquipmentFilter;
}): Promise<StopCandidate[]> {
  const p = path.join(process.cwd(), 'data', 'rest-seed.json');
  const raw = await fs.readFile(p, 'utf8');
  const seed = JSON.parse(raw) as SeedRest[];

  return seed
    .filter((r) => matchType(r.tags, input.facilityTypes))
    .filter((r) => matchEquipment(r.equipment, input.equipment))
    .map((r) => {
      const pos = locateOnRoute(input.route, { lat: r.lat, lng: r.lng });
      return {
        id: r.id,
        kind: 'REST' as const,
        name: r.name,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        source: 'MASTER' as const,
        isHighway: r.isHighway,
        distanceFromRouteKm: Number(pos.distanceFromRouteKm.toFixed(2)),
        distanceFromStartKm: Number(pos.distanceFromStartKm.toFixed(1)),
        etaIso: addMinutesIso(input.departAtIso, pos.durationFromStartMin),
        equipment: r.equipment,
        tags: r.tags
      };
    })
    .filter((r) => r.distanceFromRouteKm <= 12)
    .sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);
}
