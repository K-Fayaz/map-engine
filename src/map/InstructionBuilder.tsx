import { useMemo, useState } from "react";
import "./InstructionBuilder.css";
import { interactionStore, useInteractionStore } from "./interactionStore";
import type { Entity } from "./entities";
import { ANIMATION_OPTIONS, animationRequiresEntity, buildScene, type AnimationValue } from "./scenes";
import { useSceneStore } from "./sceneStore";

// Right-panel Instruction Builder (roadmap.md Phase 6, section 3). This
// entity picker deliberately does NOT require clicking the map -- per
// docs/phase_6_arch.md's "keep the map clean" decision, the map is chosen
// *from* this form, not the other way around (the old floating in-map
// SearchBox was removed once this became the only path used to build a
// story). Picking an entity drives a live map preview (see pickEntity
// below); the map itself stays click/hover-selectable independently
// (Phase 4, untouched), but
// building a story never requires touching it.
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

  // Same substring search interactionStore already exposes -- no new
  // search logic, just a form field to render results in.
  const results = useMemo(() => interactionStore.search(query), [query, entities]);

  // Live map preview: fast/interactive, never scripted -- duration only
  // applies once a Scene is actually added to the timeline; previewing at
  // that speed would make picking an entity feel sluggish for anything
  // longer than a couple seconds. Mirrors buildScene's animation -> action
  // mapping (scenes.ts) directly rather than routing through
  // buildScene/dispatchScene, since dispatchScene now always threads the
  // Scene's duration into a scripted glide (see the pan-duration fix) --
  // reusing it here would make every pick glide for the chosen duration
  // instead of confirming the pick instantly.
  //
  // Fixed a real bug that lived here through 6.1.c: every pick used to
  // fire *both* toggleEntity and requestFocus regardless of the selected
  // animation, so picking "Pan" (no highlight) still showed a highlight in
  // the live preview -- misleading, since the Scene actually added
  // wouldn't highlight anything.
  const pickEntity = (entity: Entity) => {
    setSelectedEntity(entity);
    setQuery("");
    // Every animation pans to the picked entity for visual confirmation
    // (plan-phase6-scenes-timeline.md decision #2) -- including
    // "clearHighlight", even though the Scene it builds won't highlight
    // anything (it clears whatever's currently highlighted, ignoring which
    // entity was picked -- see actionRegistry.ts's clearHighlight
    // handler). Only "highlight" additionally shows the highlight itself.
    interactionStore.requestFocus(entity.id);
    if (animation === "highlight") {
      interactionStore.toggleEntity(entity.id, false);
    }
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
