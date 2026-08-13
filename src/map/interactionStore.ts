import { useSyncExternalStore } from "react";
import type { Entity } from "./entities";

// Selection/hover state, shared between MapCanvas.tsx's imperative Pixi code
// (which reads/writes it directly, via the exported singleton, to avoid
// tearing down/rebuilding the map on every hover) and React components
// (SearchBox, via the hook below). No state-management library is installed
// in this repo -- this is a minimal plain pub/sub, not a general-purpose
// store. `toggleEntity`/`hoverEntity` are callable from anywhere (pointer
// handlers, search results, or later programmatically from Phase 5/6 code),
// matching architecture.md's "usable manually and through AI" principle.
interface InteractionState {
  entities: Entity[];
  // A Set, not a single id -- multi-select (ctrl/cmd+click to add/remove,
  // like a file manager) needs more than one entity selected at once. See
  // toggleEntity below for how membership changes; drawHighlights in
  // MapCanvas.tsx renders every id in here, not just one.
  selectedEntityIds: Set<string>;
  hoveredEntityId: string | null;
}

type Listener = () => void;
type FocusListener = (id: string) => void;

function createInteractionStore() {
  let state: InteractionState = {
    entities: [],
    selectedEntityIds: new Set(),
    hoveredEntityId: null,
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
    toggleEntity(id: string | null, additive: boolean) {
      if (id === null) {
        if (additive || state.selectedEntityIds.size === 0) return;
        state = { ...state, selectedEntityIds: new Set() };
        emit();
        return;
      }

      if (!additive) {
        if (state.selectedEntityIds.size === 1 && state.selectedEntityIds.has(id)) return;
        state = { ...state, selectedEntityIds: new Set([id]) };
        emit();
        return;
      }

      const next = new Set(state.selectedEntityIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      state = { ...state, selectedEntityIds: next };
      emit();
    },
    hoverEntity(id: string | null) {
      if (state.hoveredEntityId === id) return;
      state = { ...state, hoveredEntityId: id };
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
    // "Fly the camera to this entity" -- currently fired only by SearchBox's
    // non-additive select. Decoupled from toggleEntity/selection on purpose
    // (see focusListeners comment above): a caller can request a focus
    // without also changing selection, and selection changes never
    // implicitly trigger a focus.
    onFocusRequest(listener: FocusListener): () => void {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    requestFocus(id: string) {
      for (const listener of focusListeners) listener(id);
    },
  };
}

export const interactionStore = createInteractionStore();

export function useInteractionStore(): InteractionState {
  return useSyncExternalStore(interactionStore.subscribe, interactionStore.getState);
}
