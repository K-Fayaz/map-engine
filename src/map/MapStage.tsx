import { useLayoutEffect, useRef, useState } from "react";
import { MapCanvas } from "./MapCanvas";
import { EXPORT_PROFILES, useExportStore } from "./exportStore";

// Sizes MapCanvas's container to the selected export aspect ratio,
// contain-fit within whatever space .editor-map actually has (matching the
// same min(scaleX, scaleY) approach worldRenderer.ts's applyViewFit already
// uses to fit the world into the canvas) -- so what's shown while authoring
// is the same crop export will render, not an always-full-bleed live canvas
// decoupled from the chosen ratio. MapCanvas itself needs no changes: it
// already resizes to whatever container it's given via Pixi's `resizeTo`.
export function MapStage() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const selectedProfile = useExportStore((state) => state.selectedProfile);
  const profile = EXPORT_PROFILES[selectedProfile];

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAvailable({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale =
    available.width > 0 && available.height > 0
      ? Math.min(available.width / profile.width, available.height / profile.height)
      : 0;
  // Before the first ResizeObserver measurement lands, fall back to filling
  // the wrapper outright rather than a 0x0 flash.
  const stageWidth = scale > 0 ? profile.width * scale : available.width;
  const stageHeight = scale > 0 ? profile.height * scale : available.height;

  return (
    <div ref={wrapperRef} className="map-stage-wrapper">
      <div className="map-stage" style={{ width: stageWidth, height: stageHeight }}>
        <MapCanvas />
      </div>
    </div>
  );
}
