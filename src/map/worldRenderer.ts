import { Container, Graphics } from "pixi.js";
import { loadWorldData, INDIA_COUNTRY_ID, type Resolution, type AreaGeometry, type LineGeometry } from "./loadWorldData";
import { loadStatesData } from "./loadStatesData";
import { loadLakesData } from "./loadLakesData";
import { loadRiversData } from "./loadRiversData";
import { loadSeasData } from "./loadSeasData";
import {
  buildCountryEntities,
  buildStateEntities,
  buildLakeEntities,
  buildRiverEntities,
  buildSeaEntities,
  buildLabelEntities,
  type Entity,
} from "./entities";
import {
  fillGeometry,
  fillGeometryTexture,
  strokeGeometry,
  strokeLine,
  project,
  CountryContainer,
  LabelText,
  counterScaleLabelLayer,
  type LabelStyle,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./render";
import type { Camera } from "./camera";
import { colorForCountry, oceanColor, defaultSelectionColor } from "./mapColors";
import { cachedFlagTexture, loadFlagTexture } from "./flags";

// A scene highlight's fill, as resolved by whichever consumer is calling
// drawHighlights (MapCanvas.tsx's live path, exportPipeline.ts). `fillMode`
// is last-edit-wins per-scene state (see scenes.ts) -- "image" only takes
// effect when `flagCode` is set AND its texture is already cached; an
// uncached texture (or fillMode "color") falls back to `color`, same as
// today's plain color highlight.
export interface HighlightFill {
  color: number;
  flagCode: string | null;
  fillMode: "color" | "image";
  // Fraction of the entity's own bounding box (e.g. 0.1 = 10% of its
  // width/height) to pan the flag image within its fixed silhouette --
  // the Instruction Builder's position sliders. 0 (centered) is the
  // fill's original, unadjusted position.
  flagOffsetX: number;
  flagOffsetY: number;
}

const DEFAULT_HIGHLIGHT_FILL: HighlightFill = {
  color: defaultSelectionColor,
  flagCode: null,
  fillMode: "color",
  flagOffsetX: 0,
  flagOffsetY: 0,
};

// The scene-graph construction, highlight drawing, and camera-application
// pieces of what used to be one large closure inside MapCanvas.tsx's mount
// effect -- extracted so both the live canvas and a future headless/offscreen
// export renderer can share exactly the same rendering logic instead of it
// drifting into two diverging copies (see .development_logs/export.md and
// the video-export plan). Deliberately excludes anything tied to a live,
// interactive session: pointer/wheel handling, drag state, the ticker,
// scriptedPan/wall-clock camera driving, and debounced LOD/label-declutter
// scheduling all stay in MapCanvas.tsx, since none of that applies to a
// non-interactive, deterministic export frame. This module also has no
// dependency on interactionStore -- every piece of live/mutable state it
// would otherwise read (selected/hovered entity, showStateBorders) is instead
// an explicit parameter, so a caller (live or export) supplies its own
// current value rather than this module reaching for a global singleton.

// Labels (country/state) are mid-rework -- state-layer decluttering still
// has known overlap issues (see .development_logs/changelog.md). Off by
// default via .env so a fresh clone doesn't show the rough edges; flip to
// "true" in .env.local (gitignored) while actively working on labels.
const SHOW_LABELS = import.meta.env.VITE_SHOW_LABELS === "true";

// Same gating pattern as SHOW_LABELS above. riverEntities are still built
// and returned regardless (callers may still want them for search/hit-test),
// only the visible Graphics/layer construction is skipped when this is off.
const SHOW_RIVERS = import.meta.env.VITE_SHOW_RIVERS === "true";

const OCEAN_COLOR = oceanColor;
const LAND_COLOR = 0xf5f5f2;
const STATE_BORDER_COLOR = 0xa8a8a8;
const STATE_LABEL_STYLE: LabelStyle = { fontSize: 10, color: 0x555555 };
const LAKE_COLOR = OCEAN_COLOR;
const LAKE_BORDER_COLOR = 0x04697b;
const RIVER_COLOR = LAKE_BORDER_COLOR;
const HOVER_COLOR = 0xffd54a;
// Fully opaque -- a picked highlight color must render as exactly that
// color, not blended with the country's own base political-map fill
// underneath (a partial alpha here made a dark pick look like the base
// color leaking through instead of the color the user chose).
const SELECTION_FILL_ALPHA = 1;

// How far past the default view (world exactly fills the screen) the camera
// can zoom in -- shared ceiling for manual wheel-zoom/drag *and* scripted
// scene framing (focusOnBounds). See MAX_ZOOM's original comment in
// MapCanvas.tsx's history for how 2000 was derived (Singapore-sized entities
// wanting zoom ~575 to frame tightly).
export const MAX_ZOOM = 2000;

// Threshold past which states become visible/interactive -- deeper than the
// country-fill LOD threshold, since states are a finer detail level.
export const STATE_ZOOM_THRESHOLD = 6;

// Point-count budget per animation frame during a chunked LOD fill rebuild
// (see setResolution) -- tuned against measured per-country point counts at
// 10m (Canada alone is ~68k points; most countries are under 2k).
const FILL_CHUNK_WEIGHT_BUDGET = 6000;

function countPoints(geometry: AreaGeometry): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const rings of polygons) {
    for (const ring of rings) total += ring.length;
  }
  return total;
}

function setVisibleAboveZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom > threshold;
}

function setVisibleAtOrBelowZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom <= threshold;
}

interface StateRenderItem {
  container: CountryContainer;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface WorldScene {
  worldContainer: Container;
  statesLayer: Container;
  countryLabelsLayer: Container;
  stateLabelsLayer: Container;

  borderEntities: Entity[];
  stateEntities: Entity[];
  lakeEntities: Entity[];
  riverEntities: Entity[];
  seaEntities: Entity[];
  allEntities: Entity[];

  stateRenderItems: StateRenderItem[];
  countryLabelObjects: LabelText[];
  stateLabelObjects: LabelText[];

  // Mutated in place by applyViewFit -- callers read these fresh off the
  // same object rather than capturing a stale local copy.
  baseScaleX: number;
  baseScaleY: number;
  viewW: number;
  viewH: number;
  letterboxX: number;
  letterboxY: number;

  resolution: Resolution;

  findById(id: string | null): Entity | undefined;
  drawHighlights(
    selectedEntityIds: ReadonlySet<string>,
    hoveredEntityId: string | null,
    fill?: HighlightFill,
  ): void;
  applyCamera(camera: Camera, showStateBorders: boolean): void;
  applyViewFit(screenWidth: number, screenHeight: number): void;
  // `chunked` spreads the ~241 separate Graphics.fill() calls across several
  // animation frames instead of one synchronous pass -- see the original
  // rationale (measured 600ms+ main-thread blocks on an unchunked LOD swap
  // mid-zoom) preserved in the implementation below. Export always calls
  // this unchunked once, up front, at the highest-detail resolution.
  setResolution(next: Resolution, chunked?: boolean): void;
  // Stops any in-flight chunked setResolution work -- call on teardown
  // (component unmount, or an export run ending) so a stale rAF callback
  // never touches a torn-down scene.
  destroy(): void;
}

// Builds the full renderable world -- every layer (land, countries, states,
// rivers, lakes, labels, highlight overlay) plus the camera-application and
// highlight-drawing functions that operate on them. Does not attach
// `worldContainer` to any Application/stage, and does not read or depend on
// a live DOM canvas -- callers own the Application lifecycle (live,
// DOM-attached; or offscreen, for export) and are responsible for adding
// `worldContainer` to their own stage.
export function buildWorldScene(screenWidth: number, screenHeight: number): WorldScene {
  let baseScaleX = 0;
  let baseScaleY = 0;
  let viewW = 0;
  let viewH = 0;
  let letterboxX = 0;
  let letterboxY = 0;
  // "Cover" fit (like CSS background-size: cover, and how every real map
  // library -- Google/Leaflet/Mapbox -- fits its base layer), not
  // "contain": picks the LARGER per-axis scale so the world always fills
  // the canvas completely on both axes, cropping whichever axis has
  // excess, instead of picking the smaller scale and padding the rest with
  // letterbox/pillarbox bars. Matters specifically because WORLD_WIDTH ===
  // WORLD_HEIGHT (square, required for undistorted Web Mercator) while a
  // real canvas almost never is -- contain-fitting a square into a
  // landscape or portrait canvas wastes space and, worse, was forcing the
  // *entire* clipped latitude range into view at zoom=1 regardless of
  // canvas shape (Antarctica/the poles visually ballooning to dominate the
  // default view -- confirmed via a failed earlier attempt to fix this
  // purely through camera framing, which turned out to be a dead end for
  // exactly this reason). Cover-fit means viewW/viewH always exactly equal
  // the canvas size -- no letterboxing -- and matches Google Maps' own
  // default view, verified directly: at Google's real max zoom-out, the
  // "Zoom out" button is disabled well before the whole clipped world
  // would be visible; it fills the window's width and crops latitude
  // (reaching the poles needs scrolling/zooming), not the other way
  // around.
  function applyViewFit(sw: number, sh: number) {
    const scale = Math.max(sw / WORLD_WIDTH, sh / WORLD_HEIGHT);
    baseScaleX = scale;
    baseScaleY = scale;
    viewW = sw;
    viewH = sh;
    letterboxX = 0;
    letterboxY = 0;
  }
  applyViewFit(screenWidth, screenHeight);

  // Country containers are built once, from 50m data, and persist for the
  // scene's lifetime -- both their identity and their `stroke` child
  // (zoom-invariant, always sourced from this same 50m geometry regardless
  // of which resolution is currently showing -- see render.ts's
  // strokeGeometry for why that avoids ever needing a rebuild). Only `fill`
  // -- on every country, plus `land` -- gets redrawn when LOD changes.
  const initialWorld = loadWorldData("50m");
  const borderEntities = buildCountryEntities(initialWorld.countries);

  // India's patched boundary (see loadWorldData.ts) overlaps Pakistan's and
  // China's unclipped polygons in the Aksai Chin/PoK region. Hit-testing
  // resolves overlaps by first array match, not paint order -- moving India
  // to the front makes it win hit-testing too, matching the paint-order fix
  // below.
  const indiaEntityIndex = borderEntities.findIndex((e) => e.id === INDIA_COUNTRY_ID);
  if (indiaEntityIndex > 0) {
    const [indiaEntity] = borderEntities.splice(indiaEntityIndex, 1);
    borderEntities.unshift(indiaEntity);
  }

  const worldContainer = new Container();

  const land = new Graphics();
  worldContainer.addChild(land);

  const countriesLayer = new Container();
  const countryContainers = borderEntities.map((entity) => {
    const c = new CountryContainer(entity);
    strokeGeometry(c.stroke, entity.geometry as AreaGeometry);
    countriesLayer.addChild(c);
    return c;
  });
  worldContainer.addChild(countriesLayer);

  // Re-adding India after every country is already in the layer moves it to
  // the top of paint order, so its fill/stroke wins the Kashmir/Aksai Chin
  // overlap visually without needing to clip Pakistan's/China's geometry.
  const indiaContainer = countryContainers.find((c) => c.entity.id === INDIA_COUNTRY_ID);
  if (indiaContainer) countriesLayer.addChild(indiaContainer);

  // States sit above countries. Only one resolution ships (10m, see
  // loadStatesData.ts) so containers are built once and never touched
  // again. Border only, no fill -- the country/land fill underneath already
  // colors the area. Starts hidden to avoid a one-frame flash before the
  // first applyCamera call. Not all addChild'd here -- ~4600 containers all
  // being real children of a visible layer costs real per-tick time
  // regardless of change, so only whichever states are actually inside the
  // current viewport get attached (see MapCanvas.tsx's declutterStates).
  const stateEntities = buildStateEntities(loadStatesData(), initialWorld.countries);
  const statesLayer = new Container();
  statesLayer.visible = false;
  const stateRenderItems: StateRenderItem[] = stateEntities.map((entity) => {
    const c = new CountryContainer(entity);
    strokeGeometry(c.stroke, entity.geometry as AreaGeometry, STATE_BORDER_COLOR);
    // World-space bbox, projected once from the entity's boundingBox --
    // cheap viewport-culling prefilter, same known-and-accepted
    // antimeridian looseness as findEntityAt's own boundingBox prefilter.
    const { minLon, minLat, maxLon, maxLat } = entity.boundingBox;
    const corners = [
      project(minLon, minLat),
      project(minLon, maxLat),
      project(maxLon, minLat),
      project(maxLon, maxLat),
    ];
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    return {
      container: c,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });
  worldContainer.addChild(statesLayer);

  // Rivers sit above states, below lakes. riverEntities is always built,
  // regardless of SHOW_RIVERS -- callers may still want it for search/hit-
  // testing independent of whether the lines themselves are drawn.
  const riverEntities = buildRiverEntities(loadRiversData());
  if (SHOW_RIVERS) {
    const riversLayer = new Container();
    for (const entity of riverEntities) {
      const g = new Graphics();
      strokeLine(g, entity.geometry as LineGeometry, RIVER_COLOR);
      riversLayer.addChild(g);
    }
    worldContainer.addChild(riversLayer);
  }

  // Lakes sit above states -- a lake spanning a border should read as one
  // unbroken water shape on top. No ~4600-entity perf concern here (434
  // lakes), so every container is a permanent child, no culling.
  const lakeEntities = buildLakeEntities(loadLakesData());
  const lakesLayer = new Container();
  for (const entity of lakeEntities) {
    const c = new CountryContainer(entity);
    fillGeometry(c.fill, entity.geometry as AreaGeometry, LAKE_COLOR);
    strokeGeometry(c.stroke, entity.geometry as AreaGeometry, LAKE_BORDER_COLOR);
    lakesLayer.addChild(c);
  }
  worldContainer.addChild(lakesLayer);

  // Seas have no visible layer and no label by default (see entities.ts's
  // buildSeaEntities) -- geometry exists purely for hit-testing and the
  // highlight overlay.
  const seaEntities = buildSeaEntities(loadSeasData());

  // The Caspian Sea is hydrologically a closed-basin lake (no ocean outlet)
  // but Natural Earth classifies it under marine polygons, not lakes -- so
  // unlike a real lake it gets no fill from the loop above. With nothing
  // painted over it, the coarse 50m land silhouette's imperfect hole there
  // shows through as bare land color instead of water. Given the same
  // lake-style fill+stroke as every real lake here (reusing its existing
  // sea entity as-is -- search/hit-testing stay keyed to it as a "sea",
  // only its paint changes) rather than reclassifying its entity type.
  const caspianSea = seaEntities.find((e) => e.name === "Caspian Sea");
  if (caspianSea) {
    const c = new CountryContainer(caspianSea);
    fillGeometry(c.fill, caspianSea.geometry as AreaGeometry, LAKE_COLOR);
    strokeGeometry(c.stroke, caspianSea.geometry as AreaGeometry, LAKE_BORDER_COLOR);
    lakesLayer.addChild(c);
  }

  const allEntities = [
    ...borderEntities,
    ...stateEntities,
    ...lakeEntities,
    ...riverEntities,
    ...seaEntities,
  ];
  function findById(id: string | null): Entity | undefined {
    if (!id) return undefined;
    return allEntities.find((e) => e.id === id);
  }

  // Labels sit above everything, as children of worldContainer (so each
  // label's position rides the existing pan/zoom transform for free; only
  // scale needs correcting per frame, see applyCamera below). The label
  // objects are all built upfront but the layers start empty -- callers
  // (MapCanvas.tsx's declutterLabels) attach/detach only whatever survives
  // viewport culling + collision placement. Measured that leaving all
  // ~4600 state labels permanently parented cost real one-time Pixi-
  // internal render/bounds-pipeline time, unrelated to this file's own JS.
  const countryLabelObjects = SHOW_LABELS
    ? buildLabelEntities(borderEntities).map((entity) => new LabelText(entity))
    : [];
  const countryLabelsLayer = new Container();
  worldContainer.addChild(countryLabelsLayer);

  const stateLabelObjects = SHOW_LABELS
    ? buildLabelEntities(stateEntities).map((entity) => new LabelText(entity, STATE_LABEL_STYLE))
    : [];
  const stateLabelsLayer = new Container();
  stateLabelsLayer.visible = false;
  worldContainer.addChild(stateLabelsLayer);

  // Selection/hover highlight -- last child so it renders above labels too.
  // Two persistent Graphics, redrawn (not rebuilt) only when the caller's
  // selected/hovered id actually changes.
  const highlightLayer = new Container();
  const hoverGraphic = new Graphics();
  const selectionGraphic = new Graphics();
  highlightLayer.addChild(hoverGraphic);
  highlightLayer.addChild(selectionGraphic);
  worldContainer.addChild(highlightLayer);

  function drawHighlights(
    selectedEntityIds: ReadonlySet<string>,
    hoveredEntityId: string | null,
    fill: HighlightFill = DEFAULT_HIGHLIGHT_FILL,
  ) {
    // One shared Graphics accumulates every selected entity's shape, same
    // "many shapes, one Graphics object" approach `land` uses.
    selectionGraphic.clear();
    for (const id of selectedEntityIds) {
      const selected = findById(id);
      if (!selected) continue;
      // Rivers are the one selectable entity with no interior -- image fill
      // never applies to a line, only "color" mode makes sense here.
      if (selected.geometry.type === "LineString" || selected.geometry.type === "MultiLineString") {
        strokeLine(selectionGraphic, selected.geometry, fill.color);
        continue;
      }
      const geometry = selected.geometry as AreaGeometry;
      const texture = fill.fillMode === "image" && fill.flagCode ? cachedFlagTexture(fill.flagCode) : undefined;
      if (texture) {
        fillGeometryTexture(selectionGraphic, geometry, texture, fill.flagOffsetX, fill.flagOffsetY);
      } else {
        fillGeometry(selectionGraphic, geometry, fill.color, SELECTION_FILL_ALPHA);
        // Texture not loaded yet (or export hasn't preloaded it) -- draw the
        // color fallback now, kick off the load, and redraw with the same
        // args once it resolves. Export always preloads every flag it needs
        // before its frame loop starts (exportPipeline.ts), so this path is
        // live-preview-only in practice; a redraw firing between two export
        // frames would just be a no-op re-render of the same cached state.
        if (fill.fillMode === "image" && fill.flagCode) {
          loadFlagTexture(fill.flagCode).then(() => {
            if (destroyed) return;
            drawHighlights(selectedEntityIds, hoveredEntityId, fill);
          });
        }
      }
      strokeGeometry(selectionGraphic, geometry, fill.color);
    }

    hoverGraphic.clear();
    if (hoveredEntityId && !selectedEntityIds.has(hoveredEntityId)) {
      const hovered = findById(hoveredEntityId);
      // Stroke only, no fill tint -- hover fires on essentially every
      // pointermove, and fillGeometry's poly-fill triggers real GPU
      // tessellation per call; a fill here measurably added long-task time
      // during zoom. Seas are excluded -- their real polygon boundary is
      // often huge/antimeridian-spanning, so stroking on hover would draw a
      // distracting border across most of the map.
      if (hovered && hovered.type !== "sea") {
        strokeGeometry(hoverGraphic, hovered.geometry as AreaGeometry, HOVER_COLOR);
      }
    }
  }

  let resolution: Resolution = "50m";
  let fillRunToken = 0;
  let destroyed = false;

  function setResolution(nextResolution: Resolution, chunked: boolean = false) {
    resolution = nextResolution;
    const world = resolution === "50m" ? initialWorld : loadWorldData(resolution);

    land.clear();
    for (const f of world.land.features) {
      fillGeometry(land, f.geometry, LAND_COLOR);
    }

    const fillEntities = new Map(
      (resolution === "50m" ? borderEntities : buildCountryEntities(world.countries)).map(
        (e) => [e.id, e],
      ),
    );

    const myToken = ++fillRunToken;

    // Country complexity (point count) is extremely skewed -- sorting
    // heaviest-first and packing by a point-count budget gives each big
    // country roughly its own frame while still batching the cheap ones.
    const items = countryContainers.map((c) => {
      const match = fillEntities.get(c.entity.id);
      const weight = match ? countPoints(match.geometry as AreaGeometry) : 0;
      return { c, match, weight };
    });
    if (chunked) items.sort((a, b) => b.weight - a.weight);

    const budget = chunked ? FILL_CHUNK_WEIGHT_BUDGET : Infinity;
    let index = 0;

    function processChunk() {
      if (destroyed || myToken !== fillRunToken) return;
      let chunkWeight = 0;
      let processedAny = false;
      while (index < items.length) {
        const { c, match, weight } = items[index];
        if (processedAny && chunkWeight + weight > budget) break;
        c.fill.clear();
        if (match) fillGeometry(c.fill, match.geometry as AreaGeometry, colorForCountry(c.entity.id));
        chunkWeight += weight;
        processedAny = true;
        index++;
      }
      if (index < items.length) {
        requestAnimationFrame(processChunk);
      }
    }

    processChunk();
  }
  setResolution("50m");

  function applyCamera(camera: Camera, showStateBorders: boolean) {
    worldContainer.position.set(camera.x + letterboxX, camera.y + letterboxY);
    worldContainer.scale.set(baseScaleX * camera.zoom, baseScaleY * camera.zoom);
    setVisibleAboveZoom(statesLayer, camera.zoom, STATE_ZOOM_THRESHOLD);
    if (!showStateBorders) statesLayer.visible = false;
    setVisibleAboveZoom(stateLabelsLayer, camera.zoom, STATE_ZOOM_THRESHOLD);
    setVisibleAtOrBelowZoom(countryLabelsLayer, camera.zoom, STATE_ZOOM_THRESHOLD);
    counterScaleLabelLayer(countryLabelsLayer, baseScaleX, baseScaleY, camera.zoom);
    counterScaleLabelLayer(stateLabelsLayer, baseScaleX, baseScaleY, camera.zoom);
  }

  const scene: WorldScene = {
    worldContainer,
    statesLayer,
    countryLabelsLayer,
    stateLabelsLayer,
    borderEntities,
    stateEntities,
    lakeEntities,
    riverEntities,
    seaEntities,
    allEntities,
    stateRenderItems,
    countryLabelObjects,
    stateLabelObjects,
    baseScaleX,
    baseScaleY,
    viewW,
    viewH,
    letterboxX,
    letterboxY,
    resolution,
    findById,
    drawHighlights,
    applyCamera,
    applyViewFit(sw: number, sh: number) {
      applyViewFit(sw, sh);
      scene.baseScaleX = baseScaleX;
      scene.baseScaleY = baseScaleY;
      scene.viewW = viewW;
      scene.viewH = viewH;
      scene.letterboxX = letterboxX;
      scene.letterboxY = letterboxY;
    },
    setResolution(next: Resolution, chunked = false) {
      setResolution(next, chunked);
      scene.resolution = resolution;
    },
    destroy() {
      destroyed = true;
    },
  };

  return scene;
}

export { OCEAN_COLOR };
