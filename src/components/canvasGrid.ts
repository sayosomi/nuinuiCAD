export type CanvasGridSettings = {
  enabled: boolean;
  spacingMm: number;
  majorEvery: number;
  snapEnabled: boolean;
};

export const DEFAULT_CANVAS_GRID_SETTINGS: CanvasGridSettings = {
  enabled: true,
  spacingMm: 10,
  majorEvery: 5,
  snapEnabled: false
};

export const CANVAS_GRID_SETTING_KEYS = [
  "nuinuiCAD.canvas.grid.enabled",
  "nuinuiCAD.canvas.grid.spacingMm",
  "nuinuiCAD.canvas.grid.majorEvery",
  "nuinuiCAD.canvas.grid.snapEnabled"
] as const;

export const CANVAS_GRID_ENABLED_SETTING = CANVAS_GRID_SETTING_KEYS[0];
export const CANVAS_GRID_SPACING_SETTING = CANVAS_GRID_SETTING_KEYS[1];
export const CANVAS_GRID_MAJOR_EVERY_SETTING = CANVAS_GRID_SETTING_KEYS[2];
export const CANVAS_GRID_SNAP_ENABLED_SETTING = CANVAS_GRID_SETTING_KEYS[3];

export type CanvasGridPoint = { x: number; y: number };

/** Snap one world coordinate to the nearest grid multiple, with symmetric half-step ties. */
export const snapWorldCoordinateToGrid = (value: number, spacingMm: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(spacingMm) || spacingMm <= 0) return value;
  const snappedUnits = Math.floor(Math.abs(value) / spacingMm + 0.5);
  return snappedUnits === 0 ? 0 : Math.sign(value) * snappedUnits * spacingMm;
};

/** Snap a world point to the grid whose origin is the world origin. */
export const snapWorldPointToGrid = (
  point: CanvasGridPoint,
  spacingMm: number
): CanvasGridPoint => ({
  x: snapWorldCoordinateToGrid(point.x, spacingMm),
  y: snapWorldCoordinateToGrid(point.y, spacingMm)
});

export const normalizeCanvasGridSettings = (value: unknown): CanvasGridSettings => {
  const candidate = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const spacingMm = candidate.spacingMm;
  const majorEvery = candidate.majorEvery;
  const snapEnabled = candidate.snapEnabled;

  return {
    enabled: typeof candidate.enabled === "boolean"
      ? candidate.enabled
      : DEFAULT_CANVAS_GRID_SETTINGS.enabled,
    spacingMm: typeof spacingMm === "number" && Number.isFinite(spacingMm) && spacingMm > 0
      ? spacingMm
      : DEFAULT_CANVAS_GRID_SETTINGS.spacingMm,
    majorEvery: typeof majorEvery === "number" && Number.isInteger(majorEvery) && majorEvery >= 1
      ? majorEvery
      : DEFAULT_CANVAS_GRID_SETTINGS.majorEvery,
    snapEnabled: typeof snapEnabled === "boolean"
      ? snapEnabled
      : DEFAULT_CANVAS_GRID_SETTINGS.snapEnabled
  };
};
