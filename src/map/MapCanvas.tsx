import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import { loadWorldData, type Geometry } from "./loadWorldData";

const OCEAN_COLOR = 0x0a3d62;
const LAND_COLOR = 0xdcd6c0;
const BORDER_COLOR = 0x4a4a4a;

function project(
  lon: number,
  lat: number,
  width: number,
  height: number,
): [number, number] {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

function toPolygons(geometry: Geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function fillGeometry(
  graphics: Graphics,
  geometry: Geometry,
  width: number,
  height: number,
  fillColor: number,
) {
  for (const rings of toPolygons(geometry)) {
    rings.forEach((ring, ringIndex) => {
      const points = ring.flatMap(([lon, lat]) => project(lon, lat, width, height));
      graphics.poly(points, true);
      if (ringIndex === 0) {
        graphics.fill(fillColor);
      } else {
        graphics.cut();
      }
    });
  }
}

// Strokes each ring independently (fill/stroke/cut share underlying path
// state in Pixi's Graphics API, so borders are drawn as a separate pass
// rather than chained onto the fill instructions above).
function strokeGeometry(
  graphics: Graphics,
  geometry: Geometry,
  width: number,
  height: number,
) {
  for (const rings of toPolygons(geometry)) {
    for (const ring of rings) {
      const points = ring.flatMap(([lon, lat]) => project(lon, lat, width, height));
      graphics.poly(points, true).stroke({ width: 1, color: BORDER_COLOR });
    }
  }
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const app = new Application();

    app
      .init({
        resizeTo: container,
        backgroundColor: OCEAN_COLOR,
        antialias: true,
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }

        container.appendChild(app.canvas);

        const world = loadWorldData();

        const draw = () => {
          app.stage.removeChildren();
          const { width, height } = app.screen;

          const land = new Graphics();
          for (const f of world.land.features) {
            fillGeometry(land, f.geometry, width, height, LAND_COLOR);
          }
          app.stage.addChild(land);

          const countries = new Graphics();
          for (const f of world.countries.features) {
            fillGeometry(countries, f.geometry, width, height, LAND_COLOR);
            strokeGeometry(countries, f.geometry, width, height);
          }
          app.stage.addChild(countries);
        };

        draw();
        app.renderer.on("resize", draw);
      });

    return () => {
      cancelled = true;
      if (app.renderer) {
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
  );
}
