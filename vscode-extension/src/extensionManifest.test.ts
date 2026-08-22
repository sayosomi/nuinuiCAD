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
};

type CommandPaletteMenu = {
  command: string;
  when: string;
};

type ExtensionManifest = {
  contributes?: {
    configuration?: {
      properties?: Record<string, {
        scope?: string;
        type?: string;
        default?: unknown;
        items?: unknown;
      }>;
    };
    commands?: Command[];
    keybindings?: Keybinding[];
    menus?: {
      commandPalette?: CommandPaletteMenu[];
      "webview/context"?: CommandPaletteMenu[];
      "editor/context"?: CommandPaletteMenu[];
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
  "nuinuiCAD.goToSourceDefinition",
  "nuinuiCAD.revealInCanvas",
  "nuinuiCAD.canvasUndo",
  "nuinuiCAD.canvasRedo",
  "nuinuiCAD.outputPreviewUndo",
  "nuinuiCAD.outputPreviewRedo",
  "nuinuiCAD.clearCanvasSelection",
  "nuinuiCAD.resetCanvasView",
  "nuinuiCAD.fitDrawing",
  "nuinuiCAD.fitOutputPreview",
  "nuinuiCAD.toggleCanvasPointNames",
  "nuinuiCAD.toggleCanvasGeometryNames",
  "nuinuiCAD.toggleCanvasElementNames",
  "nuinuiCAD.toggleCanvasPoints",
  "nuinuiCAD.bakeCurrentShape",
  "nuinuiCAD.bakeBaseShape",
  "nuinuiCAD.editCanvasRibbon"
] as const;
const sourcePaletteWhen = "editorLangId == nui && resourceScheme == file && resourceExtname == .nui";
const sourceOrCanvasPaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.canvas'";
const sourceOrOutputPreviewPaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.outputPreview'";
const canvasPaletteWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas'";
const bakePaletteWhen = "(editorLangId == nui && resourceScheme == file && resourceExtname == .nui) || activeWebviewPanelId == 'nuinuiCAD.canvas'";
const canvasHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas' || (editorTextFocus && nuinuiCAD.canvasHistoryHandoff)";
const outputPreviewHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.outputPreview'";
const canvasBlankWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'blank'";
const canvasElementWhen = "webviewId == 'nuinuiCAD.canvas' && webviewSection == 'element' && nuinuiCAD.canvasHasSelection";
const canvasRibbonWhen = "webviewId == 'nuinuiCAD.canvas' && (webviewSection == 'blank' || webviewSection == 'ribbon')";

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
      "nuinuiCAD.bake.includeDisabledGeometry": { type: "boolean", default: false }
    });
  });

  it("registers the current command set", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];

    expect(commands.map(({ command }) => command)).toEqual(commandIds);
    expect(commands.map(({ title }) => title)).toEqual([
      "nuinuiCAD: Open Canvas",
      "nuinuiCAD: Open Output Preview",
      "nuinuiCAD: Go to Source Definition",
      "nuinuiCAD: Reveal in Canvas",
      "nuinuiCAD: Undo Canvas Transition",
      "nuinuiCAD: Redo Canvas Transition",
      "nuinuiCAD: Undo Output Preview Source Edit",
      "nuinuiCAD: Redo Output Preview Source Edit",
      "nuinuiCAD: Clear Canvas Selection",
      "nuinuiCAD: Reset Canvas View",
      "nuinuiCAD: Fit Drawing",
      "nuinuiCAD: Fit Output Preview",
      "nuinuiCAD: Toggle Point Names",
      "nuinuiCAD: Toggle Geometry Names",
      "nuinuiCAD: Toggle Canvas Element Names (Legacy)",
      "nuinuiCAD: Toggle Canvas Points",
      "nuinuiCAD: Bake Current Shape",
      "nuinuiCAD: Bake Base Shape",
      "nuinuiCAD: Edit Canvas Ribbon"
    ]);
  });

  it("scopes the cross-surface open commands to their exact surfaces", async () => {
    const manifest = await readManifest();
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];

    expect(commandPalette).toEqual([
      { command: "nuinuiCAD.openCanvas", when: sourceOrOutputPreviewPaletteWhen },
      { command: "nuinuiCAD.openOutputPreview", when: sourceOrCanvasPaletteWhen },
      { command: "nuinuiCAD.editCanvasRibbon", when: "true" },
      { command: "nuinuiCAD.goToSourceDefinition", when: canvasPaletteWhen },
      { command: "nuinuiCAD.revealInCanvas", when: sourcePaletteWhen },
      { command: "nuinuiCAD.clearCanvasSelection", when: canvasPaletteWhen },
      { command: "nuinuiCAD.resetCanvasView", when: canvasPaletteWhen },
      { command: "nuinuiCAD.fitDrawing", when: canvasPaletteWhen },
      { command: "nuinuiCAD.fitOutputPreview", when: "activeWebviewPanelId == 'nuinuiCAD.outputPreview'" },
      { command: "nuinuiCAD.toggleCanvasPointNames", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasGeometryNames", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasElementNames", when: "false" },
      { command: "nuinuiCAD.toggleCanvasPoints", when: canvasPaletteWhen },
      { command: "nuinuiCAD.bakeCurrentShape", when: bakePaletteWhen },
      { command: "nuinuiCAD.bakeBaseShape", when: bakePaletteWhen },
      { command: "nuinuiCAD.canvasUndo", when: "false" },
      { command: "nuinuiCAD.canvasRedo", when: "false" },
      { command: "nuinuiCAD.outputPreviewUndo", when: "false" },
      { command: "nuinuiCAD.outputPreviewRedo", when: "false" }
    ]);
  });

  it("adds the exact Source and Canvas context menu conditions", async () => {
    const manifest = await readManifest();
    expect(manifest.contributes?.menus).toMatchObject({
      "editor/context": [{ command: "nuinuiCAD.revealInCanvas", when: sourcePaletteWhen }]
    });
    expect(manifest.contributes?.menus?.["webview/context"]).toEqual([
      { command: "nuinuiCAD.fitDrawing", when: canvasBlankWhen },
      { command: "nuinuiCAD.resetCanvasView", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasPointNames", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasGeometryNames", when: canvasBlankWhen },
      { command: "nuinuiCAD.toggleCanvasPoints", when: canvasBlankWhen },
      { command: "nuinuiCAD.editCanvasRibbon", when: canvasRibbonWhen },
      { command: "nuinuiCAD.clearCanvasSelection", when: `${canvasBlankWhen} && nuinuiCAD.canvasHasSelection` },
      { command: "nuinuiCAD.goToSourceDefinition", when: canvasElementWhen },
      { command: "nuinuiCAD.bakeCurrentShape", when: canvasElementWhen },
      { command: "nuinuiCAD.bakeBaseShape", when: canvasElementWhen }
    ]);
    for (const menuId of ["webview/context", "editor/context"] as const) {
      const contextCommands = (manifest.contributes?.menus?.[menuId] ?? []).map(({ command }) => command);
      expect(contextCommands).not.toContain("nuinuiCAD.openOutputPreview");
      expect(contextCommands).not.toContain("nuinuiCAD.fitOutputPreview");
    }
    expect(manifest.contributes?.menus?.commandPalette?.some(({ command }) =>
      command === "nuinuiCAD.toggleCanvasElementNames")).toBe(true);
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
});

describe("VS Code extension manifest keybindings", () => {
  it("uses platform-standard history chords for Canvas and Output Preview", async () => {
    const manifest = await readManifest();
    const keybindings = manifest.contributes?.keybindings ?? [];

    expect(keybindings).toHaveLength(4);
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
      command === "nuinuiCAD.openOutputPreview" || command === "nuinuiCAD.fitOutputPreview")).toBe(false);
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
