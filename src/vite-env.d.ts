/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
}

interface ImportMetaEnv {
  readonly VITE_BENCHMARK_CAPTURE_CONFIG?: string;
}
