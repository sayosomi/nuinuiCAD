import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
const sourceOrCanvasWhen = `(${sourceWhen}) || ${canvasWhen}`;
const canvasSelectionEnablement = `${canvasWhen} && nuinuiCAD.canvasHasSelection`;
const bakeEnablement = `(${sourceWhen} && nuinuiCAD.bakeSourceTarget) || (${canvasWhen} && nuinuiCAD.canvasHasSelection)`;

const expectedTargetEnablement = new Map<string, string>([
  ["nuinuiCAD.openModulePreview", `${sourceWhen} && nuinuiCAD.modulePreviewSourceTarget`],
  ["nuinuiCAD.goToSourceDefinition", canvasSelectionEnablement],
  ["nuinuiCAD.revealInCanvas", `${sourceWhen} && nuinuiCAD.revealInCanvasSourceTarget`],
  ["nuinuiCAD.pickReferenceFromCanvas", `${sourceWhen} && nuinuiCAD.referencePickSourceTarget`],
  ["nuinuiCAD.stepSourceValueForward", `${sourceWhen} && !editorReadonly && nuinuiCAD.sourceValueStepTarget`],
  ["nuinuiCAD.stepSourceValueBackward", `${sourceWhen} && !editorReadonly && nuinuiCAD.sourceValueStepTarget`],
  ["nuinuiCAD.clearCanvasSelection", canvasSelectionEnablement],
  ["nuinuiCAD.selectParentGroup", canvasSelectionEnablement],
  ["nuinuiCAD.selectInstance", `${canvasWhen} && nuinuiCAD.canvasCanSelectInstance`],
  ["nuinuiCAD.bakeCurrentShape", bakeEnablement],
  ["nuinuiCAD.bakeBaseShape", bakeEnablement],
  ["nuinuiCAD.createFreePointAtPointer", canvasWhen]
]);

const expectedPaletteScope = new Map<string, string>([
  ["nuinuiCAD.openModulePreview", sourceWhen],
  ["nuinuiCAD.goToSourceDefinition", canvasWhen],
  ["nuinuiCAD.revealInCanvas", sourceWhen],
  ["nuinuiCAD.pickReferenceFromCanvas", sourceWhen],
  ["nuinuiCAD.stepSourceValueForward", sourceWhen],
  ["nuinuiCAD.stepSourceValueBackward", sourceWhen],
  ["nuinuiCAD.clearCanvasSelection", canvasWhen],
  ["nuinuiCAD.selectParentGroup", canvasWhen],
  ["nuinuiCAD.selectInstance", canvasWhen],
  ["nuinuiCAD.bakeCurrentShape", sourceOrCanvasWhen],
  ["nuinuiCAD.bakeBaseShape", sourceOrCanvasWhen],
  ["nuinuiCAD.createFreePointAtPointer", canvasWhen]
]);

const readManifest = async (): Promise<ExtensionManifest> =>
  JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;

describe("VS Code contextual Command Palette enablement", () => {
  it("puts target availability on command enablement while keeping broad Palette scope", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const palette = manifest.contributes?.menus?.commandPalette ?? [];

    for (const [commandId, enablement] of expectedTargetEnablement) {
      expect(commands.find(({ command }) => command === commandId)?.enablement).toBe(enablement);
      expect(palette.find(({ command }) => command === commandId)?.when).toBe(
        expectedPaletteScope.get(commandId)
      );
    }
  });

  it("does not add target enablement to surface-only or Palette-hidden commands", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];

    expect(commands.filter(({ enablement }) => enablement !== undefined).map(({ command }) => command))
      .toEqual([...expectedTargetEnablement.keys()]);
  });

  it("keeps execution authoritative in the durable repository policy", async () => {
    const agents = await readFile(agentsPath, "utf8");
    const normalizedAgents = agents.replace(/\s+/g, " ");

    expect(normalizedAgents).toContain("`menus.commandPalette[].when` owns broad surface relevance");
    expect(normalizedAgents).toContain("`contributes.commands[].enablement` owns coarse target availability");
    expect(normalizedAgents).toContain("Command execution must still revalidate exact current state");
  });
});
