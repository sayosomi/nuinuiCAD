import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addImage, commitPendingImageImport } from "./imageCreationCommands";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

const restoreUrlMethod = (name: "createObjectURL" | "revokeObjectURL", descriptor?: PropertyDescriptor) => {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    Reflect.deleteProperty(URL, name);
  }
};

const installBrowserImagePicker = ({
  file = new File(["pixels"], "underlay.png", { type: "image/png" }),
  widthPx = 5000,
  heightPx = 5000,
  fail = false
}: {
  file?: File | null;
  widthPx?: number;
  heightPx?: number;
  fail?: boolean;
} = {}) => {
  const createObjectURL = vi.fn(() => "blob:underlay.png");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL
  });

  const pickerClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, "files", {
      configurable: true,
      value: file ? [file] : []
    });
    this.onchange?.(new Event("change"));
  });

  class FakeImage {
    naturalWidth = widthPx;
    naturalHeight = heightPx;
    onload: ((event: Event) => unknown) | null = null;
    onerror: ((event: Event) => unknown) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        if (fail) {
          this.onerror?.(new Event("error"));
        } else {
          this.onload?.(new Event("load"));
        }
      });
    }
  }
  vi.stubGlobal("Image", FakeImage);

  return { createObjectURL, revokeObjectURL, pickerClick };
};

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    evaluationLimitIndex: sampleElements.length,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    past: [],
    future: [],
    currentFilePath: "/Users/yosomi/Documents/pattern.nuinui.json",
    dirtySinceSave: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
    showElementListColorAccents: false,
    showShortcutHelp: false,
    showShortcutSettings: false,
    pendingImageImport: null,
    imageImportError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  });
};

describe("imageCreationCommands", () => {
  beforeEach(() => {
    resetStore();
  });

  it("opens a pending image import state from browser image metadata", async () => {
    const file = new File(["pixels"], "underlay.png", { type: "image/png" });
    const { createObjectURL } = installBrowserImagePicker({ file });

    await addImage();

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(useCadStore.getState().pendingImageImport).toMatchObject({
      sourcePath: "blob:underlay.png",
      displayName: "underlay.png",
      naturalWidthPx: 5000,
      naturalHeightPx: 5000,
      detectedDpi: null,
      sourceDpi: 300
    });
    expect(useCadStore.getState().elements).toEqual(sampleElements);
  });

  it("shows an image import error when browser image decoding fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { revokeObjectURL } = installBrowserImagePicker({ fail: true });

    await addImage();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:underlay.png");
    expect(useCadStore.getState().pendingImageImport).toBeNull();
    expect(useCadStore.getState().imageImportError).toBe("画像を読み込めません。");
    expect(error).toHaveBeenCalled();
  });

  it("does nothing when the browser image picker is canceled", async () => {
    const { createObjectURL } = installBrowserImagePicker({ file: null });

    await addImage();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(useCadStore.getState().pendingImageImport).toBeNull();
    expect(useCadStore.getState().imageImportError).toBeNull();
  });

  it("captures a Source Editor insertion line and uses it after image configuration", async () => {
    useCadStore.getState().commitText([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "// insert image here",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n"), "test");
    const document = useCadStore.getState();
    installBrowserImagePicker();

    await addImage({
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 3,
        lineCount: 4,
        elementId: null
      })
    });
    const pending = useCadStore.getState().pendingImageImport!;
    expect(pending.sourceInsertion).toMatchObject({
      insertionTarget: { insertionIndex: 1 },
      sourceInsertionLine: 3
    });

    expect(commitPendingImageImport({
      sourcePath: pending.sourcePath,
      displayName: pending.displayName,
      naturalWidthPx: pending.naturalWidthPx,
      naturalHeightPx: pending.naturalHeightPx,
      sourceDpi: pending.sourceDpi,
      targetPixelsPerMm: pending.targetPixelsPerMm,
      sourceInsertion: pending.sourceInsertion
    })).toBe(true);
    const next = useCadStore.getState();
    expect(next.sourceText.indexOf("image underlay.png")).toBeLessThan(next.sourceText.indexOf("// insert image here"));
    expect(next.elements.map((element) => element.type)).toEqual(["freePoint", "image", "freePoint"]);
  });

  it("rejects an unsafe Source cursor before opening the image picker", async () => {
    useCadStore.getState().commitText("nui 1\npoint A = coordinate(x: 0, y: 0)", "test");
    const before = useCadStore.getState();
    const { createObjectURL, pickerClick } = installBrowserImagePicker();

    await addImage({
      currentSourceCursor: () => ({
        sourceRevision: before.sourceRevision - 1,
        line: 2,
        lineCount: 2,
        elementId: null
      })
    });

    const after = useCadStore.getState();
    expect(pickerClick).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(after.sourceText).toBe(before.sourceText);
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.elements).toBe(before.elements);
    expect(after.pendingImageImport).toBeNull();
    expect(useCadStore.getState().commandErrorMessage).toContain("安全な挿入境界");
  });

  it("rejects an image import when its captured source revision is stale", async () => {
    useCadStore.getState().commitText("nui 1\npoint A = coordinate(x: 0, y: 0)\n// capture", "test");
    const document = useCadStore.getState();
    installBrowserImagePicker();
    await addImage({
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 3,
        lineCount: 3,
        elementId: null
      })
    });
    const pending = useCadStore.getState().pendingImageImport!;
    useCadStore.getState().commitText("nui 1\npoint A = coordinate(x: 0, y: 0)\n// changed", "test");

    expect(commitPendingImageImport({
      sourcePath: pending.sourcePath,
      displayName: pending.displayName,
      naturalWidthPx: pending.naturalWidthPx,
      naturalHeightPx: pending.naturalHeightPx,
      sourceDpi: pending.sourceDpi,
      targetPixelsPerMm: pending.targetPixelsPerMm,
      sourceInsertion: pending.sourceInsertion
    })).toBe(false);
    expect(useCadStore.getState().pendingImageImport).toBeNull();
    expect(useCadStore.getState().imageImportError).toContain("文書が変更されたため");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl);
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl);
  });
});
