import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

type CommandContribution = {
  command: string;
  enablement?: string;
};

type PaletteContribution = {
  command: string;
  when: string;
};

type ExtensionManifest = {
  contributes?: {
    commands?: CommandContribution[];
    menus?: {
      commandPalette?: PaletteContribution[];
    };
  };
};

const manifestPath = resolve(process.cwd(), "vscode-extension/package.json");
const agentsPath = resolve(process.cwd(), "AGENTS.md");
const sourceWhen = "editorLangId == nui && resourceScheme == file && resourceExtname == .nui";
const canvasWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas'";
const coordinatePointCreationPaletteWhen = "nuinuiCAD.canvasCoordinatePointCreationAvailable && !nuinuiCAD.canvasCoordinatePointCreationActive";
const modulePreviewWhen = "activeWebviewPanelId == 'nuinuiCAD.modulePreview'";
const sourceOrCanvasWhen = `(${sourceWhen}) || ${canvasWhen}`;
const sourceOrModulePreviewWhen = `(${sourceWhen}) || ${modulePreviewWhen}`;
const canvasSelectionEnablement = `${canvasWhen} && nuinuiCAD.canvasHasSelection`;
const bakeEnablement = `(${sourceWhen} && nuinuiCAD.bakeSourceTarget) || ((activeWebviewPanelId == 'nuinuiCAD.canvas' || activeWebviewPanelId == 'nuinuiCAD.modulePreview') && nuinuiCAD.canvasHasSelection)`;
const coordinatePointConversionExplorerWhen = "view == nuinuiCAD.elements && viewItem == 'nuinuiCAD.coordinatePointConversionTarget'";

const expectedCommandEnablement = new Map<string, string>([
  ["nuinuiCAD.openModulePreview", `${sourceWhen} && nuinuiCAD.modulePreviewSourceTarget`],
  ["nuinuiCAD.editModulePreviewValues", `(${sourceWhen} && nuinuiCAD.modulePreviewSourceTarget) || ${modulePreviewWhen}`],
  ["nuinuiCAD.insertModulePreviewInstance", "nuinuiCAD.modulePreviewInsertAvailable"],
  ["nuinuiCAD.inlineModuleInstance", `(${sourceWhen} && nuinuiCAD.inlineModuleSourceTarget) || (${canvasWhen} && nuinuiCAD.inlineModuleCanvasTarget)`],
  ["nuinuiCAD.extractModule", `(${sourceWhen} && nuinuiCAD.extractModuleSourceTarget) || (${canvasWhen} && nuinuiCAD.extractModuleCanvasTarget)`],
  ["nuinuiCAD.goToSourceDefinition", canvasSelectionEnablement],
  ["nuinuiCAD.revealInCanvas", `${sourceWhen} && nuinuiCAD.revealInCanvasSourceTarget`],
  ["nuinuiCAD.revealInOutputPreview", `${sourceWhen} && nuinuiCAD.revealInOutputPreviewSourceTarget`],
  ["nuinuiCAD.pickReferenceFromCanvas", `${sourceWhen} && !editorReadonly`],
  ["nuinuiCAD.convertPointToXYOffset", `(${sourceWhen} && nuinuiCAD.coordinatePointConversionSourceTarget) || (${canvasWhen} && nuinuiCAD.canvasHasCoordinatePointConversionTarget) || (${coordinatePointConversionExplorerWhen})`],
  ["nuinuiCAD.convertPointToAngleDistanceOffset", `(${sourceWhen} && nuinuiCAD.coordinatePointConversionSourceTarget) || (${canvasWhen} && nuinuiCAD.canvasHasCoordinatePointConversionTarget) || (${coordinatePointConversionExplorerWhen})`],
  ["nuinuiCAD.replaceGeometryReferences", `${sourceWhen} && !editorReadonly && nuinuiCAD.geometryReferenceRetargetSourceTarget`],
  ["nuinuiCAD.stepSourceValueForward", `${sourceWhen} && !editorReadonly && nuinuiCAD.sourceValueStepTarget`],
  ["nuinuiCAD.stepSourceValueBackward", `${sourceWhen} && !editorReadonly && nuinuiCAD.sourceValueStepTarget`],
  ["nuinuiCAD.clearCanvasSelection", canvasSelectionEnablement],
  ["nuinuiCAD.selectParentGroup", canvasSelectionEnablement],
  ["nuinuiCAD.selectInstance", `${canvasWhen} && nuinuiCAD.canvasCanSelectInstance`],
  ["nuinuiCAD.bakeCurrentShape", bakeEnablement],
  ["nuinuiCAD.bakeBaseShape", bakeEnablement]
]);

