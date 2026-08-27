import { useSyncExternalStore } from "react";
import type { Entity } from "./entities";

// Selection/hover state, shared between MapCanvas.tsx's imperative Pixi code
// (which reads/writes it directly, via the exported singleton, to avoid
// tearing down/rebuilding the map on every hover) and React components
// (InstructionBuilder, via the hook below). No state-management library is
// installed in this repo -- this is a minimal plain pub/sub, not a
// general-purpose store. `toggleEntity`/`hoverEntity` are callable from
// anywhere (pointer handlers, the Instruction Builder's entity picker, or
// programmatically from Phase 6 playback), matching architecture.md's
// "usable manually and through AI" principle.
interface InteractionState {
  entities: Entity[];
  // A Set, not a single id -- multi-select (ctrl/cmd+click to add/remove,
  // like a file manager) needs more than one entity selected at once. See
  // toggleEntity below for how membership changes; drawHighlights in
  // MapCanvas.tsx renders every id in here, not just one.
  selectedEntityIds: Set<string>;
  // Custom color for the current selection, set only when a scene's
  // Highlight action provides one (via toggleEntity's `highlight.color`
  // option). `null` means "use the renderer's default" -- manual map clicks
  // never set this.
  selectedColor: number | null;
  // Flag-image fill, alongside `selectedColor` -- both are always kept
  // up to date regardless of which is currently active; `selectedFillMode`
  // is the last-edit-wins switch between them (see scenes.ts's `fillMode`).
  selectedFlagCode: string | null;
  selectedFillMode: "color" | "image";
  // Position sliders' values -- fraction of the entity's own bounding box
  // to pan the flag image within its silhouette. 0 = centered/unadjusted.
  selectedFlagOffsetX: number;
  selectedFlagOffsetY: number;
  hoveredEntityId: string | null;
  // Manual override for state (sub-country) border visibility, set from the
  // Instruction Builder. `true` (default) leaves today's behavior alone --
  // state borders still only ever appear above STATE_ZOOM_THRESHOLD.
  // `false` forces them off regardless of zoom, and also makes states
  // unclickable/unhoverable (MapCanvas.tsx's hitTestScreenPoint reads this
  // too), not just invisible.
  showStateBorders: boolean;
}

type Listener = () => void;
// `id: null` means "focus the whole world" (e.g. Phase 6's target-less
// "pan" action) rather than a specific entity -- MapCanvas.tsx's
// onFocusRequest handler branches on it instead of calling findById.
// `durationSeconds`, when given, means "glide there over exactly this many
// seconds" (a scripted Phase 6 scene pan, via camera.ts's tweenCamera) --
// omitted, it's the original fast interactive fly-to (InstructionBuilder's
// live preview), unchanged from before this existed.
// `fromWorldView`, only meaningful alongside a durationSeconds glide, means
// "start the glide from world view" instead of from wherever the camera
// currently sits -- used for a story's first scene when the user opts into
// a cinematic world->scene1 open (sceneStore.ts's startFromWorldView),
// rather than the glide silently depending on leftover camera position.
// `zoomPercent` (default 100) scales how tight/loose the resulting framing
// is versus the plain auto-fit -- camera.ts's focusOnBounds zoomMultiplier,
// or (for id === null) MIN_ZOOM itself for a world pan. Bundled into an
// options object rather than a further positional param -- this is the
// third one stacked on here, past the point where positional args stay
// readable at call sites.
export interface FocusOptions {
  durationSeconds?: number;
  fromWorldView?: boolean;
  zoomPercent?: number;
}
type FocusListener = (id: string | null, options?: FocusOptions) => void;

