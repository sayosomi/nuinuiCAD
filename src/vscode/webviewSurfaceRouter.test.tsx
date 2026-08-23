import { describe, expect, it } from "vitest";
import { VSCodeApp } from "./VSCodeApp";
import { OutputPreviewApp } from "./OutputPreviewApp";
import { ModulePreviewApp } from "./ModulePreviewApp";
import { routeVscodeWebviewSurface } from "./webviewSurfaceRouter";
import type { VscodeWebviewApi } from "./protocol";

const api: VscodeWebviewApi = { postMessage: () => undefined };

describe("VS Code Webview surface routing", () => {
  it("routes the Canvas surface to the Canvas application", () => {
    expect(routeVscodeWebviewSurface("canvas", api).type).toBe(VSCodeApp);
  });

  it("routes the Output Preview surface to its dedicated application", () => {
    expect(routeVscodeWebviewSurface("outputPreview", api).type).toBe(OutputPreviewApp);
  });

  it("routes Module Preview through its dedicated surface entry point", () => {
    expect(routeVscodeWebviewSurface("modulePreview", api).type).toBe(ModulePreviewApp);
  });

  it.each([undefined, null, "", "unknown", "Canvas", { kind: "canvas" }])(
    "fails closed for malformed surface kind %p",
    (surfaceKind) => {
      expect(() => routeVscodeWebviewSurface(surfaceKind, api)).toThrow(
        "The VS Code Webview surface kind is missing or invalid."
      );
    }
  );
});
