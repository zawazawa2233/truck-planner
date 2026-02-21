import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function decodeHtml(input) {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function slug(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9一-龠ぁ-んァ-ン]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const txt = decodeHtml((m[1] || '').trim());
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
    }
  }
  return blocks;
}

function stationFromJsonLd(item, brand) {
  const geo = item?.geo || item?.location?.geo;
  const lat = Number(geo?.latitude);
  const lng = Number(geo?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = item?.name || `${brand} SS`;
  const addrObj = item?.address;
  const address =
    typeof addrObj === 'string'
      ? addrObj
      : `${addrObj?.addressRegion ?? ''} ${addrObj?.addressLocality ?? ''} ${addrObj?.streetAddress ?? ''}`.trim();

  return {
    sourceId: `${brand.toLowerCase()}-${slug(name)}-${lat.toFixed(3)}-${lng.toFixed(3)}`,
    brand,
    name,
    address,
    lat,
    lng,
    isHighway: /SA|PA|サービスエリア|パーキングエリア/.test(name),
    service24h: /24/.test(name),
    shower: /シャワー/.test(name),
    convenience: /コンビニ/.test(name),
    largeParking: /大型|トラック/.test(name)
  };
}

function parseStationsFromDataAttributes(html, brand) {
  const out = [];
  const patterns = [
    /data-lat=\"([0-9.\-]+)\"[\s\S]*?data-lng=\"([0-9.\-]+)\"[\s\S]*?data-name=\"([^\"]+)\"[\s\S]*?data-address=\"([^\"]*)\"/g,
    /lat(?:itude)?\s*[:=]\s*['\"]?([0-9.\-]+)['\"]?[\s\S]*?lng|lon(?:gitude)?\s*[:=]\s*['\"]?([0-9.\-]+)['\"]?[\s\S]*?name\s*[:=]\s*['\"]([^'\"]+)['\"]/g
  ];

  for (const markerRegex of patterns) {
    for (const match of html.matchAll(markerRegex)) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      const name = decodeHtml(match[3] || '');
      const address = decodeHtml(match[4] || '');
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) continue;
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
  }

  return out;
}

async function fetchEwOfficial() {
  const url = process.env.EW_SOURCE_URL ?? 'https://ss.eneos-wing.co.jp';
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();

    const fromJsonLd = parseJsonLdBlocks(html)
      .map((j) => stationFromJsonLd(j, 'EW'))
      .filter(Boolean);
    const fromAttrs = parseStationsFromDataAttributes(html, 'EW');

    return [...fromJsonLd, ...fromAttrs];
  } catch {
    return [];
  }
}

async function fetchUsamiOfficial() {
  const url = process.env.USAMI_SOURCE_URL ?? 'https://usappy.jp/ss';
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();

    const fromJsonLd = parseJsonLdBlocks(html)
      .map((j) => stationFromJsonLd(j, 'USAMI'))
      .filter(Boolean);
    const fromAttrs = parseStationsFromDataAttributes(html, 'USAMI');

    return [...fromJsonLd, ...fromAttrs];
  } catch {
    return [];
  }
}

function normalize(station) {
  if (!station?.name || !station?.address) return null;
  if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;
  return {
    ...station,
    name: station.name.trim(),
    address: station.address.trim()
  };
}

async function loadJsonFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function loadSeed() {
  const basePath = path.join(process.cwd(), 'data', 'station-seed.json');
  const extraPath = path.join(process.cwd(), 'data', 'station-extra.json');
  const [base, extra] = await Promise.all([loadJsonFile(basePath), loadJsonFile(extraPath)]);
  return [...base, ...extra];
}

async function upsertStations(stations) {
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

function dedupeStations(stations) {
  const bySource = new Map();
  for (const station of stations) {
    bySource.set(station.sourceId, station);
  }

  const byGeoName = new Map();
  for (const s of bySource.values()) {
    const key = `${s.brand}:${slug(s.name)}:${s.lat.toFixed(3)}:${s.lng.toFixed(3)}`;
    if (!byGeoName.has(key)) byGeoName.set(key, s);
  }

  return Array.from(byGeoName.values());
}

async function main() {
  const [seed, ew, usami] = await Promise.all([loadSeed(), fetchEwOfficial(), fetchUsamiOfficial()]);
  const merged = [...seed, ...ew, ...usami].map(normalize).filter(Boolean);
  const uniq = dedupeStations(merged);

  await upsertStations(uniq);
  console.log(`updated stations: ${uniq.length} (seed=${seed.length}, ew=${ew.length}, usami=${usami.length})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
