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

const selectedPanelStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "6px 8px",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

// Floating search UI over the map canvas (see MapCanvas.tsx / App.tsx).
// Reads/writes interactionStore directly rather than owning any selection
// state itself -- selection is shared with pointer-driven selection on the
// map, so both paths need to agree on the same source of truth.
export function SearchBox() {
  const { entities, selectedEntityId } = useInteractionStore();
  const [query, setQuery] = useState("");

  const results = useMemo(() => interactionStore.search(query), [query, entities]);
  const selected = useMemo(
    () => entities.find((e) => e.id === selectedEntityId),
    [entities, selectedEntityId],
  );

  const selectResult = (entity: Entity) => {
    interactionStore.selectEntity(entity.id);
    setQuery("");
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
              onClick={() => selectResult(entity)}
            >
              <span>{entity.name}</span>
              <span style={badgeStyle}>{entity.type}</span>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div style={selectedPanelStyle}>
          <span>
            {selected.name} <span style={badgeStyle}>{selected.type}</span>
          </span>
          <button onClick={() => interactionStore.selectEntity(null)}>Clear</button>
        </div>
      )}
    </div>
  );
}
