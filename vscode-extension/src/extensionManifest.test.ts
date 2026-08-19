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
    commands?: Command[];
    keybindings?: Keybinding[];
    menus?: {
      commandPalette?: CommandPaletteMenu[];
    };
  };
};

const manifestPath = resolve(process.cwd(), "vscode-extension/package.json");
const commandIds = [
  "nuinuiCAD.openCanvas",
  "nuinuiCAD.canvasUndo",
  "nuinuiCAD.canvasRedo",
  "nuinuiCAD.clearCanvasSelection",
  "nuinuiCAD.resetCanvasView",
  "nuinuiCAD.fitDrawing",
  "nuinuiCAD.toggleCanvasElementNames",
  "nuinuiCAD.toggleCanvasPoints"
] as const;
const sourcePaletteWhen = "editorLangId == nui && resourceScheme == file && resourceExtname == .nui";
const canvasPaletteWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas'";
const canvasHistoryWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas' || (editorTextFocus && nuinuiCAD.canvasHistoryHandoff)";

async function readManifest(): Promise<ExtensionManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ExtensionManifest;
}

describe("VS Code extension manifest command contributions", () => {
  it("keeps the current eight command registrations", async () => {
    const manifest = await readManifest();
    const commands = manifest.contributes?.commands ?? [];

    expect(commands.map(({ command }) => command)).toEqual(commandIds);
    expect(commands.map(({ title }) => title)).toEqual([
      "nuinuiCAD: Open Canvas",
      "nuinuiCAD: Undo Canvas Transition",
      "nuinuiCAD: Redo Canvas Transition",
      "nuinuiCAD: Clear Canvas Selection",
      "nuinuiCAD: Reset Canvas View",
      "nuinuiCAD: Fit Drawing",
      "nuinuiCAD: Toggle Canvas Element Names",
      "nuinuiCAD: Toggle Canvas Points"
    ]);
  });

  it("scopes Command Palette visibility to Source and Canvas surfaces", async () => {
    const manifest = await readManifest();
    const commandPalette = manifest.contributes?.menus?.commandPalette ?? [];

    expect(commandPalette).toEqual([
      { command: "nuinuiCAD.openCanvas", when: sourcePaletteWhen },
      { command: "nuinuiCAD.clearCanvasSelection", when: canvasPaletteWhen },
      { command: "nuinuiCAD.resetCanvasView", when: canvasPaletteWhen },
      { command: "nuinuiCAD.fitDrawing", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasElementNames", when: canvasPaletteWhen },
      { command: "nuinuiCAD.toggleCanvasPoints", when: canvasPaletteWhen },
      { command: "nuinuiCAD.canvasUndo", when: "false" },
      { command: "nuinuiCAD.canvasRedo", when: "false" }
    ]);
  });
});

describe("VS Code extension manifest keybindings", () => {
  it("uses macOS overrides for Canvas history commands", async () => {
    const manifest = await readManifest();
    const keybindings = manifest.contributes?.keybindings ?? [];

    expect(keybindings).toHaveLength(2);
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
    expect(keybindings.some(({ key }) => key === "cmd+z")).toBe(false);
    expect(keybindings.some(({ key }) => key === "cmd+shift+z")).toBe(false);
  });
});
