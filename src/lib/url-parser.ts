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
  const response = await fetch(inputUrl, {
    method: 'GET',
    redirect: 'follow'
  });
  return response.url;
}

function sanitizeSegment(segment: string): string {
  return decodeURIComponent(segment).replace(/\+/g, ' ').trim();
}

function parseFromPath(pathname: string): { origin?: string; destination?: string; waypoints: string[] } {
  const segments = pathname.split('/').filter(Boolean);
  const dirIdx = segments.findIndex((seg) => seg === 'dir');
  if (dirIdx === -1) {
    return { waypoints: [] };
  }
  const routeSegments = segments.slice(dirIdx + 1).map(sanitizeSegment).filter(Boolean);
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
