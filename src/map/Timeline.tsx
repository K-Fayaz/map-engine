import { useEffect, useRef, useState } from "react";
import "./Timeline.css";
import { useInteractionStore } from "./interactionStore";
import { useSceneStore } from "./sceneStore";
import { useExportStore } from "./exportStore";
import { useAudioStore } from "./audioStore";
import { describeAnimation, sceneAnimationValue, sceneZoomPercent, type Scene } from "./scenes";
import { TimelineRuler } from "./TimelineRuler";
import { AudioWaveform } from "./AudioWaveform";
import { PIXELS_PER_SECOND } from "./timelineLayout";

const AUDIO_TRACK_HEIGHT = 48;

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

  const audioFileName = useAudioStore((state) => state.fileName);
  const audioObjectUrl = useAudioStore((state) => state.objectUrl);
  const audioDurationSeconds = useAudioStore((state) => state.durationSeconds);
  const audioPeaks = useAudioStore((state) => state.peaks);
  const audioIsLoading = useAudioStore((state) => state.isLoading);
  const audioError = useAudioStore((state) => state.error);
  const pickAudioFile = useAudioStore((state) => state.pickAudioFile);
  const clearAudio = useAudioStore((state) => state.clearAudio);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);

  // Resets playback UI state whenever a different (or no) clip is loaded --
  // a stale isAudioPlaying/playhead from the previous clip would otherwise
  // survive a pick/clear since the <audio> element's own src just changes
  // underneath it.
  useEffect(() => {
    setIsAudioPlaying(false);
    setPlayheadSeconds(0);
  }, [audioObjectUrl]);

  const toggleAudioPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  };

  // Click-to-seek anywhere on the waveform bar -- the actual point of this
  // track (see audioStore.ts's header comment): line a scene's duration up
  // against a specific point in the audio by ear, not just by eye.
  const seekAudioTo = (clientX: number, barLeft: number) => {
    const audio = audioRef.current;
    if (!audio || !audioDurationSeconds) return;
    const seconds = Math.max(0, Math.min(audioDurationSeconds, (clientX - barLeft) / PIXELS_PER_SECOND));
    audio.currentTime = seconds;
    setPlayheadSeconds(seconds);
  };

  const exportStatus = useExportStore((state) => state.status);
  const exportCurrentFrame = useExportStore((state) => state.currentFrame);
  const exportTotalFrames = useExportStore((state) => state.totalFrames);
  const exportErrorMessage = useExportStore((state) => state.errorMessage);
  const startExport = useExportStore((state) => state.startExport);
  const cancelExport = useExportStore((state) => state.cancelExport);
  const isExporting = exportStatus === "exporting";
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

  // Hold has no targetEntityId either (same as a world pan), but "World" as
  // its label would be actively misleading -- it doesn't pan anywhere, it
  // rests wherever the previous scene left off.
  const nameForScene = (scene: Scene): string => {
    if (sceneAnimationValue(scene) === "hold") return "—";
    if (!scene.targetEntityId) return "World";
    return entities.find((entity) => entity.id === scene.targetEntityId)?.name ?? scene.targetEntityId;
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
      {/* Deliberately calls startExport directly, never sceneStore.play() --
          export renders from the scene data independently of the live
          canvas, which must never start playing just because Export was
          clicked (see the video-export plan). */}
      <div className="timeline-export-row">
        <button
          type="button"
          className="timeline-export-btn"
          onClick={() => startExport(scenes, startFromWorldView)}
          disabled={scenes.length === 0 || isExporting}
        >
          Export
        </button>
        {/* Independent of the video Play/Pause above -- this only controls
            the reference <audio> element (see audioStore.ts's header
            comment), not synced to scripted camera playback. */}
        {audioObjectUrl && (
          <button
            type="button"
            className="timeline-export-btn"
            onClick={toggleAudioPlayback}
          >
            {isAudioPlaying ? "⏸ Audio" : "▶ Audio"}
          </button>
        )}
        {isExporting && (
          <>
            <span className="timeline-export-progress">
              {exportTotalFrames > 0
                ? `Frame ${exportCurrentFrame} / ${exportTotalFrames}`
                : "Starting…"}
            </span>
            <button type="button" className="timeline-export-cancel" onClick={cancelExport}>
              Cancel
            </button>
          </>
        )}
        {exportStatus === "done" && <span className="timeline-export-status">Export complete</span>}
        {exportStatus === "error" && (
          <span className="timeline-export-status timeline-export-status-error">
            Export failed{exportErrorMessage ? `: ${exportErrorMessage}` : ""}
          </span>
        )}
      </div>
      {/* Play/world-view/Export/Audio controls above stay outside this
          wrapper so they never scroll out of view -- only the ruler/track/
          audio row (which can legitimately be wider than the panel) scroll
          horizontally, clipped to the panel's own width. */}
      <div className="timeline-scroll-area">
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
                  aria-label={`Delete ${nameForScene(scene)} scene`}
                >
                  ×
                </button>
                <span className="timeline-entity">{nameForScene(scene)}</span>
                <span className="timeline-animation">{describeAnimation(scene)}</span>
                <span className="timeline-duration">
                  {scene.duration}s
                  {sceneAnimationValue(scene) !== "hold" && ` · ${sceneZoomPercent(scene)}%`}
                </span>
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
      {/* Reference audio track (see audioStore.ts's header comment) -- one
          clip for the whole story, purely a visual/audible reference for
          timing scene durations against. Not synced to Play/live playback;
          this <audio> element's play/pause/seek is entirely independent. */}
      <div className="timeline-audio-row">
        {!audioObjectUrl ? (
          <button
            type="button"
            className="timeline-audio-add-btn"
            onClick={() => pickAudioFile()}
            disabled={audioIsLoading}
          >
            {audioIsLoading ? "Loading…" : "+ Add Audio"}
          </button>
        ) : (
          <div className="timeline-audio-clip">
            <div
              className="timeline-audio-waveform-bar"
              style={{ width: (audioDurationSeconds ?? 0) * PIXELS_PER_SECOND }}
              onClick={(e) => seekAudioTo(e.clientX, e.currentTarget.getBoundingClientRect().left)}
              title={audioFileName ?? undefined}
            >
              {audioPeaks && (
                <AudioWaveform
                  peaks={audioPeaks}
                  width={(audioDurationSeconds ?? 0) * PIXELS_PER_SECOND}
                  height={AUDIO_TRACK_HEIGHT}
                  playheadFraction={
                    audioDurationSeconds ? playheadSeconds / audioDurationSeconds : null
                  }
                />
              )}
            </div>
            <button
              type="button"
              className="timeline-audio-clear-btn"
              onClick={() => clearAudio()}
              aria-label="Remove audio"
            >
              ×
            </button>
            <audio
              ref={audioRef}
              src={audioObjectUrl}
              onPlay={() => setIsAudioPlaying(true)}
              onPause={() => setIsAudioPlaying(false)}
              onTimeUpdate={(e) => setPlayheadSeconds(e.currentTarget.currentTime)}
              onEnded={() => setIsAudioPlaying(false)}
            />
          </div>
        )}
        {audioError && <span className="timeline-audio-error">{audioError}</span>}
      </div>
      </div>
    </div>
  );
}
