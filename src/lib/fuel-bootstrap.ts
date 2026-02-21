import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

type RawStation = {
  sourceId: string;
  brand: 'EW' | 'USAMI';
  name: string;
  address: string;
  lat: number;
  lng: number;
  isHighway: boolean;
  service24h: boolean;
  shower: boolean;
  convenience: boolean;
  largeParking: boolean;
};

let bootstrapPromise: Promise<{ warnings: string[] }> | null = null;

export async function ensureFuelStationMasterReady(): Promise<{ warnings: string[] }> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  return bootstrapPromise;
}

async function bootstrap(): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  await ensureFuelStationTable();

  const count = await prisma.fuelStation.count();
  if (count > 0) {
    return { warnings };
  }

  const seed = await loadSeedStations();
  if (seed.length > 0) {
    await upsertStations(seed);
    warnings.push(`給油マスター初期投入: seed ${seed.length}件`);
  }

  const [ew, usami] = await Promise.all([fetchEwOfficial(), fetchUsamiOfficial()]);
  const official = dedupeStations([...ew, ...usami]);
  if (official.length > 0) {
    await upsertStations(official);
    warnings.push(`給油マスター更新: 公式 ${official.length}件`);
  } else {
    warnings.push('給油マスター更新: 公式取得0件（seedで継続）');
  }

  return { warnings };
}

async function ensureFuelStationTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FuelStation" (
      "id" TEXT PRIMARY KEY,
      "sourceId" TEXT UNIQUE,
      "brand" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "address" TEXT NOT NULL,
      "lat" DOUBLE PRECISION NOT NULL,
      "lng" DOUBLE PRECISION NOT NULL,
      "isHighway" BOOLEAN NOT NULL DEFAULT false,
      "service24h" BOOLEAN NOT NULL DEFAULT false,
      "shower" BOOLEAN NOT NULL DEFAULT false,
      "convenience" BOOLEAN NOT NULL DEFAULT false,
      "largeParking" BOOLEAN NOT NULL DEFAULT false,
      "metadata" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FuelStation_brand_idx" ON "FuelStation" ("brand");');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FuelStation_isHighway_idx" ON "FuelStation" ("isHighway");');
}

async function loadSeedStations(): Promise<RawStation[]> {
  const seedPath = path.join(process.cwd(), 'data', 'station-seed.json');
  const extraPath = path.join(process.cwd(), 'data', 'station-extra.json');
  const [seed, extra] = await Promise.all([readJsonFile(seedPath), readJsonFile(extraPath)]);

  return dedupeStations([...seed, ...extra]);
}

async function readJsonFile(filePath: string): Promise<RawStation[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as RawStation[];
  } catch {
    return [];
  }
}

async function fetchEwOfficial(): Promise<RawStation[]> {
  return fetchOfficialCommon(process.env.EW_SOURCE_URL ?? 'https://ss.eneos-wing.co.jp', 'EW');
}

async function fetchUsamiOfficial(): Promise<RawStation[]> {
  return fetchOfficialCommon(process.env.USAMI_SOURCE_URL ?? 'https://usappy.jp/ss', 'USAMI');
}

async function fetchOfficialCommon(url: string, brand: 'EW' | 'USAMI'): Promise<RawStation[]> {
  try {
    const res = await fetchWithTimeout(url, { redirect: 'follow' }, 8000);
    if (!res.ok) return [];
    const html = await res.text();

    const out = parseStationsFromDataAttributes(html, brand);
    return dedupeStations(out);
  } catch {
    return [];
  }
}

function parseStationsFromDataAttributes(html: string, brand: 'EW' | 'USAMI'): RawStation[] {
  const out: RawStation[] = [];
  const markerRegex = /data-lat=\"([0-9.\-]+)\"[\s\S]*?data-lng=\"([0-9.\-]+)\"[\s\S]*?data-name=\"([^\"]+)\"[\s\S]*?data-address=\"([^\"]*)\"/g;

  for (const match of html.matchAll(markerRegex)) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    const name = decodeHtml(match[3]);
    const address = decodeHtml(match[4]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name || !address) continue;

    out.push({
      sourceId: `${brand.toLowerCase()}-${slug(name)}-${lat.toFixed(3)}-${lng.toFixed(3)}`,
      brand,
      name,
      address,
      lat,
      lng,
      isHighway: /SA|PA|サービスエリア|パーキングエリア/.test(name),
      service24h: /24/.test(`${name} ${address}`),
      shower: /シャワー/.test(`${name} ${address}`),
      convenience: /コンビニ/.test(`${name} ${address}`),
      largeParking: /大型|トラック/.test(`${name} ${address}`)
    });
  }

  return out;
}

function dedupeStations(stations: RawStation[]): RawStation[] {
  const normalized = stations
    .map(normalize)
    .filter((v): v is RawStation => v !== null);

  const map = new Map<string, RawStation>();
  for (const s of normalized) {
    const key = `${s.brand}:${slug(s.name)}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;
    map.set(key, s);
  }
  return Array.from(map.values());
}

function normalize(station: RawStation): RawStation | null {
  if (!station?.name || !station?.address) return null;
  if (!Number.isFinite(station?.lat) || !Number.isFinite(station?.lng)) return null;

  return {
    ...station,
    sourceId: station.sourceId || `${station.brand.toLowerCase()}-${slug(station.name)}-${station.lat.toFixed(3)}-${station.lng.toFixed(3)}`,
    name: station.name.trim(),
    address: station.address.trim()
  };
}

async function upsertStations(stations: RawStation[]) {
  for (const station of stations) {
    await prisma.fuelStation.upsert({
      where: { sourceId: station.sourceId },
      create: {
        sourceId: station.sourceId,
        brand: station.brand,
        name: station.name,
        address: station.address,
        lat: station.lat,
        lng: station.lng,
        isHighway: station.isHighway,
        service24h: station.service24h,
        shower: station.shower,
        convenience: station.convenience,
        largeParking: station.largeParking
      },
      update: {
        brand: station.brand,
        name: station.name,
        address: station.address,
        lat: station.lat,
        lng: station.lng,
        isHighway: station.isHighway,
        service24h: station.service24h,
        shower: station.shower,
        convenience: station.convenience,
        largeParking: station.largeParking
      }
    });
  }
}

function decodeHtml(input: string): string {
  return input.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9一-龠ぁ-んァ-ン]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
