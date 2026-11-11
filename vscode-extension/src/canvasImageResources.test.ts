import { afterEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import type * as vscode from "vscode";
import { CanvasImageResources } from "./canvasImageResources";
import { canvasImageSourceUrl } from "../../src/vscode/canvasImageResources";
import { renderHook } from "@testing-library/react";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { evaluateElements } from "../../src/geometry/evaluate";
import { useCanvasOverlayData } from "../../src/components/useCanvasOverlayData";
import { renderCanvasGeometry } from "../../src/components/canvasRenderer";
import { LEGACY_CANVAS_THEME } from "../../src/components/canvasTheme";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiRuntimeEvaluationService } from "./runtimeEvaluationService";
import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { evaluationResultToPayload, type EvaluationPayload } from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realpathSync = (path: string) => {
    if (path === "/missing" || path === "/unreadable") throw new Error("unavailable");
    return path === "/root-link" ? "/" : path === "/home-link" ? homedir() : path;
  };
  return { ...actual, realpathSync, default: { ...actual, realpathSync } };
});
vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ scheme: "file", fsPath: path, toString: () => pathToFileURL(path).href }) }
}));

const documentFor = (path = "/patterns/front.nui", scheme = "file") => ({
  uri: { scheme, fsPath: path, toString: () => `${scheme}://${path}` }
}) as vscode.TextDocument;

const webviewFor = () => ({
  options: { enableScripts: true },
  asWebviewUri: vi.fn((uri: vscode.Uri) => ({
    toString: () => `https://file.vscode-resource.test${new URL(uri.toString()).pathname}`
  }))
}) as unknown as vscode.Webview;

const dist = { toString: () => "extension/dist" } as vscode.Uri;
const rootsFor = (webview: vscode.Webview) => webview.options.localResourceRoots?.map((uri) => uri.toString());

afterEach(() => vi.unstubAllGlobals());

