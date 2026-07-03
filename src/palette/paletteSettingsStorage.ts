import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import type { DocumentPalette } from "../types/geometry";
import { defaultDocumentPalette, normalizeDocumentPalette } from "./palette";

const STORAGE_KEY = "nuinuiCAD.paletteTemplate.v1";

export type PaletteTemplateSettings = {
  version: 1;
  palette: DocumentPalette;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const defaultPaletteTemplateSettings = (): PaletteTemplateSettings => ({
  version: 1,
  palette: defaultDocumentPalette()
});

export const normalizePaletteTemplateSettings = (value: unknown): PaletteTemplateSettings => {
  if (!isObject(value)) return defaultPaletteTemplateSettings();
  return {
    version: 1,
    palette: normalizeDocumentPalette(value.palette)
  };
};

const loadPaletteTemplateFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultPaletteTemplateSettings();
  try {
    return normalizePaletteTemplateSettings(JSON.parse(raw));
  } catch {
    return defaultPaletteTemplateSettings();
  }
};

const savePaletteTemplateToLocalStorage = (settings: PaletteTemplateSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadPaletteTemplateSettings = async (): Promise<PaletteTemplateSettings> => {
  if (!isTauriRuntime()) return loadPaletteTemplateFromLocalStorage();
  const settings = await invoke<unknown>("load_palette_template");
  return normalizePaletteTemplateSettings(settings);
};

export const savePaletteTemplateSettings = async (palette: DocumentPalette) => {
  const normalized = normalizePaletteTemplateSettings({ version: 1, palette });
  if (!isTauriRuntime()) {
    savePaletteTemplateToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_palette_template", { input: normalized });
};
