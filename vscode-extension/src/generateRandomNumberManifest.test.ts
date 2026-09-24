import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = {
  contributes?: {
    commands?: Array<{ command: string; title?: string; category?: string; enablement?: string }>;
    keybindings?: Array<{ command: string }>;
    menus?: Record<string, Array<{ command?: string; when?: string }>>;
  };
};

const extensionRoot = resolve(process.cwd(), "vscode-extension");
const readJson = async <T,>(file: string) => JSON.parse(await readFile(resolve(extensionRoot, file), "utf8")) as T;

describe("Generate Random Number manifest", () => {
  it("contributes a writable Source-only Palette command with localized title", async () => {
    const manifest = await readJson<Manifest>("package.json");
    const english = await readJson<Record<string, string>>("package.nls.json");
    const japanese = await readJson<Record<string, string>>("package.nls.ja.json");
    const commandId = "nuinuiCAD.generateRandomNumber";
    const command = manifest.contributes?.commands?.find(({ command: id }) => id === commandId);

    expect(command).toEqual({
      command: commandId,
      title: "%command.generateRandomNumber.title%",
      category: "nuinuiCAD"
    });
    expect(manifest.contributes?.menus?.commandPalette?.filter(({ command: id }) => id === commandId)).toEqual([
      {
        command: commandId,
        when: "editorLangId == nui && resourceScheme == file && resourceExtname == .nui"
      }
    ]);
    expect(manifest.contributes?.menus?.["editor/context"]?.some(({ command: id }) => id === commandId)).toBe(false);
    expect(manifest.contributes?.keybindings?.some(({ command: id }) => id === commandId)).toBe(false);
    expect(english["command.generateRandomNumber.title"]).toBe("Generate Random Number");
    expect(japanese["command.generateRandomNumber.title"]).toBe("ランダムな数値を生成");
  });
});
