import { Container, Graphics } from "pixi.js";
import type { Geometry, Position } from "./loadWorldData";
import type { Entity } from "./entities";

const BORDER_COLOR = 0x4a4a4a;

// Fixed world-space size geometry is projected into, decoupled from actual
// screen size. Geometry is built once against these constants; pan/zoom is
// then a cheap Container-level transform on top (see camera.ts /
// MapCanvas.tsx), not a re-projection. 2:1 ratio matches the projection's
// natural 360:180 degree range. The exact numbers don't matter -- only that
// they stay constant.
export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 1000;

export function project(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * WORLD_WIDTH;
  const y = ((90 - lat) / 180) * WORLD_HEIGHT;
  return [x, y];
}

function toPolygons(geometry: Geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

// A handful of Natural Earth rings (Russia's Chukotka peninsula, Fiji,
// Antarctica's polar closure edge) have consecutive points that jump from
// ~+180 to ~-180 longitude. Some of these are real coastline crossing the
// dateline; others are synthetic edges Natural Earth inserts to seal a
// polygon shut exactly along the map boundary (Antarctica's flat southern
// cap, for instance) and aren't reliably distinguishable from real crossings
// by their coordinates alone. Rather than bridging across the jump (which
// either draws a stray line across the whole map, or -- if "corrected" --
// can warp the shape into something spanning the whole map instead), this
// simply splits the ring into separate pieces at the jump, each closed on
// its own. The affected pieces close slightly differently than the true
// coastline right at the seam, but this avoids wrap-around glitches
// entirely and only touches this small set of dateline-straddling features.
export function splitAtAntimeridian(ring: Position[]): Position[][] {
  const pieces: Position[][] = [[]];
  let prevLon: number | null = null;

  for (const point of ring) {
    if (prevLon !== null && Math.abs(point[0] - prevLon) > 180) {
      pieces.push([]);
    }
    pieces[pieces.length - 1].push(point);
    prevLon = point[0];
  }

  // GeoJSON rings are closed loops: the array's start/end is just wherever
  // the data happened to begin tracing, not a real geographic break. If the
  // split above produced more than one piece, the first and last pieces are
  // actually one continuous piece that got cut apart by that arbitrary
  // array boundary (this is what caused Russia's mainland to render as a
  // stray diagonal -- its first and last pieces both dangled from the same
  // interior point instead of closing locally). Stitching them back together
  // leaves only the genuine antimeridian crossings as piece boundaries.
  if (pieces.length > 1) {
    const first = pieces.shift()!;
    const last = pieces.pop()!;
    pieces.push([...last, ...first]);
  }

  return pieces.filter((piece) => piece.length >= 3);
}

function projectPoints(points: Position[]): number[] {
  return points.flatMap(([lon, lat]) => project(lon, lat));
}

export function fillGeometry(graphics: Graphics, geometry: Geometry, fillColor: number) {
  for (const rings of toPolygons(geometry)) {
    rings.forEach((ring, ringIndex) => {
      for (const piece of splitAtAntimeridian(ring)) {
        const points = projectPoints(piece);
        graphics.poly(points, true);
        if (ringIndex === 0) {
          graphics.fill(fillColor);
        } else {
          graphics.cut();
        }
      }
    });
  }
}

// Strokes each ring independently (fill/stroke/cut share underlying path
// state in Pixi's Graphics API, so borders are drawn as a separate pass
// rather than chained onto the fill instructions above).
//
// Uses `pixelLine`: a GPU-native line primitive that always renders ~1
// device pixel wide, completely independent of the current camera zoom --
// so unlike a regular stroke, this never needs its width recomputed or its
// geometry rebuilt as the user zooms. Its one real drawback is that each
// segment is drawn as an independent primitive with no proper corner joins,
// so a coastline with many more points per unit length ends up with
// proportionally more overlapping antialiased joints, reading as a visibly
// bolder line purely from point density -- independent of any width
// setting. That's why MapCanvas.tsx always calls this with 50m-resolution
// geometry for the border, even when the fill underneath it is showing 10m
// detail: one consistent (and comfortably low) point density, so the
// border never needs rebuilding for either zoom *or* LOD changes -- it's
// built once and never touched again.
//
// `color` is the only stylable parameter here -- pixelLine ignores `width`
// entirely (Pixi's pixel-line build path doesn't take a line style at all),
// so a thinner/thicker line isn't achievable this way. Callers that want
// state borders to read as subordinate to country borders (see
// MapCanvas.tsx) do it with a lighter color, not a thinner one.
export function strokeGeometry(graphics: Graphics, geometry: Geometry, color: number = BORDER_COLOR) {
  for (const rings of toPolygons(geometry)) {
    for (const ring of rings) {
      for (const piece of splitAtAntimeridian(ring)) {
        const points = projectPoints(piece);
        graphics.poly(points, true).stroke({ width: 1, color, pixelLine: true });
      }
    }
  }
}

// `fill` and `stroke` are separate, persistent children rather than one
// combined Graphics: LOD swaps only ever need to redraw `fill` (via
// `.clear()` + refill) to show the new resolution's coastline shape --
// `stroke` is built once from stable 50m data and never touched again, so
// keeping them apart means a LOD swap doesn't pay to rebuild borders it
// isn't changing.
export class CountryContainer extends Container {
  fill = new Graphics();
  stroke = new Graphics();

  constructor(public entity: Entity) {
    super();
    this.addChild(this.fill);
    this.addChild(this.stroke);
  }
}
