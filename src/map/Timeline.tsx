import { useRef } from "react";
import "./Timeline.css";
import { useInteractionStore } from "./interactionStore";
import { useSceneStore } from "./sceneStore";
import { describeAnimation } from "./scenes";
import { TimelineRuler } from "./TimelineRuler";
import { PIXELS_PER_SECOND } from "./timelineLayout";

// Bottom-left Timeline panel (roadmap.md Phase 6, section 8). Scene blocks
// are laid out edge-to-edge, each block's width = duration *
// PIXELS_PER_SECOND, so the track lines up with the ruler above it.
// Reorder/delete are the rest of 6.2, not yet built.
export function Timeline() {
  const scenes = useSceneStore((state) => state.scenes);
  const currentSceneIndex = useSceneStore((state) => state.currentSceneIndex);
  const isPlaying = useSceneStore((state) => state.isPlaying);
  const play = useSceneStore((state) => state.play);
  const pause = useSceneStore((state) => state.pause);
  const resizeScene = useSceneStore((state) => state.resizeScene);
  const deleteScene = useSceneStore((state) => state.deleteScene);
  const jumpToScene = useSceneStore((state) => state.jumpToScene);
  const startFromWorldView = useSceneStore((state) => state.startFromWorldView);
  const setStartFromWorldView = useSceneStore((state) => state.setStartFromWorldView);
  const { entities } = useInteractionStore();
  // Floor of 60s so the ruler still shows a full minute of ticks with no
  // scenes yet, instead of collapsing to nothing.
  const totalDurationSeconds = Math.max(60, scenes.reduce((sum, scene) => sum + scene.duration, 0));

  // Drag-to-resize state lives in a ref, not React state -- it only needs
  // to be read inside pointer-move/up handlers, never rendered off of, so
  // a ref avoids a re-render on every pixel of mouse movement (resizeScene
  // itself already triggers the re-render that actually matters, via the
  // width recompute below). Only one block can be resized at a time, so a
  // single ref (not one per block) is enough.
  const dragRef = useRef<{ sceneId: string; startX: number; startDuration: number } | null>(null);

  const startResize = (e: React.PointerEvent, sceneId: string, duration: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { sceneId, startX: e.clientX, startDuration: duration };
  };

  const onResizeMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const deltaSeconds = (e.clientX - dragRef.current.startX) / PIXELS_PER_SECOND;
    resizeScene(dragRef.current.sceneId, dragRef.current.startDuration + deltaSeconds);
  };

  const endResize = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  const nameForScene = (targetEntityId?: string): string => {
    if (!targetEntityId) return "World";
    return entities.find((entity) => entity.id === targetEntityId)?.name ?? targetEntityId;
  };

  return (
    <div className="timeline-panel">
      {/* Single toggle button, not two separate Play/Pause buttons -- only
          one of the two actions is ever valid at a time (isPlaying already
          disambiguates), so one button avoids a redundant disabled half. */}
      <button
        type="button"
        className="timeline-playback-toggle"
        onClick={isPlaying ? pause : play}
        disabled={scenes.length === 0}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      {/* Only affects a fresh Play (scene 0, not a resume) -- when off, that
          first scene snaps straight to its target instead of gliding from
          world view; either way the start no longer depends on wherever the
          camera was last left. */}
      <label className="timeline-world-view-toggle">
        <input
          type="checkbox"
          checked={startFromWorldView}
          onChange={(e) => setStartFromWorldView(e.target.checked)}
        />
        Start from world view
      </label>
      <TimelineRuler totalDurationSeconds={totalDurationSeconds} />
      {scenes.length === 0 ? (
        <div className="timeline-empty">No scenes yet -- build one in the Instruction Builder.</div>
      ) : (
          <ol className="timeline-track">
            {scenes.map((scene, index) => (
              <li
                key={scene.id}
                className={
                  index === currentSceneIndex ? "timeline-block timeline-block-active" : "timeline-block"
                }
                style={{ width: scene.duration * PIXELS_PER_SECOND }}
                onClick={() => jumpToScene(index)}
              >
                <button
                  type="button"
                  className="timeline-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScene(scene.id);
                  }}
                  aria-label={`Delete ${nameForScene(scene.targetEntityId)} scene`}
                >
                  ×
                </button>
                <span className="timeline-entity">{nameForScene(scene.targetEntityId)}</span>
                <span className="timeline-animation">{describeAnimation(scene)}</span>
                <span className="timeline-duration">{scene.duration}s</span>
                <div
                  className="timeline-resize-handle"
                  onPointerDown={(e) => startResize(e, scene.id, scene.duration)}
                  onPointerMove={onResizeMove}
                  onPointerUp={endResize}
                  onClick={(e) => e.stopPropagation()}
                />
              </li>
            ))}
          </ol>
      )}
    </div>
  );
}
