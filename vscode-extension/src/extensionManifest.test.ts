import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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
      "nuinuiCAD.webview.canvasDisplay"?: CommandPaletteMenu[];
      "nuinuiCAD.webview.modulePreviewDisplay"?: CommandPaletteMenu[];
      "nuinuiCAD.webview.convertPoint"?: CommandPaletteMenu[];
      "nuinuiCAD.webview.bake"?: CommandPaletteMenu[];
      "view/item/context"?: CommandPaletteMenu[];
      "view/title"?: CommandPaletteMenu[];
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
const architecturePath = resolve(process.cwd(), "ARCHITECTURE.md");
const packageNlsPath = resolve(process.cwd(), "vscode-extension/package.nls.json");
const packageNlsJaPath = resolve(process.cwd(), "vscode-extension/package.nls.ja.json");
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
  "nuinuiCAD.createFreePointAtPointer"
] as const;
const webviewContextAliasIds = [
  "nuinuiCAD.webview.createFreePointAtPointer",
  "nuinuiCAD.webview.fitDrawing",
  "nuinuiCAD.webview.resetCanvasView",
  "nuinuiCAD.webview.showCanvasPointNames",
  "nuinuiCAD.webview.hideCanvasPointNames",
  "nuinuiCAD.webview.showCanvasGeometryNames",
  "nuinuiCAD.webview.hideCanvasGeometryNames",
  "nuinuiCAD.webview.showCanvasPoints",
  "nuinuiCAD.webview.hideCanvasPoints",
  "nuinuiCAD.webview.editCanvasRibbon",
  "nuinuiCAD.webview.clearCanvasSelection",
  "nuinuiCAD.webview.convertPointToXYOffset",
  "nuinuiCAD.webview.convertPointToAngleDistanceOffset",
  "nuinuiCAD.webview.selectParentGroup",
  "nuinuiCAD.webview.selectInstance",
  "nuinuiCAD.webview.goToSourceDefinition",
  "nuinuiCAD.webview.inlineModuleInstance",
  "nuinuiCAD.webview.extractModule",
  "nuinuiCAD.webview.bakeCurrentShape",
  "nuinuiCAD.webview.bakeBaseShape",
  "nuinuiCAD.webview.modulePreview.fitDrawing",
  "nuinuiCAD.webview.modulePreview.resetView",
  "nuinuiCAD.webview.modulePreview.showPointNames",
  "nuinuiCAD.webview.modulePreview.hidePointNames",
  "nuinuiCAD.webview.modulePreview.showGeometryNames",
  "nuinuiCAD.webview.modulePreview.hideGeometryNames",
  "nuinuiCAD.webview.modulePreview.showPoints",
  "nuinuiCAD.webview.modulePreview.hidePoints",
  "nuinuiCAD.webview.modulePreview.clearSelection",
  "nuinuiCAD.webview.resetOutputPreviewView",
  "nuinuiCAD.webview.fitOutputPreview",
  "nuinuiCAD.webview.clearOutputPreviewFocus"
] as const;
const canonicalCommandShortTitles: Partial<Record<(typeof commandIds)[number], string>> = {
  "nuinuiCAD.openCanvas": "Open Canvas",
  "nuinuiCAD.openOutputPreview": "Open Output Preview",
  "nuinuiCAD.openModulePreview": "Open Module Preview",
  "nuinuiCAD.convertPointToXYOffset": "XY Offset…",
  "nuinuiCAD.convertPointToAngleDistanceOffset": "Angle-Distance Offset…",
  "nuinuiCAD.createFreePointAtPointer": "Create Free Point at Pointer"
};
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
const canvasHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas' || activeWebviewPanelId == 'nuinuiCAD.modulePreview' || (editorTextFocus && nuinuiCAD.canvasHistoryHandoff)";
const outputPreviewHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.outputPreview'";
const canvasBlankWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'blank'";
const canvasElementWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasHasSelection";
const canvasOrModulePreviewElementWhen = "(webviewId == 'nuinuiCAD.canvas' || webviewId == 'nuinuiCAD.modulePreview') && webviewSection == 'element' && nuinuiCAD.canvasHasSelection";
const canvasOrModulePreviewRibbonWhen = "(webviewId == 'nuinuiCAD.canvas' || webviewId == 'nuinuiCAD.modulePreview') && (webviewSection == 'blank' || webviewSection == 'ribbon')";
const modulePreviewBlankWhen = "webviewId == 'nuinuiCAD.modulePreview' && webviewSection == 'blank'";

