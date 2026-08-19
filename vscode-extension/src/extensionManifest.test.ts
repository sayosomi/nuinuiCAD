import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type Keybinding = {
  command: string;
  key: string;
  mac?: string;
  when: string;
};

type ExtensionManifest = {
  contributes?: {
    keybindings?: Keybinding[];
  };
};

const manifestPath = resolve(process.cwd(), "vscode-extension/package.json");

describe("VS Code extension manifest keybindings", () => {
  it("uses macOS overrides for Canvas history commands", async () => {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as ExtensionManifest;
    const keybindings = manifest.contributes?.keybindings ?? [];
    const canvasWhen = "activeWebviewPanelId == 'nuinuiCAD.canvas' || (editorTextFocus && nuinuiCAD.canvasHistoryHandoff)";

    expect(keybindings).toHaveLength(2);
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.canvasUndo",
      key: "ctrl+z",
      mac: "cmd+z",
      when: canvasWhen
    });
    expect(keybindings).toContainEqual({
      command: "nuinuiCAD.canvasRedo",
      key: "ctrl+y",
      mac: "cmd+shift+z",
      when: canvasWhen
    });
    expect(keybindings.some(({ key }) => key === "cmd+z")).toBe(false);
    expect(keybindings.some(({ key }) => key === "cmd+shift+z")).toBe(false);
  });
});
