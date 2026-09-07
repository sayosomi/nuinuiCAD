import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = {
  contributes?: {
    viewsContainers?: {
      activitybar?: Array<{ id: string; title: string; icon: string }>;
    };
    views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
    commands?: Array<{
      command: string;
      title: string;
      shortTitle?: string;
      icon?: { light: string; dark: string };
    }>;
    menus?: {
      "view/title"?: Array<{ command: string; when: string; group: string }>;
    };
  };
};

const extensionRoot = resolve(process.cwd(), "vscode-extension");
const packageNlsPath = resolve(extensionRoot, "package.nls.json");
const packageNlsJaPath = resolve(extensionRoot, "package.nls.ja.json");

const readManifest = async (): Promise<Manifest> =>
  JSON.parse(await readFile(resolve(extensionRoot, "package.json"), "utf8")) as Manifest;

describe("nuinuiCAD Explorer manifest", () => {
  it("contributes the Activity Bar container and source Elements view", async () => {
    const manifest = await readManifest();
    expect(manifest.contributes?.viewsContainers?.activitybar).toEqual([{
      id: "nuinuiCAD.explorer",
      title: "%views.explorerContainer%",
      icon: "media/spline.svg"
    }]);
    expect(manifest.contributes?.views?.["nuinuiCAD.explorer"]).toEqual([
      {
        id: "nuinuiCAD.elements",
        name: "%views.elements%"
      },
      {
        id: "nuinuiCAD.explorerMock",
        name: "%views.explorerMock%",
        type: "webview"
      },
      {
        id: "nuinuiCAD.modulePreviewParameters",
        name: "%views.modulePreviewParameters%",
        type: "webview"
      }
    ]);
  });

  it("reuses the existing surface commands as Elements title actions", async () => {
    const manifest = await readManifest();
    const english = JSON.parse(await readFile(packageNlsPath, "utf8")) as Record<string, string>;
    const japanese = JSON.parse(await readFile(packageNlsJaPath, "utf8")) as Record<string, string>;
    expect(manifest.contributes?.menus?.["view/title"]).toEqual([
      {
        command: "nuinuiCAD.openCanvas",
        when: "view == nuinuiCAD.elements",
        group: "navigation@1"
      },
      {
        command: "nuinuiCAD.openOutputPreview",
        when: "view == nuinuiCAD.elements",
        group: "navigation@2"
      }
    ]);

    const commands = manifest.contributes?.commands ?? [];
    expect(commands.find(({ command }) => command === "nuinuiCAD.openCanvas")).toMatchObject({
      title: "%command.openCanvas.title%",
      shortTitle: "%command.openCanvas.shortTitle%",
      icon: { light: "media/spline.svg", dark: "media/spline.svg" }
    });
    expect(commands.find(({ command }) => command === "nuinuiCAD.openOutputPreview")).toMatchObject({
      title: "%command.openOutputPreview.title%",
      shortTitle: "%command.openOutputPreview.shortTitle%",
      icon: { light: "media/printer.svg", dark: "media/printer.svg" }
    });
    for (const command of [
      commands.find(({ command }) => command === "nuinuiCAD.openCanvas"),
      commands.find(({ command }) => command === "nuinuiCAD.openOutputPreview")
    ]) {
      expect(command).toBeDefined();
      expect(english[command!.title.slice(1, -1)]).toMatch(/^nuinuiCAD: /);
      expect(japanese[command!.title.slice(1, -1)]).toMatch(/^nuinuiCAD: /);
      expect(english[command!.shortTitle!.slice(1, -1)]).toBeDefined();
      expect(japanese[command!.shortTitle!.slice(1, -1)]).toBeDefined();
    }
  });

  it("keeps the Lucide launch assets neutral and theme-aware", async () => {
    const spline = await readFile(resolve(extensionRoot, "media/spline.svg"), "utf8");
    const printer = await readFile(resolve(extensionRoot, "media/printer.svg"), "utf8");

    for (const icon of [spline, printer]) {
      expect(icon).toContain('stroke="currentColor"');
      expect(icon).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
    expect(spline).toContain('<path d="M5 17A12 12 0 0 1 17 5" />');
    expect(printer).toContain('<rect x="6" y="14" width="12" height="8" rx="1" />');
  });
});
