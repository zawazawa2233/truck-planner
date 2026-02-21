import { FuelStation } from '@prisma/client';
import { prisma } from '@/lib/db';
import { addMinutesIso } from '@/lib/time';
import { locateOnRoute } from '@/lib/route-helpers';
import { FuelBrand, RouteSummary, StopCandidate } from '@/lib/types';

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

  const mapped = stations
    .map((station) => toCandidate(station, input.route, input.departAtIso))
    .filter((s) => s.distanceFromRouteKm <= 10)
    .filter((s) => s.distanceFromStartKm <= input.fuelRangeKm)
    .sort((a, b) => {
      if (input.prioritizeHighwayStations && a.isHighway !== b.isHighway) {
        return a.isHighway ? -1 : 1;
      }
      return a.distanceFromRouteKm - b.distanceFromRouteKm;
    });

  return mapped.slice(0, 8);
}
