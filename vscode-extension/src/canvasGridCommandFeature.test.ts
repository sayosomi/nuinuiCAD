import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn()
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: mocks.registerCommand,
    executeCommand: mocks.executeCommand
  },
  Disposable: {
    from: (...disposables: Array<{ dispose: () => void }>) => ({
      dispose: () => disposables.forEach(({ dispose }) => dispose())
    })
  }
}));

vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.showQuickPick,
  nativeShowInputBox: mocks.showInputBox
}));

import {
  CANVAS_GRID_ENABLED_SETTING,
  CANVAS_GRID_MAJOR_EVERY_SETTING,
  CANVAS_GRID_SNAP_ENABLED_SETTING,
  CANVAS_GRID_SPACING_SETTING,
  type CanvasGridSettings
} from "../../src/components/canvasGrid";
import {
  registerCanvasGridCommandFeature,
  type CanvasGridCommandFeatureDependencies,
  type CanvasGridCommandTextKey,
  type CanvasGridSettingKey
} from "./canvasGridCommandFeature";
import { canvasPresentationTextFor } from "./canvasPresentationLocalization";

const englishText: Record<CanvasGridCommandTextKey, string> = {
  "canvas.grid.configure.title": "Configure Canvas Grid",
  "canvas.grid.configure.placeholder": "Select a Canvas grid setting to edit",
  "canvas.grid.configure.gridOn": "Grid: On",
  "canvas.grid.configure.gridOff": "Grid: Off",
  "canvas.grid.configure.spacing": "Spacing: {spacing} mm",
  "canvas.grid.configure.majorEvery": "Major interval: ×{majorEvery}",
  "canvas.grid.configure.gridSnapOn": "Grid Snap: On",
  "canvas.grid.configure.gridSnapOff": "Grid Snap: Off",
  "canvas.grid.configure.spacingTitle": "Canvas Grid Spacing",
  "canvas.grid.configure.spacingPrompt": "Enter a finite spacing value in millimetres greater than 0.",
  "canvas.grid.configure.spacingInvalid": "Enter a finite number greater than 0.",
  "canvas.grid.configure.majorEveryTitle": "Canvas Grid Major Interval",
  "canvas.grid.configure.majorEveryPrompt": "Enter an integer of at least 1.",
  "canvas.grid.configure.majorEveryInvalid": "Enter an integer of at least 1."
};

const interpolate = (
  template: string,
  parameters?: Record<string, string | number>
): string => template.replace(/\{([^}]+)\}/g, (_match, key: string) => String(parameters?.[key] ?? ""));

const createFeature = (
  activeCanvas = true,
  initialSettings: CanvasGridSettings = {
    enabled: true,
    spacingMm: 10,
    majorEvery: 5,
    snapEnabled: false
  }
) => {
  let settings = initialSettings;
  const updates: Array<{ key: CanvasGridSettingKey; value: boolean | number }> = [];
  const handlers = new Map<string, () => unknown>();
  const dependencies: CanvasGridCommandFeatureDependencies = {
    hasActiveCanvas: () => activeCanvas,
    getSettings: () => settings,
    updateSetting: vi.fn(async (key, value) => {
      updates.push({ key, value });
      if (key === CANVAS_GRID_ENABLED_SETTING) settings = { ...settings, enabled: value as boolean };
      if (key === CANVAS_GRID_SPACING_SETTING) settings = { ...settings, spacingMm: value as number };
      if (key === CANVAS_GRID_MAJOR_EVERY_SETTING) settings = { ...settings, majorEvery: value as number };
      if (key === CANVAS_GRID_SNAP_ENABLED_SETTING) settings = { ...settings, snapEnabled: value as boolean };
    }),
    text: (key, parameters) => interpolate(englishText[key], parameters)
  };
  mocks.registerCommand.mockImplementation((command: string, handler: () => unknown) => {
    handlers.set(command, handler);
    return { dispose: vi.fn() };
  });
  const disposable = registerCanvasGridCommandFeature(dependencies);
  return { dependencies, disposable, handlers, updates };
};

