import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  VSCODE_CANVAS_QUICK_CREATE_SETTING,
  VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT,
  vscodeCanvasCreationCommands,
  vscodeCanvasCreationCommandIdFor
} from "../../src/vscode/vscodeCanvasCreationCommands";

type Keybinding = {
  command: string;
  key: string;
  mac?: string;
  when: string;
};

type Command = {
  command: string;
  title: string;
  shortTitle?: string;
  enablement?: string;
};

type CommandPaletteMenu = {
  command?: string;
  submenu?: string;
  when: string;
  group?: string;
};

type ExtensionManifest = {
  contributes?: {
    configuration?: {
      properties?: Record<string, {
        scope?: string;
        type?: string;
        default?: unknown;
        maxItems?: number;
        items?: unknown;
      }>;
    };
    submenus?: Array<{ id: string; label: string }>;
    commands?: Command[];
    keybindings?: Keybinding[];
    menus?: {
      commandPalette?: CommandPaletteMenu[];
      "webview/context"?: CommandPaletteMenu[];
      "editor/context"?: CommandPaletteMenu[];
      "nuinuiCAD.create"?: CommandPaletteMenu[];
      "nuinuiCAD.convertPoint"?: CommandPaletteMenu[];
      "view/item/context"?: CommandPaletteMenu[];
    };
  };
};

type SchemaNode = {
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  oneOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
};

