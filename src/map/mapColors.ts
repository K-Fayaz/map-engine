// External color config so map styling isn't hardcoded per-country -- swap
// this file's palette to change the whole map's look without touching
// rendering code. See .development_logs/changelog.md for the "political
// map" coloring discussion this was built for.

export const oceanColor: number = 0xaee2f2;

export const landPalette: number[] = [
  0x9ec9e2, // blue
  0xf6e27a, // yellow
  0xf3a6c2, // pink
  0xb5d99c, // green
  0xf5b26b, // orange
  0xc7a6d9, // purple
  0x8fd1c7, // teal
  0xe8a6a0, // salmon
];

// Deterministic string hash (FNV-1a) so the same country id always maps to
// the same palette color across renders, LOD swaps, and exports, without
// needing adjacency-based graph coloring.
function hashString(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function colorForCountry(id: string): number {
  return landPalette[hashString(id) % landPalette.length];
}

// Fallback color for scene highlights that don't specify their own (old
// scenes saved before per-scene color existed, or manual map clicks outside
// scene playback). Same value the highlight overlay always used before it
// became customizable.
export const defaultSelectionColor: number = 0xffa000;

// Conversions between Pixi's packed-number hex (0xrrggbb) and the
// "#rrggbb" string an <input type="color"> speaks.
export function numberToHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
