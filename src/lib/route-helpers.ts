import { nearestDistanceToPolylineKm } from '@/lib/geo';
import { RouteSummary } from '@/lib/types';

export function locateOnRoute(
  route: RouteSummary,
  point: { lat: number; lng: number }
): { distanceFromRouteKm: number; distanceFromStartKm: number; durationFromStartMin: number } {
  const polyline = route.points.map((p) => ({ lat: p.lat, lng: p.lng }));
  const nearest = nearestDistanceToPolylineKm(point, polyline);
  const routePoint = route.points[nearest.nearestIndex] ?? route.points[0];

  return {
    distanceFromRouteKm: nearest.distanceKm,
    distanceFromStartKm: routePoint?.cumulativeDistanceKm ?? 0,
    durationFromStartMin: routePoint?.cumulativeDurationMin ?? 0
  };
}