const manifestPath = resolve(process.cwd(), "vscode-extension/package.json");
const agentsPath = resolve(process.cwd(), "AGENTS.md");
const commandIds = [
  "nuinuiCAD.openCanvas",
  "nuinuiCAD.openOutputPreview",
  "nuinuiCAD.openModulePreview",
  "nuinuiCAD.inlineModuleInstance",
  "nuinuiCAD.extractModule",
  "nuinuiCAD.goToSourceDefinition",
  "nuinuiCAD.revealInCanvas",
  "nuinuiCAD.revealInOutputPreview",
  "nuinuiCAD.pickReferenceFromCanvas",
  "nuinuiCAD.convertPointToXYOffset",
  "nuinuiCAD.convertPointToAngleDistanceOffset",
  "nuinuiCAD.replaceGeometryReferences",
  "nuinuiCAD.stepSourceValueForward",
  "nuinuiCAD.stepSourceValueBackward",
  "nuinuiCAD.canvasUndo",
  "nuinuiCAD.canvasRedo",
  "nuinuiCAD.outputPreviewUndo",
  "nuinuiCAD.outputPreviewRedo",
  "nuinuiCAD.clearCanvasSelection",
  "nuinuiCAD.selectParentGroup",
  "nuinuiCAD.selectInstance",
  "nuinuiCAD.resetCanvasView",
  "nuinuiCAD.fitDrawing",
  "nuinuiCAD.resetOutputPreviewView",
  "nuinuiCAD.fitOutputPreview",
  "nuinuiCAD.clearOutputPreviewFocus",
  "nuinuiCAD.exportCurrentOutput",
  "nuinuiCAD.toggleCanvasPointNames",
  "nuinuiCAD.toggleCanvasGeometryNames",
  "nuinuiCAD.toggleCanvasElementNames",
  "nuinuiCAD.toggleCanvasPoints",
  "nuinuiCAD.bakeCurrentShape",
  "nuinuiCAD.bakeBaseShape",
  "nuinuiCAD.editCanvasRibbon",
  "nuinuiCAD.modulePreview.clearSelection",
  "nuinuiCAD.modulePreview.resetView",
  "nuinuiCAD.modulePreview.fitDrawing",
  "nuinuiCAD.modulePreview.togglePointNames",
  "nuinuiCAD.modulePreview.toggleGeometryNames",
  "nuinuiCAD.modulePreview.togglePoints",
  "nuinuiCAD.createGeometry",
  "nuinuiCAD.createFreePointAtPointer",
  "nuinuiCAD.create.addFreePoint",
  "nuinuiCAD.create.addText",
  "nuinuiCAD.create.addOffsetPoint",
  "nuinuiCAD.create.addPolarOffsetPoint",
  "nuinuiCAD.create.addDivisionPoint",
  "nuinuiCAD.create.addLineDivisionPoint",
  "nuinuiCAD.create.addIntersectionPoint",
  "nuinuiCAD.create.addLineTangentOffsetPoint",
  "nuinuiCAD.create.addBezierBulgePoint",
  "nuinuiCAD.create.addBezierExtremePoint",
  "nuinuiCAD.create.addLine",
  "nuinuiCAD.create.addAngleLengthLine",
  "nuinuiCAD.create.addCommonTangentLine",
  "nuinuiCAD.create.addArcLine",
  "nuinuiCAD.create.addThreePointArcLine",
  "nuinuiCAD.create.addCornerRadiusArcLine",
  "nuinuiCAD.create.addEdge",
  "nuinuiCAD.create.addExtendTrim",
  "nuinuiCAD.create.addBezierCurve",
  "nuinuiCAD.create.addOffsetLine",
  "nuinuiCAD.create.addCopyLine",
  "nuinuiCAD.create.addSymmetricCopyLine",
  "nuinuiCAD.create.addMove",
  "nuinuiCAD.create.addSymmetricMove",
  "nuinuiCAD.create.addSplitLine",
  "nuinuiCAD.configureQuickCreate"
] as const;
const sourcePaletteWhen = "editorLangId == nui && resourceScheme == file && resourceExtname == .nui";
const canvasRevealContextWhen = `${sourcePaletteWhen} && nuinuiCAD.revealInCanvasSourceTarget`;
const canvasOpenFallbackContextWhen = `${sourcePaletteWhen} && !nuinuiCAD.revealInCanvasSourceTarget`;
const outputPreviewRevealContextWhen = `${sourcePaletteWhen} && nuinuiCAD.revealInOutputPreviewSourceTarget`;
const outputPreviewOpenFallbackContextWhen = `${sourcePaletteWhen} && !nuinuiCAD.revealInOutputPreviewSourceTarget`;
const referencePickContextWhen = `${sourcePaletteWhen} && nuinuiCAD.referencePickSourceTarget`;
const coordinatePointConversionSourceContextWhen = `${sourcePaletteWhen} && nuinuiCAD.coordinatePointConversionSourceTarget`;
const coordinatePointConversionCanvasContextWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasHasCoordinatePointConversionTarget";
const coordinatePointConversionExplorerContextWhen = "view == nuinuiCAD.elements && viewItem == 'nuinuiCAD.coordinatePointConversionTarget'";
const coordinatePointConversionEnablement = `(${coordinatePointConversionSourceContextWhen}) || (activeWebviewPanelId == 'nuinuiCAD.canvas' && nuinuiCAD.canvasHasCoordinatePointConversionTarget) || (${coordinatePointConversionExplorerContextWhen})`;
const outputPreviewRevealEnablement = `${sourcePaletteWhen} && nuinuiCAD.revealInOutputPreviewSourceTarget`;
const geometryReferenceRetargetContextWhen = `${sourcePaletteWhen} && !editorReadonly && nuinuiCAD.geometryReferenceRetargetSourceTarget`;
const sourceValueStepKeybindingWhen = `editorTextFocus && ${sourcePaletteWhen} && !editorReadonly`;
const modulePreviewValueStepKeybindingWhen = "focusedView == 'nuinuiCAD.modulePreviewParameters' && nuinuiCAD.modulePreviewValueInputFocus";
const sourceValueStepContextWhen = `${sourcePaletteWhen} && !editorReadonly && nuinuiCAD.sourceValueStepTarget`;
const bakeSourceContextWhen = `${sourcePaletteWhen} && nuinuiCAD.bakeSourceTarget`;
const modulePreviewContextWhen = `${sourcePaletteWhen} && nuinuiCAD.modulePreviewSourceTarget`;
const inlineModuleSourceContextWhen = `${sourcePaletteWhen} && nuinuiCAD.inlineModuleSourceTarget`;
const inlineModuleCanvasContextWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.inlineModuleCanvasTarget";
const extractModuleSourceContextWhen = `${sourcePaletteWhen} && nuinuiCAD.extractModuleSourceTarget`;
const extractModuleCanvasContextWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.extractModuleCanvasTarget";
const sourceOrCanvasPaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.canvas'";
const sourceOrOutputPreviewPaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.outputPreview'";
const canvasPaletteWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas'";
const bakePaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.canvas'";
const canvasHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas' || (editorTextFocus && nuinuiCAD.canvasHistoryHandoff)";
const outputPreviewHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.outputPreview'";
const canvasBlankWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'blank'";
const canvasElementWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasHasSelection";
const canvasOrModulePreviewRibbonWhen = "(webviewId == 'nuinuiCAD.canvas' || webviewId == 'nuinuiCAD.modulePreview') && (webviewSection == 'blank' || webviewSection == 'ribbon')";
const modulePreviewBlankWhen = "webviewId == 'nuinuiCAD.modulePreview' && webviewSection == 'blank'";

async function readManifest(): Promise<ExtensionManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;
}

