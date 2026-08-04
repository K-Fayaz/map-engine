// Pure label-decluttering math, no Pixi/DOM dependency -- MapCanvas.tsx
// gathers each label's actual screen-space box (from Pixi) and camera.ts's
// viewportWorldBounds narrows the candidate list to what's on-screen; this
// module only decides, given boxes + importance, which labels win.

export interface LabelCandidate {
  id: string;
  importance: number;
  // Screen-space bounding box.
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: LabelCandidate, b: LabelCandidate): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Greedy label placement: sort candidates by importance (descending), then
// walk down the list keeping each one only if its screen-space box doesn't
// overlap a higher-priority box already kept. This is the same core
// algorithm most map renderers (Mapbox/Maplibre, Google Maps) use for label
// decluttering -- not true optimal placement (that's NP-hard), but a
// cheap, well-understood approximation: O(n^2) worst case, but only against
// the labels that have survived so far, and n here is already small after
// viewport culling narrows candidates down from ~4800 to whatever's
// actually on screen.
export function placeLabelsWithoutOverlap(candidates: LabelCandidate[]): Set<string> {
  const sorted = [...candidates].sort((a, b) => b.importance - a.importance);
  const placed: LabelCandidate[] = [];
  const visible = new Set<string>();

  for (const candidate of sorted) {
    if (placed.some((p) => rectsOverlap(candidate, p))) continue;
    placed.push(candidate);
    visible.add(candidate.id);
  }

  return visible;
}
