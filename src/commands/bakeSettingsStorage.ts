import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import type { CommandContext } from "./commandTypes";

const STORAGE_KEY = "nuinuiCAD.bakeSettings.v1";

export type BakeSettings = {
  version: 1;
  "nuinuiCAD.bake.emitSkippedComments": boolean;
  "nuinuiCAD.bake.includeHiddenGeometry": boolean;
  "nuinuiCAD.bake.includeDisabledGeometry": boolean;
};

export const defaultBakeSettings = (): BakeSettings => ({
  version: 1,
  "nuinuiCAD.bake.emitSkippedComments": true,
  "nuinuiCAD.bake.includeHiddenGeometry": false,
  "nuinuiCAD.bake.includeDisabledGeometry": false
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const booleanOr = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export const normalizeBakeSettings = (value: unknown): BakeSettings => {
  const defaults = defaultBakeSettings();
  if (!isObject(value)) return defaults;
  return {
    version: 1,
    "nuinuiCAD.bake.emitSkippedComments": booleanOr(
      value["nuinuiCAD.bake.emitSkippedComments"],
      defaults["nuinuiCAD.bake.emitSkippedComments"]
    ),
    "nuinuiCAD.bake.includeHiddenGeometry": booleanOr(
      value["nuinuiCAD.bake.includeHiddenGeometry"],
      defaults["nuinuiCAD.bake.includeHiddenGeometry"]
    ),
    "nuinuiCAD.bake.includeDisabledGeometry": booleanOr(
      value["nuinuiCAD.bake.includeDisabledGeometry"],
      defaults["nuinuiCAD.bake.includeDisabledGeometry"]
    )
  };
};

export const bakeCommandOptionsFromSettings = (
  settings: BakeSettings
): Pick<CommandContext, "emitSkippedComments" | "includeHiddenGeometry" | "includeDisabledGeometry"> => ({
  emitSkippedComments: settings["nuinuiCAD.bake.emitSkippedComments"],
  includeHiddenGeometry: settings["nuinuiCAD.bake.includeHiddenGeometry"],
  includeDisabledGeometry: settings["nuinuiCAD.bake.includeDisabledGeometry"]
});

const loadFromLocalStorage = (): BakeSettings => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultBakeSettings();
  try {
    return normalizeBakeSettings(JSON.parse(raw));
  } catch {
    return defaultBakeSettings();
  }
};

const saveToLocalStorage = (settings: BakeSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadBakeSettings = async (): Promise<BakeSettings> => {
  if (!isTauriRuntime()) return loadFromLocalStorage();
  return normalizeBakeSettings(await invoke<unknown>("load_bake_settings"));
};

export const saveBakeSettings = async (settings: BakeSettings) => {
  const normalized = normalizeBakeSettings(settings);
  if (!isTauriRuntime()) {
    saveToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_bake_settings", { input: normalized });
};
