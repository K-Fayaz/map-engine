import "./TimelineRuler.css";
import { PIXELS_PER_SECOND, pickTickInterval, formatTimestamp } from "./timelineLayout";

// Timestamp ruler above the scene block track (Phase 6, 6.2). Ticks are
// spaced by pickTickInterval's "nice" interval and extend one tick past
// totalDurationSeconds, so the ruler doesn't end exactly at the last
// block's edge (matches how video editors give the track trailing room).
// No playhead here -- that's 6.3's job (scrub sync); this is purely a
// static timestamp reference.
export function TimelineRuler({ totalDurationSeconds }: { totalDurationSeconds: number }) {
  const interval = pickTickInterval(totalDurationSeconds);
  const rulerEnd = Math.ceil(totalDurationSeconds / interval) * interval;
  const ticks: number[] = [];
  for (let t = 0; t <= rulerEnd; t += interval) ticks.push(t);

  return (
    <div className="timeline-ruler" style={{ width: rulerEnd * PIXELS_PER_SECOND }}>
      {ticks.map((t) => (
        <div key={t} className="timeline-ruler-tick" style={{ left: t * PIXELS_PER_SECOND }}>
          <span className="timeline-ruler-label">{formatTimestamp(t)}</span>
        </div>
      ))}
    </div>
  );
}