function createInteractionStore() {
  let state: InteractionState = {
    entities: [],
    selectedEntityIds: new Set(),
    selectedColor: null,
    selectedFlagCode: null,
    selectedFillMode: "color",
    selectedFlagOffsetX: 0,
    selectedFlagOffsetY: 0,
    hoveredEntityId: null,
    showStateBorders: true,
  };
  const listeners = new Set<Listener>();
  // Separate from `listeners`/`emit` above -- a focus request (e.g. "fly the
  // camera to this entity") isn't a state change, so it shouldn't also
  // trigger unrelated state subscribers like MapCanvas.tsx's
  // drawHighlights. Kept as its own channel so callers can react to "fly to
  // X" without it being entangled with selection/hover state.
  const focusListeners = new Set<FocusListener>();

  function emit() {
    for (const listener of listeners) listener();
  }

  return {
    getState(): InteractionState {
      return state;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEntities(entities: Entity[]) {
      state = { ...state, entities };
      emit();
    },
    isSelected(id: string): boolean {
      return state.selectedEntityIds.has(id);
    },
    // `additive` is the ctrl/cmd modifier: false replaces the whole
    // selection with just `id` (or clears it, for `id === null` -- e.g. a
    // plain click on empty ocean/land); true toggles `id` into/out of the
    // existing selection, leaving the rest alone, same as a file manager's
    // ctrl+click. `id === null` with `additive: true` is a deliberate no-op
    // (ctrl+clicking empty space shouldn't discard a multi-selection) --
    // callers (MapCanvas.tsx's onPointerUp) shouldn't even call this in that
    // case, but it's a safe no-op here too if they do.
    // `highlight`, only meaningful alongside a non-additive single-entity
    // replace, is the Phase 6 scene highlight's custom fill
    // (actionRegistry.ts's "highlight" handler) -- color and/or flag image,
    // plus which one is currently active (`fillMode`, last-edit-wins per
    // scenes.ts). Bundled into an options object rather than more stacked
    // positional params, same call already made for FocusOptions above.
    // Every other path (clearing, additive multi-select) resets all three
    // to their defaults -- manual map clicks have no custom-fill concept
    // and should fall back to the renderer's defaults.
    toggleEntity(
      id: string | null,
      additive: boolean,
      highlight?: {
        color?: number;
        flagCode?: string;
        fillMode?: "color" | "image";
        flagOffsetX?: number;
        flagOffsetY?: number;
      },
    ) {
      if (id === null) {
        if (additive || state.selectedEntityIds.size === 0) return;
        state = {
          ...state,
          selectedEntityIds: new Set(),
          selectedColor: null,
          selectedFlagCode: null,
          selectedFillMode: "color",
          selectedFlagOffsetX: 0,
          selectedFlagOffsetY: 0,
        };
        emit();
        return;
      }

      if (!additive) {
        const color = highlight?.color ?? null;
        const flagCode = highlight?.flagCode ?? null;
        const fillMode = highlight?.fillMode ?? "color";
        const flagOffsetX = highlight?.flagOffsetX ?? 0;
        const flagOffsetY = highlight?.flagOffsetY ?? 0;
        if (
          state.selectedEntityIds.size === 1 &&
          state.selectedEntityIds.has(id) &&
          state.selectedColor === color &&
          state.selectedFlagCode === flagCode &&
          state.selectedFillMode === fillMode &&
          state.selectedFlagOffsetX === flagOffsetX &&
          state.selectedFlagOffsetY === flagOffsetY
        )
          return;
        state = {
          ...state,
          selectedEntityIds: new Set([id]),
          selectedColor: color,
          selectedFlagCode: flagCode,
          selectedFillMode: fillMode,
          selectedFlagOffsetX: flagOffsetX,
          selectedFlagOffsetY: flagOffsetY,
        };
        emit();
        return;
      }

      const next = new Set(state.selectedEntityIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      state = {
        ...state,
        selectedEntityIds: next,
        selectedColor: null,
        selectedFlagCode: null,
        selectedFillMode: "color",
        selectedFlagOffsetX: 0,
        selectedFlagOffsetY: 0,
      };
      emit();
    },
    hoverEntity(id: string | null) {
      if (state.hoveredEntityId === id) return;
      state = { ...state, hoveredEntityId: id };
      emit();
    },
    setShowStateBorders(show: boolean) {
      if (state.showStateBorders === show) return;
      state = { ...state, showStateBorders: show };
      emit();
    },
    // Case-insensitive substring match over entity names, capped at `limit`.
    // No prebuilt index -- ~4850 entities is trivial to filter per keystroke.
    search(query: string, limit: number = 10): Entity[] {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const results: Entity[] = [];
      for (const entity of state.entities) {
        if (entity.name.toLowerCase().includes(q)) {
          results.push(entity);
          if (results.length >= limit) break;
        }
      }
      return results;
    },
    // "Fly the camera to this entity" -- fired by InstructionBuilder's
    // live preview and Phase 6 scene playback. Decoupled from
    // toggleEntity/selection on purpose (see focusListeners comment above):
    // a caller can request a focus without also changing selection, and
    // selection changes never implicitly trigger a focus.
    onFocusRequest(listener: FocusListener): () => void {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    requestFocus(id: string | null, options?: FocusOptions) {
      for (const listener of focusListeners) listener(id, options);
    },
  };
}

export const interactionStore = createInteractionStore();

export function useInteractionStore(): InteractionState {
  return useSyncExternalStore(interactionStore.subscribe, interactionStore.getState);
}
