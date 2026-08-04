/// <reference types="vite/client" />

interface ImportMetaEnv {
  // "true" to show map labels (country/state names) -- default off, see
  // MapCanvas.tsx's SHOW_LABELS. Set in .env.local while working on labels.
  readonly VITE_SHOW_LABELS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
