export type CanvasGridSettings = {
  enabled: boolean;
  spacingMm: number;
  majorEvery: number;
};

export const DEFAULT_CANVAS_GRID_SETTINGS: CanvasGridSettings = {
  enabled: true,
  spacingMm: 10,
  majorEvery: 5
};

export const CANVAS_GRID_SETTING_KEYS = [
  "nuinuiCAD.canvas.grid.enabled",
  "nuinuiCAD.canvas.grid.spacingMm",
  "nuinuiCAD.canvas.grid.majorEvery"
] as const;

export const CANVAS_GRID_ENABLED_SETTING = CANVAS_GRID_SETTING_KEYS[0];
export const CANVAS_GRID_SPACING_SETTING = CANVAS_GRID_SETTING_KEYS[1];
export const CANVAS_GRID_MAJOR_EVERY_SETTING = CANVAS_GRID_SETTING_KEYS[2];

export const normalizeCanvasGridSettings = (value: unknown): CanvasGridSettings => {
  const candidate = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const spacingMm = candidate.spacingMm;
  const majorEvery = candidate.majorEvery;

  return {
    enabled: typeof candidate.enabled === "boolean"
      ? candidate.enabled
      : DEFAULT_CANVAS_GRID_SETTINGS.enabled,
    spacingMm: typeof spacingMm === "number" && Number.isFinite(spacingMm) && spacingMm > 0
      ? spacingMm
      : DEFAULT_CANVAS_GRID_SETTINGS.spacingMm,
    majorEvery: typeof majorEvery === "number" && Number.isInteger(majorEvery) && majorEvery >= 1
      ? majorEvery
      : DEFAULT_CANVAS_GRID_SETTINGS.majorEvery
  };
};
