import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildRestWindows } from '@/lib/rest-rules';
import { fetchRouteSummary } from '@/lib/route';
import { fetchRestCandidatesFromOverpass } from '@/lib/overpass';
import { fetchRestCandidatesFromGooglePlaces } from '@/lib/places';
import { fetchRestCandidatesFromSeed } from '@/lib/rest-seed';
import { fetchFuelCandidates } from '@/lib/stations';
import { ensureFuelStationMasterReady } from '@/lib/fuel-bootstrap';
import { buildFallbackRouteInputFromCoords, resolveGoogleRouteInput } from '@/lib/url-parser';
import { PlanRequest, PlanResponse, RouteSummary, StopCandidate } from '@/lib/types';

const requestSchema = z.object({
  mapUrl: z.string().url(),
  departAtIso: z.string().datetime(),
  extraWaypoints: z.array(z.string()).optional(),
  includeRouteDetails: z.boolean().optional(),
  allowExtendedDrive: z.boolean(),
  restStyle: z.enum(['SINGLE_30', 'MULTI_10']),
  facilityTypes: z.object({
    saPa: z.boolean(),
    expresswayRest: z.boolean(),
    michiNoEki: z.boolean()
  }),
  equipment: z.object({
    shower: z.boolean(),
    open24h: z.boolean(),
    convenience: z.boolean(),
    largeParking: z.boolean()
  }),
  fuelBrand: z.enum(['EW', 'USAMI', 'BOTH']),
  prioritizeHighwayStations: z.boolean(),
  fuelRangeKm: z.number().positive().optional(),
  fuelRangePreset: z.union([z.literal(50), z.literal(100), z.literal(150), z.literal(200)]).optional()
});

export async function POST(req: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const input = parsed.data as PlanRequest;
    const includeRouteDetails = input.includeRouteDetails ?? false;
    const warnings: string[] = [];

    try {
      const fuelMaster = await ensureFuelStationMasterReady();
      warnings.push(...fuelMaster.warnings);
    } catch (e) {
      warnings.push(`給油マスター初期化に失敗: ${stringifyError(e)}`);
    }

    const routeInput = await resolveGoogleRouteInput(input.mapUrl, input.extraWaypoints ?? []);
    let route: RouteSummary;
    try {
      route = await fetchRouteSummary({
        origin: routeInput.origin,
        destination: routeInput.destination,
        waypoints: routeInput.waypoints
      });
    } catch (e) {
      const message = stringifyError(e);
      const shouldRetry = /NOT_FOUND|ZERO_RESULTS/.test(message);
      if (!shouldRetry) throw e;

      const fallback = buildFallbackRouteInputFromCoords(routeInput.expandedUrl, routeInput.waypoints);
      if (!fallback) {
        throw new Error(
          'Googleマップ共有URLから地点抽出に失敗しました。追加経由地に出発地/到着地を入力して再実行してください。'
        );
      }

      route = await fetchRouteSummary(fallback);
      warnings.push('URL補正でルート再取得しました（座標フォールバック）。');
    }

    let restCandidates: StopCandidate[] = [];

    try {
      restCandidates = await fetchRestCandidatesFromOverpass({
        route,
        departAtIso: input.departAtIso,
        facilityTypes: input.facilityTypes,
        equipment: input.equipment
      });
    } catch (e) {
      warnings.push(`休憩候補抽出に失敗したため空リストで返却: ${stringifyError(e)}`);
    }

    if (restCandidates.length === 0) {
      try {
        restCandidates = await fetchRestCandidatesFromGooglePlaces({
          route,
          departAtIso: input.departAtIso,
          facilityTypes: input.facilityTypes,
          equipment: input.equipment
        });
        if (restCandidates.length > 0) {
          warnings.push('Overpass候補が不足したためGoogle Placesで補完しました。');
        }
      } catch (e) {
        warnings.push(`Google Places補完に失敗: ${stringifyError(e)}`);
      }
    }

    if (restCandidates.length === 0) {
      try {
        restCandidates = await fetchRestCandidatesFromSeed({
          route,
          departAtIso: input.departAtIso,
          facilityTypes: input.facilityTypes,
          equipment: input.equipment
        });
        if (restCandidates.length > 0) {
          warnings.push('外部API候補が不足したためローカル休憩マスターで補完しました。');
        }
      } catch (e) {
        warnings.push(`ローカル休憩マスター補完に失敗: ${stringifyError(e)}`);
      }
    }

    const fuelRangeKm = input.fuelRangeKm ?? input.fuelRangePreset ?? 100;
    let fuelCandidates: StopCandidate[] = [];
    try {
      fuelCandidates = await fetchFuelCandidates({
        route,
        departAtIso: input.departAtIso,
        fuelBrand: input.fuelBrand,
        fuelRangeKm,
        prioritizeHighwayStations: input.prioritizeHighwayStations
      });
    } catch (e) {
      warnings.push(`給油候補抽出に失敗したため空リストで返却: ${stringifyError(e)}`);
    }

    const restWindows = buildRestWindows({
      route,
      departAtIso: input.departAtIso,
      allowExtendedDrive: input.allowExtendedDrive,
      restStyle: input.restStyle,
      restCandidates
    });

    const payload: PlanResponse = {
      status: warnings.length > 0 ? 'fallback' : 'ok',
      warnings,
      extractedRouteInput: {
        finalExpandedUrl: routeInput.expandedUrl,
        origin: routeInput.origin,
        destination: routeInput.destination,
        waypoints: routeInput.waypoints
      },
      route: includeRouteDetails
        ? route
        : {
            ...route,
            polyline: '',
            points: []
          },
      restWindows,
      fuelCandidates
    };

    if (restCandidates.length === 0) {
      payload.warnings.push('条件に一致する休憩候補が0件です。フィルタを緩めるか経由地を追加してください。');
    }
    if (fuelCandidates.length === 0) {
      payload.warnings.push('条件に一致する給油候補が0件です。距離レンジやブランド設定を見直してください。');
    }

    return NextResponse.json(payload);
  } catch (e) {
    const message = stringifyError(e);
    let hint = 'URL解析失敗時は追加経由地を入力して再実行してください。';
    if (message.includes('GOOGLE_MAPS_API_KEY')) {
      hint = '`.env` の GOOGLE_MAPS_API_KEY を設定してください。';
    } else if (message.includes('REQUEST_DENIED') || message.includes('API key is expired')) {
      hint = 'Google APIキーの有効期限・API制限（Directions/Places）・請求設定を確認してください。';
    } else if (message.includes('NOT_FOUND') || message.includes('ZERO_RESULTS')) {
      hint = 'Googleマップ共有URLから地点抽出に失敗しました。追加経由地に出発地/到着地を入力して再実行してください。';
    } else if (message.includes('DATABASE_URL') || message.includes('datasource') || message.includes('FuelStation')) {
      hint = 'DATABASE_URL を外部Postgresに設定し、マイグレーション後に再実行してください。';
    }
    return NextResponse.json(
      {
        error: message,
        hint
      },
      { status: 500 }
    );
  }
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
