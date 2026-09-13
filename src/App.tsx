import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { MapStage } from "./map/MapStage";
import { InstructionBuilder } from "./map/InstructionBuilder";
import { Timeline } from "./map/Timeline";
import { HomeScreen } from "./map/HomeScreen";
import { TopBar } from "./map/TopBar";
import { confirmLeaveWithUnsavedChanges, useProjectStore } from "./map/projectStore";

// Phase 6 editor shell (roadmap.md section 1): Map on top, Timeline and
// Instruction Builder split across the bottom. MapStage (map/MapStage.tsx)
// contain-fits MapCanvas to the selected export aspect ratio within this
// area; MapCanvas itself already resizes to whatever container it's given
// (`resizeTo: container` in MapCanvas.tsx), so it needs no changes here.
//
// SearchBox.tsx (the floating in-map search overlay) was removed here --
// the Instruction Builder's entity picker is now the only path used to
// build a story (per docs/phase_6_arch.md's "keep the map clean"), so the
// map-embedded search was redundant. Direct map click/hover (Phase 4)
// stays fully independent, unaffected by this.
//
// Phase 2 (roadmap.md): the app now boots to a Home screen (project list/
// creation) instead of straight into this editor -- no router library, just
// a plain switch on whether a project is open (projectStore.ts). There's no
// auto-resume of the last-open project; Home always shows first, and the
// user picks or creates one each launch.
function App() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  // Guards the OS window-close button the same way TopBar.tsx guards the
  // "back to Projects" button -- onCloseRequested's handler can be async,
  // and Tauri holds the close open until it resolves, so awaiting the
  // confirm/save here before deciding whether to preventDefault() is the
  // documented pattern, not a race. Once a JS-side onCloseRequested
  // listener is registered, Tauri routes the actual close through a JS
  // destroy() call even when preventDefault() is never invoked -- that
  // needs its own explicit "core:window:allow-destroy" capability grant
  // (src-tauri/capabilities/default.json), not covered by core:default.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    // React 18 StrictMode (dev only) mounts, cleans up, and mounts this
    // effect again -- the cleanup below runs before onCloseRequested's
    // promise has resolved, so `unlisten` is still undefined at that point
    // and doesn't actually remove the first listener. Without this guard,
    // the second mount registers a second listener alongside the still-live
    // first one, firing the confirm dialog twice on a real close. `cleaned`
    // lets the late-resolving first registration unregister itself instead.
    let cleaned = false;
    win.onCloseRequested(async (event) => {
      const canProceed = await confirmLeaveWithUnsavedChanges();
      if (!canProceed) event.preventDefault();
    }).then((fn) => {
      if (cleaned) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cleaned = true;
      unlisten?.();
    };
  }, []);

  if (activeProjectId === null) {
    return <HomeScreen />;
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="editor-layout">
        <div className="editor-map">
          <MapStage />
        </div>
        <div className="editor-timeline">
          <Timeline />
        </div>
        <div className="editor-instruction-builder">
          <InstructionBuilder />
        </div>
      </div>
    </div>
  );
}

export default App;
