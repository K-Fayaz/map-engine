import { Container, Graphics, BitmapText, BitmapFont, Matrix, type Texture } from "pixi.js";
import type { AreaGeometry, LineGeometry, Position } from "./loadWorldData";
import type { Entity } from "./entities";
import { clampCamera, MIN_ZOOM, type Camera } from "./camera";

const BORDER_COLOR = 0x4a4a4a;

// Fixed world-space size geometry is projected into, decoupled from actual
// screen size. Geometry is built once against these constants; pan/zoom is
// then a cheap Container-level transform on top (see camera.ts /
// MapCanvas.tsx), not a re-projection. Square (1:1), matching standard Web
// Mercator's own conformal base aspect (every tile-based web map -- Google/
// OSM/Mapbox -- uses the same square ratio) -- not the 2:1 the previous
// equirectangular projection used, which would apply Mercator's shape inside
// the wrong-shaped box. The exact numbers don't matter -- only that they
// stay constant and equal to each other.
export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 2000;

// Standard Web Mercator clip latitude (Google/OSM/Mapbox all use this same
// value) -- true Mercator sends the poles to infinite y, so latitude must be
// clamped before projecting. Real Antarctic coastline in the vendored data
// only reaches ~-85.2 deg (see isPolarClosureRing below), so this trims a
// negligible sliver, not a visible chunk.
const MAX_MERCATOR_LAT = 85.0511287798;

