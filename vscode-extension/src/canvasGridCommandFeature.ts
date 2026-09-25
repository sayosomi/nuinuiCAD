import * as vscode from "vscode";
import {
  CANVAS_GRID_ENABLED_SETTING,
  CANVAS_GRID_MAJOR_EVERY_SETTING,
  CANVAS_GRID_SETTING_KEYS,
  CANVAS_GRID_SPACING_SETTING,
  type CanvasGridSettings
} from "../../src/components/canvasGrid";
import { nativeShowInputBox, nativeShowQuickPick } from "./nativeQuickInput";

export type CanvasGridSettingKey = (typeof CANVAS_GRID_SETTING_KEYS)[number];

type CanvasGridQuickPickItem = vscode.QuickPickItem & {
  setting: "grid" | "spacing" | "majorEvery" | "gridSnap";
};

export type CanvasGridCommandTextKey =
  | "canvas.grid.configure.title"
  | "canvas.grid.configure.placeholder"
  | "canvas.grid.configure.gridOn"
  | "canvas.grid.configure.gridOff"
  | "canvas.grid.configure.spacing"
  | "canvas.grid.configure.majorEvery"
  | "canvas.grid.configure.gridSnapOn"
  | "canvas.grid.configure.gridSnapOff"
  | "canvas.grid.configure.spacingTitle"
  | "canvas.grid.configure.spacingPrompt"
  | "canvas.grid.configure.spacingInvalid"
  | "canvas.grid.configure.majorEveryTitle"
  | "canvas.grid.configure.majorEveryPrompt"
  | "canvas.grid.configure.majorEveryInvalid";

export type CanvasGridCommandFeatureDependencies = {
  hasActiveCanvas: () => boolean;
  getSettings: () => CanvasGridSettings;
  updateSetting: (key: CanvasGridSettingKey, value: boolean | number) => Thenable<void> | Promise<void>;
  text: (key: CanvasGridCommandTextKey, parameters?: Record<string, string | number>) => string;
};

const parseSpacing = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const spacingMm = Number(value);
  return Number.isFinite(spacingMm) && spacingMm > 0 ? spacingMm : null;
};

const parseMajorEvery = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const majorEvery = Number(value);
  return Number.isInteger(majorEvery) && majorEvery >= 1 ? majorEvery : null;
};

export const registerCanvasGridCommandFeature = (
  dependencies: CanvasGridCommandFeatureDependencies
): vscode.Disposable => {
  const toggleCanvasGrid = async (): Promise<void> => {
    if (!dependencies.hasActiveCanvas()) return;
    const settings = dependencies.getSettings();
    await dependencies.updateSetting(CANVAS_GRID_ENABLED_SETTING, !settings.enabled);
  };

  const configureCanvasGrid = async (): Promise<void> => {
    if (!dependencies.hasActiveCanvas()) return;

    while (true) {
      const settings = dependencies.getSettings();
      const items: CanvasGridQuickPickItem[] = [
        {
          label: dependencies.text(settings.enabled
            ? "canvas.grid.configure.gridOn"
            : "canvas.grid.configure.gridOff"),
          setting: "grid"
        },
        {
          label: dependencies.text("canvas.grid.configure.spacing", { spacing: settings.spacingMm }),
          setting: "spacing"
        },
        {
          label: dependencies.text("canvas.grid.configure.majorEvery", { majorEvery: settings.majorEvery }),
          setting: "majorEvery"
        },
        {
          label: dependencies.text(settings.snapEnabled
            ? "canvas.grid.configure.gridSnapOn"
            : "canvas.grid.configure.gridSnapOff"),
          setting: "gridSnap"
        }
      ];
      const selected = await nativeShowQuickPick(items, {
        title: dependencies.text("canvas.grid.configure.title"),
        placeHolder: dependencies.text("canvas.grid.configure.placeholder")
      });
      if (!selected) return;

      if (selected.setting === "grid") {
        await vscode.commands.executeCommand("nuinuiCAD.toggleCanvasGrid");
        continue;
      }
      if (selected.setting === "gridSnap") {
        await vscode.commands.executeCommand("nuinuiCAD.toggleCanvasGridSnap");
        continue;
      }
      if (selected.setting === "spacing") {
        const value = await nativeShowInputBox({
          title: dependencies.text("canvas.grid.configure.spacingTitle"),
          prompt: dependencies.text("canvas.grid.configure.spacingPrompt"),
          value: String(settings.spacingMm),
          validateInput: (input) => parseSpacing(input) === null
            ? dependencies.text("canvas.grid.configure.spacingInvalid")
            : undefined
        });
        if (value === undefined) return;
        const spacingMm = parseSpacing(value);
        if (spacingMm !== null) await dependencies.updateSetting(CANVAS_GRID_SPACING_SETTING, spacingMm);
        continue;
      }

      const value = await nativeShowInputBox({
        title: dependencies.text("canvas.grid.configure.majorEveryTitle"),
        prompt: dependencies.text("canvas.grid.configure.majorEveryPrompt"),
        value: String(settings.majorEvery),
        validateInput: (input) => parseMajorEvery(input) === null
          ? dependencies.text("canvas.grid.configure.majorEveryInvalid")
          : undefined
      });
      if (value === undefined) return;
      const majorEvery = parseMajorEvery(value);
      if (majorEvery !== null) await dependencies.updateSetting(CANVAS_GRID_MAJOR_EVERY_SETTING, majorEvery);
    }
  };

  return vscode.Disposable.from(
    vscode.commands.registerCommand("nuinuiCAD.toggleCanvasGrid", toggleCanvasGrid),
    vscode.commands.registerCommand("nuinuiCAD.configureCanvasGrid", configureCanvasGrid)
  );
};
