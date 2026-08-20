import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addImage, commitPendingImageImport } from "./imageCreationCommands";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn()
}));
const dialogMock = vi.hoisted(() => ({
  open: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true
  });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
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
    showCanvasElementNames: true,
    showCanvasPoints: true,
    showElementListColorAccents: false,
    showShortcutHelp: false,
    showShortcutSettings: false,
    showPaletteSettings: false,
    showSelectionColorPicker: false,
    pendingImageImport: null,
    imageImportError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  });
};

describe("imageCreationCommands", () => {
  beforeEach(() => {
    resetStore();
    setTauriRuntime();
    tauriCoreMock.invoke.mockReset();
    dialogMock.open.mockReset();
  });

  it("opens a pending image import dialog state from Tauri image metadata", async () => {
    dialogMock.open.mockResolvedValue("/Users/yosomi/Documents/underlay.png");
    tauriCoreMock.invoke.mockResolvedValue({
      widthPx: 5000,
      heightPx: 5000,
      dpi: 72.009
    });

    await addImage();

    expect(dialogMock.open).toHaveBeenCalled();
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("read_image_metadata", {
      path: "/Users/yosomi/Documents/underlay.png"
    });
    expect(useCadStore.getState().pendingImageImport).toMatchObject({
      sourcePath: "underlay.png",
      displayName: "underlay.png",
      naturalWidthPx: 5000,
      naturalHeightPx: 5000,
      detectedDpi: 72.009,
      sourceDpi: 72.009,
      targetPixelsPerMm: 72.009 / 25.4
    });
    expect(useCadStore.getState().elements).toEqual(sampleElements);
  });

  it("shows an image import error when metadata loading fails", async () => {
    dialogMock.open.mockResolvedValue("/Users/yosomi/Documents/broken.png");
    tauriCoreMock.invoke.mockRejectedValue(new Error("画像メタデータを読み取れません。"));

    await addImage();

    expect(useCadStore.getState().pendingImageImport).toBeNull();
    expect(useCadStore.getState().imageImportError).toBe("画像メタデータを読み取れません。");
  });

  it("does nothing when the image picker is canceled", async () => {
    dialogMock.open.mockResolvedValue(null);

    await addImage();

    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(useCadStore.getState().pendingImageImport).toBeNull();
    expect(useCadStore.getState().imageImportError).toBeNull();
  });

  it("captures a Source Editor insertion line and uses it after image configuration", async () => {
    useCadStore.getState().commitText([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "// insert image here",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n"), "test");
    const document = useCadStore.getState();
    dialogMock.open.mockResolvedValue("/Users/yosomi/Documents/underlay.png");
    tauriCoreMock.invoke.mockResolvedValue({ widthPx: 5000, heightPx: 5000, dpi: 300 });

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

  it("rejects an image import when its captured source revision is stale", async () => {
    useCadStore.getState().commitText("nui 4\npoint A = coordinate(x: 0, y: 0)", "test");
    const document = useCadStore.getState();
    dialogMock.open.mockResolvedValue("/Users/yosomi/Documents/underlay.png");
    tauriCoreMock.invoke.mockResolvedValue({ widthPx: 5000, heightPx: 5000, dpi: 300 });
    await addImage({
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 3,
        lineCount: 3,
        elementId: null
      })
    });
    const pending = useCadStore.getState().pendingImageImport!;
    useCadStore.getState().commitText("nui 4\npoint A = coordinate(x: 0, y: 0)\n// changed", "test");

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
    clearTauriRuntime();
  });
});
