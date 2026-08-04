import { Container, Graphics, BitmapText, BitmapFont } from "pixi.js";
import type { AreaGeometry, Position } from "./loadWorldData";
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

function toPolygons(geometry: AreaGeometry) {
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

export function fillGeometry(graphics: Graphics, geometry: AreaGeometry, fillColor: number) {
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
export function strokeGeometry(graphics: Graphics, geometry: AreaGeometry, color: number = BORDER_COLOR) {
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

export interface LabelStyle {
  fontSize: number;
  color: number;
}

const DEFAULT_LABEL_STYLE: LabelStyle = { fontSize: 14, color: 0x333333 };

const LABEL_FONT_FAMILY = "MapLabelFont";

// Every character that appears in any country or state label name in the
// vendored data (src/map/data/states-10m.json + world-atlas's
// countries-*.json), derived by scanning both files directly rather than
// guessing a broad Unicode range. All romanized/Latin-script (Vietnamese,
// Azerbaijani, Romanian, etc. diacritics included) -- Natural Earth's
// admin-1 `name` field turned out not to use native non-Latin scripts
// (Cyrillic, CJK, ...) for any country in this dataset. If the vendored
// label data ever changes, regenerate this by scanning both files' `name`
// properties for their union of characters -- an out-of-date set doesn't
// break anything, it just silently drops unlisted glyphs from rendered
// labels.
const LABEL_FONT_CHARS =
  " '(),-./ABCDEFGHIJKLMNOPQRSTUVWXYZ[]`abcdefghijklmnopqrstuvwxyzÁÅÇÉÎÐÑÓÖØÚàáâãäåæçèéêëìíîïðñòóôõöøúûüýĀāăćċČčĐĔęğĠġĦħĩīĭİıŁňŌōŏœřŚŞşŠšţũūźŻżŽžơưȘșəḍḩḷṇṭạảậắằẵếềệịọồộớừ–";

// A bitmap font is a texture atlas of pre-rendered glyphs, generated once;
// after that, constructing any number of BitmapText instances is cheap
// (glyph lookup + layout, no canvas work) -- unlike Pixi's regular Text,
// which rasterizes each distinct string to its own canvas + GPU texture on
// first render. That per-string cost is what made building ~4600 state
// labels expensive the moment they were first revealed (~1.9s of blocking
// work, measured via chrome-devtools): switching to a shared bitmap font
// moves that cost to one upfront atlas generation instead of one per label.
// Installed lazily (once) rather than at module load, since BitmapFont.install
// touches the renderer/canvas and doesn't need to run before it's needed.
let labelFontInstalled = false;
function ensureLabelFontInstalled() {
  if (labelFontInstalled) return;
  BitmapFont.install({
    name: LABEL_FONT_FAMILY,
    style: { fontFamily: "sans-serif", fontSize: 32 },
    chars: LABEL_FONT_CHARS,
    resolution: 2,
  });
  labelFontInstalled = true;
}

// A label's BitmapText, positioned once at its world anchor and never
// repositioned again -- once added under worldContainer (see
// counterScaleLabelLayer below), Pixi's normal parent-child transform
// carries it through every pan/zoom automatically, the same way
// CountryContainer's fill/stroke are, so there's no per-frame position
// recompute needed here. fontSize/fill are freely overridable per instance
// even though the underlying atlas was generated at one fixed size/color
// (see BitmapText's own docs) -- country and state labels share the one
// installed font rather than needing one installed per style.
export class LabelText extends BitmapText {
  entity: Entity;

  constructor(entity: Entity, style: LabelStyle = DEFAULT_LABEL_STYLE) {
    ensureLabelFontInstalled();
    super({
      text: entity.name,
      style: { fontFamily: LABEL_FONT_FAMILY, fontSize: style.fontSize, fill: style.color },
      anchor: 0.5,
    });

    // Guaranteed by construction (see entities.ts's buildLabelEntities) --
    // this is a label entity, so its geometry is always a Point. Checked
    // at runtime rather than trusted blindly since, unlike the AreaGeometry
    // casts in MapCanvas.tsx, there's no static entity-array-level guarantee
    // here (LabelText can be constructed from any Entity).
    if (entity.geometry.type !== "Point") {
      throw new Error(`LabelText: entity "${entity.id}" has no Point geometry`);
    }
    const [lon, lat] = entity.geometry.coordinates;
    const [x, y] = project(lon, lat);

    this.entity = entity;
    this.position.set(x, y);

    // Every label in this app goes through MapCanvas.tsx's decluttering
    // pass (viewport culling + collision placement) before it's ever meant
    // to actually show -- but that pass runs on a debounce, while a label
    // layer's own container-level `.visible` can flip on immediately
    // (every tick). Defaulting to hidden here closes that gap: without it,
    // up to a whole layer's worth of never-yet-culled labels (thousands,
    // for states) sit at Pixi's default `visible=true` and get rendered in
    // a single expensive burst the moment their layer turns on, before the
    // debounced pass has had a chance to hide the ones that should stay
    // hidden. Measured this directly -- a label layer's first reveal
    // produced a 525ms long task that vanished once labels defaulted to
    // hidden instead.
    this.visible = false;
  }
}

// Cancels each label's inherited zoom stretch so text renders at a constant
// screen-pixel size regardless of camera zoom.
//
// This must be applied per-*label*, not to a shared parent layer: a
// Container's `position` is transformed by its *own* scale before its
// parent's, so scaling the layer itself doesn't just shrink rendered text
// size -- it also shrinks every child's stored position back toward the
// layer's local origin, collapsing all labels toward one point instead of
// leaving them pinned at their correct world location. (Learned the hard
// way -- an earlier version scaled the layer and every label ended up
// thousands of pixels off-screen, silently rendering nothing.) A node's own
// scale, by contrast, only affects its own rendering size, not its own
// position, so applying this to each LabelText individually keeps position
// and size independent, which is what's actually needed here.
export function counterScaleLabelLayer(
  layer: Container,
  baseScaleX: number,
  baseScaleY: number,
  zoom: number,
) {
  const sx = 1 / (baseScaleX * zoom);
  const sy = 1 / (baseScaleY * zoom);
  for (const child of layer.children) {
    child.scale.set(sx, sy);
  }
}
