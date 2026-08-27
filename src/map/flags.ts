import { Assets, type Texture } from "pixi.js";
import { numericToAlpha3, type Entity } from "./entities";
import alpha3ToAlpha2 from "./data/iso-alpha3-to-alpha2.json";

// A scene highlight's "image" fill mode (see scenes.ts's `fillMode`) --
// flags are vendored locally (public/flags/4x3/*.svg, from the flag-icons
// package) since this is an offline Tauri app with no `http` capability;
// nothing can be fetched at runtime. Keyed by ISO 3166-1 alpha-2 (how
// flag-icons names its files), while country Entity ids are ISO numeric --
// entities.ts's numericToAlpha3 plus this file's own alpha3->alpha2 table
// (same vendoring pattern as iso-alpha3-to-numeric.json) bridge the two.

const alpha3ToAlpha2Map = alpha3ToAlpha2 as Record<string, string>;

export function alpha2ForEntityId(numericId: string): string | undefined {
  const alpha3 = numericToAlpha3[numericId];
  return alpha3 ? alpha3ToAlpha2Map[alpha3] : undefined;
}

export function flagAssetUrl(alpha2: string): string {
  return `/flags/4x3/${alpha2}.svg`;
}

export interface FlagOption {
  alpha2: string;
  name: string;
}

// For the Instruction Builder's flag search grid -- every country entity
// with a resolvable flag, free choice independent of whichever entity is
// actually being highlighted (per the user's "no restriction" requirement).
export function listFlagOptions(entities: Entity[]): FlagOption[] {
  const options: FlagOption[] = [];
  for (const entity of entities) {
    if (entity.type !== "country") continue;
    const alpha2 = alpha2ForEntityId(entity.id);
    if (!alpha2) continue;
    options.push({ alpha2, name: entity.name });
  }
  return options;
}

// In-memory cache so repeated draws (live re-renders, export) after the
// first load are synchronous -- Assets.load itself is async and would
// otherwise re-resolve (though not re-fetch) on every call.
const textureCache = new Map<string, Texture>();
const pending = new Map<string, Promise<Texture>>();

// Synchronous "do we already have it" check -- worldRenderer.ts's
// drawHighlights uses this to decide whether to draw the texture now or
// fall back to the color fill while a first load is still in flight.
export function cachedFlagTexture(alpha2: string): Texture | undefined {
  return textureCache.get(alpha2);
}

export function loadFlagTexture(alpha2: string): Promise<Texture> {
  const cached = textureCache.get(alpha2);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(alpha2);
  if (inFlight) return inFlight;

  const promise = Assets.load<Texture>(flagAssetUrl(alpha2)).then((texture) => {
    textureCache.set(alpha2, texture);
    pending.delete(alpha2);
    return texture;
  });
  pending.set(alpha2, promise);
  return promise;
}
