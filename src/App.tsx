import "./App.css";
import { MapStage } from "./map/MapStage";
import { InstructionBuilder } from "./map/InstructionBuilder";
import { Timeline } from "./map/Timeline";

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
function App() {
  return (
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
  );
}

export default App;
