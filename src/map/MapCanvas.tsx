import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
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
  findEntityAt,
  type Entity,
} from "./entities";
import {
  fillGeometry,
  strokeGeometry,
  strokeLine,
  project,
  unproject,
  CountryContainer,
  LabelText,
  counterScaleLabelLayer,
  type LabelStyle,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./render";
import {
  type Camera,
  MIN_ZOOM,
  clampCamera,
  zoomAt,
  lerpCamera,
  viewportWorldBounds,
  screenToWorld,
  focusOnBounds,
} from "./camera";
import { placeLabelsWithoutOverlap, type LabelCandidate } from "./labelLayout";
import { interactionStore } from "./interactionStore";

// Labels (country/state) are mid-rework -- state-layer decluttering still
// has known overlap issues (see .development_logs/changelog.md). Off by
// default via .env so a fresh clone doesn't show the rough edges; flip to
// "true" in .env.local (gitignored) while actively working on labels.
// Build-time flag, not a live in-app toggle -- changing it needs a dev
// server restart / rebuild.
const SHOW_LABELS = import.meta.env.VITE_SHOW_LABELS === "true";

// Same gating pattern as SHOW_LABELS above, off by default per user
// request. Only gates the visible line rendering -- riverEntities are
// still built and fed into interactionStore regardless, so rivers stay
// selectable via search even with this off (see riversLayer below). Rivers
// are deliberately excluded from hitTestScreenPoint (see its comment), so
// this flag has no effect on click/hover either way.
const SHOW_RIVERS = import.meta.env.VITE_SHOW_RIVERS === "true";

const OCEAN_COLOR = 0x068494;
const LAND_COLOR = 0xf5f5f2;
// Lighter than render.ts's country BORDER_COLOR (0x4a4a4a) so state
// boundaries read as subordinate to country borders. Can't lean on width to
// do that instead -- see strokeGeometry's comment on why pixelLine ignores
// it.
const STATE_BORDER_COLOR = 0xa8a8a8;
// Smaller and lighter than render.ts's default label style, same
// subordinate-to-country relationship as STATE_BORDER_COLOR above.
const STATE_LABEL_STYLE: LabelStyle = { fontSize: 10, color: 0x555555 };
// Lakes are the same substance as the ocean background, so they share its
// color -- reads as "this is water" for free rather than needing a second
// water hue. Border is a touch darker (same subordinate-color idea as
// STATE_BORDER_COLOR) purely so a lake's edge stays visible against the
// land fill it sits on; pixelLine ignores width, same reasoning as before.
const LAKE_COLOR = OCEAN_COLOR;
const LAKE_BORDER_COLOR = 0x04697b;
// Same water hue as a lake's border -- a river is a thin ribbon of the same
// substance, no separate color needed.
const RIVER_COLOR = LAKE_BORDER_COLOR;

// How far past the default view (world exactly fills the screen) the user
// can zoom in. Arbitrary reasonable cap for V1 -- there's no Phase 3
// city/state detail yet to justify a specific number, revisit once that
// exists.
const MAX_ZOOM = 16;

// Fraction of the current->target gap closed per tick (~60fps), giving the
// eased-zoom feel without full momentum/velocity physics.
const EASE_FACTOR = 0.2;

// Tuned by feel: how much a single wheel tick's deltaY changes zoom.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

// Zoom level past which the higher-detail 10m dataset swaps in. Swapping
// back down to 50m only happens below threshold * LOD_HYSTERESIS, so
// hovering right at the boundary doesn't repeatedly reload both datasets.
const LOD_ZOOM_THRESHOLD = 4;
const LOD_HYSTERESIS = 0.85;
const LOD_DEBOUNCE_MS = 150;

// Point-count budget per animation frame during a chunked LOD fill rebuild
// (see applyFill) -- tuned against measured per-country point counts at 10m
// (Canada alone is ~68k points; most countries are under 2k). Small enough
// that a chunk full of average-complexity countries stays cheap, while
// single outliers (Canada, Russia, USA, ...) each still get their own frame
// rather than a fixed per-frame *count* accidentally grouping several of
// them together.
const FILL_CHUNK_WEIGHT_BUDGET = 6000;

// Same debounce duration as LOD_DEBOUNCE_MS, but a logically separate
// trigger: label decluttering needs to re-run on *panning* too (the
// viewport shifts, so which labels are candidates changes), unlike the LOD
// swap, which panning alone can never affect.
const LABEL_DECLUTTER_DEBOUNCE_MS = 150;

// Threshold past which states become visible. Deeper than
// LOD_ZOOM_THRESHOLD since states are a finer detail level than 10m country
// fill -- tuned by feel, same as the other zoom constants here.
const STATE_ZOOM_THRESHOLD = 6;

// A pointerdown/pointerup pair whose cursor never moved more than this many
// screen pixels counts as a click (select/deselect); anything past it is a
// drag (pan), not a click -- Phase 2's drag handling never needed to make
// this distinction since it had nothing else pointer events could mean.
const CLICK_MOVE_THRESHOLD_PX = 4;

// Selection reads as stronger than hover: hover is a stroke-only outline
// (see drawHighlights), selection additionally gets a translucent fill tint,
// still see-through enough that the underlying country/state fill and
// borders stay visible underneath.
const HOVER_COLOR = 0xffd54a;
const SELECTION_COLOR = 0xffa000;
const SELECTION_FILL_ALPHA = 0.3;

// Cheap proxy for how expensive a polygon is to tessellate (see applyFill's
// chunk-weight budgeting) -- just the raw coordinate count across every
// ring, no antimeridian-splitting or area math needed for this purpose.
function countPoints(geometry: AreaGeometry): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const rings of polygons) {
    for (const ring of rings) total += ring.length;
  }
  return total;
}

