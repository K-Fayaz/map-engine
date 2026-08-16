import "./Timeline.css";
import { useInteractionStore } from "./interactionStore";
import { useSceneStore } from "./sceneStore";
import { describeAnimation } from "./scenes";

// Bottom-left Timeline panel (roadmap.md Phase 6, section 8). Deliberately
// a plain list for this step -- positioned left-to-right, no cumulative-
// duration track, no drag-resize/reorder/delete. Turning this into the
// actual visual timeline (blocks laid out by duration, draggable) is 6.2,
// not this step; this only proves scenes created by the Instruction
// Builder actually land here, in order.
export function Timeline() {
  const scenes = useSceneStore((state) => state.scenes);
  const currentSceneIndex = useSceneStore((state) => state.currentSceneIndex);
  const isPlaying = useSceneStore((state) => state.isPlaying);
  const play = useSceneStore((state) => state.play);
  const pause = useSceneStore((state) => state.pause);
  const { entities } = useInteractionStore();

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
      {scenes.length === 0 ? (
        <div className="timeline-empty">No scenes yet -- build one in the Instruction Builder.</div>
      ) : (
        <ol className="timeline-list">
          {scenes.map((scene, index) => (
            <li
              key={scene.id}
              className={
                index === currentSceneIndex ? "timeline-row timeline-row-active" : "timeline-row"
              }
            >
              <span className="timeline-entity">{nameForScene(scene.targetEntityId)}</span>
              <span className="timeline-animation">{describeAnimation(scene)}</span>
              <span className="timeline-duration">{scene.duration}s</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
