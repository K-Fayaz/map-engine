// Shared layout constants/helpers for the Phase 6 visual timeline (6.2) --
// used by the ruler (TimelineRuler.tsx) and, next 6.2 step, the scene
// block track itself, so tick positions and block widths stay on the same
// pixel-per-second scale instead of drifting independently.
export const PIXELS_PER_SECOND = 40;

// Picks a "nice" tick interval (seconds) so a ruler spanning
// totalDurationSeconds shows roughly targetTickCount ticks -- avoids
// unreadably dense ticks for short timelines or overly sparse ones for
// long timelines, without a full adaptive-labeling system.
const NICE_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
export function pickTickInterval(totalDurationSeconds: number, targetTickCount = 10): number {
  for (const interval of NICE_INTERVALS) {
    if (totalDurationSeconds / interval <= targetTickCount) return interval;
  }
  return NICE_INTERVALS[NICE_INTERVALS.length - 1];
}

// m:ss -- no hours. Phase 6 stories aren't expected to run that long; can
// grow to h:mm:ss later if that stops being true.
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
