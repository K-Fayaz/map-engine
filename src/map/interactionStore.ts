import { useSyncExternalStore } from "react";
import type { Entity } from "./entities";

// Selection/hover state, shared between MapCanvas.tsx's imperative Pixi code
// (which reads/writes it directly, via the exported singleton, to avoid
// tearing down/rebuilding the map on every hover) and React components
// (SearchBox, via the hook below). No state-management library is installed
// in this repo -- this is a minimal plain pub/sub, not a general-purpose
// store. `selectEntity`/`hoverEntity` are callable from anywhere (pointer
// handlers, search results, or later programmatically from Phase 5/6 code),
// matching architecture.md's "usable manually and through AI" principle.
interface InteractionState {
  entities: Entity[];
  selectedEntityId: string | null;
  hoveredEntityId: string | null;
}

type Listener = () => void;

function createInteractionStore() {
  let state: InteractionState = {
    entities: [],
    selectedEntityId: null,
    hoveredEntityId: null,
  };
  const listeners = new Set<Listener>();

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
    selectEntity(id: string | null) {
      if (state.selectedEntityId === id) return;
      state = { ...state, selectedEntityId: id };
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
  };
}

export const interactionStore = createInteractionStore();

export function useInteractionStore(): InteractionState {
  return useSyncExternalStore(interactionStore.subscribe, interactionStore.getState);
}
