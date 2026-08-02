import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import { loadWorldData, type Geometry, type Position } from "./loadWorldData";

const OCEAN_COLOR = 0x068494;
const LAND_COLOR = 0xf5f5f2;
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

// A handful of Natural Earth rings (Russia's Chukotka peninsula, Fiji,
// Antarctica's polar closure edge) have consecutive points that jump from
// ~+180 to ~-180 longitude. Some of these are real coastline crossing the
// dateline; others are synthetic edges Natural Earth inserts to seal a
// polygon shut exactly along the map boundary (Antarctica's flat southern
// cap, for instance) and aren't reliably distinguishable from real crossings
// by their coordinates alone. Rather than bridging across the jump (which
// either draws a stray line across the whole map, or -- if "corrected" --
// can warp the shape into something spanning the whole map instead), this
// simply splits the ring into separate pieces at the jump, each closed on
// its own. The affected pieces close slightly differently than the true
// coastline right at the seam, but this avoids wrap-around glitches
// entirely and only touches this small set of dateline-straddling features.
function splitAtAntimeridian(ring: Position[]): Position[][] {
  const pieces: Position[][] = [[]];
  let prevLon: number | null = null;

  for (const point of ring) {
    if (prevLon !== null && Math.abs(point[0] - prevLon) > 180) {
      pieces.push([]);
    }
    pieces[pieces.length - 1].push(point);
    prevLon = point[0];
  }

  // GeoJSON rings are closed loops: the array's start/end is just wherever
  // the data happened to begin tracing, not a real geographic break. If the
  // split above produced more than one piece, the first and last pieces are
  // actually one continuous piece that got cut apart by that arbitrary
  // array boundary (this is what caused Russia's mainland to render as a
  // stray diagonal -- its first and last pieces both dangled from the same
  // interior point instead of closing locally). Stitching them back together
  // leaves only the genuine antimeridian crossings as piece boundaries.
  if (pieces.length > 1) {
    const first = pieces.shift()!;
    const last = pieces.pop()!;
    pieces.push([...last, ...first]);
  }

  return pieces.filter((piece) => piece.length >= 3);
}

function projectPoints(points: Position[], width: number, height: number): number[] {
  return points.flatMap(([lon, lat]) => project(lon, lat, width, height));
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
      for (const piece of splitAtAntimeridian(ring)) {
        const points = projectPoints(piece, width, height);
        graphics.poly(points, true);
        if (ringIndex === 0) {
          graphics.fill(fillColor);
        } else {
          graphics.cut();
        }
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
      for (const piece of splitAtAntimeridian(ring)) {
        const points = projectPoints(piece, width, height);
        graphics.poly(points, true).stroke({ width: 1, color: BORDER_COLOR });
      }
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
