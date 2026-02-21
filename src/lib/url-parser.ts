import { fetchWithTimeout, timeoutErrorLabel } from '@/lib/fetch-timeout';
const GOOGLE_MAP_HOSTS = ['maps.app.goo.gl', 'www.google.com', 'google.com', 'maps.google.com'];

function isGoogleMapsUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return GOOGLE_MAP_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

async function expandMapsUrl(inputUrl: string): Promise<string> {
  if (!isGoogleMapsUrl(inputUrl)) {
    throw new Error('Googleマップ共有URLではありません。');
  }
  const timeoutMs = 8000;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      inputUrl,
      {
        method: 'GET',
        redirect: 'follow'
      },
      timeoutMs
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(timeoutErrorLabel('URL展開', timeoutMs));
    }
    throw e;
  }
  return response.url;
}

function sanitizeSegment(segment: string): string {
  return decodeURIComponent(segment).replace(/\+/g, ' ').trim();
}

function isRouteTailSegment(segment: string): boolean {
  if (!segment) return true;
  const lower = segment.toLowerCase();
  if (lower.startsWith('@')) return true;
  if (lower.includes('data=!')) return true;
  if (/^[a-z]{1,4}=/.test(lower)) return true; // am=t など
  if (lower === 'data') return true;
  return false;
}

export function extractPathStops(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  const dirIdx = segments.findIndex((seg) => seg === 'dir');
  if (dirIdx === -1) return [];

  const routeSegments: string[] = [];
  for (const seg of segments.slice(dirIdx + 1)) {
    const s = sanitizeSegment(seg);
    if (!s) continue;
    if (isRouteTailSegment(s)) break;
    routeSegments.push(s);
  }
  return routeSegments;
}

function parseFromPath(pathname: string): { origin?: string; destination?: string; waypoints: string[] } {
  const routeSegments = extractPathStops(pathname);
  if (routeSegments.length < 2) {
    return { waypoints: [] };
  }
  return {
    origin: routeSegments[0],
    destination: routeSegments[routeSegments.length - 1],
    waypoints: routeSegments.slice(1, -1)
  };
}

function parseFromQuery(url: URL): { origin?: string; destination?: string; waypoints: string[] } {
  const origin =
    url.searchParams.get('origin') ??
    url.searchParams.get('saddr') ??
    url.searchParams.get('source') ??
    undefined;
  const destination =
    url.searchParams.get('destination') ??
    url.searchParams.get('daddr') ??
    url.searchParams.get('dest') ??
    undefined;
  const wp = url.searchParams.get('waypoints') ?? '';
  const waypoints = wp
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);

  return { origin, destination, waypoints };
}

export function extractLatLngPairsFromData(expandedUrl: string): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  const regex = /!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;
  for (const m of expandedUrl.matchAll(regex)) {
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng });
  }
  return out;
}

export function buildFallbackRouteInputFromCoords(
  expandedUrl: string,
  waypoints: string[] = []
): { origin: string; destination: string; waypoints: string[] } | null {
  const pairs = extractLatLngPairsFromData(expandedUrl);
  if (pairs.length < 2) return null;
  const origin = `${pairs[0].lat},${pairs[0].lng}`;
  const last = pairs[pairs.length - 1];
  const destination = `${last.lat},${last.lng}`;
  return {
    origin,
    destination,
    waypoints
  };
}

export async function resolveGoogleRouteInput(rawUrl: string, extraWaypoints: string[] = []) {
  const expanded = await expandMapsUrl(rawUrl);
  const url = new URL(expanded);

  const pathParsed = parseFromPath(url.pathname);
  const queryParsed = parseFromQuery(url);

  const origin = queryParsed.origin ?? pathParsed.origin;
  const destination = queryParsed.destination ?? pathParsed.destination;

  if (!origin || !destination) {
    throw new Error('URLから出発地/到着地を抽出できませんでした。追加経由地を入力して再実行してください。');
  }

  const waypoints = [...(queryParsed.waypoints.length > 0 ? queryParsed.waypoints : pathParsed.waypoints), ...extraWaypoints]
    .map((w) => w.trim())
    .filter(Boolean);

  return {
    expandedUrl: expanded,
    origin,
    destination,
    waypoints
  };
}
