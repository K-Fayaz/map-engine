import { useMemo, useState } from "react";
import "./InstructionBuilder.css";
import { interactionStore, useInteractionStore } from "./interactionStore";
import type { Entity } from "./entities";
import { ANIMATION_OPTIONS, animationRequiresEntity, buildScene, type AnimationValue } from "./scenes";
import { useSceneStore } from "./sceneStore";

// Right-panel Instruction Builder (roadmap.md Phase 6, section 3). Unlike
// SearchBox.tsx, this entity picker deliberately does NOT require clicking
// the map -- per docs/phase_6_arch.md's "keep the map clean" decision, the
// map is chosen *from* this form, not the other way around. This step only
// tracks the picked entity locally (query -> dropdown -> pick); wiring a
// pick here to interactionStore.requestFocus/toggleEntity for a live map
// preview is the next 6.1 step, not yet done.
export function InstructionBuilder() {
  const { entities } = useInteractionStore();
  const addScene = useSceneStore((state) => state.addScene);
  const [query, setQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [animation, setAnimation] = useState<AnimationValue>(ANIMATION_OPTIONS[0].value);
  // Seconds. Plain local state, becomes part of the Scene "Add to Timeline"
  // creates below.
  const [duration, setDuration] = useState(3);

  // Only "Pan" can go without an entity (pans out to the world) -- every
  // other animation needs one picked before a Scene can be built.
  const canAdd = !animationRequiresEntity(animation) || selectedEntity !== null;

  // Discussed and chosen over a full reset or no reset at all: only the
  // entity clears after adding, animation/duration carry over. Matches the
  // one concrete workflow roadmap.md's own demo describes (section 2) --
  // repeating the same Focus+Highlight/3s pattern for Pakistan, China,
  // Russia in a row -- so the common case doesn't need re-picking
  // animation/duration for every single entity.
  const addToTimeline = () => {
    const scene = buildScene(selectedEntity, animation, duration);
    if (!scene) return;
    addScene(scene);
    setSelectedEntity(null);
  };

  // Same substring search interactionStore already exposes for SearchBox --
  // no new search logic, just a new place (a form field, not a floating
  // map overlay) to render its results.
  const results = useMemo(() => interactionStore.search(query), [query, entities]);

  // Live map preview: same non-additive select + fly-to pattern
  // SearchBox.tsx uses (toggleEntity replaces the whole selection with just
  // this entity, requestFocus flies the camera to it). This is the only
  // path that drives the map now -- the map itself stays click/hover-
  // selectable independently (Phase 4, untouched), but building a story
  // never requires touching it.
  //
  // Known gap (flagged 6.1.a, still true here): every pick fires *both*
  // toggleEntity and requestFocus regardless of the selected animation, so
  // e.g. picking "Pan" (no highlight) still highlights the entity in the
  // live preview -- misleading, since the Scene actually added won't
  // highlight it. Deliberately left as-is for now (reverted a buildScene/
  // dispatchScene-based fix here on request) -- revisit later.
  const pickEntity = (entity: Entity) => {
    setSelectedEntity(entity);
    setQuery("");
    interactionStore.toggleEntity(entity.id, false);
    interactionStore.requestFocus(entity.id);
  };

  return (
    <div className="zone">
      <div>
        <span className="ib-field-label">Animation</span>
        <select
          className="ib-input"
          value={animation}
          onChange={(e) => setAnimation(e.target.value as typeof animation)}
        >
          {ANIMATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* No execution wiring yet -- this only tracks the pick locally
            until the Scene model + action registry land (6.1.b/6.1.c). */}
      </div>
      <div>
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
            placeholder={
              animation === "pan"
                ? "Search countries, states... (leave empty to pan to world)"
                : "Search countries, states..."
            }
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
      </div>
      <div>
        <span className="ib-field-label">Duration (seconds)</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="ib-input"
        />
      </div>
      <button className="ib-add-btn" disabled={!canAdd} onClick={addToTimeline}>
        Add to Timeline
      </button>
    </div>
  );
}