describe("Canvas host image authority", () => {
  const boundImageFixture = () => {
    const source = 'nui 1\nconst Path: string = "../photos/bound.png"\nimage Ref = image(source: @Path, origin: (0, 0))';
    let sourceText = source;
    const document = { uri: documentFor().uri, version: 1, getText: () => sourceText };
    const analysis = createLanguageAnalysisSession(source);
    const compiled = analysis.runtimeEvaluationSnapshot()!.compiled;
    const payload = evaluationResultToPayload(evaluateElementsReference(compiled.document.elements,
      buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })));
    let resolve!: (payload: EvaluationPayload) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<EvaluationPayload>((yes, no) => { resolve = yes; reject = no; });
    const request = vi.fn(() => pending);
    const runtime = createNuiRuntimeEvaluationService({
      rustProcessOwner: { get: () => ({ request }) } as never,
      isDocumentCurrent: () => true
    });
    const webview = webviewFor();
    const authority = new CanvasImageResources(dist);
    const onResolved = vi.fn();
    let current = true;
    const initial = authority.publishDocument(webview, document as vscode.TextDocument, analysis, runtime, () => current, onResolved);
    return { source, document, analysis, payload, resolve, reject, request, runtime, webview, authority, onResolved, initial,
      setSource: (text: string) => { sourceText = text; }, close: () => { current = false; } };
  };

  it("authorizes bound image paths through the canonical host runtime evaluation service", async () => {
    const fixture = boundImageFixture();
    expect(fixture.initial).toEqual({});
    expect(rootsFor(fixture.webview)).toEqual(["extension/dist"]);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    fixture.resolve(fixture.payload);
    await vi.waitFor(() => expect(fixture.onResolved).toHaveBeenCalledWith({
      "../photos/bound.png": "https://file.vscode-resource.test/photos/bound.png"
    }));
    expect(rootsFor(fixture.webview)).toEqual(["extension/dist", "file:///photos"]);
    fixture.setSource(fixture.source + "\nconst Broken: number = @missing");
    expect(fixture.authority.publishDocument(fixture.webview, fixture.document as vscode.TextDocument,
      fixture.analysis, fixture.runtime, () => true, fixture.onResolved)).toEqual({
      "../photos/bound.png": "https://file.vscode-resource.test/photos/bound.png"
    });
    fixture.runtime.dispose();
  });

  it.each(["revision", "source", "closed", "disposed", "failure"])("rejects stale or unavailable bound-image completion: %s", async (transition) => {
    const fixture = boundImageFixture();
    if (transition === "revision") fixture.document.version += 1;
    else if (transition === "source") fixture.setSource(fixture.source + "\n// changed");
    else if (transition === "closed") fixture.close();
    else if (transition === "disposed") fixture.runtime.dispose();
    if (transition === "failure") fixture.reject(new Error("runtime unavailable"));
    else fixture.resolve(fixture.payload);
    // Wait for the service's complete promise chain, including its guarded publication.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.onResolved).not.toHaveBeenCalled();
    expect(rootsFor(fixture.webview)).toEqual(["extension/dist"]);
    fixture.runtime.dispose();
  });

  it("resolves relative, parent, absolute and file URI paths with Unicode URL encoding", () => {
    const webview = webviewFor();
    const paths = ["./reference.png", "assets/型 紙.jpg", "../共有/下絵.webp", "/photos/参照.jpeg", "file:///photos/a%20b.png"];
    const resources = new CanvasImageResources(dist).publish(webview, documentFor(), paths);
    expect(resources).toEqual({
      "./reference.png": "https://file.vscode-resource.test/patterns/reference.png",
      "assets/型 紙.jpg": "https://file.vscode-resource.test/patterns/assets/%E5%9E%8B%20%E7%B4%99.jpg",
      "../共有/下絵.webp": "https://file.vscode-resource.test/%E5%85%B1%E6%9C%89/%E4%B8%8B%E7%B5%B5.webp",
      "/photos/参照.jpeg": "https://file.vscode-resource.test/photos/%E5%8F%82%E7%85%A7.jpeg",
      "file:///photos/a%20b.png": "https://file.vscode-resource.test/photos/a%20b.png"
    });
    expect(rootsFor(webview)).toEqual(["extension/dist", "file:///patterns", "file:///patterns/assets", "file:///%E5%85%B1%E6%9C%89", "file:///photos"]);
    expect(webview.options.enableScripts).toBe(true);
  });

  it("replaces grants on revisions, retains last-good on errors, and clears on document switches/Save As", () => {
    const webview = webviewFor();
    const authority = new CanvasImageResources(dist);
    const first = authority.publish(webview, documentFor(), ["assets/a.png"]);
    expect(authority.publish(webview, documentFor(), null)).toEqual(first);
    expect(authority.publish(webview, documentFor(), ["../photos/b.jpg"])).toEqual({
      "../photos/b.jpg": "https://file.vscode-resource.test/photos/b.jpg"
    });
    expect(rootsFor(webview)).toEqual(["extension/dist", "file:///photos"]);
    expect(authority.publish(webview, documentFor("/other/saved.nui"), null)).toEqual({});
    expect(rootsFor(webview)).toEqual(["extension/dist"]);
    expect(authority.publish(webview, documentFor("/other/saved.nui"), ["assets/a.png"])).toEqual({
      "assets/a.png": "https://file.vscode-resource.test/other/assets/a.png"
    });
    expect(new CanvasImageResources(dist).publish(webviewFor(), documentFor(), ["assets/a.png"])).toEqual(first);
  });

  it("fails closed for schemes, network shares, broad roots, symlink roots and unavailable directories", () => {
    const webview = webviewFor();
    const sources = ["https://example.com/x.png", "command:foo.png", "vscode-resource:/x.png", "file://server/x.png", "file:///photos/x.png?q=1", "//server/x.png", "\\\\server\\x.png", "/x.png", `${homedir()}/x.png`, "/root-link/x.png", "/home-link/x.png", "/missing/x.png", "/unreadable/x.png", "/etc/passwd", "a\0.png"];
    expect(new CanvasImageResources(dist).publish(webview, documentFor(), sources)).toEqual({});
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
    expect(rootsFor(webview)).toEqual(["extension/dist"]);
    expect(new CanvasImageResources(dist).publish(webview, documentFor("/patterns/front.nui", "untitled"), ["a.png"])).toEqual({});
    const remoteDocument = { uri: { scheme: "file", authority: "server", fsPath: "/patterns/front.nui", toString: () => "file://server/patterns/front.nui" } } as vscode.TextDocument;
    expect(new CanvasImageResources(dist).publish(webview, remoteDocument, ["a.png"])).toEqual({});
  });

  it("allows only mapped local resources and controlled browser image URLs at the consumer", () => {
    const resources = { "a.png": "https://file.vscode-resource.test/patterns/a.png" };
    expect(canvasImageSourceUrl("a.png", resources)).toBe(resources["a.png"]);
    for (const path of ["../secret.png", "/etc/private.png", "file:///secret.png", "https://other/a.png", "toString", "data:text/html,test"]) {
      expect(canvasImageSourceUrl(path, resources)).toBe("data:,");
    }
    for (const path of ["blob:controlled", "data:image/png;base64,AA=="]) expect(canvasImageSourceUrl(path, {})).toBe(path);
  });

  it("carries the host URL through the existing overlays, asset cache and renderer without changing physical geometry", () => {
    const compiled = compileDslDocument('nui 1\nimage Ref = image(source: "./render.png", origin: (5, 10), naturalWidthPx: 100, naturalHeightPx: 50, sourceDpi: 254, targetPixelsPerMm: 10, scale: 2)');
    const elements = compiled.document!.elements;
    const evaluation = evaluateElements(elements);
    const webview = webviewFor();
    const resources = new CanvasImageResources(dist).publish(webview, documentFor(), ["./render.png"]);
    const viewport = { panX: 3, panY: 4, zoom: 2 };
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation, elements, selectedElementId: null, pointPickCandidates: [],
      viewportSize: { width: 200, height: 100 }, canvasViewport: viewport,
      visibilityProfiles: [], activeVisibilityProfileId: null,
      resolveImageSourceUrl: (source) => canvasImageSourceUrl(source, resources)
    }));
    const images: HTMLImageElement[] = [];
    vi.stubGlobal("Image", class {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { images.push(this as unknown as HTMLImageElement); }
    });
    const ctx = {
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      setLineDash: vi.fn(), clearRect: vi.fn(),
      drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn()
    };
    const render = (overlayImages = result.current.overlayImages) => renderCanvasGeometry({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      size: { width: 200, height: 100 }, viewport, images: overlayImages,
      lines: [], arcs: [], curves: [], offsetLines: [], points: [],
      visibleElementIds: result.current.visibleElementIds,
      selectedElementIdSet: new Set(), selectedElementId: null,
      canvasGridSettings: { enabled: false, snapEnabled: false, spacingMm: 10, majorEvery: 5 },
      showCanvasPoints: false, isPointPickActive: false, isNumericReferencePickActive: false, isLinePickActive: false
    });
    render();
    expect(images[0].src).toBe("https://file.vscode-resource.test/patterns/render.png");
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 40, 20);
    images[0].onload!(new Event("load"));
    render();
    expect(ctx.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 40, 20);
    expect(result.current.overlayImages[0].image).toMatchObject({ sourcePath: "./render.png", widthMm: 20, heightMm: 10 });
    const missing = result.current.overlayImages.map((item) => ({ ...item, sourceUrl: "https://file.vscode-resource.test/patterns/missing.png" }));
    render(missing);
    images[1].onerror!(new Event("error"));
    ctx.drawImage.mockClear();
    render(missing);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx).toHaveProperty("strokeStyle", LEGACY_CANVAS_THEME.error);
  });
});
