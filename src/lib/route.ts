import { decodePolyline, haversineKm } from '@/lib/geo';
import { RoutePoint, RouteSummary } from '@/lib/types';

type DirectionsResponse = {
  status: string;
  routes: Array<{
    overview_polyline: { points: string };
    legs: Array<{
      distance: { value: number };
      duration: { value: number };
    }>;
  }>;
  error_message?: string;
};

function buildRoutePoints(polyline: string, totalDistanceKm: number, totalDurationMin: number): RoutePoint[] {
  const decoded = decodePolyline(polyline);
  if (decoded.length === 0) return [];

  const segmentLengths: number[] = [];
  let polylineLength = 0;

  for (let i = 1; i < decoded.length; i += 1) {
    const d = haversineKm(decoded[i - 1], decoded[i]);
    segmentLengths.push(d);
    polylineLength += d;
  }

  const points: RoutePoint[] = [{ ...decoded[0], cumulativeDistanceKm: 0, cumulativeDurationMin: 0 }];

  let cumulativePolyline = 0;
  for (let i = 1; i < decoded.length; i += 1) {
    cumulativePolyline += segmentLengths[i - 1] ?? 0;
    const ratio = polylineLength === 0 ? 0 : cumulativePolyline / polylineLength;

    points.push({
      ...decoded[i],
      cumulativeDistanceKm: Number((totalDistanceKm * ratio).toFixed(2)),
      cumulativeDurationMin: Number((totalDurationMin * ratio).toFixed(1))
    });
  }

  return points;
}

export async function fetchRouteSummary(input: {
  origin: string;
  destination: string;
  waypoints: string[];
}): Promise<RouteSummary> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error('GOOGLE_MAPS_API_KEY が未設定です。');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', input.origin);
  url.searchParams.set('destination', input.destination);
  if (input.waypoints.length > 0) {
    url.searchParams.set('waypoints', input.waypoints.join('|'));
  }
  url.searchParams.set('language', 'ja');
  url.searchParams.set('region', 'jp');
  url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Directions API呼び出し失敗: ${res.status}`);
  }

  const body = (await res.json()) as DirectionsResponse;
  if (body.status !== 'OK' || !body.routes[0]) {
    throw new Error(body.error_message ?? `ルート取得失敗: ${body.status}`);
  }

  const route = body.routes[0];
  const totalDistanceKm = route.legs.reduce((sum, leg) => sum + leg.distance.value / 1000, 0);
  const totalDurationMin = route.legs.reduce((sum, leg) => sum + leg.duration.value / 60, 0);
  const polyline = route.overview_polyline.points;
  const points = buildRoutePoints(polyline, totalDistanceKm, totalDurationMin);

  return {
    origin: input.origin,
    destination: input.destination,
    waypoints: input.waypoints,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    totalDurationMin: Number(totalDurationMin.toFixed(1)),
    polyline,
    points
  };
}