async function readManifest(): Promise<ExtensionManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;
}

const nlsKeysReferencedBy = (value: unknown): string[] => {
  const keys: string[] = [];
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(/%([^%]+)%/g)) keys.push(match[1]!);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate && typeof candidate === "object") {
      Object.values(candidate).forEach(visit);
    }
  };
  visit(value);
  return [...new Set(keys)].sort();
};

const resolveNlsToken = (value: string, locale: Record<string, unknown>): string => value.replace(
  /%([^%]+)%/g,
  (_, key: string) => {
    const localized = locale[key];
    if (typeof localized !== "string") throw new Error(`Missing NLS key: ${key}`);
    return localized;
  }
);

describe("VS Code extension manifest command contributions", () => {
  it("provides English and Japanese package NLS entries for every manifest token and localizes command contributions", async () => {
    const rawManifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const english = JSON.parse(await readFile(packageNlsPath, "utf8")) as Record<string, unknown>;
    const japanese = JSON.parse(await readFile(packageNlsJaPath, "utf8")) as Record<string, unknown>;
    const referencedKeys = nlsKeysReferencedBy(rawManifest);

    expect(referencedKeys.length).toBeGreaterThan(0);
    for (const key of referencedKeys) {
      expect(typeof english[key], key).toBe("string");
      expect(typeof japanese[key], key).toBe("string");
    }

    const manifest = rawManifest as { contributes?: { commands?: Command[] } };
    const commands = (manifest.contributes?.commands ?? []).filter(({ command }) =>
      commandIds.some((id) => id === command)
    );
    expect(commands.every(({ command, title, shortTitle }) => {
      const suffix = command.replace(/^nuinuiCAD\./, "");
      return title === `%command.${suffix}.title%`
        && (shortTitle === undefined || shortTitle === `%command.${suffix}.shortTitle%`);
    })).toBe(true);
    for (const command of commands) {
      expect(typeof english[command.title.slice(1, -1)]).toBe("string");
      expect(typeof japanese[command.title.slice(1, -1)]).toBe("string");
      if (command.shortTitle !== undefined) {
        expect(typeof english[command.shortTitle.slice(1, -1)]).toBe("string");
        expect(typeof japanese[command.shortTitle.slice(1, -1)]).toBe("string");
      }
    }
  });

  it("localizes Japanese command titles while retaining the English canonical labels", async () => {
    const rawManifest = JSON.parse(await readFile(manifestPath, "utf8")) as { contributes?: { commands?: Command[] } };
    const english = JSON.parse(await readFile(packageNlsPath, "utf8")) as Record<string, unknown>;
    const japanese = JSON.parse(await readFile(packageNlsJaPath, "utf8")) as Record<string, unknown>;
    const commands = (rawManifest.contributes?.commands ?? []).filter(({ command }) =>
      commandIds.some((id) => id === command)
    );

    for (const command of commands) {
      const titleKey = command.title.slice(1, -1);
      expect(japanese[titleKey]).not.toBe(english[titleKey]);
      expect(japanese[titleKey]).toMatch(/^nuinuiCAD: /);
      if (command.shortTitle !== undefined) {
        const shortTitleKey = command.shortTitle.slice(1, -1);
        expect(japanese[shortTitleKey]).not.toBe(english[shortTitleKey]);
      }
    }
  });

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
    const english = JSON.parse(await readFile(packageNlsPath, "utf8")) as Record<string, unknown>;
    const commands = (manifest.contributes?.commands ?? []).filter(({ command }) =>
      commandIds.some((id) => id === command)
    );

    expect(commands.map(({ command }) => command)).toEqual(commandIds);
    expect(commands.map(({ title }) => resolveNlsToken(title, english))).toEqual([
      "nuinuiCAD: Open Canvas",
      "nuinuiCAD: Open Output Preview",
      "nuinuiCAD: Open Module Preview",
      "nuinuiCAD: Inline Module Instance",
      "nuinuiCAD: Extract Module",
      "nuinuiCAD: Go to Source Definition",
      "nuinuiCAD: Reveal in Canvas",
      "nuinuiCAD: Reveal in Output Preview",
      "nuinuiCAD: Pick from Canvas",
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
      "nuinuiCAD: Reset Output Preview Pan and Zoom",
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
      "nuinuiCAD: Create Free Point at Pointer"
    ]);
    expect(commands.map(({ command, shortTitle }) => ({
      command,
      shortTitle: shortTitle === undefined ? undefined : resolveNlsToken(shortTitle, english)
    }))).toEqual(commandIds.map((command) => ({ command, shortTitle: canonicalCommandShortTitles[command] })));
  });

  it("registers the exact hidden Webview aliases with short localized labels", async () => {
    const manifest = await readManifest();
    const english = JSON.parse(await readFile(packageNlsPath, "utf8")) as Record<string, unknown>;
    const japanese = JSON.parse(await readFile(packageNlsJaPath, "utf8")) as Record<string, unknown>;
    const commands = manifest.contributes?.commands ?? [];
    const aliases = commands.filter(({ command }) => webviewContextAliasIds.some((id) => id === command));
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];
    const keybindings = manifest.contributes?.keybindings ?? [];

    expect(aliases.map(({ command }) => command)).toEqual(webviewContextAliasIds);
    expect(aliases.every(({ title, shortTitle, enablement }) =>
      title.startsWith("%command.webview.") && title.endsWith(".title%")
      && shortTitle === undefined
      && enablement === undefined
    )).toBe(true);
    expect(aliases.map(({ title }) => resolveNlsToken(title, english))).toEqual([
      "Create Free Point at Pointer",
      "Fit Drawing",
      "Reset View",
      "Show Point Names",
      "Hide Point Names",
      "Show Geometry Names",
      "Hide Geometry Names",
      "Show Points",
      "Hide Points",
      "Edit Ribbon",
      "Clear Selection",
      "XY Offset…",
      "Angle-Distance Offset…",
      "Select Parent Group",
      "Select Instance",
      "Go to Source Definition",
      "Inline Module Instance",
      "Extract Module",
      "Current Shape",
      "Base Shape",
      "Fit Drawing",
      "Reset View",
      "Show Point Names",
      "Hide Point Names",
      "Show Geometry Names",
      "Hide Geometry Names",
      "Show Points",
      "Hide Points",
      "Clear Selection",
      "Reset View",
      "Fit Preview",
      "Clear Focus"
    ]);
    expect(aliases.map(({ title }) => resolveNlsToken(title, japanese))).toEqual([
      "ポインター位置に自由点を作成",
      "図面をフィット",
      "表示をリセット",
      "点名を表示",
      "点名を非表示",
      "ジオメトリ名を表示",
      "ジオメトリ名を非表示",
      "点を表示",
      "点を非表示",
      "リボンを編集",
      "選択を解除",
      "XYオフセット…",
      "角度と距離のオフセット…",
      "親グループを選択",
      "インスタンスを選択",
      "ソース定義へ移動",
      "Module instanceをインライン化",
      "Moduleを抽出",
      "現在の形状",
      "ベース形状",
      "図面をフィット",
      "表示をリセット",
      "点名を表示",
      "点名を非表示",
      "ジオメトリ名を表示",
      "ジオメトリ名を非表示",
      "点を表示",
      "点を非表示",
      "選択を解除",
      "表示をリセット",
      "プレビューをフィット",
      "フォーカスを解除"
    ]);
    expect(commandPalette.filter(({ command }) => webviewContextAliasIds.some((id) => id === command))).toEqual(
      webviewContextAliasIds.map((command) => ({ command, when: "false" }))
    );
    expect(keybindings.filter(({ command }) => webviewContextAliasIds.some((id) => id === command))).toEqual([]);
  });

  it("keeps Reset Output Preview Pan and Zoom canonical while using its Webview alias", async () => {
    const manifest = await readManifest();
    const command = manifest.contributes?.commands?.find(({ command }) => command === "nuinuiCAD.resetOutputPreviewView");
    expect(command).toEqual({
      command: "nuinuiCAD.resetOutputPreviewView",
      title: "%command.resetOutputPreviewView.title%"
    });
    expect(manifest.contributes?.menus?.commandPalette).toContainEqual({
      command: "nuinuiCAD.resetOutputPreviewView",
      when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'"
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toContainEqual({
      command: "nuinuiCAD.webview.resetOutputPreviewView",
      when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'",
      group: "2_view@1"
    });
    expect(manifest.contributes?.keybindings?.some(({ command: id }) => id === "nuinuiCAD.resetOutputPreviewView")).toBe(false);
  });

  it("uses the fixed short title for the Canvas free-point context menu", async () => {
    const manifest = await readManifest();
    const command = manifest.contributes?.commands?.find(({ command }) => command === "nuinuiCAD.createFreePointAtPointer");

    expect(command?.shortTitle).toBe("%command.createFreePointAtPointer.shortTitle%");
  });

  it("keeps the public Convert titles while using native submenu short titles", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];
    const keybindings = manifest.contributes?.keybindings ?? [];
    const conversionCommands = [
      {
        id: "nuinuiCAD.convertPointToXYOffset",
        title: "%command.convertPointToXYOffset.title%",
        shortTitle: "%command.convertPointToXYOffset.shortTitle%"
      },
      {
        id: "nuinuiCAD.convertPointToAngleDistanceOffset",
        title: "%command.convertPointToAngleDistanceOffset.title%",
        shortTitle: "%command.convertPointToAngleDistanceOffset.shortTitle%"
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
      group: "2_nuinuiCAD@7"
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toContainEqual({
      submenu: "nuinuiCAD.webview.convertPoint",
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
    expect(manifest.contributes?.menus?.["nuinuiCAD.convertPoint"]).toEqual([
      {
        command: "nuinuiCAD.convertPointToXYOffset",
        when: coordinatePointConversionSourceContextWhen
      },
      {
        command: "nuinuiCAD.convertPointToAngleDistanceOffset",
        when: coordinatePointConversionSourceContextWhen
      },
      {
        command: "nuinuiCAD.convertPointToXYOffset",
        when: coordinatePointConversionExplorerContextWhen
      },
      {
        command: "nuinuiCAD.convertPointToAngleDistanceOffset",
        when: coordinatePointConversionExplorerContextWhen
      }
    ]);
    expect(manifest.contributes?.menus?.["nuinuiCAD.webview.convertPoint"]).toEqual([
      {
        command: "nuinuiCAD.webview.convertPointToXYOffset",
        when: coordinatePointConversionCanvasContextWhen
      },
      {
        command: "nuinuiCAD.webview.convertPointToAngleDistanceOffset",
        when: coordinatePointConversionCanvasContextWhen
      }
    ]);
  });

  it("scopes open commands without making Module Preview Palette visibility caret-dependent", async () => {
    const manifest = await readManifest();
    const commandPalette = (manifest.contributes?.menus?.commandPalette ?? []).filter(({ command }) =>
      command !== undefined && commandIds.some((id) => id === command)
    );

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
      { command: "nuinuiCAD.createGeometry", when: sourcePaletteWhen },
      { command: "nuinuiCAD.createFreePointAtPointer", when: canvasPaletteWhen }
    ]);
    expect(commandPalette.find(({ command }) => command === "nuinuiCAD.openModulePreview")?.when)
      .not.toContain("modulePreviewSourceTarget");
  });

  it("keeps independent Reveal/Open fallback slots in the consolidated Source hierarchy", async () => {
    const manifest = await readManifest();
    expect(manifest.contributes?.menus?.["editor/context"]).toEqual([
      { command: "nuinuiCAD.revealInCanvas", when: canvasRevealContextWhen, group: "2_nuinuiCAD@1" },
      { command: "nuinuiCAD.openCanvas", when: canvasOpenFallbackContextWhen, group: "2_nuinuiCAD@1" },
      { command: "nuinuiCAD.revealInOutputPreview", when: outputPreviewRevealContextWhen, group: "2_nuinuiCAD@2" },
      { command: "nuinuiCAD.openOutputPreview", when: outputPreviewOpenFallbackContextWhen, group: "2_nuinuiCAD@2" },
      { command: "nuinuiCAD.openModulePreview", when: modulePreviewContextWhen, group: "2_nuinuiCAD@3" },
      { command: "nuinuiCAD.inlineModuleInstance", when: inlineModuleSourceContextWhen, group: "2_nuinuiCAD@4" },
      { command: "nuinuiCAD.extractModule", when: extractModuleSourceContextWhen, group: "2_nuinuiCAD@5" },
      { command: "nuinuiCAD.pickReferenceFromCanvas", when: referencePickContextWhen, group: "2_nuinuiCAD@6" },
      { submenu: "nuinuiCAD.convertPoint", when: coordinatePointConversionSourceContextWhen, group: "2_nuinuiCAD@7" },
      { command: "nuinuiCAD.replaceGeometryReferences", when: geometryReferenceRetargetContextWhen, group: "2_nuinuiCAD@8" },
      { command: "nuinuiCAD.stepSourceValueForward", when: sourceValueStepContextWhen, group: "2_nuinuiCAD@9" },
      { command: "nuinuiCAD.stepSourceValueBackward", when: sourceValueStepContextWhen, group: "2_nuinuiCAD@10" },
      { command: "nuinuiCAD.bakeCurrentShape", when: bakeSourceContextWhen, group: "2_nuinuiCAD@11" },
      { command: "nuinuiCAD.bakeBaseShape", when: bakeSourceContextWhen, group: "2_nuinuiCAD@12" }
    ]);
    expect(manifest.contributes?.submenus).toEqual([
      { id: "nuinuiCAD.convertPoint", label: "%submenu.convert%" },
      { id: "nuinuiCAD.webview.canvasDisplay", label: "%submenu.webview.display%" },
      { id: "nuinuiCAD.webview.modulePreviewDisplay", label: "%submenu.webview.display%" },
      { id: "nuinuiCAD.webview.convertPoint", label: "%submenu.webview.convertPoint%" },
      { id: "nuinuiCAD.webview.bake", label: "%submenu.webview.bake%" }
    ]);
    expect(manifest.contributes?.menus?.["webview/context"]).toEqual([
      { command: "nuinuiCAD.webview.createFreePointAtPointer", when: canvasBlankWhen, group: "1_create@0" },
      { command: "nuinuiCAD.webview.fitDrawing", when: canvasBlankWhen, group: "2_view@1" },
      { command: "nuinuiCAD.webview.resetCanvasView", when: canvasBlankWhen, group: "2_view@2" },
      { submenu: "nuinuiCAD.webview.canvasDisplay", when: canvasBlankWhen, group: "2_view@3" },
      { command: "nuinuiCAD.webview.editCanvasRibbon", when: canvasOrModulePreviewRibbonWhen, group: "3_edit@1" },
      { command: "nuinuiCAD.webview.clearCanvasSelection", when: `${canvasBlankWhen} && nuinuiCAD.canvasHasSelection`, group: "4_selection@1" },
      { submenu: "nuinuiCAD.webview.convertPoint", when: coordinatePointConversionCanvasContextWhen, group: "1_modification@1" },
      { command: "nuinuiCAD.webview.selectParentGroup", when: canvasElementWhen, group: "1_modification@2" },
      { command: "nuinuiCAD.webview.selectInstance", when: "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasCanSelectInstance", group: "1_modification@3" },
      { command: "nuinuiCAD.webview.goToSourceDefinition", when: canvasElementWhen, group: "1_modification@4" },
      { command: "nuinuiCAD.webview.inlineModuleInstance", when: inlineModuleCanvasContextWhen, group: "1_modification@7" },
      { command: "nuinuiCAD.webview.extractModule", when: extractModuleCanvasContextWhen, group: "1_modification@8" },
      { submenu: "nuinuiCAD.webview.bake", when: canvasOrModulePreviewElementWhen, group: "1_modification@9" },
      { command: "nuinuiCAD.webview.resetOutputPreviewView", when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'", group: "2_view@1" },
      { command: "nuinuiCAD.webview.fitOutputPreview", when: "webviewId == 'nuinuiCAD.outputPreview' && webviewSection == 'blank'", group: "2_view@2" },
      { command: "nuinuiCAD.webview.clearOutputPreviewFocus", when: "webviewId == 'nuinuiCAD.outputPreview' && (webviewSection == 'blank' || webviewSection == 'place')", group: "4_selection@1" },
      { command: "nuinuiCAD.webview.modulePreview.fitDrawing", when: modulePreviewBlankWhen, group: "2_view@1" },
      { command: "nuinuiCAD.webview.modulePreview.resetView", when: modulePreviewBlankWhen, group: "2_view@2" },
      { submenu: "nuinuiCAD.webview.modulePreviewDisplay", when: modulePreviewBlankWhen, group: "2_view@3" },
      { command: "nuinuiCAD.webview.modulePreview.clearSelection", when: `${modulePreviewBlankWhen} && nuinuiCAD.canvasHasSelection`, group: "4_selection@1" }
    ]);
    expect(manifest.contributes?.menus?.["nuinuiCAD.webview.canvasDisplay"]).toEqual([
      { command: "nuinuiCAD.webview.showCanvasPointNames", when: `${canvasBlankWhen} && !nuinuiCAD.showCanvasPointNames`, group: "1_display@1" },
      { command: "nuinuiCAD.webview.hideCanvasPointNames", when: `${canvasBlankWhen} && nuinuiCAD.showCanvasPointNames`, group: "1_display@1" },
      { command: "nuinuiCAD.webview.showCanvasGeometryNames", when: `${canvasBlankWhen} && !nuinuiCAD.showCanvasGeometryNames`, group: "1_display@2" },
      { command: "nuinuiCAD.webview.hideCanvasGeometryNames", when: `${canvasBlankWhen} && nuinuiCAD.showCanvasGeometryNames`, group: "1_display@2" },
      { command: "nuinuiCAD.webview.showCanvasPoints", when: `${canvasBlankWhen} && !nuinuiCAD.showCanvasPoints`, group: "1_display@3" },
      { command: "nuinuiCAD.webview.hideCanvasPoints", when: `${canvasBlankWhen} && nuinuiCAD.showCanvasPoints`, group: "1_display@3" }
    ]);
    expect(manifest.contributes?.menus?.["nuinuiCAD.webview.modulePreviewDisplay"]).toEqual([
      { command: "nuinuiCAD.webview.modulePreview.showPointNames", when: `${modulePreviewBlankWhen} && !nuinuiCAD.showCanvasPointNames`, group: "1_display@1" },
      { command: "nuinuiCAD.webview.modulePreview.hidePointNames", when: `${modulePreviewBlankWhen} && nuinuiCAD.showCanvasPointNames`, group: "1_display@1" },
      { command: "nuinuiCAD.webview.modulePreview.showGeometryNames", when: `${modulePreviewBlankWhen} && !nuinuiCAD.showCanvasGeometryNames`, group: "1_display@2" },
      { command: "nuinuiCAD.webview.modulePreview.hideGeometryNames", when: `${modulePreviewBlankWhen} && nuinuiCAD.showCanvasGeometryNames`, group: "1_display@2" },
      { command: "nuinuiCAD.webview.modulePreview.showPoints", when: `${modulePreviewBlankWhen} && !nuinuiCAD.showCanvasPoints`, group: "1_display@3" },
      { command: "nuinuiCAD.webview.modulePreview.hidePoints", when: `${modulePreviewBlankWhen} && nuinuiCAD.showCanvasPoints`, group: "1_display@3" }
    ]);
    expect(manifest.contributes?.menus?.["nuinuiCAD.webview.convertPoint"]).toEqual([
      { command: "nuinuiCAD.webview.convertPointToXYOffset", when: coordinatePointConversionCanvasContextWhen },
      { command: "nuinuiCAD.webview.convertPointToAngleDistanceOffset", when: coordinatePointConversionCanvasContextWhen }
    ]);
    expect(manifest.contributes?.menus?.["nuinuiCAD.webview.bake"]).toEqual([
      { command: "nuinuiCAD.webview.bakeCurrentShape", when: canvasOrModulePreviewElementWhen },
      { command: "nuinuiCAD.webview.bakeBaseShape", when: canvasOrModulePreviewElementWhen }
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
      "nuinuiCAD.replaceGeometryReferences",
      "nuinuiCAD.stepSourceValueForward",
      "nuinuiCAD.stepSourceValueBackward",
      "nuinuiCAD.bakeCurrentShape",
      "nuinuiCAD.bakeBaseShape"
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
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.webview.bakeCurrentShape");
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.webview.bakeBaseShape");
    expect(modulePreviewContextCommands).not.toContain("nuinuiCAD.webview.goToSourceDefinition");
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

  it("cuts Create Geometry to Source and removes configured Canvas Quick Create", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];
    const webviewContext = manifest.contributes?.menus?.["webview/context"] ?? [];
    expect(commands.filter(({ command }) => command === "nuinuiCAD.createGeometry")).toEqual([{
      command: "nuinuiCAD.createGeometry",
      title: "%command.createGeometry.title%"
    }]);
    expect(commandPalette.filter(({ command }) => command === "nuinuiCAD.createGeometry")).toEqual([{
      command: "nuinuiCAD.createGeometry",
      when: sourcePaletteWhen
    }]);
    expect(commandPalette.some(({ command, when }) => command === "nuinuiCAD.createGeometry" && when === canvasPaletteWhen)).toBe(false);
    expect(webviewContext.some(({ command, submenu }) => command === "nuinuiCAD.createGeometry" || submenu === "nuinuiCAD.create")).toBe(false);
    expect(commands.some(({ command }) => command === "nuinuiCAD.configureQuickCreate" || (command ?? "").startsWith("nuinuiCAD.create."))).toBe(false);
    expect(commandPalette.some(({ command }) => command === "nuinuiCAD.configureQuickCreate" || (command ?? "").startsWith("nuinuiCAD.create."))).toBe(false);
    expect(manifest.contributes?.submenus?.some(({ id }) => id === "nuinuiCAD.create")).toBe(false);
    expect(manifest.contributes?.menus?.["nuinuiCAD.create"]).toBeUndefined();
    expect(manifest.contributes?.configuration?.properties?.["nuinuiCAD.canvasQuickCreate.commands"]).toBeUndefined();
    expect(commands.filter(({ command }) => command === "nuinuiCAD.createFreePointAtPointer")).toHaveLength(1);
    expect(webviewContext).toContainEqual({ command: "nuinuiCAD.webview.createFreePointAtPointer", when: canvasBlankWhen, group: "1_create@0" });
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
    expect(keybindings.some(({ command }) =>
      command === "nuinuiCAD.modulePreviewUndo" || command === "nuinuiCAD.modulePreviewRedo")).toBe(false);
  });
});

describe("Module Preview architecture documentation", () => {
  it("documents authored point/Bezier source commits and keeps Bake outside Slice A", async () => {
    const architecture = await readFile(architecturePath, "utf8");

    expect(architecture).toContain("Shared DrawingCanvas point and");
    expect(architecture).toContain("Bezier gestures use Preview-only ephemeral runtime transforms.");
    expect(architecture).toContain("source-preserving statement `LineSplice`s through the existing");
    expect(architecture).toContain("Native VS Code Undo/Redo remains canonical history");
    expect(architecture).toContain("Module Preview Bake Current/Base uses the authored current `StatementMap`");
    expect(architecture).not.toContain("Bake Current/Base remains outside Slice A");
    expect(architecture).not.toContain("surface is read-only for authored source: source-writing Canvas gestures are not");
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
