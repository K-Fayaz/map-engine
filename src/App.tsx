import "./App.css";
import { MapCanvas } from "./map/MapCanvas";
import { SearchBox } from "./map/SearchBox";

function App() {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapCanvas />
      <SearchBox />
    </div>
  );
}

export default App;
