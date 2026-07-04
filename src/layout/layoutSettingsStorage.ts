import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";

export const DEFAULT_LEFT_PANEL_WIDTH = 320;
export const MIN_LEFT_PANEL_WIDTH = 320;
export const MAX_LEFT_PANEL_WIDTH = 640;

const STORAGE_KEY = "nuinuiCAD.layoutSettings.v1";
export const PRINT_PANEL_SECTION_IDS = ["output", "variables", "groups", "placements"] as const;

export type PrintPanelSectionId = (typeof PRINT_PANEL_SECTION_IDS)[number];

export type LayoutSettings = {
  version: 1;
  leftPanelWidth: number;
  collapsedPrintPanelSections: PrintPanelSectionId[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const clampLeftPanelWidth = (width: number) =>
  Math.min(Math.max(Math.round(width), MIN_LEFT_PANEL_WIDTH), MAX_LEFT_PANEL_WIDTH);

export const defaultLayoutSettings = (): LayoutSettings => ({
  version: 1,
  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
  collapsedPrintPanelSections: ["variables"]
});

export const normalizeLayoutSettings = (value: unknown): LayoutSettings => {
  if (!isObject(value) || typeof value.leftPanelWidth !== "number" || !Number.isFinite(value.leftPanelWidth)) {
    return defaultLayoutSettings();
  }
  const sectionIds = new Set(PRINT_PANEL_SECTION_IDS);
  const collapsedPrintPanelSections = Array.isArray(value.collapsedPrintPanelSections)
    ? value.collapsedPrintPanelSections.filter(
        (section): section is PrintPanelSectionId =>
          typeof section === "string" && sectionIds.has(section as PrintPanelSectionId)
      )
    : defaultLayoutSettings().collapsedPrintPanelSections;
  return {
    version: 1,
    leftPanelWidth: clampLeftPanelWidth(value.leftPanelWidth),
    collapsedPrintPanelSections
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
  const settings = await invoke<unknown>("load_layout_settings");
  return normalizeLayoutSettings(settings);
};

export const saveLayoutSettings = async (settings: LayoutSettings) => {
  const normalized = normalizeLayoutSettings(settings);
  if (!isTauriRuntime()) {
    saveLayoutSettingsToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_layout_settings", { input: normalized });
};