export function project(lon: number, lat: number): [number, number] {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const x = ((lon + 180) / 360) * WORLD_WIDTH;
  const latRad = (clampedLat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = (0.5 - mercN / (2 * Math.PI)) * WORLD_HEIGHT;
  return [x, y];
}

// Exact inverse of project() -- used by hit-testing (see MapCanvas.tsx) to
// turn a world-space point (already recovered from screen space via
// camera.ts's screenToWorld) back into lon/lat for pointInPolygon.
export function unproject(x: number, y: number): [number, number] {
  const lon = (x / WORLD_WIDTH) * 360 - 180;
  const mercN = (0.5 - y / WORLD_HEIGHT) * 2 * Math.PI;
  const lat = (2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

// The shared "default World view" camera -- {x:0, y:0, zoom:MIN_ZOOM} --
// centralized here instead of four call sites (MapCanvas.tsx's initial
// camera, its "Pan to World" case, its "Start from world view" glide-start,
// and timelineResolver.ts's equivalent world-pan/no-prior-scene fallback)
// each independently re-hardcoding the same literal. Once worldRenderer.ts's
// applyViewFit cover-fits the world to the canvas (fills it completely, no
// letterboxing), zoom=MIN_ZOOM already means exactly "the world fills the
// screen" -- an earlier attempt to derive this via focusOnBounds against a
// deliberately tighter latitude band (to shrink the poles' visual share of
// a *contain-fit* default view) turned out to be a dead end once cover-fit
// made that unnecessary: keeping full longitude width always pinned the
// focusOnBounds-derived zoom at exactly 1 anyway, so the extra machinery
// added complexity for no remaining benefit. `screenWidth`/`screenHeight`/
// `baseScaleX`/`baseScaleY` are unused here now, kept only so call sites
// don't need to change if this ever needs bounds-based framing again.
// `zoomMultiplier` supports a Pan-to-World scene's own Zoom% field.
export function worldViewCamera(
  screenWidth: number,
  screenHeight: number,
  _baseScaleX: number,
  _baseScaleY: number,
  maxZoom: number,
  zoomMultiplier: number = 1,
): Camera {
  return clampCamera({ x: 0, y: 0, zoom: MIN_ZOOM * zoomMultiplier }, screenWidth, screenHeight, maxZoom);
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

// Some Natural Earth polygons (Antarctica, specifically) include an extra
// ring that's not real coastline at all: a full sweep across every
// longitude at a constant latitude essentially equal to the pole (observed:
// 257 points, every one within a hundredth of a degree of lat -90) --
// a technical closure Natural Earth inserts to seal a polygon shut exactly
// along the map's flat polar edge. In an equirectangular projection this
// degenerates into a near-zero-height shape spanning the full map width
// right at that edge; if it's drawn as a normal ring (see fillGeometry/
// strokeGeometry below), it renders as a thin filled/stroked sliver at the
// bottom of the map, distinct from -- and rendered in addition to -- the
// real Antarctic coastline (which comes from other, normally-shaped
// polygons in the same MultiPolygon and renders correctly on its own).
// Detected generically (not by feature name), since no legitimate ring
// anywhere else in the vendored data comes anywhere close to true polar
// latitude -- ordinary antimeridian crossings (Fiji, Russia) sit at
// everyday latitudes, nowhere near this threshold.
const POLE_LAT_EPSILON = 0.01;

function isPolarClosureRing(ring: Position[]): boolean {
  return ring.every(([, lat]) => 90 - Math.abs(lat) < POLE_LAT_EPSILON);
}

// After splitAtAntimeridian's merge step, a ring whose real coastline
// sweeps through (almost) the full 360° of longitude while staying near
// one pole -- Antarctica is the only such case in the vendored data --
// still has one unresolved "wrap": its own first and last point sit on
// opposite sides of the antimeridian (still >180° apart even after
// merging), and auto-closing that with a single straight edge cuts a long
// diagonal chord across most of the map. Measured concretely: Antarctica's
// ring closes from (179.622°, -84.268°) to (-180°, -84.352°) -- a real,
// short (~0.4°) coastline connection geographically, but a chord spanning
// ~1998 of the map's 2000-unit width once projected, drawn by both the
// fill and the border stroke.
//
// Fixed by routing that closing edge along the map's own border instead:
// out to the nearest edge (lon = +-180) at the point's own latitude, down
// to the pole itself (lat = +-90 -- project()'s own MAX_MERCATOR_LAT clamp
// already pulls this to the map's real bottom/top edge, no special-casing
// needed here), across to the other endpoint's edge, then the existing
// auto-close finishes the connection -- right-edge-down, bottom-edge-
// across, left-edge-up, instead of a diagonal chord through the middle.
// Exactly how any atlas draws a pole-sweeping landmass on a flat,
// non-wrapping map.
//
// Deliberately only used by fillGeometry/strokeGeometry below, not folded
// into splitAtAntimeridian itself -- that function is also used by
// entities.ts for computeArea and point-in-polygon hit-testing, where
// inserting extra boundary points would wrongly inflate Antarctica's
// computed area and hit-test region. Gated on "every point of this piece
// is past +-60° latitude" so ordinary, non-polar antimeridian crossings
// (Russia's Chukotka peninsula, Fiji, the USA's Aleutians) are never
// affected -- their own closing chord is comparatively short/subtle and
// stays exactly as splitAtAntimeridian already produces it, an accepted,
// documented imperfection, not something to touch here.
function closePolarWrap(piece: Position[]): Position[] {
  const first = piece[0];
  const last = piece[piece.length - 1];
  if (Math.abs(last[0] - first[0]) <= 180) return piece;

  const allSouth = piece.every(([, lat]) => lat < -60);
  const allNorth = piece.every(([, lat]) => lat > 60);
  if (!allSouth && !allNorth) return piece;

  const poleLat = allSouth ? -90 : 90;
  const lastEdgeLon = last[0] > 0 ? 180 : -180;
  const firstEdgeLon = first[0] > 0 ? 180 : -180;

  return [...piece, [lastEdgeLon, last[1]], [lastEdgeLon, poleLat], [firstEdgeLon, poleLat]];
}

// `alpha` defaults to 1 (fully opaque, existing behavior for land/country
// fills) -- overridable for translucent highlight overlays (see
// MapCanvas.tsx's hover/selection highlight).
export function fillGeometry(
  graphics: Graphics,
  geometry: AreaGeometry,
  fillColor: number,
  alpha: number = 1,
) {
  for (const rings of toPolygons(geometry)) {
    // Drops polar-closure rings before assigning fill/cut roles below, not
    // just skipping them in place -- for Antarctica's own coastline
    // (the real, detailed ring), the polar-closure ring happens to be
    // *first*, so leaving it in and only skipping its own draw call would
    // leave the real coastline ring at ringIndex 1, permanently treated as
    // a hole to `cut()` rather than the exterior to `fill()` -- silently
    // discarding the actual detailed coastline along with the synthetic
    // edge. Filtering first means whatever ring is real ends up at index 0
    // and gets filled, same as any ordinary single-ring country.
    const realRings = rings.filter((ring) => !isPolarClosureRing(ring));
    if (realRings.length === 0) continue;
    realRings.forEach((ring, ringIndex) => {
      for (const piece of splitAtAntimeridian(ring).map(closePolarWrap)) {
        const points = projectPoints(piece);
        graphics.poly(points, true);
        if (ringIndex === 0) {
          graphics.fill({ color: fillColor, alpha });
        } else {
          graphics.cut();
        }
      }
    });
  }
}

// Same ring/hole/antimeridian-split iteration as fillGeometry, but fills
// with an image (e.g. a flag) instead of a flat color -- used for a scene
// highlight's "image" fill mode (see scenes.ts's `fillMode`). Each ring is
// still its own `poly()`+`fill()` call, so `textureSpace: "local"` (no
// explicit `matrix`) makes Pixi auto-scale the texture to exactly stretch
// across *that ring's own* bounding box (see generateTextureFillMatrix in
// pixi.js) -- correct, simple, and needs no manual bounds/Matrix math for
// the common single-ring-per-piece case. A multi-piece antimeridian-split
// country (Russia, Fiji) ends up with the same texture independently
// stretched per piece rather than one continuous image across all of
// them -- an acceptable simplification, not a broken result (each piece
// still shows a correctly cropped, undistorted-relative-to-itself flag).
//
// `offsetX`/`offsetY` (each a fraction of the ring's own projected
// bounding box, e.g. 0.1 = 10% of its width/height) pan which part of the
// texture shows through that same fixed silhouette -- the Instruction
// Builder's Flag/Image Position sliders. `scale` (1 = the default
// stretch-fill, unaffected) additionally zooms in/out -- the Instruction
// Builder's upload-only Scale slider (flags never pass a non-1 scale).
//
// Two different matrix formulas, deliberately kept separate rather than
// unified into one:
// - `scale === 1` (always true for flags, the common case): the original
//   plain-translate formula (`-offsetX * boundsWidth` in *raw* pixel
//   units, not inverted by us -- Pixi's `generateTextureMatrix` inverts
//   `style.matrix` internally) exactly as first shipped. Deliberately not
//   replaced by the normalized-unit version below even though that one is
//   arguably more "correct" in isolation -- swapping it changed the flag
//   sliders' actual feel (confirmed by the user against the real running
//   app, a real regression, not just a units cleanup), so this path stays
//   bit-for-bit what shipped and was already tuned/accepted.
// - `scale !== 1` (upload-only, via the Scale slider -- flags have no
//   Scale control): a normalized-`[0,1]` UV formula (`k = 1/scale`,
//   translate term `(1-k)/2 - offset*k`) that folds pan and zoom into one
//   matrix -- necessary because the plain-translate formula above has no
//   zoom concept and doesn't compose with one. This path has no prior
//   "before" behavior to preserve, since Scale is new.
export function fillGeometryTexture(
  graphics: Graphics,
  geometry: AreaGeometry,
  texture: Texture,
  offsetX: number = 0,
  offsetY: number = 0,
  scale: number = 1,
) {
  for (const rings of toPolygons(geometry)) {
    const realRings = rings.filter((ring) => !isPolarClosureRing(ring));
    if (realRings.length === 0) continue;
    realRings.forEach((ring, ringIndex) => {
      for (const piece of splitAtAntimeridian(ring).map(closePolarWrap)) {
        const points = projectPoints(piece);
        graphics.poly(points, true);
        if (ringIndex === 0) {
          if (offsetX === 0 && offsetY === 0 && scale === 1) {
            graphics.fill({ texture, textureSpace: "local" });
          } else if (scale === 1) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < points.length; i += 2) {
              minX = Math.min(minX, points[i]);
              maxX = Math.max(maxX, points[i]);
              minY = Math.min(minY, points[i + 1]);
              maxY = Math.max(maxY, points[i + 1]);
            }
            const matrix = new Matrix().translate(-offsetX * (maxX - minX), -offsetY * (maxY - minY));
            graphics.fill({ texture, matrix, textureSpace: "local" });
          } else {
            const k = 1 / scale;
            const cX = (1 - k) / 2 - offsetX * k;
            const cY = (1 - k) / 2 - offsetY * k;
            const matrix = new Matrix(k, 0, 0, k, cX, cY).invert();
            graphics.fill({ texture, matrix, textureSpace: "local" });
          }
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
      // Same reasoning as fillGeometry above -- skip only the synthetic
      // ring itself, not the rest of this polygon's real rings (which
      // includes Antarctica's actual detailed coastline).
      if (isPolarClosureRing(ring)) continue;
      for (const piece of splitAtAntimeridian(ring).map(closePolarWrap)) {
        const points = projectPoints(piece);
        graphics.poly(points, true).stroke({ width: 1, color, pixelLine: true });
      }
    }
  }
}

// Rivers' line equivalent of strokeGeometry -- same pixelLine primitive
// (zoom-invariant width, no corner joins), but drawn open (`poly(points,
// false)`) instead of closed: a river is a path, not a ring, so there's no
// "last point connects back to the first" to draw and no fill concept at
// all (see loadWorldData.ts's LineGeometry comment).
//
// Deliberately skips splitAtAntimeridian, unlike every polygon-drawing
// function in this file: that helper's "stitch the first and last split
// piece back together" step (see its own comment) assumes a closed ring,
// which doesn't hold for an open path -- applying it here could stitch two
// genuinely unrelated ends of a river together. No river in the vendored
// data actually crosses the antimeridian, so this is "guaranteed correct
// handling of a case that doesn't occur" traded for "no risk of misapplying
// ring-closure logic to a path where it doesn't belong" -- lower stakes
// either way than the polygon cases that motivated splitAtAntimeridian in
// the first place.
export function strokeLine(graphics: Graphics, geometry: LineGeometry, color: number = BORDER_COLOR) {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  for (const line of lines) {
    const points = projectPoints(line);
    graphics.poly(points, false).stroke({ width: 1, color, pixelLine: true });
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
    // `fill: "#ffffff"` bakes the atlas glyphs in white, not the canvas
    // default (black). LabelText's per-instance `style.color` works by
    // *multiplicatively tinting* this baked texture, not repainting it --
    // white is the only base that lets that multiply reach every color
    // freely (white * color = color). A black-baked atlas can only ever
    // tint *darker* than black, i.e. stay black, regardless of the
    // requested color -- silently broke SEA_LABEL_STYLE's light color in
    // MapCanvas.tsx (rendered black instead of near-white) until this was
    // caught by actually looking at a screenshot, not just trusting the
    // color value was applied.
    style: { fontFamily: "sans-serif", fontSize: 32, fill: "#ffffff" },
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
