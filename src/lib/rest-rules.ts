import { RestWindow, RouteSummary, StopCandidate } from '@/lib/types';

export function buildRestWindows(input: {
  route: RouteSummary;
  departAtIso: string;
  allowExtendedDrive: boolean;
  restStyle: 'SINGLE_30' | 'MULTI_10';
  restCandidates: StopCandidate[];
}): RestWindow[] {
  const driveLimitMin = input.allowExtendedDrive ? 270 : 240;
  const breakMin = input.restStyle === 'SINGLE_30' ? 30 : 30;

  const windows: RestWindow[] = [];
  const totalDuration = input.route.totalDurationMin;

  let elapsed = driveLimitMin;
  let idx = 1;

  while (elapsed < totalDuration + 30) {
    const windowStart = Math.max(elapsed - 30, 30);
    const windowEnd = elapsed;

    const eligible = input.restCandidates
      .filter((candidate) => candidate.distanceFromStartKm >= 0)
      .filter((candidate) => {
        const minutesFromStart = etaDiffMin(input.departAtIso, candidate.etaIso);
        return minutesFromStart >= windowStart && minutesFromStart <= windowEnd;
      })
      .sort((a, b) => a.distanceFromRouteKm - b.distanceFromRouteKm);

    windows.push({
      windowId: idx,
      targetDriveLimitMin: driveLimitMin,
      startAfterMin: windowStart,
      endByMin: windowEnd,
      targetBreakMin: breakMin,
      etaIso: addMinutes(input.departAtIso, elapsed),
      primaryCandidates: eligible.slice(0, 8),
      backupCandidates: eligible.slice(8, 12)
    });

    idx += 1;
    elapsed += driveLimitMin;
  }

  return windows;
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function etaDiffMin(startIso: string, etaIso: string): number {
  const s = new Date(startIso).getTime();
  const e = new Date(etaIso).getTime();
  return (e - s) / 60000;
}
