import "./App.css";
import { MapCanvas } from "./map/MapCanvas";
import { SearchBox } from "./map/SearchBox";

const placeholderStyle: React.CSSProperties = {
  fontFamily: "sans-serif",
  fontSize: 13,
  color: "#9a9ea6",
  padding: 12,
};

// Phase 6 editor shell (roadmap.md section 1): Map on top, Timeline and
// Instruction Builder split across the bottom. Timeline/Instruction Builder
// are placeholders for now -- their real content lands in later 6.1 steps
// (entity picker, animation/duration fields, scene list). MapCanvas already
// resizes to whatever container it's given (`resizeTo: container` in
// MapCanvas.tsx), so shrinking its area here needs no changes there.
function App() {
  return (
    <div className="editor-layout">
      <div className="editor-map">
        <MapCanvas />
        <SearchBox />
      </div>
      <div className="editor-timeline" style={placeholderStyle}>
        Timeline
      </div>
      <div className="editor-instruction-builder">
        <div className="zone zone-animation" style={placeholderStyle}>
          Animation / parameters
        </div>
        <div className="zone zone-input" style={placeholderStyle}>
          Entity / duration input
        </div>
      </div>
    </div>
  );
}

export default App;
