import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

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

const prisma = new PrismaClient();

async function fetchEwOfficial(): Promise<RawStation[]> {
  const url = process.env.EW_SOURCE_URL ?? 'https://ss.eneos-wing.co.jp';

  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();

    const jsonBlocks = html.match(/\{\"@context\"[\s\S]*?\}/g) ?? [];
    const out: RawStation[] = [];
    for (const block of jsonBlocks) {
      if (!block.includes('GeoCoordinates')) continue;
      try {
        const parsed = JSON.parse(block) as {
          name?: string;
          address?: { streetAddress?: string; addressLocality?: string };
          geo?: { latitude?: string | number; longitude?: string | number };
        };
        const lat = Number(parsed.geo?.latitude);
        const lng = Number(parsed.geo?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        out.push({
          sourceId: `ew-${slug(parsed.name ?? `${lat}-${lng}`)}`,
          brand: 'EW',
          name: parsed.name ?? 'ENEOSウイング',
          address: `${parsed.address?.addressLocality ?? ''} ${parsed.address?.streetAddress ?? ''}`.trim(),
          lat,
          lng,
          isHighway: /SA|PA|サービスエリア|パーキングエリア/.test(parsed.name ?? ''),
          service24h: false,
          shower: false,
          convenience: false,
          largeParking: false
        });
      } catch {
        // ignore parse failure
      }
    }

    return out;
  } catch {
    return [];
  }
}

async function fetchUsamiOfficial(): Promise<RawStation[]> {
  const url = process.env.USAMI_SOURCE_URL ?? 'https://usappy.jp/ss';

  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();

    const out: RawStation[] = [];
    const markerRegex = /data-lat=\"([0-9.\-]+)\"[\s\S]*?data-lng=\"([0-9.\-]+)\"[\s\S]*?data-name=\"([^\"]+)\"[\s\S]*?data-address=\"([^\"]*)\"/g;

    for (const match of html.matchAll(markerRegex)) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      const name = decodeHtml(match[3]);
      const address = decodeHtml(match[4]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      out.push({
        sourceId: `usami-${slug(name)}`,
        brand: 'USAMI',
        name,
        address,
        lat,
        lng,
        isHighway: /SA|PA|サービスエリア|パーキングエリア/.test(name),
        service24h: /24/.test(name),
        shower: /シャワー/.test(name),
        convenience: /コンビニ/.test(name),
        largeParking: /大型/.test(name)
      });
    }

    return out;
  } catch {
    return [];
  }
}

function decodeHtml(input: string): string {
  return input.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9一-龠ぁ-んァ-ン]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalize(station: RawStation): RawStation | null {
  if (!station.name || !station.address) return null;
  if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;

  return {
    ...station,
    name: station.name.trim(),
    address: station.address.trim()
  };
}

async function loadSeed(): Promise<RawStation[]> {
  const seedPath = path.join(process.cwd(), 'data', 'station-seed.json');
  const raw = await fs.readFile(seedPath, 'utf8');
  return JSON.parse(raw) as RawStation[];
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

async function main() {
  const [seed, ew, usami] = await Promise.all([loadSeed(), fetchEwOfficial(), fetchUsamiOfficial()]);
  const merged = [...seed, ...ew, ...usami]
    .map(normalize)
    .filter((v): v is RawStation => v !== null);

  const uniq = new Map<string, RawStation>();
  for (const station of merged) {
    uniq.set(station.sourceId, station);
  }

  await upsertStations(Array.from(uniq.values()));
  console.log(`updated stations: ${uniq.size}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
