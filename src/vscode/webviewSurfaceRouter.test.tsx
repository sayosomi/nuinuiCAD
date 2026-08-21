import { describe, expect, it } from "vitest";
import { VSCodeApp } from "./VSCodeApp";
import { routeVscodeWebviewSurface } from "./webviewSurfaceRouter";
import type { VscodeWebviewApi } from "./protocol";

const api: VscodeWebviewApi = { postMessage: () => undefined };

describe("VS Code Webview surface routing", () => {
  it("routes the Canvas surface to the Canvas application", () => {
    expect(routeVscodeWebviewSurface("canvas", api).type).toBe(VSCodeApp);
  });

  it("fails closed when Output Preview has no registered implementation", () => {
    expect(() => routeVscodeWebviewSurface("outputPreview", api)).toThrow(
      "The VS Code Output Preview surface is not implemented."
    );
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
