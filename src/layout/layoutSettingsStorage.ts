import { isTauriRuntime } from "../geometry/evaluationEngine";

export const DEFAULT_LEFT_PANEL_WIDTH = 320;
export const MIN_LEFT_PANEL_WIDTH = 320;
export const MAX_LEFT_PANEL_WIDTH = 640;

const STORAGE_KEY = "nuinuiCAD.layoutSettings.v1";

export type LayoutSettings = {
  version: 1;
  leftPanelWidth: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const clampLeftPanelWidth = (width: number) =>
  Math.min(Math.max(Math.round(width), MIN_LEFT_PANEL_WIDTH), MAX_LEFT_PANEL_WIDTH);

export const defaultLayoutSettings = (): LayoutSettings => ({
  version: 1,
  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH
});

export const normalizeLayoutSettings = (value: unknown): LayoutSettings => {
  if (!isObject(value) || typeof value.leftPanelWidth !== "number" || !Number.isFinite(value.leftPanelWidth)) {
    return defaultLayoutSettings();
  }
  return {
    version: 1,
    leftPanelWidth: clampLeftPanelWidth(value.leftPanelWidth)
  };
};

const loadLayoutSettingsFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultLayoutSettings();
  try {
    return normalizeLayoutSettings(JSON.parse(raw));
  } catch {
    return defaultLayoutSettings();
  }
};

const saveLayoutSettingsToLocalStorage = (settings: LayoutSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadLayoutSettings = async (): Promise<LayoutSettings> => {
  if (!isTauriRuntime()) return loadLayoutSettingsFromLocalStorage();
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = await invoke<unknown>("load_layout_settings");
  return normalizeLayoutSettings(settings);
};

export const saveLayoutSettings = async (settings: LayoutSettings) => {
  const normalized = normalizeLayoutSettings(settings);
  if (!isTauriRuntime()) {
    saveLayoutSettingsToLocalStorage(normalized);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("save_layout_settings", { input: normalized });
};
