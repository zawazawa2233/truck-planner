export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  let index = 0;
  const points: Array<{ lat: number; lng: number }> = [];
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function toRad(v: number): number {
  return (v * Math.PI) / 180;
}

export function nearestDistanceToPolylineKm(
  target: { lat: number; lng: number },
  polylinePoints: Array<{ lat: number; lng: number }>
): { distanceKm: number; nearestIndex: number } {
  let min = Number.POSITIVE_INFINITY;
  let idx = 0;

  for (let i = 0; i < polylinePoints.length; i += 1) {
    const d = haversineKm(target, polylinePoints[i]);
    if (d < min) {
      min = d;
      idx = i;
    }
  }

  return { distanceKm: min, nearestIndex: idx };
}