describe("Canvas Grid native commands", () => {
  beforeEach(() => {
    mocks.registerCommand.mockReset();
    mocks.executeCommand.mockReset();
    mocks.showQuickPick.mockReset();
    mocks.showInputBox.mockReset();
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.showQuickPick.mockResolvedValue(undefined);
    mocks.showInputBox.mockResolvedValue(undefined);
  });

  it("registers the two canonical Canvas commands and gates Toggle Grid on an active Canvas", async () => {
    const feature = createFeature(false);

    expect(mocks.registerCommand.mock.calls.map(([command]) => command)).toEqual([
      "nuinuiCAD.toggleCanvasGrid",
      "nuinuiCAD.configureCanvasGrid"
    ]);
    await feature.handlers.get("nuinuiCAD.toggleCanvasGrid")?.();
    await feature.handlers.get("nuinuiCAD.configureCanvasGrid")?.();

    expect(feature.updates).toEqual([]);
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    feature.disposable.dispose();
  });

  it.each([
    [true, false],
    [false, true]
  ])("toggles effective Grid enabled=%s to %s through the existing update authority", async (enabled, expected) => {
    const feature = createFeature(true, {
      enabled,
      spacingMm: 10,
      majorEvery: 5,
      snapEnabled: false
    });

    await feature.handlers.get("nuinuiCAD.toggleCanvasGrid")?.();

    expect(feature.updates).toEqual([{ key: CANVAS_GRID_ENABLED_SETTING, value: expected }]);
  });

  it("projects fresh effective values and delegates Grid and Grid Snap to canonical commands", async () => {
    const feature = createFeature();
    mocks.showQuickPick
      .mockImplementationOnce(async (items: Array<{ label: string; setting: string }>) => items[0])
      .mockImplementationOnce(async (items: Array<{ label: string; setting: string }>) => items[3])
      .mockResolvedValueOnce(undefined);

    await feature.handlers.get("nuinuiCAD.configureCanvasGrid")?.();

    expect(mocks.showQuickPick.mock.calls.map(([items]) => (items as Array<{ label: string }>).map(({ label }) => label))).toEqual([
      ["Grid: On", "Spacing: 10 mm", "Major interval: ×5", "Grid Snap: Off"],
      ["Grid: On", "Spacing: 10 mm", "Major interval: ×5", "Grid Snap: Off"],
      ["Grid: On", "Spacing: 10 mm", "Major interval: ×5", "Grid Snap: Off"]
    ]);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(1, expect.any(Array), {
      title: "Configure Canvas Grid",
      placeHolder: "Select a Canvas grid setting to edit"
    });
    expect(mocks.executeCommand).toHaveBeenNthCalledWith(1, "nuinuiCAD.toggleCanvasGrid");
    expect(mocks.executeCommand).toHaveBeenNthCalledWith(2, "nuinuiCAD.toggleCanvasGridSnap");
    expect(feature.updates).toEqual([]);
  });

  it("validates and updates spacing and major interval, refreshing the next Quick Pick", async () => {
    const feature = createFeature();
    mocks.showQuickPick
      .mockImplementationOnce(async (items: Array<{ setting: string }>) => items[1])
      .mockImplementationOnce(async (items: Array<{ setting: string }>) => items[2])
      .mockResolvedValueOnce(undefined);
    mocks.showInputBox
      .mockImplementationOnce(async (options: { validateInput?: (value: string) => string | undefined }) => {
        expect(options.validateInput?.("Infinity")).toBe("Enter a finite number greater than 0.");
        expect(options.validateInput?.("0")).toBe("Enter a finite number greater than 0.");
        expect(options.validateInput?.("12.5")).toBeUndefined();
        return "12.5";
      })
      .mockImplementationOnce(async (options: { validateInput?: (value: string) => string | undefined }) => {
        expect(options.validateInput?.("1.5")).toBe("Enter an integer of at least 1.");
        expect(options.validateInput?.("0")).toBe("Enter an integer of at least 1.");
        expect(options.validateInput?.("6")).toBeUndefined();
        return "6";
      });

    await feature.handlers.get("nuinuiCAD.configureCanvasGrid")?.();

    expect(mocks.showInputBox).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "Canvas Grid Spacing",
      value: "10"
    }));
    expect(mocks.showInputBox).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "Canvas Grid Major Interval",
      value: "5"
    }));
    expect(feature.updates).toEqual([
      { key: CANVAS_GRID_SPACING_SETTING, value: 12.5 },
      { key: CANVAS_GRID_MAJOR_EVERY_SETTING, value: 6 }
    ]);
    expect(mocks.showQuickPick.mock.calls[1]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Spacing: 12.5 mm" })
    ]));
  });

  it("does not persist invalid numeric values and closes on explicit cancellation", async () => {
    const feature = createFeature();
    mocks.showQuickPick
      .mockImplementationOnce(async (items: Array<{ setting: string }>) => items[1])
      .mockImplementationOnce(async (items: Array<{ setting: string }>) => items[2]);
    mocks.showInputBox
      .mockResolvedValueOnce("NaN")
      .mockResolvedValueOnce(undefined);

    await feature.handlers.get("nuinuiCAD.configureCanvasGrid")?.();

    expect(feature.updates).toEqual([]);
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.showInputBox).toHaveBeenCalledTimes(2);
  });

  it("closes without mutation when the top-level Quick Pick is canceled", async () => {
    const feature = createFeature();
    mocks.showQuickPick.mockResolvedValue(undefined);

    await feature.handlers.get("nuinuiCAD.configureCanvasGrid")?.();

    expect(feature.updates).toEqual([]);
    expect(mocks.showInputBox).not.toHaveBeenCalled();
  });
});

describe("Canvas Grid command localization", () => {
  it("resolves the Quick Input rows and validation messages in English and Japanese", () => {
    expect(canvasPresentationTextFor("canvas.grid.configure.spacing", "en", { spacing: 2.5 }))
      .toBe("Spacing: 2.5 mm");
    expect(canvasPresentationTextFor("canvas.grid.configure.majorEvery", "ja", { majorEvery: 5 }))
      .toBe("主線間隔: ×5");
    expect(canvasPresentationTextFor("canvas.grid.configure.spacingInvalid", "en"))
      .toBe("Enter a finite number greater than 0.");
    expect(canvasPresentationTextFor("canvas.grid.configure.majorEveryInvalid", "ja"))
      .toBe("1以上の整数を入力してください。");
  });
});
