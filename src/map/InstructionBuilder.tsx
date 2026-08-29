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
  sceneHighlightFlagScale,
  sceneHighlightImageSource,
  sceneHighlightUploadedImageId,
  sceneZoomPercent,
  type AnimationValue,
} from "./scenes";
import { useSceneStore } from "./sceneStore";
import { EXPORT_PROFILES, useExportStore } from "./exportStore";
import { defaultSelectionColor, hexToNumber, numberToHex } from "./mapColors";
import { flagAssetUrl, listFlagOptions } from "./flags";
import {
  cachedUploadedImagePreviewUrl,
  loadUploadedImagePreviewUrl,
  pickAndStoreUploadImage,
} from "./uploadedImages";

// Position sliders run -50..50 (full drag range, same feel as any other
// slider) but map to a much smaller actual offset -- fillGeometryTexture's
// offset is a fraction of the entity's own bounding box, so even 0.5 (50%)
// panned the flag drastically for a small drag. /5000 caps the real range
// at +/-0.01 (1%), which reads as a fine, controllable nudge instead.
const FLAG_OFFSET_SLIDER_SCALE = 5000;

// Scale slider range, as a percentage -- 50% to 200%, default 100% (1x,
// the automatic fit's own size, unaffected). Unlike the position sliders,
// this doesn't need a sensitivity-scaling factor -- 1 slider-percent-point
// is already a reasonably fine step for zoom.
const FLAG_SCALE_MIN_PERCENT = 50;
const FLAG_SCALE_MAX_PERCENT = 200;

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
  // Zoom on top of the automatic fit (render.ts's fillGeometryTexture) --
  // 1 = unadjusted. Same "refines whichever fill is active" role as the
  // offset sliders above.
  const [highlightFlagScale, setHighlightFlagScale] = useState(1);
  const [flagQuery, setFlagQuery] = useState("");
  // Which image mode currently resolves to -- a bundled flag or the user's
  // own upload (uploadedImages.ts) -- plus the uploaded image's id and a
  // displayable preview URL for its thumbnail (a blob URL, not persisted;
  // regenerated from the app-data copy on edit-load, see the effect below).
  const [highlightImageSource, setHighlightImageSource] = useState<"flag" | "upload" | null>(null);
  const [highlightUploadedImageId, setHighlightUploadedImageId] = useState<string | null>(null);
  const [uploadedImagePreviewUrl, setUploadedImagePreviewUrl] = useState<string | null>(null);
  const [uploadImageError, setUploadImageError] = useState<string | null>(null);

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
    setHighlightFlagScale(sceneHighlightFlagScale(scene));
    const imageSource = sceneHighlightImageSource(scene);
    const uploadedImageId = sceneHighlightUploadedImageId(scene);
    setHighlightImageSource(imageSource);
    setHighlightUploadedImageId(uploadedImageId);
    if (imageSource === "upload" && uploadedImageId) {
      // Async -- the blob URL preview isn't available until its bytes are
      // read back from the app-data copy (or it's already cached from
      // this session). Doesn't block the rest of the form repopulating.
      const cached = cachedUploadedImagePreviewUrl(uploadedImageId);
      if (cached) {
        setUploadedImagePreviewUrl(cached);
      } else {
        loadUploadedImagePreviewUrl(uploadedImageId).then(setUploadedImagePreviewUrl);
      }
    } else {
      setUploadedImagePreviewUrl(null);
    }
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
      highlightImageSource,
      highlightUploadedImageId,
      highlightFlagScale,
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
    setHighlightFlagScale(1);
    setFlagQuery("");
    setHighlightImageSource(null);
    setHighlightUploadedImageId(null);
    setUploadedImagePreviewUrl(null);
  };

  // Same substring search interactionStore already exposes -- no new
  // search logic, just a form field to render results in.
  const results = useMemo(() => interactionStore.search(query), [query, entities]);

  // Bundles current highlight-fill state into interactionStore.toggleEntity's
  // options shape, with any just-changed field overridden -- avoids
  // repeating all seven fields at every call site below (color, flag,
  // upload, and position-slider changes all need to pass the *other*
  // fields through unchanged so the live preview doesn't lose them).
  const highlightOptions = (
    overrides: Partial<{
      color: number;
      flagCode: string | null;
      fillMode: "color" | "image";
      flagOffsetX: number;
      flagOffsetY: number;
      flagScale: number;
      imageSource: "flag" | "upload" | null;
      uploadedImageId: string | null;
    }> = {},
  ) => {
    const color = overrides.color ?? highlightColor;
    const flagCode = overrides.flagCode !== undefined ? overrides.flagCode : highlightFlagCode;
    const fillMode = overrides.fillMode ?? highlightFillMode;
    const flagOffsetX = overrides.flagOffsetX ?? highlightFlagOffsetX;
    const flagOffsetY = overrides.flagOffsetY ?? highlightFlagOffsetY;
    const flagScale = overrides.flagScale ?? highlightFlagScale;
    const imageSource = overrides.imageSource !== undefined ? overrides.imageSource : highlightImageSource;
    const uploadedImageId =
      overrides.uploadedImageId !== undefined ? overrides.uploadedImageId : highlightUploadedImageId;
    return {
      color,
      flagCode: flagCode ?? undefined,
      fillMode,
      flagOffsetX,
      flagOffsetY,
      flagScale,
      imageSource: imageSource ?? undefined,
      uploadedImageId: uploadedImageId ?? undefined,
    };
  };

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
      interactionStore.toggleEntity(entity.id, false, highlightOptions());
    }
  };

  // Live-updates the map preview as the color/flag/upload controls change,
  // same "instant feedback" principle as pickEntity above -- only
  // meaningful once an entity is already highlighted in the preview. Each
  // setter also flips `highlightFillMode`/`highlightImageSource` to its own
  // mode -- last-edit-wins, per the user's requirement that touching any
  // one control makes it the active fill, without discarding the others'
  // last values.
  const changeHighlightColor = (hex: string) => {
    const color = hexToNumber(hex);
    setHighlightColor(color);
    setHighlightFillMode("color");
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, highlightOptions({ color, fillMode: "color" }));
    }
  };

  const pickFlag = (alpha2: string) => {
    setHighlightFlagCode(alpha2);
    setHighlightFillMode("image");
    setHighlightImageSource("flag");
    setHighlightUploadedImageId(null);
    setUploadedImagePreviewUrl(null);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(
        selectedEntity.id,
        false,
        highlightOptions({
          flagCode: alpha2,
          fillMode: "image",
          imageSource: "flag",
          uploadedImageId: null,
        }),
      );
    }
  };

  // Opens the native file picker (no type/size restriction -- the user's
  // explicit call), copies the chosen file into the app-owned data folder
  // (uploadedImages.ts, since this is a fully offline app -- the original
  // file could move/be deleted later), and makes it the active fill.
  // Wrapped in try/catch (same pattern as audioStore.ts's pickAudioFile) --
  // a real failure (disk full, permission denied) shouldn't surface as an
  // unhandled promise rejection with no feedback.
  const pickUploadImage = async () => {
    let result;
    try {
      result = await pickAndStoreUploadImage();
    } catch (err) {
      setUploadImageError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!result) return; // user cancelled the picker
    setUploadImageError(null);
    setHighlightUploadedImageId(result.id);
    setUploadedImagePreviewUrl(result.previewUrl);
    setHighlightFillMode("image");
    setHighlightImageSource("upload");
    setHighlightFlagCode(null);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(
        selectedEntity.id,
        false,
        highlightOptions({
          fillMode: "image",
          imageSource: "upload",
          uploadedImageId: result.id,
          flagCode: null,
        }),
      );
    }
  };

  // Live-updates the map preview as a position slider moves, same
  // "instant feedback" principle as the color/flag/upload pickers --
  // doesn't touch `highlightFillMode`/`highlightImageSource` themselves,
  // since these only refine whichever fill is already active.
  const changeFlagOffsetX = (value: number) => {
    setHighlightFlagOffsetX(value);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, highlightOptions({ flagOffsetX: value }));
    }
  };

  const changeFlagOffsetY = (value: number) => {
    setHighlightFlagOffsetY(value);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, highlightOptions({ flagOffsetY: value }));
    }
  };

  const changeFlagScale = (value: number) => {
    setHighlightFlagScale(value);
    if (animation === "highlight" && selectedEntity) {
      interactionStore.toggleEntity(selectedEntity.id, false, highlightOptions({ flagScale: value }));
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

  // Position sliders only make sense once an actual image (either source)
  // is the active fill -- otherwise there's nothing to pan.
  const hasActiveImage =
    (highlightImageSource === "flag" && !!highlightFlagCode) ||
    (highlightImageSource === "upload" && !!highlightUploadedImageId);

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
          <span className="ib-field-label">Highlight Image</span>
          <div className="ib-upload-row">
            <button type="button" className="ib-upload-btn" onClick={pickUploadImage}>
              Upload Image
            </button>
            {uploadedImagePreviewUrl && (
              <div className="ib-upload-preview">
                <img src={uploadedImagePreviewUrl} alt="Uploaded highlight" />
                {highlightImageSource === "upload" && <span className="ib-upload-active-dot" />}
              </div>
            )}
          </div>
          {uploadImageError && <div className="ib-upload-error">{uploadImageError}</div>}
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
                  (highlightFillMode === "image" &&
                  highlightImageSource === "flag" &&
                  highlightFlagCode === option.alpha2
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
              disabled={highlightFillMode !== "image" || !hasActiveImage}
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
              disabled={highlightFillMode !== "image" || !hasActiveImage}
            />
          </div>
          <div className="ib-slider-row">
            <span className="ib-slider-caption">Scale</span>
            <input
              type="range"
              className="ib-slider"
              min={FLAG_SCALE_MIN_PERCENT}
              max={FLAG_SCALE_MAX_PERCENT}
              step={5}
              value={Math.round(highlightFlagScale * 100)}
              onChange={(e) => changeFlagScale(Number(e.target.value) / 100)}
              disabled={highlightFillMode !== "image" || !hasActiveImage}
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
