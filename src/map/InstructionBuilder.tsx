import { useMemo, useState } from "react";
import "./InstructionBuilder.css";
import { interactionStore, useInteractionStore } from "./interactionStore";
import type { Entity } from "./entities";

// Right-panel Instruction Builder (roadmap.md Phase 6, section 3). Unlike
// SearchBox.tsx, this entity picker deliberately does NOT require clicking
// the map -- per docs/phase_6_arch.md's "keep the map clean" decision, the
// map is chosen *from* this form, not the other way around. This step only
// tracks the picked entity locally (query -> dropdown -> pick); wiring a
// pick here to interactionStore.requestFocus/toggleEntity for a live map
// preview is the next 6.1 step, not yet done.
export function InstructionBuilder() {
  const { entities } = useInteractionStore();
  const [query, setQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  // Same substring search interactionStore already exposes for SearchBox --
  // no new search logic, just a new place (a form field, not a floating
  // map overlay) to render its results.
  const results = useMemo(() => interactionStore.search(query), [query, entities]);

  const pickEntity = (entity: Entity) => {
    setSelectedEntity(entity);
    setQuery("");
  };

  return (
    <>
      <div className="zone zone-animation">
        <span className="ib-field-label">Animation</span>
        {/* Animation dropdown lands in a later 6.1 step. */}
      </div>
      <div className="zone zone-input">
        <span className="ib-field-label">Entity</span>
        {selectedEntity ? (
          <div className="ib-input ib-selected-row">
            <span>
              {selectedEntity.name} <span className="ib-badge">{selectedEntity.type}</span>
            </span>
            <button className="ib-clear-btn" onClick={() => setSelectedEntity(null)}>
              ×
            </button>
          </div>
        ) : (
          <input
            type="text"
            placeholder="Search countries, states..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ib-input"
          />
        )}
        {!selectedEntity && results.length > 0 && (
          <ul className="ib-list">
            {results.map((entity) => (
              <li
                key={entity.id}
                className="ib-result"
                onClick={() => pickEntity(entity)}
              >
                <span>{entity.name}</span>
                <span className="ib-badge">{entity.type}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Duration input lands in a later 6.1 step. */}
      </div>
    </>
  );
}
