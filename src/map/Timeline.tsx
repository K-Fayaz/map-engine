import { useEffect, useRef, useState } from "react";
import "./Timeline.css";
import { useInteractionStore } from "./interactionStore";
import { useSceneStore } from "./sceneStore";
import { useExportStore } from "./exportStore";
import { useAudioStore } from "./audioStore";
import { describeAnimation, sceneAnimationValue, sceneZoomPercent, type Scene } from "./scenes";
import { TimelineRuler } from "./TimelineRuler";
import { AudioWaveform } from "./AudioWaveform";
import { PIXELS_PER_SECOND, cumulativeSceneStart, sceneIndexAtTime } from "./timelineLayout";

// Left inset both .timeline-track (padding) and .timeline-audio-row
// (margin) already use -- the shared playhead line needs the same offset
// so it lines up with both rows' own duration/second-based positioning.
const TRACK_LEFT_INSET = 12;

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
  // One playhead position shared by both the scene track and the audio
  // waveform (see plan: crispy-chasing-biscuit.md) -- while scene playback
  // is active it tracks scene-elapsed time, while only audio is playing it
  // tracks audio.currentTime, and otherwise it just holds still at wherever
  // it was last scrubbed/jumped to.
  const [sharedPlayheadSeconds, setSharedPlayheadSeconds] = useState(0);

  // Resets playback UI state whenever a different (or no) clip is loaded --
  // a stale isAudioPlaying/playhead from the previous clip would otherwise
  // survive a pick/clear since the <audio> element's own src just changes
  // underneath it.
  useEffect(() => {
    setIsAudioPlaying(false);
    setSharedPlayheadSeconds(0);
  }, [audioObjectUrl]);

  const isAnyPlaying = isPlaying || isAudioPlaying;

  // One toggle drives both the scripted scene playback and the reference
  // audio together -- previously these were two separate buttons, which
  // made previewing both at once (the actual point of adding audio)
  // impossible to trigger with a single click.
  const togglePlayback = () => {
    if (isAnyPlaying) {
      pause();
      audioRef.current?.pause();
    } else {
      play();
      audioRef.current?.play();
    }
  };

  // Unified seek: snaps the video side to the start of whichever scene
  // contains `targetSeconds` (mid-scene seeking isn't supported by scene
  // playback -- jumpToScene only ever snaps to a scene's start), then moves
  // audio to that same snapped instant so both land together, per the
  // approved design (floor to scene start, never skip ahead of the drop
  // point).
  const seekToTime = (targetSeconds: number) => {
    const clamped = Math.max(0, targetSeconds);
    if (scenes.length > 0) {
      const index = sceneIndexAtTime(scenes, clamped);
      jumpToScene(index);
      const sceneStart = cumulativeSceneStart(scenes, index);
      setSharedPlayheadSeconds(sceneStart);
      if (audioRef.current && audioDurationSeconds) {
        audioRef.current.currentTime = Math.min(sceneStart, audioDurationSeconds);
      }
    } else if (audioRef.current && audioDurationSeconds) {
      const audioTarget = Math.min(clamped, audioDurationSeconds);
      audioRef.current.currentTime = audioTarget;
      setSharedPlayheadSeconds(audioTarget);
    }
  };

  const seekToSceneIndex = (index: number) => seekToTime(cumulativeSceneStart(scenes, index));

  // Drag-to-scrub the shared playhead itself, not just click-to-seek on a
  // block/waveform -- measured against .timeline-tracks (both rows'
  // common ancestor) rather than whichever row the pointer happens to be
  // over, so dragging tracks smoothly regardless of which row's height the
  // cursor is at.
  //
  // While dragging, the line follows the raw cursor position in real time
  // (no snapping) -- calling seekToTime on every move would re-jump the
  // scene/audio on every pixel, which pins the displayed position at the
  // current scene's start for the whole time the pointer is inside it
  // (only moving when a boundary is crossed), the opposite of sliding.
  // The actual scene jump + audio sync (seekToTime's snap-to-scene-start)
  // only happens once, on release.
  const tracksRef = useRef<HTMLDivElement>(null);
  const draggingPlayheadRef = useRef(false);
  const rawDragSecondsRef = useRef(0);

  const clientXToSeconds = (clientX: number) => {
    const rect = tracksRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left - TRACK_LEFT_INSET) / PIXELS_PER_SECOND);
  };

  const startPlayheadDrag = (e: React.PointerEvent) => {
    // user-select: none on the ancestor rows (Timeline.css) isn't always
    // enough on its own to stop a fast drag from starting a native text
    // selection before it takes effect -- belt-and-braces.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingPlayheadRef.current = true;
    rawDragSecondsRef.current = clientXToSeconds(e.clientX);
    setSharedPlayheadSeconds(rawDragSecondsRef.current);
  };

  const onPlayheadDragMove = (e: React.PointerEvent) => {
    if (!draggingPlayheadRef.current) return;
    rawDragSecondsRef.current = clientXToSeconds(e.clientX);
    setSharedPlayheadSeconds(rawDragSecondsRef.current);
  };

  const endPlayheadDrag = (e: React.PointerEvent) => {
    if (!draggingPlayheadRef.current) return;
    draggingPlayheadRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    seekToTime(rawDragSecondsRef.current);
  };

  // Drives the shared playhead while either side is actually playing --
  // reads fresh scene-store state via getState() each frame (not the
  // hook's subscribed value) since currentSceneIndex/currentSceneStartedAt
  // can change mid-loop without isPlaying itself flipping.
  useEffect(() => {
    if (!isAnyPlaying) return;
    let rafId: number;
    const tick = () => {
      const sceneState = useSceneStore.getState();
      if (sceneState.isPlaying && sceneState.currentSceneIndex !== null) {
        const scene = sceneState.scenes[sceneState.currentSceneIndex];
        const elapsed = sceneState.currentSceneStartedAt
          ? (Date.now() - sceneState.currentSceneStartedAt) / 1000
          : 0;
        const clampedElapsed = scene ? Math.min(elapsed, scene.duration) : 0;
        setSharedPlayheadSeconds(
          cumulativeSceneStart(sceneState.scenes, sceneState.currentSceneIndex) + clampedElapsed,
        );
      } else if (audioRef.current && !audioRef.current.paused) {
        setSharedPlayheadSeconds(audioRef.current.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isAnyPlaying]);

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
      {/* Play, the world-view toggle, and Export all share one row now --
          previously three separate stacked rows. */}
      <div className="timeline-controls-row">
        {/* Only affects a fresh Play (scene 0, not a resume) -- when off,
            that first scene snaps straight to its target instead of
            gliding from world view; either way the start no longer
            depends on wherever the camera was last left. Animated
            switch, not a native checkbox -- the input itself stays for
            click/keyboard handling and state, visually replaced by the
            track+thumb spans next to it. */}
        <label className="timeline-world-view-toggle">
          <input
            type="checkbox"
            className="timeline-toggle-input"
            checked={startFromWorldView}
            onChange={(e) => setStartFromWorldView(e.target.checked)}
          />
          <span className="timeline-toggle-track">
            <span className="timeline-toggle-thumb" />
          </span>
          Start from world view
        </label>
        {/* One toggle drives both scene playback and the reference audio
            together (togglePlayback above) -- previously these were two
            separate buttons (video Play/Pause + a standalone Audio button),
            which made it impossible to preview both at once with one click.
            Icon-only, same as Export below -- aria-label carries the name
            for accessibility since there's no visible text. */}
        <button
          type="button"
          className="timeline-icon-btn"
          onClick={togglePlayback}
          disabled={scenes.length === 0 && !audioObjectUrl}
          aria-label={isAnyPlaying ? "Pause" : "Play"}
          title={isAnyPlaying ? "Pause" : "Play"}
        >
          {isAnyPlaying ? (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M4 2.3v11.4a0.6 0.6 0 0 0 0.92 0.51l9-5.7a0.6 0.6 0 0 0 0-1.02l-9-5.7A0.6 0.6 0 0 0 4 2.3z" />
            </svg>
          )}
        </button>
        {/* Deliberately calls startExport directly, never sceneStore.play()
            -- export renders from the scene data independently of the live
            canvas, which must never start playing just because Export was
            clicked (see the video-export plan). */}
        <button
          type="button"
          className="timeline-icon-btn"
          onClick={() => startExport(scenes, startFromWorldView)}
          disabled={scenes.length === 0 || isExporting}
          aria-label="Export"
          title="Export"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 1.5v8" />
            <path d="M4.8 6.8 8 9.5l3.2-2.7" />
            <path d="M2.5 11v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
          </svg>
        </button>
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
      <div className="timeline-tracks" ref={tracksRef}>
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
                onClick={() => seekToSceneIndex(index)}
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
              onClick={(e) => {
                const barLeft = e.currentTarget.getBoundingClientRect().left;
                seekToTime((e.clientX - barLeft) / PIXELS_PER_SECOND);
              }}
              title={audioFileName ?? undefined}
            >
              {audioPeaks && (
                <AudioWaveform
                  peaks={audioPeaks}
                  width={(audioDurationSeconds ?? 0) * PIXELS_PER_SECOND}
                  height={AUDIO_TRACK_HEIGHT}
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
              onEnded={() => setIsAudioPlaying(false)}
            />
          </div>
        )}
        {audioError && <span className="timeline-audio-error">{audioError}</span>}
      </div>
      {/* One playhead shared across both rows above -- see seekToTime/the
          rAF loop -- instead of a separate line drawn inside the waveform
          canvas (AudioWaveform.tsx no longer draws one) and an implicit
          whole-block highlight for video. Draggable left/right via
          startPlayheadDrag/onPlayheadDragMove -- re-snaps to the scene it's
          currently over on every move, so scrubbing shows exactly where a
          drop would land instead of only snapping once released. Only
          rendered once there's something to show a position on. */}
      {(scenes.length > 0 || audioObjectUrl) && (
        <div
          className="timeline-shared-playhead"
          style={{ left: TRACK_LEFT_INSET + sharedPlayheadSeconds * PIXELS_PER_SECOND }}
          onPointerDown={startPlayheadDrag}
          onPointerMove={onPlayheadDragMove}
          onPointerUp={endPlayheadDrag}
        >
          <div className="timeline-shared-playhead-pin" />
          <div className="timeline-shared-playhead-line" />
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
