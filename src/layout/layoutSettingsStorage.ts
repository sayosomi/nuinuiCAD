import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import {
  DEFAULT_DSL_PANEL_HEIGHT,
  DEFAULT_DSL_PANEL_WIDTH,
  DEFAULT_DSL_PANEL_WINDOW,
  DEFAULT_PRINT_PREVIEW_WINDOW,
  MIN_DSL_PANEL_HEIGHT,
  MIN_DSL_PANEL_WIDTH,
  MIN_PRINT_PREVIEW_HEIGHT,
  MIN_PRINT_PREVIEW_WIDTH,
  clampPrintPreviewZoom
} from "../state/cadUiStore";
import type { DslPanelWindow, PrintPreviewWindow } from "../state/cadUiStore";

export const DEFAULT_LEFT_PANEL_WIDTH = 420;
export const MIN_LEFT_PANEL_WIDTH = 360;
export const MAX_LEFT_PANEL_WIDTH = 720;

const STORAGE_KEY = "nuinuiCAD.layoutSettings.v1";
export const PRINT_PANEL_SECTION_IDS = ["output", "variables", "groups", "placements"] as const;

export type PrintPanelSectionId = (typeof PRINT_PANEL_SECTION_IDS)[number];

export type LayoutSettings = {
  version: 1;
  leftPanelWidth: number;
  collapsedPrintPanelSections: PrintPanelSectionId[];
  printPreviewWindow: PrintPreviewWindow;
  dslPanelWindow: DslPanelWindow | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const clampLeftPanelWidth = (width: number) =>
  Math.min(Math.max(Math.round(width), MIN_LEFT_PANEL_WIDTH), MAX_LEFT_PANEL_WIDTH);

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizePrintPreviewWindowSettings = (value: unknown): PrintPreviewWindow => {
  if (!isObject(value)) return DEFAULT_PRINT_PREVIEW_WINDOW;
  return {
    x: Math.round(finiteNumber(value.x, DEFAULT_PRINT_PREVIEW_WINDOW.x)),
    y: Math.round(finiteNumber(value.y, DEFAULT_PRINT_PREVIEW_WINDOW.y)),
    width: Math.max(
      Math.round(finiteNumber(value.width, DEFAULT_PRINT_PREVIEW_WINDOW.width)),
      MIN_PRINT_PREVIEW_WIDTH
    ),
    height: Math.max(
      Math.round(finiteNumber(value.height, DEFAULT_PRINT_PREVIEW_WINDOW.height)),
      MIN_PRINT_PREVIEW_HEIGHT
    ),
    zoom: clampPrintPreviewZoom(finiteNumber(value.zoom, DEFAULT_PRINT_PREVIEW_WINDOW.zoom)),
    layoutId: typeof value.layoutId === "string" ? value.layoutId : null
  };
};

const normalizeDslPanelWindowSettings = (value: unknown): DslPanelWindow | null => {
  if (!isObject(value)) return DEFAULT_DSL_PANEL_WINDOW;
  return {
    x: Math.round(finiteNumber(value.x, 20)),
    y: Math.round(finiteNumber(value.y, 68)),
    width: Math.max(
      Math.round(finiteNumber(value.width, DEFAULT_DSL_PANEL_WIDTH)),
      MIN_DSL_PANEL_WIDTH
    ),
    height: Math.max(
      Math.round(finiteNumber(value.height, DEFAULT_DSL_PANEL_HEIGHT)),
      MIN_DSL_PANEL_HEIGHT
    )
  };
};

export const defaultLayoutSettings = (): LayoutSettings => ({
  version: 1,
  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
  collapsedPrintPanelSections: ["variables"],
  printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
  dslPanelWindow: DEFAULT_DSL_PANEL_WINDOW
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
    collapsedPrintPanelSections,
    printPreviewWindow: normalizePrintPreviewWindowSettings(value.printPreviewWindow),
    dslPanelWindow: normalizeDslPanelWindowSettings(value.dslPanelWindow)
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
