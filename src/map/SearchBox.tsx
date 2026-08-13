import { useMemo, useState } from "react";
import { interactionStore, useInteractionStore } from "./interactionStore";
import type { Entity } from "./entities";

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  width: 260,
  fontFamily: "sans-serif",
  fontSize: 13,
  color: "#222",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 13,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: "4px 0 0",
  padding: 0,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  overflow: "hidden",
  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
};

const resultStyle: React.CSSProperties = {
  padding: "6px 8px",
  cursor: "pointer",
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
};

const badgeStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  textTransform: "uppercase",
};

const selectedListStyle: React.CSSProperties = {
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const selectedPanelStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const clearAllStyle: React.CSSProperties = {
  alignSelf: "flex-end",
  fontSize: 11,
  padding: "2px 6px",
};

// Floating search UI over the map canvas (see MapCanvas.tsx / App.tsx).
// Reads/writes interactionStore directly rather than owning any selection
// state itself -- selection is shared with pointer-driven selection on the
// map, so both paths need to agree on the same source of truth.
export function SearchBox() {
  const { entities, selectedEntityIds } = useInteractionStore();
  const [query, setQuery] = useState("");

  const results = useMemo(() => interactionStore.search(query), [query, entities]);
  const selectedEntities = useMemo(
    () => entities.filter((e) => selectedEntityIds.has(e.id)),
    [entities, selectedEntityIds],
  );

  // ctrl/cmd+click a result to add it to the current selection, same
  // modifier the map canvas uses -- plain click replaces the selection with
  // just this entity (and closes the results, like before). Additive clicks
  // deliberately leave the query/results open so several results can be
  // ctrl+clicked in a row without retyping. Only a plain click also flies
  // the camera there -- with more than one entity selected via ctrl+click
  // there's no single unambiguous target to frame.
  const selectResult = (entity: Entity, additive: boolean) => {
    interactionStore.toggleEntity(entity.id, additive);
    if (!additive) {
      interactionStore.requestFocus(entity.id);
      setQuery("");
    }
  };

  return (
    <div style={panelStyle}>
      <input
        type="text"
        placeholder="Search countries, states..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={inputStyle}
      />
      {results.length > 0 && (
        <ul style={listStyle}>
          {results.map((entity) => (
            <li
              key={entity.id}
              style={resultStyle}
              onClick={(e) => selectResult(entity, e.ctrlKey || e.metaKey)}
            >
              <span>{entity.name}</span>
              <span style={badgeStyle}>{entity.type}</span>
            </li>
          ))}
        </ul>
      )}
      {selectedEntities.length > 0 && (
        <div style={selectedListStyle}>
          {selectedEntities.map((entity) => (
            <div key={entity.id} style={selectedPanelStyle}>
              <span>
                {entity.name} <span style={badgeStyle}>{entity.type}</span>
              </span>
              <button onClick={() => interactionStore.toggleEntity(entity.id, true)}>×</button>
            </div>
          ))}
          {selectedEntities.length > 1 && (
            <button style={clearAllStyle} onClick={() => interactionStore.toggleEntity(null, false)}>
              Clear all ({selectedEntities.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