const expectedPaletteScope = new Map<string, string>([
  ["nuinuiCAD.openModulePreview", sourceWhen],
  ["nuinuiCAD.editModulePreviewValues", sourceOrModulePreviewWhen],
  ["nuinuiCAD.insertModulePreviewInstance", sourceWhen],
  ["nuinuiCAD.inlineModuleInstance", sourceOrCanvasWhen],
  ["nuinuiCAD.extractModule", sourceOrCanvasWhen],
  ["nuinuiCAD.goToSourceDefinition", canvasWhen],
  ["nuinuiCAD.revealInCanvas", sourceWhen],
  ["nuinuiCAD.revealInOutputPreview", sourceWhen],
  ["nuinuiCAD.pickReferenceFromCanvas", sourceWhen],
  ["nuinuiCAD.convertPointToXYOffset", sourceOrCanvasWhen],
  ["nuinuiCAD.convertPointToAngleDistanceOffset", sourceOrCanvasWhen],
  ["nuinuiCAD.replaceGeometryReferences", sourceWhen],
  ["nuinuiCAD.stepSourceValueForward", sourceWhen],
  ["nuinuiCAD.stepSourceValueBackward", sourceWhen],
  ["nuinuiCAD.clearCanvasSelection", canvasWhen],
  ["nuinuiCAD.selectParentGroup", canvasWhen],
  ["nuinuiCAD.selectInstance", canvasWhen],
  ["nuinuiCAD.bakeCurrentShape", sourceOrCanvasWhen],
  ["nuinuiCAD.bakeBaseShape", sourceOrCanvasWhen],
  ["nuinuiCAD.createFreePointAtPointer", coordinatePointCreationPaletteWhen]
]);

const readManifest = async (): Promise<ExtensionManifest> =>
  JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;

describe("VS Code contextual Command Palette enablement", () => {
  it("keeps target availability separate from Palette scope and permits targetless Reference Pick", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const palette = manifest.contributes?.menus?.commandPalette ?? [];

    for (const [commandId, enablement] of expectedCommandEnablement) {
      expect(commands.find(({ command }) => command === commandId)?.enablement).toBe(enablement);
      expect(palette.find(({ command }) => command === commandId)?.when).toBe(
        expectedPaletteScope.get(commandId)
      );
    }
  });

  it("does not add other enablement or target conditions to surface-only Reference Pick", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];

    expect(commands.find(({ command }) => command === "nuinuiCAD.pickReferenceFromCanvas")?.enablement).not.toContain("referencePickSourceTarget");
    expect(commands.filter(({ enablement }) => enablement !== undefined).map(({ command }) => command))
      .toEqual([...expectedCommandEnablement.keys()]);
  });

  it("keeps coordinate-point creation available throughout the Canvas Palette scope", async () => {
    const manifest = await readManifest();
    const command = manifest.contributes?.commands?.find(({ command }) => command === "nuinuiCAD.createFreePointAtPointer");
    const palette = manifest.contributes?.menus?.commandPalette?.find(({ command }) => command === "nuinuiCAD.createFreePointAtPointer");

    expect(command?.enablement).toBeUndefined();
    expect(palette?.when).toBe(coordinatePointCreationPaletteWhen);
  });

  it("evaluates the actual coordinate-point Palette condition against Canvas tab contexts", async () => {
    const manifest = await readManifest();
    const palette = manifest.contributes?.menus?.commandPalette?.find(({ command }) => command === "nuinuiCAD.createFreePointAtPointer");
    expect(palette?.when).toBeDefined();
    const when = palette!.when;
    const visibleFor = (context: Record<string, unknown>): boolean =>
      runInNewContext(when, context) === true;
    const scenarios: Array<{ name: string; context: Record<string, unknown>; visible: boolean }> = [
      {
        name: "ready Canvas tab with no Webview-interior focus and no Source caret",
        context: {
          activeWebviewPanelId: undefined,
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: true, canvasCoordinatePointCreationActive: false },
          sourceCaretSelected: false
        },
        visible: true
      },
      {
        name: "ready Canvas tab with Webview-interior focus",
        context: {
          activeWebviewPanelId: "nuinuiCAD.canvas",
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: true, canvasCoordinatePointCreationActive: false }
        },
        visible: true
      },
      {
        name: "Source tab active",
        context: {
          activeWebviewPanelId: undefined,
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: false, canvasCoordinatePointCreationActive: false }
        },
        visible: false
      },
      {
        name: "Output Preview active",
        context: {
          activeWebviewPanelId: "nuinuiCAD.outputPreview",
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: false, canvasCoordinatePointCreationActive: false }
        },
        visible: false
      },
      {
        name: "unrelated Webview active",
        context: {
          activeWebviewPanelId: "other.webview",
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: false, canvasCoordinatePointCreationActive: false }
        },
        visible: false
      },
      ...["unavailable", "stale", "disposed"].map((state) => ({
        name: `Canvas session ${state}`,
        context: {
          activeWebviewPanelId: undefined,
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: false, canvasCoordinatePointCreationActive: false }
        },
        visible: false
      })),
      {
        name: "coordinate-point mode already active",
        context: {
          activeWebviewPanelId: "nuinuiCAD.canvas",
          nuinuiCAD: { canvasCoordinatePointCreationAvailable: true, canvasCoordinatePointCreationActive: true }
        },
        visible: false
      }
    ];

    for (const scenario of scenarios) {
      expect(visibleFor(scenario.context), scenario.name).toBe(scenario.visible);
    }
  });

  it("keeps execution authoritative in the durable repository policy", async () => {
    const agents = await readFile(agentsPath, "utf8");
    const normalizedAgents = agents.replace(/\s+/g, " ");

    expect(normalizedAgents).toContain("`menus.commandPalette[].when` owns broad surface relevance");
    expect(normalizedAgents).toContain("`contributes.commands[].enablement` owns coarse target availability");
    expect(normalizedAgents).toContain("Command execution remains authoritative and must revalidate exact current state");
  });
});