describe("VS Code extension manifest command contributions", () => {
  it("keeps the Source+Output Preview Palette scope in the durable policy", async () => {
    expect(await readFile(agentsPath, "utf8")).toContain("* `Source+Output Preview`");
  });

  it("declares the Bake activity settings with their current defaults", async () => {
    const manifest = await readManifest();
    const properties = manifest.contributes?.configuration?.properties ?? {};
    expect(properties).toMatchObject({
      "nuinuiCAD.bake.emitSkippedComments": { type: "boolean", default: true },
      "nuinuiCAD.bake.includeHiddenGeometry": { type: "boolean", default: false },
      "nuinuiCAD.bake.includeDisabledGeometry": { type: "boolean", default: false },
      "nuinuiCAD.inlineModule.emitOmittedBranchComments": { type: "boolean", default: true },
      "nuinuiCAD.inlineModule.includeHiddenInstances": { type: "boolean", default: false },
      "nuinuiCAD.inlineModule.includeDisabledInstances": { type: "boolean", default: false }
    });
  });

  it("registers the current command set", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];

    expect(commands.map(({ command }) => command)).toEqual(commandIds);
    expect(commands.map(({ title }) => title)).toEqual([
      "nuinuiCAD: Open Canvas",
      "nuinuiCAD: Open Output Preview",
      "nuinuiCAD: Open Module Preview",
      "nuinuiCAD: Inline Module Instance",
      "nuinuiCAD: Extract Module",
      "nuinuiCAD: Go to Source Definition",
      "nuinuiCAD: Reveal in Canvas",
      "nuinuiCAD: Reveal in Output Preview",
      "nuinuiCAD: Pick Reference from Canvas",
      "nuinuiCAD: Convert Point to XY Offset",
      "nuinuiCAD: Convert Point to Angle-Distance Offset",
      "nuinuiCAD: Replace Geometry References",
      "nuinuiCAD: Step Source Value Forward",
      "nuinuiCAD: Step Source Value Backward",
      "nuinuiCAD: Undo Canvas Transition",
      "nuinuiCAD: Redo Canvas Transition",
      "nuinuiCAD: Undo Output Preview Source Edit",
      "nuinuiCAD: Redo Output Preview Source Edit",
      "nuinuiCAD: Clear Canvas Selection",
      "nuinuiCAD: Select Parent Group",
      "nuinuiCAD: Select Instance",
      "nuinuiCAD: Reset Canvas View",
      "nuinuiCAD: Fit Drawing",
      "nuinuiCAD: Reset Output Preview View",
      "nuinuiCAD: Fit Output Preview",
      "nuinuiCAD: Clear Output Preview Focus",
      "nuinuiCAD: Export Current Output",
      "nuinuiCAD: Toggle Point Names",
      "nuinuiCAD: Toggle Geometry Names",
      "nuinuiCAD: Toggle Canvas Element Names (Legacy)",
      "nuinuiCAD: Toggle Canvas Points",
      "nuinuiCAD: Bake Current Shape",
      "nuinuiCAD: Bake Base Shape",
      "nuinuiCAD: Edit Canvas Ribbon",
      "nuinuiCAD: Clear Module Preview Selection",
      "nuinuiCAD: Reset Module Preview View",
      "nuinuiCAD: Fit Module Preview Drawing",
      "nuinuiCAD: Toggle Module Preview Point Names",
      "nuinuiCAD: Toggle Module Preview Geometry Names",
      "nuinuiCAD: Toggle Module Preview Points",
      "nuinuiCAD: Create Geometry…",
      "nuinuiCAD: Create Free Point at Pointer",
      "nuinuiCAD: Create Free Point",
      "nuinuiCAD: Create Text",
      "nuinuiCAD: Create Offset Point",
      "nuinuiCAD: Create Polar Offset Point",
      "nuinuiCAD: Create Division Point",
      "nuinuiCAD: Create Line Division Point",
      "nuinuiCAD: Create Intersection Point",
      "nuinuiCAD: Create Line Tangent Offset Point",
      "nuinuiCAD: Create Bezier Bulge Point",
      "nuinuiCAD: Create Bezier Extreme Point",
      "nuinuiCAD: Create Line",
      "nuinuiCAD: Create Angle Length Line",
      "nuinuiCAD: Create Common Tangent Line",
      "nuinuiCAD: Create Arc Line",
      "nuinuiCAD: Create Three-Point Arc Line",
      "nuinuiCAD: Create Corner Radius Arc Line",
      "nuinuiCAD: Create Edge",
      "nuinuiCAD: Create Extend/Trim",
      "nuinuiCAD: Create Bezier Curve",
      "nuinuiCAD: Create Offset Line",
      "nuinuiCAD: Create Copy Line",
      "nuinuiCAD: Create Symmetric Copy Line",
      "nuinuiCAD: Create Move",
      "nuinuiCAD: Create Symmetric Move",
      "nuinuiCAD: Create Split Line",
      "nuinuiCAD: Configure Quick Create…"
    ]);
  });

  it("keeps Reset Output Preview View surface-only with no shortcut or target enablement", async () => {
    const manifest = await readManifest();
    const command = manifest.contributes?.commands?.find(({ command }) => command === "nuinuiCAD.resetOutputPreviewView");
    expect(command).toEqual({
      command: "nuinuiCAD.resetOutputPreviewView",
      title: "nuinuiCAD: Reset Output Preview View"
    });
    expect(manifest.contributes?.menus?.commandPalette).toContainEqual({
      command: "nuinuiCAD.resetOutputPreviewView",
      when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'"
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toContainEqual({
      command: "nuinuiCAD.resetOutputPreviewView",
      when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'"
    });
    expect(manifest.contributes?.keybindings?.some(({ command: id }) => id === "nuinuiCAD.resetOutputPreviewView")).toBe(false);
  });

  it("uses the fixed short title for the Canvas free-point context menu", async () => {
    const manifest = await readManifest();
    const command = manifest.contributes?.commands?.find(({ command }) => command === "nuinuiCAD.createFreePointAtPointer");

    expect(command?.shortTitle).toBe("Create Free Point at Pointer");
  });

  it("keeps the public Convert titles while using native submenu short titles", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];
    const keybindings = manifest.contributes?.keybindings ?? [];
    const conversionCommands = [
      {
        id: "nuinuiCAD.convertPointToXYOffset",
        title: "nuinuiCAD: Convert Point to XY Offset",
        shortTitle: "XY Offset…"
      },
      {
        id: "nuinuiCAD.convertPointToAngleDistanceOffset",
        title: "nuinuiCAD: Convert Point to Angle-Distance Offset",
        shortTitle: "Angle-Distance Offset…"
      }
    ];

    for (const conversion of conversionCommands) {
      expect(commands.find(({ command }) => command === conversion.id)).toMatchObject({
        command: conversion.id,
        title: conversion.title,
        shortTitle: conversion.shortTitle,
        enablement: coordinatePointConversionEnablement
      });
      expect(commandPalette.find(({ command }) => command === conversion.id)?.when)
        .toBe(sourceOrCanvasPaletteWhen);
      expect(keybindings.some(({ command }) => command === conversion.id)).toBe(false);
    }

    expect(manifest.contributes?.menus?.["editor/context"]).toContainEqual({
      submenu: "nuinuiCAD.convertPoint",
      when: coordinatePointConversionSourceContextWhen,
      group: "1_modification@2"
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toContainEqual({
      submenu: "nuinuiCAD.convertPoint",
      when: coordinatePointConversionCanvasContextWhen,
      group: "1_modification@1"
    });
    expect(manifest.contributes?.menus?.["view/item/context"]).toContainEqual({
      submenu: "nuinuiCAD.convertPoint",
      when: coordinatePointConversionExplorerContextWhen,
      group: "1_modification@1"
    });

    expect(manifest.contributes?.menus?.["view/title"]?.some(({ command }) =>
      conversionCommands.some((conversion) => conversion.id === command))).toBe(false);
    const ribbonSetting = manifest.contributes?.configuration?.properties?.["nuinuiCAD.canvasRibbon.ribbons"];
    expect(JSON.stringify(ribbonSetting)).not.toContain("convertPointToXYOffset");
    expect(JSON.stringify(ribbonSetting)).not.toContain("convertPointToAngleDistanceOffset");
  });

  it("scopes open commands without making Module Preview Palette visibility caret-dependent", async () => {
    const manifest = await readManifest();
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];

    expect(commandPalette).toEqual([
      { command: "nuinuiCAD.openCanvas", when: sourceOrOutputPreviewPaletteWhen },
      { command: "nuinuiCAD.openOutputPreview", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.openModulePreview", when: sourcePaletteWhen },
      { command: "nuinuiCAD.editCanvasRibbon", when: canvasPaletteWhen },
      { command: "nuinuiCAD.goToSourceDefinition", when: canvasPaletteWhen },
      { command: "nuinuiCAD.revealInCanvas", when: sourcePaletteWhen },
      { command: "nuinuiCAD.revealInOutputPreview", when: sourcePaletteWhen },
      { command: "nuinuiCAD.pickReferenceFromCanvas", when: sourcePaletteWhen },
      { command: "nuinuiCAD.inlineModuleInstance", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.extractModule", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.convertPointToXYOffset", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.convertPointToAngleDistanceOffset", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.replaceGeometryReferences", when: sourcePaletteWhen },
      { command: "nuinuiCAD.stepSourceValueForward", when: sourcePaletteWhen },
      { command: "nuinuiCAD.stepSourceValueBackward", when: sourcePaletteWhen },
      { command: "nuinuiCAD.clearCanvasSelection", when: canvasPaletteWhen },
      { command: "nuinuiCAD.selectParentGroup", when: canvasPaletteWhen },
      { command: "nuinuiCAD.selectInstance", when: canvasPaletteWhen },
      { command: "nuinuiCAD.resetCanvasView", when: canvasPaletteWhen },
      { command: "nuinuiCAD.fitDrawing", when: canvasPaletteWhen },
      { command: "nuinuiCAD.resetOutputPreviewView", when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'" },
      { command: "nuinuiCAD.fitOutputPreview", when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'" },
      { command: "nuinuiCAD.clearOutputPreviewFocus", when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'" },
      { command: "nuinuiCAD.exportCurrentOutput", when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'" },
      { command: "nuinuiCAD.toggleCanvasPointNames", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasGeometryNames", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasElementNames", when: "false" },
      { command: "nuinuiCAD.toggleCanvasPoints", when: canvasPaletteWhen },
      { command: "nuinuiCAD.bakeCurrentShape", when: bakePaletteWhen },
      { command: "nuinuiCAD.bakeBaseShape", when: bakePaletteWhen },
      { command: "nuinuiCAD.canvasUndo", when: "false" },
      { command: "nuinuiCAD.canvasRedo", when: "false" },
      { command: "nuinuiCAD.outputPreviewUndo", when: "false" },
      { command: "nuinuiCAD.outputPreviewRedo", when: "false" },
      { command: "nuinuiCAD.modulePreview.clearSelection", when: "false" },
      { command: "nuinuiCAD.modulePreview.resetView", when: "false" },
      { command: "nuinuiCAD.modulePreview.fitDrawing", when: "false" },
      { command: "nuinuiCAD.modulePreview.togglePointNames", when: "false" },
      { command: "nuinuiCAD.modulePreview.toggleGeometryNames", when: "false" },
      { command: "nuinuiCAD.modulePreview.togglePoints", when: "false" },
      { command: "nuinuiCAD.createGeometry", when: canvasPaletteWhen },
      { command: "nuinuiCAD.createFreePointAtPointer", when: canvasPaletteWhen },
      { command: "nuinuiCAD.create.addFreePoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addFreePoint` },
      { command: "nuinuiCAD.create.addText", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addText` },
      { command: "nuinuiCAD.create.addOffsetPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addOffsetPoint` },
      { command: "nuinuiCAD.create.addPolarOffsetPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addPolarOffsetPoint` },
      { command: "nuinuiCAD.create.addDivisionPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addDivisionPoint` },
      { command: "nuinuiCAD.create.addLineDivisionPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addLineDivisionPoint` },
      { command: "nuinuiCAD.create.addIntersectionPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addIntersectionPoint` },
      { command: "nuinuiCAD.create.addLineTangentOffsetPoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addLineTangentOffsetPoint` },
      { command: "nuinuiCAD.create.addBezierBulgePoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addBezierBulgePoint` },
      { command: "nuinuiCAD.create.addBezierExtremePoint", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addBezierExtremePoint` },
      { command: "nuinuiCAD.create.addLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addLine` },
      { command: "nuinuiCAD.create.addAngleLengthLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addAngleLengthLine` },
      { command: "nuinuiCAD.create.addCommonTangentLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addCommonTangentLine` },
      { command: "nuinuiCAD.create.addArcLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addArcLine` },
      { command: "nuinuiCAD.create.addThreePointArcLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addThreePointArcLine` },
      { command: "nuinuiCAD.create.addCornerRadiusArcLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addCornerRadiusArcLine` },
      { command: "nuinuiCAD.create.addEdge", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addEdge` },
      { command: "nuinuiCAD.create.addExtendTrim", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addExtendTrim` },
      { command: "nuinuiCAD.create.addBezierCurve", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addBezierCurve` },
      { command: "nuinuiCAD.create.addOffsetLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addOffsetLine` },
      { command: "nuinuiCAD.create.addCopyLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addCopyLine` },
      { command: "nuinuiCAD.create.addSymmetricCopyLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addSymmetricCopyLine` },
      { command: "nuinuiCAD.create.addMove", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addMove` },
      { command: "nuinuiCAD.create.addSymmetricMove", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addSymmetricMove` },
      { command: "nuinuiCAD.create.addSplitLine", when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.addSplitLine` },
      { command: "nuinuiCAD.configureQuickCreate", when: "false" }
    ]);
    expect(commandPalette.find(({ command }) => command === "nuinuiCAD.openModulePreview")?.when)
      .not.toContain("modulePreviewSourceTarget");
  });

  it("keeps independent Reveal/Open fallback slots in deterministic Source navigation order", async () => {
    const manifest = await readManifest();
    expect(manifest.contributes?.menus?.["editor/context"]).toEqual([
      { command: "nuinuiCAD.revealInCanvas", when: canvasRevealContextWhen, group: "navigation@1" },
      { command: "nuinuiCAD.openCanvas", when: canvasOpenFallbackContextWhen, group: "navigation@1" },
      { command: "nuinuiCAD.revealInOutputPreview", when: outputPreviewRevealContextWhen, group: "navigation@2" },
      { command: "nuinuiCAD.openOutputPreview", when: outputPreviewOpenFallbackContextWhen, group: "navigation@2" },
      { command: "nuinuiCAD.openModulePreview", when: modulePreviewContextWhen, group: "navigation@3" },
      { command: "nuinuiCAD.inlineModuleInstance", when: inlineModuleSourceContextWhen, group: "1_modification@7" },
      { command: "nuinuiCAD.extractModule", when: extractModuleSourceContextWhen, group: "1_modification@8" },
      { command: "nuinuiCAD.pickReferenceFromCanvas", when: referencePickContextWhen, group: "1_modification@1" },
      { submenu: "nuinuiCAD.convertPoint", when: coordinatePointConversionSourceContextWhen, group: "1_modification@2" },
      { command: "nuinuiCAD.stepSourceValueForward", when: sourceValueStepContextWhen, group: "1_modification@2" },
      { command: "nuinuiCAD.stepSourceValueBackward", when: sourceValueStepContextWhen, group: "1_modification@3" },
      { command: "nuinuiCAD.bakeCurrentShape", when: bakeSourceContextWhen, group: "1_modification@4" },
      { command: "nuinuiCAD.bakeBaseShape", when: bakeSourceContextWhen, group: "1_modification@5" },
      { command: "nuinuiCAD.replaceGeometryReferences", when: geometryReferenceRetargetContextWhen, group: "1_modification@6" }
    ]);
    expect(manifest.contributes?.menus?.["webview/context"]).toEqual([
      { command: "nuinuiCAD.createFreePointAtPointer", when: canvasBlankWhen, group: "1_create@0" },
      { command: "nuinuiCAD.createGeometry", when: canvasBlankWhen, group: "1_create@0" },
      { submenu: "nuinuiCAD.create", when: canvasBlankWhen, group: "1_create@1" },
      { submenu: "nuinuiCAD.convertPoint", when: coordinatePointConversionCanvasContextWhen, group: "1_modification@1" },
      { command: "nuinuiCAD.fitDrawing", when: canvasBlankWhen },
      { command: "nuinuiCAD.resetCanvasView", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasPointNames", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasGeometryNames", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasPoints", when: canvasBlankWhen },
      { command: "nuinuiCAD.editCanvasRibbon", when: canvasOrModulePreviewRibbonWhen },
      { command: "nuinuiCAD.clearCanvasSelection", when: `${canvasBlankWhen} && nuinuiCAD.canvasHasSelection` },
      { command: "nuinuiCAD.selectParentGroup", when: canvasElementWhen },
      { command: "nuinuiCAD.selectInstance", when: "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasCanSelectInstance" },
      { command: "nuinuiCAD.resetOutputPreviewView", when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'" },
      { command: "nuinuiCAD.fitOutputPreview", when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'" },
      { command: "nuinuiCAD.clearOutputPreviewFocus", when: "webviewId == 'nuinuiCAD.outputPreview' && (webviewSection == 'blank' || webviewSection == 'place')" },
      { command: "nuinuiCAD.goToSourceDefinition", when: canvasElementWhen },
      { command: "nuinuiCAD.inlineModuleInstance", when: inlineModuleCanvasContextWhen, group: "1_modification@7" },
      { command: "nuinuiCAD.extractModule", when: extractModuleCanvasContextWhen, group: "1_modification@8" },
      { command: "nuinuiCAD.bakeCurrentShape", when: canvasElementWhen },
      { command: "nuinuiCAD.bakeBaseShape", when: canvasElementWhen },
      { command: "nuinuiCAD.modulePreview.fitDrawing", when: modulePreviewBlankWhen },
      { command: "nuinuiCAD.modulePreview.resetView", when: modulePreviewBlankWhen },
      { command: "nuinuiCAD.modulePreview.togglePointNames", when: modulePreviewBlankWhen },
      { command: "nuinuiCAD.modulePreview.toggleGeometryNames", when: modulePreviewBlankWhen },
      { command: "nuinuiCAD.modulePreview.togglePoints", when: modulePreviewBlankWhen },
      { command: "nuinuiCAD.modulePreview.clearSelection", when: `${modulePreviewBlankWhen} && nuinuiCAD.canvasHasSelection` }
    ]);
    const editorContextCommands = (manifest.contributes?.menus?.["editor/context"] ?? []).map(({ command, submenu }) => command ?? submenu);
    expect(editorContextCommands).toEqual([
      "nuinuiCAD.revealInCanvas",
      "nuinuiCAD.openCanvas",
      "nuinuiCAD.revealInOutputPreview",
      "nuinuiCAD.openOutputPreview",
      "nuinuiCAD.openModulePreview",
      "nuinuiCAD.inlineModuleInstance",
      "nuinuiCAD.extractModule",
      "nuinuiCAD.pickReferenceFromCanvas",
      "nuinuiCAD.convertPoint",
      "nuinuiCAD.stepSourceValueForward",
      "nuinuiCAD.stepSourceValueBackward",
      "nuinuiCAD.bakeCurrentShape",
      "nuinuiCAD.bakeBaseShape",
      "nuinuiCAD.replaceGeometryReferences"
    ]);
    expect(editorContextCommands).not.toContain("nuinuiCAD.fitOutputPreview");
    expect(editorContextCommands).not.toContain("nuinuiCAD.resetOutputPreviewView");
    expect(editorContextCommands).not.toContain("nuinuiCAD.clearOutputPreviewFocus");
    const commands = manifest.contributes?.commands ?? [];
    expect(commands.find(({ command }) => command === "nuinuiCAD.revealInCanvas")?.enablement)
      .toBe(`${sourcePaletteWhen} && nuinuiCAD.revealInCanvasSourceTarget`);
    expect(commands.find(({ command }) => command === "nuinuiCAD.openCanvas")?.enablement).toBeUndefined();
    expect(commands.find(({ command }) => command === "nuinuiCAD.revealInOutputPreview")?.enablement)
      .toBe(outputPreviewRevealEnablement);
    expect(commands.find(({ command }) => command === "nuinuiCAD.openOutputPreview")?.enablement).toBeUndefined();
    expect(commands.find(({ command }) => command === "nuinuiCAD.openModulePreview")?.enablement)
      .toBe(`${sourcePaletteWhen} && nuinuiCAD.modulePreviewSourceTarget`);
    expect(manifest.contributes?.menus?.["editor/context"]?.slice(0, 4).every(({ when }) => !when.includes("canReveal")))
      .toBe(true);
    expect(manifest.contributes?.keybindings?.some(({ command }) => command === "nuinuiCAD.revealInOutputPreview")).toBe(false);
    const modulePreviewContextCommands = (manifest.contributes?.menus?.["webview/context"] ?? [])
      .filter(({ when }) => when.includes("nuinuiCAD.modulePreview"))
      .map(({ command }) => command);
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.bakeCurrentShape");
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.bakeBaseShape");
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.goToSourceDefinition");
    expect(manifest.contributes?.menus?.commandPalette ?? []).toContainEqual({
      command: "nuinuiCAD.toggleCanvasElementNames",
      when: "false"
    });
    for (const command of ["nuinuiCAD.outputPreviewUndo", "nuinuiCAD.outputPreviewRedo"] as const) {
      expect(manifest.contributes?.menus?.commandPalette ?? []).toContainEqual({ command, when: "false" });
    }
    for (const menuId of ["webview/context", "editor/context"] as const) {
      const contextCommands = (manifest.contributes?.menus?.[menuId] ?? []).map(({ command }) => command);
      expect(contextCommands).not.toContain("nuinuiCAD.toggleCanvasElementNames");
      expect(contextCommands).not.toContain("nuinuiCAD.outputPreviewUndo");
      expect(contextCommands).not.toContain("nuinuiCAD.outputPreviewRedo");
    }
  });

  it("contributes the Canvas creation search command and full-catalog native submenu", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];
    const keybindings = manifest.contributes?.keybindings ?? [];
    const submenu = manifest.contributes?.menus?.["nuinuiCAD.create"] ?? [];
    const creationCommandIds = vscodeCanvasCreationCommands.map(({ commandId }) => commandId);
    const quickCreateSetting = manifest.contributes?.configuration?.properties?.[VSCODE_CANVAS_QUICK_CREATE_SETTING];
    const quickCreateEnum = (quickCreateSetting?.items as { enum?: unknown[] } | undefined)?.enum;

    expect(manifest.contributes?.submenus).toContainEqual({ id: "nuinuiCAD.create", label: "Create" });
    expect(commands.find(({ command }) => command === "nuinuiCAD.createGeometry")).toEqual({
      command: "nuinuiCAD.createGeometry",
      title: "nuinuiCAD: Create Geometry…"
    });
    expect(commandPalette).toContainEqual({
      command: "nuinuiCAD.createGeometry",
      when: canvasPaletteWhen
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toContainEqual({
      command: "nuinuiCAD.createGeometry",
      when: canvasBlankWhen,
      group: "1_create@0"
    });

    for (const entry of vscodeCanvasCreationCommands) {
      expect(commands.find(({ command }) => command === vscodeCanvasCreationCommandIdFor(entry.commandId))).toMatchObject({
        command: vscodeCanvasCreationCommandIdFor(entry.commandId),
        title: entry.title
      });
      expect(commands.find(({ command }) => command === vscodeCanvasCreationCommandIdFor(entry.commandId)))
        .not.toHaveProperty("enablement");
      expect(commandPalette).toContainEqual({
        command: vscodeCanvasCreationCommandIdFor(entry.commandId),
        when: `${canvasPaletteWhen} && nuinuiCAD.quickCreateConfigured.${entry.commandId}`
      });
      expect(keybindings.some(({ command }) => command === vscodeCanvasCreationCommandIdFor(entry.commandId))).toBe(false);
    }

    const slotEntries = submenu.filter(({ command }) => command !== "nuinuiCAD.configureQuickCreate");
    expect(slotEntries).toHaveLength(VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT * vscodeCanvasCreationCommands.length);
    for (let slot = 1; slot <= VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT; slot += 1) {
      const entries = slotEntries.filter(({ when }) => when.includes(`nuinuiCAD.quickCreateSlot${slot} ==`));
      expect(entries.map(({ command }) => command)).toEqual(
        creationCommandIds.map((commandId) => vscodeCanvasCreationCommandIdFor(commandId))
      );
      expect(entries.every(({ group }) => group === `quickCreate@${slot}`)).toBe(true);
    }
    expect(submenu).toContainEqual({ command: "nuinuiCAD.configureQuickCreate", group: "configuration@100" });

    const createSurfaceEntries = (manifest.contributes?.menus?.["webview/context"] ?? [])
      .filter(({ command, submenu: child }) =>
        command === "nuinuiCAD.createGeometry" || child === "nuinuiCAD.create"
      );
    expect(createSurfaceEntries.every(({ when }) => when === canvasBlankWhen)).toBe(true);
    expect(quickCreateSetting).toMatchObject({
      type: "array",
      scope: "application",
      default: [],
      uniqueItems: true,
    });
    expect(quickCreateSetting).not.toHaveProperty("maxItems");
    expect(quickCreateEnum).toEqual([...creationCommandIds].sort());
  });
});

describe("VS Code extension manifest keybindings", () => {
  it("keeps history chords surface-owned and declares broad writable-Source value-step chords", async () => {
    const manifest = await readManifest();
    const keybindings = manifest.contributes?.keybindings ?? [];

    expect(keybindings).toHaveLength(8);
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.stepSourceValueForward.keybinding",
      key: "ctrl+shift+.",
      mac: "shift+cmd+.",
      when: sourceValueStepKeybindingWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.stepSourceValueBackward.keybinding",
      key: "ctrl+shift+,",
      mac: "shift+cmd+,",
      when: sourceValueStepKeybindingWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.modulePreviewValueStepForward.keybinding",
      key: "ctrl+shift+.",
      mac: "shift+cmd+.",
      when: modulePreviewValueStepKeybindingWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.modulePreviewValueStepBackward.keybinding",
      key: "ctrl+shift+,",
      mac: "shift+cmd+,",
      when: modulePreviewValueStepKeybindingWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.canvasUndo",
      key: "ctrl+z",
      mac: "cmd+z",
      when: canvasHistoryWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.canvasRedo",
      key: "ctrl+y",
      mac: "cmd+shift+z",
      when: canvasHistoryWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.outputPreviewUndo",
      key: "ctrl+z",
      mac: "cmd+z",
      when: outputPreviewHistoryWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.outputPreviewRedo",
      key: "ctrl+y",
      mac: "cmd+shift+z",
      when: outputPreviewHistoryWhen
    });
    expect(keybindings.some(({ key }) => key === "cmd+z")).toBe(false);
    expect(keybindings.some(({ key }) => key === "cmd+shift+z")).toBe(false);
    expect(keybindings.some(({ command }) =>
      command === "nuinuiCAD.toggleCanvasPointNames" || command === "nuinuiCAD.toggleCanvasGeometryNames")).toBe(false);
    expect(keybindings.some(({ command }) =>
      command === "nuinuiCAD.openOutputPreview" ||
      command === "nuinuiCAD.fitOutputPreview" ||
      command === "nuinuiCAD.resetOutputPreviewView")).toBe(false);
    expect(keybindings.some(({ command }) => command === "nuinuiCAD.pickReferenceFromCanvas")).toBe(false);
    expect(keybindings.some(({ command }) => command === "nuinuiCAD.replaceGeometryReferences")).toBe(false);
    expect(keybindings.filter(({ command }) => command.includes("modulePreview"))).toEqual([
      {
        command: "nuinuiCAD.modulePreviewValueStepForward.keybinding",
        key: "ctrl+shift+.",
        mac: "shift+cmd+.",
        when: modulePreviewValueStepKeybindingWhen
      },
      {
        command: "nuinuiCAD.modulePreviewValueStepBackward.keybinding",
        key: "ctrl+shift+,",
        mac: "shift+cmd+,",
        when: modulePreviewValueStepKeybindingWhen
      }
    ]);
    for (const command of ["nuinuiCAD.stepSourceValueForward.keybinding", "nuinuiCAD.stepSourceValueBackward.keybinding"]) {
      const binding = keybindings.find((candidate) => candidate.command === command);
      expect(binding?.when).not.toContain("sourceValueStepTarget");
      expect(manifest.contributes?.commands?.some((candidate) => candidate.command === command)).toBe(false);
      expect(manifest.contributes?.menus?.commandPalette?.some((candidate) => candidate.command === command)).toBe(false);
    }
    expect(keybindings.some(({ command }) =>
      command === "nuinuiCAD.stepSourceValueForward" || command === "nuinuiCAD.stepSourceValueBackward")).toBe(false);
  });
});

describe("VS Code Canvas Ribbon configuration contribution", () => {
  it("declares application scope, the edit-only default, and command/value item schema", async () => {
    const manifest = await readManifest();
    const setting = manifest.contributes?.configuration?.properties?.["nuinuiCAD.canvasRibbon.ribbons"];
    expect(setting).toMatchObject({
      type: "array",
      scope: "application",
      default: [{
        id: "canvas-ribbon",
        x: null,
        y: 12,
        orientation: "horizontal",
        items: [{ commandId: "editCanvasRibbon", type: "command" }]
      }]
    });
    expect(setting?.items).toMatchObject({
      oneOf: [expect.objectContaining({
        required: expect.arrayContaining(["id", "items"]),
        properties: expect.objectContaining({ items: expect.anything() })
      })]
    });
    const ribbonSchema = (setting?.items as SchemaNode | undefined)?.oneOf?.[0];
    const itemSchema = ribbonSchema?.properties?.items?.items;
    const commandSchema = itemSchema?.oneOf?.find((schema) => schema.properties?.type?.const === "command");
    const valueSchema = itemSchema?.oneOf?.find((schema) => schema.properties?.type?.const === "value");
    expect(ribbonSchema?.required).not.toContain("iconSize");
    expect(ribbonSchema?.properties?.iconSize).toBeUndefined();
    expect(commandSchema?.properties?.iconColor).toBeUndefined();
    expect(commandSchema?.properties?.label).toBeUndefined();
    expect(commandSchema?.properties?.commandId).toBeDefined();
    expect(valueSchema?.properties?.valueId).toEqual({ const: "canvasZoom" });
    expect(valueSchema?.properties?.label).toBeUndefined();
  });
});
