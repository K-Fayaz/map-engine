import { useEffect, useMemo, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import "./InstructionBuilder.css";
import { interactionStore, useInteractionStore } from "./interactionStore";
import type { Entity } from "./entities";
import {
  ANIMATION_OPTIONS,
  animationRequiresEntity,
  buildScene,
  sceneAnimationValue,
  sceneHighlightColor,
  sceneHighlightFillMode,
  sceneHighlightFlagCode,
  sceneHighlightFlagOffsetX,
  sceneHighlightFlagOffsetY,
  sceneZoomPercent,
  type AnimationValue,
} from "./scenes";
import { useSceneStore } from "./sceneStore";
import { EXPORT_PROFILES, useExportStore } from "./exportStore";
import { defaultSelectionColor, hexToNumber, numberToHex } from "./mapColors";
import { flagAssetUrl, listFlagOptions } from "./flags";

// Position sliders run -50..50 (full drag range, same feel as any other
// slider) but map to a much smaller actual offset -- fillGeometryTexture's
// offset is a fraction of the entity's own bounding box, so even 0.5 (50%)
// panned the flag drastically for a small drag. /5000 caps the real range
// at +/-0.01 (1%), which reads as a fine, controllable nudge instead.
const FLAG_OFFSET_SLIDER_SCALE = 5000;

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
  const { entities, showStateBorders } = useInteractionStore();
  const selectedProfile = useExportStore((state) => state.selectedProfile);
  const setSelectedProfile = useExportStore((state) => state.setSelectedProfile);
  const scenes = useSceneStore((state) => state.scenes);
  const addScene = useSceneStore((state) => state.addScene);
  const editingSceneId = useSceneStore((state) => state.editingSceneId);
  const updateScene = useSceneStore((state) => state.updateScene);
  const stopEditingScene = useSceneStore((state) => state.stopEditingScene);
  const [query, setQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [animation, setAnimation] = useState<AnimationValue>(ANIMATION_OPTIONS[0].value);
  // Seconds. Plain local state, becomes part of the Scene "Add to Timeline"
  // creates below.
  const [duration, setDuration] = useState(3);
  // Percent, 100 = plain auto-fit framing (unchanged from before this
  // field existed). Tightness multiplier on top of the auto-fit, not an
  // absolute zoom -- see camera.ts's focusOnBounds zoomMultiplier.
  const [zoomPercent, setZoomPercent] = useState(100);
  // Pixi packed-number hex, only meaningful while animation === "highlight".
  // Becomes part of the Scene's highlight action -- see buildScene. Both
  // this and the flag fields below stay live/editable together regardless
  // of which is currently active -- `highlightFillMode` (last-edit-wins) is
  // the only thing deciding which one actually renders.
  const [highlightColor, setHighlightColor] = useState(defaultSelectionColor);
  const [highlightFlagCode, setHighlightFlagCode] = useState<string | null>(null);
  const [highlightFillMode, setHighlightFillMode] = useState<"color" | "image">("color");
  // Position sliders' values -- fraction of the entity's own bounding box
  // to pan the flag image within its silhouette (see render.ts's
  // fillGeometryTexture). 0 = centered/unadjusted. These don't participate
  // in the color/image last-edit-wins switch -- they only refine the flag
  // fill once one's already active.
  const [highlightFlagOffsetX, setHighlightFlagOffsetX] = useState(0);
  const [highlightFlagOffsetY, setHighlightFlagOffsetY] = useState(0);
  const [flagQuery, setFlagQuery] = useState("");

  // 6.3: clicking a scene block in Timeline.tsx sets editingSceneId, which
  // this form re-populates from -- only depends on editingSceneId itself
  // (not `scenes`/`entities`), so it re-syncs when the user picks a
  // *different* scene to edit, but doesn't fight their in-progress edits
  // if the scenes array happens to change for an unrelated reason (e.g.
  // dragging another block's resize handle) while this one stays open.
  useEffect(() => {
    if (!editingSceneId) return;
    const scene = scenes.find((s) => s.id === editingSceneId);
    if (!scene) return;
    setAnimation(sceneAnimationValue(scene));
    setDuration(scene.duration);
    setZoomPercent(sceneZoomPercent(scene));
    setHighlightColor(sceneHighlightColor(scene));
    setHighlightFlagCode(sceneHighlightFlagCode(scene));
    setHighlightFillMode(sceneHighlightFillMode(scene));
    setHighlightFlagOffsetX(sceneHighlightFlagOffsetX(scene));
    setHighlightFlagOffsetY(sceneHighlightFlagOffsetY(scene));
    setSelectedEntity(
      scene.targetEntityId ? (entities.find((e) => e.id === scene.targetEntityId) ?? null) : null,
    );
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSceneId]);

  // Only "Pan" can go without an entity (pans out to the world) -- every
  // other animation needs one picked before a Scene can be built.
  const canAdd = !animationRequiresEntity(animation) || selectedEntity !== null;
  // "Hold" doesn't target an entity or a camera framing at all -- it's a
  // pure "rest here for a while" instruction -- so both fields are
  // disabled outright while it's selected, not just optional like "Pan"'s
  // target-less case.
  const isHold = animation === "hold";

  // Discussed and chosen over a full reset or no reset at all: only the
  // entity clears after adding, animation/duration carry over. Matches the
  // one concrete workflow roadmap.md's own demo describes (section 2) --
  // repeating the same Focus+Highlight/3s pattern for Pakistan, China,
  // Russia in a row -- so the common case doesn't need re-picking
  // animation/duration for every single entity. Editing an existing scene
  // (editingSceneId set) takes the update branch instead of appending, and
  // fully resets/exits edit mode afterward rather than carrying anything
  // over -- editing is a one-off correction, not a repeated pattern.
  const submit = () => {
    const scene = buildScene(
      selectedEntity,
      animation,
      duration,
      zoomPercent,
      highlightColor,
      highlightFlagCode,
      highlightFillMode,
      highlightFlagOffsetX,
      highlightFlagOffsetY,
    );
    if (!scene) return;
    if (editingSceneId) {
      updateScene(editingSceneId, scene);
      setSelectedEntity(null);
      setQuery("");
    } else {
      addScene(scene);
      setSelectedEntity(null);
    }
  };

  const cancelEdit = () => {
    stopEditingScene();
    setSelectedEntity(null);
    setQuery("");
    setAnimation(ANIMATION_OPTIONS[0].value);
    setDuration(3);
    setZoomPercent(100);
    setHighlightColor(defaultSelectionColor);
    setHighlightFlagCode(null);
    setHighlightFillMode("color");
    setHighlightFlagOffsetX(0);
    setHighlightFlagOffsetY(0);
    setFlagQuery("");
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
    interactionStore.requestFocus(entity.id, { zoomPercent });
    if (animation === "highlight") {
      interactionStore.toggleEntity(entity.id, false, {
        color: highlightColor,
        flagCode: highlightFlagCode ?? undefined,
        fillMode: highlightFillMode,
        flagOffsetX: highlightFlagOffsetX,
        flagOffsetY: highlightFlagOffsetY,
      });
    }
  };

  // Live-updates the map preview as the color picker moves or a flag is
  // picked, same "instant feedback" principle as pickEntity above -- only
  // meaningful once an entity is already highlighted in the preview. Each
  // setter also flips `highlightFillMode` to its own mode -- last-edit-wins,
  // per the user's requirement that touching either control makes it the
  // active fill, without discarding the other's last value.
  const changeHighlightColor = (hex: string) => {
    const color = hexToNumber(hex);
    setHighlightColor(color);
    setHighlightFillMode("color");
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, {
        color,
        flagCode: highlightFlagCode ?? undefined,
        fillMode: "color",
        flagOffsetX: highlightFlagOffsetX,
        flagOffsetY: highlightFlagOffsetY,
      });
    }
  };

  const pickFlag = (alpha2: string) => {
    setHighlightFlagCode(alpha2);
    setHighlightFillMode("image");
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, {
        color: highlightColor,
        flagCode: alpha2,
        fillMode: "image",
        flagOffsetX: highlightFlagOffsetX,
        flagOffsetY: highlightFlagOffsetY,
      });
    }
  };

  // Live-updates the map preview as a position slider moves, same
  // "instant feedback" principle as the color/flag pickers -- doesn't
  // touch `highlightFillMode` itself, since these only refine whichever
  // fill (color or image) is already active.
  const changeFlagOffsetX = (value: number) => {
    setHighlightFlagOffsetX(value);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, {
        color: highlightColor,
        flagCode: highlightFlagCode ?? undefined,
        fillMode: highlightFillMode,
        flagOffsetX: value,
        flagOffsetY: highlightFlagOffsetY,
      });
    }
  };

  const changeFlagOffsetY = (value: number) => {
    setHighlightFlagOffsetY(value);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, {
        color: highlightColor,
        flagCode: highlightFlagCode ?? undefined,
        fillMode: highlightFillMode,
        flagOffsetX: highlightFlagOffsetX,
        flagOffsetY: value,
      });
    }
  };

  // All country entities with a resolvable flag, independent of which
  // entity is actually being highlighted -- free choice, per the user's
  // "no restriction on which country flag" requirement. Filtered by
  // flagQuery the same substring-match way entity search already works.
  const flagOptions = useMemo(() => listFlagOptions(entities), [entities]);
  const filteredFlagOptions = useMemo(() => {
    const q = flagQuery.trim().toLowerCase();
    if (!q) return flagOptions;
    return flagOptions.filter((option) => option.name.toLowerCase().includes(q));
  }, [flagOptions, flagQuery]);

  return (
    <div className="zone">
      <div className="ib-ratio-field">
        <span className="ib-field-label">Export Aspect Ratio</span>
        <div className="ib-ratio-toggle">
          {Object.values(EXPORT_PROFILES).map((profile) => (
            <button
              key={profile.ratio}
              type="button"
              className={
                "ib-ratio-option" +
                (selectedProfile === profile.ratio ? " ib-ratio-option-active" : "")
              }
              onClick={() => setSelectedProfile(profile.ratio)}
            >
              {profile.label}
            </button>
          ))}
        </div>
        <div className="ib-ratio-summary">
          {EXPORT_PROFILES[selectedProfile].label} ·{" "}
          {EXPORT_PROFILES[selectedProfile].width}x{EXPORT_PROFILES[selectedProfile].height}
        </div>
      </div>
      {/* Manual override for state-border visibility on zoom -- when off,
          states also stop being clickable/hoverable (interactionStore.ts's
          showStateBorders, read by MapCanvas.tsx's hitTestScreenPoint). */}
      <label className="ib-checkbox-row">
        <input
          type="checkbox"
          checked={showStateBorders}
          onChange={(e) => interactionStore.setShowStateBorders(e.target.checked)}
        />
        Show state borders on zoom
      </label>
      <div>
        <span className="ib-field-label">Animation</span>
        <select
          className="ib-input"
          value={animation}
          onChange={(e) => setAnimation(e.target.value as typeof animation)}
        >
          {ANIMATION_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              // "Hold" rests the camera at whatever the *previous* scene
              // left it at -- meaningless with no previous scene, so it's
              // disabled until the timeline already has at least one.
              disabled={option.value === "hold" && scenes.length === 0}
            >
              {option.label}
            </option>
          ))}
        </select>
        {/* No execution wiring yet -- this only tracks the pick locally
            until the Scene model + action registry land (6.1.b/6.1.c). */}
      </div>
      <div>
        <span className="ib-field-label">Entity</span>
        {selectedEntity && !isHold ? (
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
              isHold
                ? "Not applicable for Hold"
                : animation === "pan"
                  ? "Search countries, states... (leave empty to pan to world)"
                  : "Search countries, states..."
            }
            value={isHold ? "" : query}
            onChange={(e) => setQuery(e.target.value)}
            className="ib-input"
            disabled={isHold}
          />
        )}
        {!selectedEntity && !isHold && results.length > 0 && (
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
      <div>
        <span className="ib-field-label">Zoom (%)</span>
        <input
          type="number"
          min={10}
          step={10}
          value={zoomPercent}
          onChange={(e) => setZoomPercent(Number(e.target.value))}
          className="ib-input"
          disabled={isHold}
        />
      </div>
      {animation === "highlight" && (
        <div>
          <span className="ib-field-label">Highlight Color</span>
          <HexColorPicker
            className="ib-color-picker"
            color={numberToHex(highlightColor)}
            onChange={changeHighlightColor}
          />
          <HexColorInput
            className="ib-input ib-color-hex-input"
            color={numberToHex(highlightColor)}
            onChange={changeHighlightColor}
            prefixed
          />
          <span className="ib-field-label ib-flags-label">Flags</span>
          <input
            type="text"
            placeholder="Search flags..."
            value={flagQuery}
            onChange={(e) => setFlagQuery(e.target.value)}
            className="ib-input"
          />
          <div className="ib-flag-grid">
            {filteredFlagOptions.map((option) => (
              <button
                type="button"
                key={option.alpha2}
                className={
                  "ib-flag-option" +
                  (highlightFillMode === "image" && highlightFlagCode === option.alpha2
                    ? " ib-flag-option-active"
                    : "")
                }
                title={option.name}
                onClick={() => pickFlag(option.alpha2)}
              >
                <img src={flagAssetUrl(option.alpha2)} alt={option.name} />
              </button>
            ))}
          </div>
          <span className="ib-field-label ib-flags-label">Flag Position</span>
          <div className="ib-slider-row">
            <span className="ib-slider-caption">Horizontal</span>
            <input
              type="range"
              className="ib-slider"
              min={-50}
              max={50}
              step={1}
              value={Math.round(highlightFlagOffsetX * FLAG_OFFSET_SLIDER_SCALE)}
              onChange={(e) => changeFlagOffsetX(Number(e.target.value) / FLAG_OFFSET_SLIDER_SCALE)}
              disabled={highlightFillMode !== "image" || !highlightFlagCode}
            />
          </div>
          <div className="ib-slider-row">
            <span className="ib-slider-caption">Vertical</span>
            <input
              type="range"
              className="ib-slider"
              min={-50}
              max={50}
              step={1}
              value={Math.round(highlightFlagOffsetY * FLAG_OFFSET_SLIDER_SCALE)}
              onChange={(e) => changeFlagOffsetY(Number(e.target.value) / FLAG_OFFSET_SLIDER_SCALE)}
              disabled={highlightFillMode !== "image" || !highlightFlagCode}
            />
          </div>
        </div>
      )}
      <div className="ib-btn-row">
        <button className="ib-add-btn" disabled={!canAdd} onClick={submit}>
          {editingSceneId ? "Update Timeline" : "Add to Timeline"}
        </button>
        {editingSceneId && (
          <button className="ib-cancel-btn" onClick={cancelEdit}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
