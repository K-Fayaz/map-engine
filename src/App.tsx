import "./App.css";
import { MapCanvas } from "./map/MapCanvas";
import { SearchBox } from "./map/SearchBox";
import { InstructionBuilder } from "./map/InstructionBuilder";
import { Timeline } from "./map/Timeline";

// Phase 6 editor shell (roadmap.md section 1): Map on top, Timeline and
// Instruction Builder split across the bottom. MapCanvas already resizes to
// whatever container it's given (`resizeTo: container` in MapCanvas.tsx),
// so shrinking its area here needs no changes there.
function App() {
  return (
    <div className="editor-layout">
      <div className="editor-map">
        <MapCanvas />
        <SearchBox />
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
