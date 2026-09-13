import { Texture } from "pixi.js";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, remove, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { projectAssetsDir } from "./project";

// A scene highlight's "upload" image source (see scenes.ts's `imageSource`)
// -- the user's own arbitrary image, alongside the bundled flags
// (flags.ts). This app is fully offline (no `http` Tauri capability), so a
// picked file is copied into the active project's own `assets/images/`
// folder (see src-tauri/capabilities/default.json's fs:allow-appdata-*-
// recursive grants) rather than referenced by its original path -- that
// path could move or be deleted later, same reasoning audioStore.ts's
// reference audio track doesn't apply to it (ffmpeg reads that one
// directly as an OS process at export time; this one has to survive being
// read back into a texture on every future app launch). Scoped per-project
// (not a single global folder) so deleting a project cleanly removes its
// own images without touching any other project's.

function uploadDir(projectId: string): string {
  return `${projectAssetsDir(projectId)}/images`;
}

function uploadPath(projectId: string, id: string): string {
  return `${uploadDir(projectId)}/${id}`;
}

// blob: URLs carry no file extension, so Pixi's Assets.load (which picks a
// parser by sniffing the URL's extension) can never recognize one -- this
// is what produced the "could not be loaded as we don't know how to parse
// it" warning and, worse, left that load permanently stuck (see
// loadUploadedImageTexture below, which no longer goes through Assets at
// all). A correct MIME type on the Blob itself is still needed separately
// for the plain <img> thumbnail preview to render instead of showing
// blank -- browsers decode a blob: URL's image type from the Blob's own
// `type`, not by sniffing content the way a same-origin file with no
// content-type header sometimes gets sniffed.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

function mimeTypeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_MIME_TYPES[extension]) || "application/octet-stream";
}

// In-memory blob-URL cache, shared by the texture loader below and the
// Instruction Builder's plain <img> thumbnail preview (which needs a
// displayable URL, not a Pixi Texture). Populated eagerly on upload, and
// lazily (from the app-data copy) whenever something asks for an id that
// was never loaded this session -- e.g. re-opening a scene that references
// an upload from a previous session.
const objectUrlCache = new Map<string, string>();

export function cachedUploadedImagePreviewUrl(id: string): string | undefined {
  return objectUrlCache.get(id);
}

export async function loadUploadedImagePreviewUrl(projectId: string, id: string): Promise<string> {
  const cached = objectUrlCache.get(id);
  if (cached) return cached;
  const bytes = await readFile(uploadPath(projectId, id), { baseDir: BaseDirectory.AppData });
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeTypeForPath(id) }));
  objectUrlCache.set(id, objectUrl);
  return objectUrl;
}

// No file-type/size restriction (`open()` has no `filters`) -- the user's
// explicit call. Returns null if the user cancelled the picker.
export async function pickAndStoreUploadImage(
  projectId: string,
): Promise<{ id: string; previewUrl: string } | null> {
  const path = await open({ multiple: false });
  if (!path) return null;

  const bytes = await readFile(path);
  const extension = path.split(".").pop();
  const id = extension ? `${crypto.randomUUID()}.${extension}` : crypto.randomUUID();

  await mkdir(uploadDir(projectId), { recursive: true, baseDir: BaseDirectory.AppData });
  await writeFile(uploadPath(projectId, id), bytes, { baseDir: BaseDirectory.AppData });

  const previewUrl = URL.createObjectURL(new Blob([bytes], { type: mimeTypeForPath(path) }));
  objectUrlCache.set(id, previewUrl);
  return { id, previewUrl };
}

// Same cache-then-load shape as flags.ts's loadFlagTexture/
// cachedFlagTexture -- shared by the live renderer (worldRenderer.ts's
// drawHighlights) and export's preload step (exportPipeline.ts).
const textureCache = new Map<string, Texture>();
const pending = new Map<string, Promise<Texture>>();

export function cachedUploadedImageTexture(id: string): Texture | undefined {
  return textureCache.get(id);
}

// Decodes via a plain HTMLImageElement instead of Pixi's Assets.load --
// deliberately bypassing Pixi's URL-extension-based parser resolution
// entirely (see the EXTENSION_MIME_TYPES comment above for why that path
// can never work for a blob: URL). img.onload/onerror give a real,
// well-defined settle point Assets.load's blob handling didn't.
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image: ${url}`));
    img.src = url;
  });
}

export function loadUploadedImageTexture(projectId: string, id: string): Promise<Texture> {
  const cached = textureCache.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const promise = loadUploadedImagePreviewUrl(projectId, id)
    .then(loadImageElement)
    .then((image) => {
      const texture = Texture.from(image);
      textureCache.set(id, texture);
      return texture;
    })
    // `finally`, not just clearing on success -- a failed load must not
    // leave a permanently-stuck entry in `pending` (that's what caused the
    // hang: every future call for the same id kept returning the same
    // never-settling promise instead of ever retrying or falling back).
    .finally(() => {
      pending.delete(id);
    });
  pending.set(id, promise);
  return promise;
}

// Called from sceneStore.ts once no remaining scene references `id` --
// removes the app-data copy, and drops it from both in-memory caches.
export async function deleteUploadedImage(projectId: string, id: string): Promise<void> {
  await remove(uploadPath(projectId, id), { baseDir: BaseDirectory.AppData }).catch(() => {
    // Already gone (e.g. deleted in a previous session that crashed
    // mid-cleanup) -- not worth surfacing as an error to the user.
  });
  textureCache.delete(id);
  pending.delete(id);
  const objectUrl = objectUrlCache.get(id);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrlCache.delete(id);
  }
}