// Toggles a layer's visibility based on zoom. Unlike the LOD fill swap
// above, nothing gets rebuilt here, so this is cheap enough to run every
// tick straight off the eased camera zoom instead of needing
// scheduleLodCheck's debounce -- no risk of "thrashing" when a flag flip is
// the only cost. Reused by whichever Phase 3 layer needs a "hidden until
// zoomed in" reveal next (labels, cities, rivers/lakes).
function setVisibleAboveZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom > threshold;
}

// Complementary "hidden once zoomed in" version, for country labels: they
// show at the default view and hide the moment state labels take over at
// the same STATE_ZOOM_THRESHOLD, rather than both being visible at once.
function setVisibleAtOrBelowZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom <= threshold;
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const app = new Application();
    // Hoisted out of the .then() below (unlike everything else there) --
    // interactionStore is a persistent module-level singleton, not
    // recreated per mount like `app` is, so a StrictMode double-invoke
    // cleanup must actually unsubscribe or it leaks one subscriber per
    // discarded mount.
    let unsubscribeInteraction: (() => void) | null = null;
    let unsubscribeFocus: (() => void) | null = null;

    app
      .init({
        resizeTo: container,
        backgroundColor: OCEAN_COLOR,
        antialias: true,
      })
      .then(() => {
        if (cancelled) {
          // releaseGlobalResources clears Pixi's pooled batcher buffers on
        // cleanup -- without it, React.StrictMode's dev-mode double-invoke
        // (mount -> cleanup -> mount again) leaves the second Application
        // with a stale, undersized buffer inherited from the first, which
        // then throws "GL_INVALID_OPERATION: glDrawElements: Insufficient
        // buffer size" once enough BitmapText glyph batches are drawn to
        // exceed it (see https://github.com/pixijs/pixijs/discussions/11678).
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
          return;
        }

        container.appendChild(app.canvas);

        // All pointer interaction here (drag pan, wheel zoom, hover/click
        // selection) is handled manually via raw canvas listeners below --
        // Phase 4 deliberately avoided Pixi's own eventMode/hitArea system
        // to sidestep per-object interactivity cost across thousands of
        // entities (see changelog). But Pixi's EventSystem still installs
        // its own pointer listeners and runs its own recursive hit-test
        // walk of the whole scene graph on every pointermove regardless --
        // it doesn't know it's unused. Measured this costing real time
        // (`hitTestMoveRecursive`) once the ~4600-entity states layer
        // becomes visible. `eventMode = "none"` on the stage prunes that
        // walk at the root before it recurses into any children.
        app.stage.eventMode = "none";

        // Uniform contain-fit so the world keeps its aspect ratio instead of
        // stretching to the container's -- matters a lot once the map is no
        // longer the whole window (Phase 6's editor layout gives it a
        // non-2:1 area). baseScaleX/baseScaleY stay separate params
        // throughout camera.ts/this file (unchanged call signatures) but are
        // always set equal here. viewW/viewH is the resulting content size
        // (<= the real canvas in one axis); letterboxX/letterboxY is the
        // margin that centers it, applied only where world-space math
        // crosses into real screen/DOM pixels: worldContainer's position
        // (applyCameraTransform) and raw pointer coordinates
        // (hitTestScreenPoint, onWheel). Every other camera.ts call already
        // works in "content space" (0..viewW, 0..viewH) and needs no
        // change -- clampCamera/zoomAt/etc. don't know or care that content
        // space might be smaller than the actual canvas.
        let baseScaleX = 0;
        let baseScaleY = 0;
        let viewW = 0;
        let viewH = 0;
        let letterboxX = 0;
        let letterboxY = 0;
        function applyViewFit(screenWidth: number, screenHeight: number) {
          const scale = Math.min(screenWidth / WORLD_WIDTH, screenHeight / WORLD_HEIGHT);
          baseScaleX = scale;
          baseScaleY = scale;
          viewW = WORLD_WIDTH * scale;
          viewH = WORLD_HEIGHT * scale;
          letterboxX = (screenWidth - viewW) / 2;
          letterboxY = (screenHeight - viewH) / 2;
        }
        applyViewFit(app.screen.width, app.screen.height);

        // Country containers are built once, from 50m data, and persist for
        // the lifetime of the map -- both their identity (useful later for
        // Phase 4 selection, which shouldn't lose its target every time the
        // LOD resolution changes) and their `stroke` child (pixelLine,
        // zoom-invariant, and always sourced from this same 50m geometry
        // regardless of which resolution is currently showing -- see
        // render.ts's strokeGeometry for why that avoids ever needing a
        // rebuild). Only `fill` -- on every country, plus `land` -- gets
        // redrawn when the LOD resolution actually changes.
        const initialWorld = loadWorldData("50m");
        const borderEntities = buildCountryEntities(initialWorld.countries);

        // India's patched boundary (see loadWorldData.ts) overlaps Pakistan's
        // and China's unclipped polygons in the Aksai Chin/PoK region.
        // findEntityAt (entities.ts) resolves overlaps by returning the
        // first array match, not by paint order -- without this, a click in
        // that region would silently select Pakistan (whichever comes first
        // in world-atlas's raw feature order), contradicting the visual
        // (India painted on top, see the countriesLayer reorder below).
        // Moving India to the front makes it win hit-testing too, for any
        // point, at negligible cost (one array splice at mount, not
        // per-hit-test).
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
          // Safe: borderEntities comes from buildCountryEntities, which never
          // produces label (Point) geometry -- entity.geometry's static type
          // is just the broader Entity-wide Geometry union.
          strokeGeometry(c.stroke, entity.geometry as AreaGeometry);
          countriesLayer.addChild(c);
          return c;
        });
        worldContainer.addChild(countriesLayer);

        // India's patched boundary (see loadWorldData.ts) claims territory
        // that overlaps Pakistan's and China's unpatched polygons in the
        // Kashmir/Aksai Chin region. Pixi's addChild moves an already-added
        // child to the end of its parent's children, i.e. the top of paint
        // order -- re-adding India here (after every country is already in
        // the layer) makes its fill/stroke the one that wins visually in the
        // overlap, without needing to clip Pakistan's/China's geometry.
        const indiaContainer = countryContainers.find((c) => c.entity.id === INDIA_COUNTRY_ID);
        if (indiaContainer) countriesLayer.addChild(indiaContainer);

        // States sit above countries in the layer stack (see
        // architecture.md's layer list). They only ship at one resolution
        // (10m) -- no LOD swap needed, see loadStatesData.ts -- so, unlike
        // countries, containers are built once and never touched again.
        // Border only, no fill: the country/land fill underneath already
        // colors the area, and a state fill only becomes useful once Phase 4
        // selection needs one to highlight. Starts hidden to avoid a one-
        // frame flash before the ticker's setVisibleAboveZoom takes over.
        //
        // Unlike countryContainers, these are *not* all addChild'd here.
        // Measured (see changelog) that ~4600 containers all being real
        // children of a visible layer costs real per-tick time regardless of
        // whether anything about them changes -- Pixi still transform-updates
        // and batch-packs every visible child every frame. declutterStates()
        // below attaches only whichever states are actually inside the
        // current viewport, same "build once, attach only what's needed"
        // approach declutterLabels already uses for the same reason.
        const stateEntities = buildStateEntities(loadStatesData(), initialWorld.countries);
        const statesLayer = new Container();
        statesLayer.visible = false;
        const stateRenderItems = stateEntities.map((entity) => {
          const c = new CountryContainer(entity);
          // Safe: same reasoning as the countryContainers cast above --
          // buildStateEntities never produces label geometry either.
          strokeGeometry(c.stroke, entity.geometry as AreaGeometry, STATE_BORDER_COLOR);
          // World-space bbox, projected once from the entity's (lon/lat)
          // boundingBox -- cheap prefilter for declutterStates, same
          // known-and-accepted antimeridian looseness as findEntityAt's own
          // boundingBox prefilter (an overly wide box only ever fails to
          // cull early, never hides a state that should be visible).
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

        // Rivers sit above states, below lakes in architecture.md's layer
        // order (Countries -> States -> Cities -> Rivers -> Lakes). Same
        // "no ~4600-entity perf concern, no culling needed" reasoning as
        // lakes below (490 rivers). No CountryContainer here -- a river has
        // no fill, just a single Graphics per entity holding its stroke.
        //
        // riverEntities is always built, regardless of SHOW_RIVERS -- it
        // feeds search/click-selection (interactionStore, hitTestScreenPoint
        // below) independently of whether the lines themselves are drawn.
        // Only the visible Graphics/layer construction is skipped when the
        // flag is off, same "skip the cost entirely, not just hide the
        // result" approach SHOW_LABELS already uses for country/state
        // labels.
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

        // Lakes sit above states in architecture.md's layer order -- a lake
        // spanning a state (or country) border should read as one unbroken
        // water shape on top, not interrupted by the border line underneath
        // it. Unlike states, there's no ~4600-entity perf concern here (434
        // lakes, comparable to the 241-country layer that's never needed
        // culling), so every lake container is just added as a permanent
        // child up front -- no viewport culling, no zoom-gated reveal.
        const lakeEntities = buildLakeEntities(loadLakesData());
        const lakesLayer = new Container();
        for (const entity of lakeEntities) {
          const c = new CountryContainer(entity);
          fillGeometry(c.fill, entity.geometry as AreaGeometry, LAKE_COLOR);
          strokeGeometry(c.stroke, entity.geometry as AreaGeometry, LAKE_BORDER_COLOR);
          lakesLayer.addChild(c);
        }
        worldContainer.addChild(lakesLayer);

        // Seas have no visible layer and no label at all by default --
        // see entities.ts's buildSeaEntities comment for why (marine
        // regions overlap/nest in ways that don't render sensibly as
        // disjoint filled areas, and a permanently-visible label for all
        // 306 was explicit user feedback: too cluttered). The geometry
        // still exists purely for hit-testing (see hitTestScreenPoint) and
        // the highlight overlay (drawHighlights, which already handles
        // AreaGeometry -- a sea needs no special-casing there the way a
        // river did) -- clicking or searching a sea still selects and
        // highlights it exactly like every other entity, just without a
        // permanently-rendered name.
        const seaEntities = buildSeaEntities(loadSeasData());

        // Feeds Phase 4 interaction (search, and eventually anything else
        // that needs to look an entity up by id from outside this effect) --
        // countries, states, lakes, rivers, and seas only, no labels
        // (they're derived display artifacts, not user-facing selectable
        // entities).
        interactionStore.setEntities([
          ...borderEntities,
          ...stateEntities,
          ...lakeEntities,
          ...riverEntities,
          ...seaEntities,
        ]);

        // Labels sit above everything (see architecture.md's layer list --
        // Labels is the topmost layer). They're children of worldContainer
        // too, not a separate top-level overlay: that way each label's
        // *position* rides worldContainer's existing pan/zoom transform for
        // free (see render.ts's LabelText), and only *scale* needs
        // correcting per tick to keep text a constant screen size despite
        // that same transform.
        //
        // The label *objects* are all built upfront (countryLabelObjects /
        // stateLabelObjects), but the layers themselves start empty --
        // declutterLabels() (below) is what actually attaches/detaches
        // labels as Pixi children, adding only whatever survives viewport
        // culling + collision placement. Measured directly that this
        // matters, not just tidiness: leaving all ~4600 state labels
        // permanently parented (even individually hidden via
        // `.visible = false`) caused several hundred ms of one-time cost
        // somewhere in Pixi's own render/bounds pipeline the moment their
        // shared parent container first turned visible -- not reproducible
        // by timing this file's own JS, so it's Pixi-internal cost that
        // scales with a container's actual child count. Keeping the live
        // child count down to only what's currently placed (tens, not
        // thousands) avoids it.
        // Empty arrays when SHOW_LABELS is off -- skips buildLabelEntities/
        // LabelText/BitmapFont-install cost entirely, not just hiding the
        // result. The layers themselves are still created (declutterLabels,
        // counterScaleLabelLayer etc. all reference them unconditionally),
        // but stay empty, so every downstream label operation becomes a
        // no-op over a 0-length array/child list rather than needing
        // SHOW_LABELS checks sprinkled through this whole file.
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

        // Selection/hover highlight -- last child of worldContainer so it
        // renders above labels too, avoiding having to pick between the two
        // label layers for z-order. Two persistent Graphics, redrawn (not
        // rebuilt) only when the store's selected/hovered id actually
        // changes -- see drawHighlights below, wired to
        // interactionStore.subscribe near the label-declutter setup.
        const highlightLayer = new Container();
        const hoverGraphic = new Graphics();
        const selectionGraphic = new Graphics();
        highlightLayer.addChild(hoverGraphic);
        highlightLayer.addChild(selectionGraphic);
        worldContainer.addChild(highlightLayer);

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

        // Redraws whichever of the two highlight graphics changed. Hover is
        // skipped when it matches the current selection -- otherwise the
        // stronger selection highlight would sit underneath a redundant,
        // weaker hover highlight of the exact same shape.
        function drawHighlights() {
          const { selectedEntityIds, hoveredEntityId } = interactionStore.getState();

          // One shared Graphics accumulates every selected entity's shape --
          // same "many shapes, one Graphics object" approach `land` already
          // uses for ~topology's worth of polygons, not one object per
          // selection.
          selectionGraphic.clear();
          for (const id of selectedEntityIds) {
            const selected = findById(id);
            if (!selected) continue;
            // Rivers are the one selectable entity with no interior --
            // fillGeometry/strokeGeometry are typed to (and only make sense
            // for) AreaGeometry, so a river needs strokeLine instead of the
            // fill+stroke every other entity type gets.
            if (selected.geometry.type === "LineString" || selected.geometry.type === "MultiLineString") {
              strokeLine(selectionGraphic, selected.geometry, SELECTION_COLOR);
              continue;
            }
            const geometry = selected.geometry as AreaGeometry;
            fillGeometry(selectionGraphic, geometry, SELECTION_COLOR, SELECTION_FILL_ALPHA);
            strokeGeometry(selectionGraphic, geometry, SELECTION_COLOR);
          }

          hoverGraphic.clear();
          if (hoveredEntityId && !selectedEntityIds.has(hoveredEntityId)) {
            const hovered = findById(hoveredEntityId);
            // Stroke only, no fill tint -- unlike selection, hover fires on
            // essentially every pointermove (including during a zoom
            // gesture, since the entity under a fixed screen point changes
            // as zoom changes), and fillGeometry's poly-fill triggers real
            // GPU tessellation (Pixi's earcut) per call. A fill here was
            // measured adding real extra long-task time during zoom (see
            // changelog) on top of the LOD fill rebuild's own cost --
            // strokeGeometry's pixelLine needs no tessellation, so it stays
            // cheap regardless of how often hover changes. No LineString
            // branch needed here (unlike the selection branch above) --
            // rivers are the only LineString entity type and
            // hitTestScreenPoint deliberately never resolves to one, so
            // `hovered` can never be a river.
            // Seas are deliberately excluded from hover feedback -- a sea's
            // real polygon boundary is often huge and antimeridian-spanning
            // (e.g. the Pacific), so stroking it on hover draws a
            // distracting border across most of the map instead of a small,
            // readable outline. Still fully selectable/highlightable via
            // search (see SearchBox.tsx's requestFocus) and via a direct
            // click (selectionGraphic above, unaffected by this) -- only the
            // passive hover stroke is suppressed.
            if (hovered && hovered.type !== "sea") {
              strokeGeometry(hoverGraphic, hovered.geometry as AreaGeometry, HOVER_COLOR);
            }
          }
        }

        app.stage.addChild(worldContainer);

        let resolution: Resolution = "50m";

        // Guards a chunked run below against a second applyFill call
        // superseding it mid-flight (e.g. rapid up/down zoom crossing
        // LOD_ZOOM_THRESHOLD more than once before the first run finishes)
        // -- bumped on every call, each run only keeps writing while its own
        // token is still the current one.
        let fillRunToken = 0;

        // Rebuilds land + every country's fill for the given resolution.
        // `chunked` spreads the ~241 separate Graphics.fill() calls (each
        // one a real Pixi/earcut polygon tessellation, not a cheap redraw)
        // across several animation frames instead of one synchronous pass --
        // measured that single pass blocking the main thread for 600ms+ when
        // a LOD swap fires mid-zoom (see changelog). The initial mount-time
        // call below stays unchunked (budget = Infinity, everything in one
        // chunk) so the very first paint still shows a complete map rather
        // than one that visibly fills in over a few frames.
        function applyFill(nextResolution: Resolution, chunked: boolean = false) {
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

          // Country complexity (point count) is extremely skewed -- at 10m,
          // Canada alone (~68k points) is worth more tessellation work than
          // roughly the bottom 150 countries combined (measured; see
          // changelog). A fixed per-frame *count* risks packing several of
          // these heavy outliers into one chunk purely by chance (measured
          // that going wrong too). Sorting heaviest-first and packing by a
          // point-count budget instead gives each big country roughly its
          // own frame while still batching the many cheap ones together.
          const items = countryContainers.map((c) => {
            const match = fillEntities.get(c.entity.id);
            const weight = match ? countPoints(match.geometry as AreaGeometry) : 0;
            return { c, match, weight };
          });
          if (chunked) items.sort((a, b) => b.weight - a.weight);

          const budget = chunked ? FILL_CHUNK_WEIGHT_BUDGET : Infinity;
          let index = 0;

          function processChunk() {
            if (cancelled || myToken !== fillRunToken) return;
            let chunkWeight = 0;
            let processedAny = false;
            while (index < items.length) {
              const { c, match, weight } = items[index];
              if (processedAny && chunkWeight + weight > budget) break;
              c.fill.clear();
              // Safe: same reasoning as above -- fillEntities is built from
              // buildCountryEntities, never label entities.
              if (match) fillGeometry(c.fill, match.geometry as AreaGeometry, LAND_COLOR);
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

        applyFill("50m");

        // Camera state: current is what's actually rendered each frame,
        // eased toward target by the ticker. No pan/zoom input is wired up
        // yet (that's the next todos) -- for now both start at the default
        // view (zoom = 1, world exactly fills the screen) and stay there.
        let current: Camera = { x: 0, y: 0, zoom: 1 };
        let target: Camera = { ...current };

        // Applies the current camera state to the scene graph -- called
        // once synchronously below (so the initial declutterLabels() call
        // sees correct transforms instead of Pixi's default (1,1) scale,
        // before the ticker has ever run) and every tick thereafter.
        function applyCameraTransform() {
          current = lerpCamera(current, target, EASE_FACTOR);
          worldContainer.position.set(current.x + letterboxX, current.y + letterboxY);
          worldContainer.scale.set(baseScaleX * current.zoom, baseScaleY * current.zoom);
          setVisibleAboveZoom(statesLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          setVisibleAboveZoom(stateLabelsLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          setVisibleAtOrBelowZoom(countryLabelsLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          counterScaleLabelLayer(countryLabelsLayer, baseScaleX, baseScaleY, current.zoom);
          counterScaleLabelLayer(stateLabelsLayer, baseScaleX, baseScaleY, current.zoom);
        }
        applyCameraTransform();

        const onResize = () => {
          const { width, height } = app.screen;
          applyViewFit(width, height);
          current = clampCamera(current, viewW, viewH, MAX_ZOOM);
          target = clampCamera(target, viewW, viewH, MAX_ZOOM);
          scheduleLabelDeclutter();
        };
        app.renderer.on("resize", onResize);

        // Hit-tests a screen-space point against whichever entity layer is
        // currently active for interaction -- states once zoomed in past
        // STATE_ZOOM_THRESHOLD, countries otherwise. Same threshold
        // declutterLabels uses for the same "which layer is live" question.
        // Lakes are checked first, regardless of zoom: they paint on top of
        // both layers (see lakesLayer above), so a click inside/near one
        // should resolve to it, matching what's actually visible, the same
        // "hit-test priority follows paint order" reasoning already applied
        // to India's re-added-on-top container elsewhere in this file. Seas
        // are checked *last*, as a fallback -- they have no visible layer at
        // all (see seaEntities above), so there's no "paints on top" to
        // match; a click only ever falls through to a sea when it lands on
        // open water, missing every land feature entirely.
        //
        // Rivers are deliberately excluded here -- their hit-test tolerance
        // made them easy to hover/click by accident while aiming at
        // something else nearby (a country border, a lake edge), getting in
        // the way of selecting the thing actually intended. A click/hover
        // near a river now just falls through to whatever's underneath
        // (land, or a sea fallback). Rivers stay fully selectable via search
        // (SearchBox.tsx calls interactionStore.toggleEntity/requestFocus
        // directly by id, bypassing this function entirely).
        function hitTestScreenPoint(screenX: number, screenY: number): Entity | undefined {
          // screenX/screenY are raw canvas-relative coordinates (e.g.
          // e.offsetX/Y); letterboxX/Y converts into content space, since
          // current/target camera math never knows about the letterbox
          // margin (see applyViewFit above).
          const [wx, wy] = screenToWorld(
            current,
            screenX - letterboxX,
            screenY - letterboxY,
            baseScaleX,
            baseScaleY,
          );
          const [lon, lat] = unproject(wx, wy);
          const lakeHit = findEntityAt(lakeEntities, lon, lat);
          if (lakeHit) return lakeHit;
          const candidates = current.zoom > STATE_ZOOM_THRESHOLD ? stateEntities : borderEntities;
          const landHit = findEntityAt(candidates, lon, lat);
          if (landHit) return landHit;
          return findEntityAt(seaEntities, lon, lat);
        }

        // Drag pan: tracks the cursor 1:1 (no easing/momentum, per Phase 2
        // scope), so both current and target are set directly on move
        // rather than letting the ticker lerp toward a target. Pointer
        // capture keeps the drag going even if the cursor leaves the
        // canvas mid-drag, instead of needing pointerleave handling.
        const canvas = app.canvas;
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartCameraX = 0;
        let dragStartCameraY = 0;
        // Tracks whether this pointerdown/up pair has moved past
        // CLICK_MOVE_THRESHOLD_PX yet -- distinguishes a click (select) from
        // a drag (pan), since onPointerDown/onPointerUp alone can't tell
        // those apart (both start/end with dragging = true/false).
        let movedPastClickThreshold = false;

        const onPointerDown = (e: PointerEvent) => {
          dragging = true;
          movedPastClickThreshold = false;
          dragStartX = e.offsetX;
          dragStartY = e.offsetY;
          dragStartCameraX = current.x;
          dragStartCameraY = current.y;
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = "grabbing";
        };

        const onPointerMove = (e: PointerEvent) => {
          if (!dragging) {
            const hit = hitTestScreenPoint(e.offsetX, e.offsetY);
            interactionStore.hoverEntity(hit?.id ?? null);
            canvas.style.cursor = hit ? "pointer" : "grab";
            return;
          }

          if (
            !movedPastClickThreshold &&
            Math.hypot(e.offsetX - dragStartX, e.offsetY - dragStartY) > CLICK_MOVE_THRESHOLD_PX
          ) {
            movedPastClickThreshold = true;
          }

          // Drag delta (offsetX - dragStartX) is letterbox-invariant -- the
          // constant margin cancels out in the subtraction -- so no
          // letterboxX/Y adjustment is needed here, unlike the absolute
          // cursor positions hitTestScreenPoint/onWheel use.
          const next = clampCamera(
            {
              x: dragStartCameraX + (e.offsetX - dragStartX),
              y: dragStartCameraY + (e.offsetY - dragStartY),
              zoom: current.zoom,
            },
            viewW,
            viewH,
            MAX_ZOOM,
          );
          current = next;
          target = next;
          scheduleLabelDeclutter();
        };

        const onPointerUp = (e: PointerEvent) => {
          dragging = false;
          canvas.releasePointerCapture(e.pointerId);
          canvas.style.cursor = "grab";

          if (!movedPastClickThreshold) {
            const hit = hitTestScreenPoint(e.offsetX, e.offsetY);
            // ctrl (Windows/Linux) or cmd (Mac) held -- same modifier a file
            // manager uses for multi-select -- toggles the hit entity into/
            // out of the existing selection instead of replacing it.
            interactionStore.toggleEntity(hit?.id ?? null, e.ctrlKey || e.metaKey);
          }
        };

        canvas.style.cursor = "grab";
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);

        // Debounced off wheel events (panning alone never changes zoom, so
        // it can't cross the LOD threshold) so a continuous scroll only
        // triggers one fill refresh after it stops, rather than one per
        // tick. Only actually calls applyFill when the resolution genuinely
        // needs to change -- borders never need touching here at all.
        let lodTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLodCheck = () => {
          if (lodTimeout !== null) clearTimeout(lodTimeout);
          lodTimeout = setTimeout(() => {
            lodTimeout = null;
            if (cancelled) return;
            if (resolution === "50m" && current.zoom > LOD_ZOOM_THRESHOLD) {
              applyFill("10m", true);
            } else if (
              resolution === "10m" &&
              current.zoom < LOD_ZOOM_THRESHOLD * LOD_HYSTERESIS
            ) {
              applyFill("50m", true);
            }
          }, LOD_DEBOUNCE_MS);
        };

        // Declutters whichever label layer is currently active (matches the
        // same current.zoom > STATE_ZOOM_THRESHOLD check the ticker uses for
        // layer visibility, so the two always agree on which layer is
        // "live"). Two passes over *all* of that layer's label objects
        // (not just its current children -- see the layer-building comment
        // above for why child count is kept minimal):
        //  1. Cull to labels inside the current viewport (see camera.ts's
        //     viewportWorldBounds) -- cheap numeric comparisons against
        //     each label's world-space position, no Pixi work, so doing
        //     this over all ~4600 state labels every time is fine.
        //  2. For only the (much smaller) surviving candidates, compute
        //     their screen-space box and run them through labelLayout.ts's
        //     greedy collision placement. Collision winners get attached;
        //     losers stay detached -- keeping labels as actual children
        //     even while invisible is exactly the cost this whole
        //     attach/detach approach exists to avoid.
        //
        // The screen-space box is computed directly from data already
        // trusted here (world position + camera state), *not* Pixi's
        // getBounds(): getBounds() composes through the parent chain, which
        // Pixi only updates lazily during its own render cycle. Calling it
        // synchronously right after addChild -- the first version of this
        // function did -- returned (0,0,0,0) every time, which silently
        // broke collision detection (every pair of zero-size boxes reads as
        // "not overlapping", so nothing ever lost). label.width/height are
        // local-only and correct immediately, parent or not -- but they
        // reflect the label's *current* .scale, which the ticker's
        // counterScaleLabelLayer only updates for already-attached
        // children, so a label becoming a candidate for the first time this
        // cycle needs that correction applied here explicitly too.
        function declutterLabels() {
          const isStates = current.zoom > STATE_ZOOM_THRESHOLD;
          const layer = isStates ? stateLabelsLayer : countryLabelsLayer;
          const allLabels = isStates ? stateLabelObjects : countryLabelObjects;
          const bounds = viewportWorldBounds(current, viewW, viewH, baseScaleX, baseScaleY);
          const scaleX = baseScaleX * current.zoom;
          const scaleY = baseScaleY * current.zoom;

          const candidates: LabelCandidate[] = [];
          const candidateLabels: LabelText[] = [];

          for (const label of allLabels) {
            const { x: wx, y: wy } = label.position;
            if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) {
              if (label.parent === layer) layer.removeChild(label);
              continue;
            }
            label.scale.set(1 / scaleX, 1 / scaleY);
            const screenX = current.x + wx * scaleX;
            const screenY = current.y + wy * scaleY;
            candidates.push({
              id: label.entity.id,
              importance: label.entity.metadata?.area ?? 0,
              x: screenX - label.width / 2,
              y: screenY - label.height / 2,
              width: label.width,
              height: label.height,
            });
            candidateLabels.push(label);
          }

          const keep = placeLabelsWithoutOverlap(candidates);
          for (const label of candidateLabels) {
            const shouldShow = keep.has(label.entity.id);
            label.visible = shouldShow;
            if (shouldShow) {
              if (label.parent !== layer) layer.addChild(label);
            } else if (label.parent === layer) {
              layer.removeChild(label);
            }
          }
        }

        // Same viewport-cull idea as declutterLabels, applied to the states
        // layer's ~4600 border containers instead of label objects: only
        // attach whichever are inside the current viewport, detach the
        // rest. No collision placement needed here (borders don't overlap
        // each other visually the way label boxes do), just membership.
        // No-ops below STATE_ZOOM_THRESHOLD -- statesLayer is invisible
        // there anyway (see setVisibleAboveZoom), so there's nothing to
        // gain from computing membership no one will see; whatever was
        // attached before simply stays attached, cheaply, until zoom
        // crosses back above threshold and this runs for real again.
        function declutterStates() {
          if (current.zoom <= STATE_ZOOM_THRESHOLD) return;
          const bounds = viewportWorldBounds(current, viewW, viewH, baseScaleX, baseScaleY);
          for (const item of stateRenderItems) {
            const onScreen =
              item.maxX >= bounds.minX &&
              item.minX <= bounds.maxX &&
              item.maxY >= bounds.minY &&
              item.minY <= bounds.maxY;
            if (onScreen) {
              if (item.container.parent !== statesLayer) statesLayer.addChild(item.container);
            } else if (item.container.parent === statesLayer) {
              statesLayer.removeChild(item.container);
            }
          }
        }

        // Debounced off both wheel (zoom) and drag (pan) -- unlike the LOD
        // check above, panning alone *does* change which labels/states are
        // candidates (the viewport itself moved), so this can't reuse
        // scheduleLodCheck's wheel-only trigger. Drives both declutter
        // passes off the one timer rather than adding a second, near-
        // identical one -- they're both "viewport changed, recompute what's
        // attached" and always need to agree on the current viewport/zoom.
        let labelDeclutterTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLabelDeclutter = () => {
          if (labelDeclutterTimeout !== null) clearTimeout(labelDeclutterTimeout);
          labelDeclutterTimeout = setTimeout(() => {
            labelDeclutterTimeout = null;
            if (cancelled) return;
            declutterLabels();
            declutterStates();
          }, LABEL_DECLUTTER_DEBOUNCE_MS);
        };

        // Declutter the default view immediately rather than waiting for
        // the first interaction to trigger the debounce above.
        declutterLabels();
        declutterStates();

        // Redraws the highlight overlay whenever the store's
        // selected/hovered entity changes -- from pointer events here, or
        // from SearchBox selecting an entity by name. Not run per-frame:
        // selection/hover change only on discrete events, not continuously,
        // unlike applyCameraTransform above.
        unsubscribeInteraction = interactionStore.subscribe(drawHighlights);
        drawHighlights();

        // Fly the camera to fit whatever entity SearchBox just requested
        // focus for (see interactionStore.requestFocus). Decoupled from
        // drawHighlights above -- a focus request isn't itself a
        // selection/hover state change. Only sets `target`; the ticker's
        // lerpCamera (applyCameraTransform above) eases `current` toward it
        // every frame, same as wheel-zoom does.
        unsubscribeFocus = interactionStore.onFocusRequest((id) => {
          // null = "focus the whole world" (Phase 6's target-less "pan"
          // action) -- the world-space bounds fit computation below doesn't
          // apply, since there's no entity to look up; zoom = MIN_ZOOM,
          // x/y = 0 already *is* the definition of the default world view
          // (clampCamera forces exactly this at zoom 1, see camera.ts).
          if (id === null) {
            target = clampCamera({ x: 0, y: 0, zoom: MIN_ZOOM }, viewW, viewH, MAX_ZOOM);
            return;
          }
          const entity = findById(id);
          if (!entity) return;
          const bb = entity.boundingBox;
          // project()'s y is inverted (higher lat -> smaller y), so minLat
          // maps to the world-space maxY and maxLat maps to minY.
          const [minX, maxY] = project(bb.minLon, bb.minLat);
          const [maxX, minY] = project(bb.maxLon, bb.maxLat);
          target = focusOnBounds(
            { minX, minY, maxX, maxY },
            viewW,
            viewH,
            baseScaleX,
            baseScaleY,
            MAX_ZOOM,
          );
        });

        // Wheel zoom: cursor-anchored, eased (only `target` is set here --
        // the ticker's lerpCamera above carries `current` toward it). Based
        // on `target` rather than `current` so repeated fast wheel ticks
        // compose against the intended zoom level instead of drifting from
        // whatever the easing hasn't caught up to yet. preventDefault stops
        // the browser's own page-zoom/scroll; needs { passive: false } for
        // that to be allowed.
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
          // Clamp the requested zoom *before* anchoring, not after: zoomAt
          // computes x/y assuming the camera ends up at exactly the zoom
          // value it's given, so anchoring against an unclamped value (which
          // regularly overshoots MAX_ZOOM near the top of the range) and
          // only clamping the zoom number afterward leaves x/y anchored for
          // a different zoom than what's actually applied -- a large,
          // sudden position jump. Clamping first keeps them in agreement.
          const requestedZoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, target.zoom * zoomFactor),
          );
          // e.offsetX/Y are raw canvas-relative coordinates -- convert into
          // content space before anchoring, same reasoning as
          // hitTestScreenPoint above.
          const zoomed = zoomAt(
            target,
            e.offsetX - letterboxX,
            e.offsetY - letterboxY,
            requestedZoom,
          );
          target = clampCamera(zoomed, viewW, viewH, MAX_ZOOM);
          scheduleLodCheck();
          scheduleLabelDeclutter();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        app.ticker.add(applyCameraTransform);
      });

    return () => {
      cancelled = true;
      unsubscribeInteraction?.();
      unsubscribeFocus?.();
      if (app.renderer) {
        // releaseGlobalResources clears Pixi's pooled batcher buffers on
        // cleanup -- without it, React.StrictMode's dev-mode double-invoke
        // (mount -> cleanup -> mount again) leaves the second Application
        // with a stale, undersized buffer inherited from the first, which
        // then throws "GL_INVALID_OPERATION: glDrawElements: Insufficient
        // buffer size" once enough BitmapText glyph batches are drawn to
        // exceed it (see https://github.com/pixijs/pixijs/discussions/11678).
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
  );
}
