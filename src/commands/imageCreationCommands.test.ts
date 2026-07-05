import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addImage } from "./imageCreationCommands";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";

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
    selectedParameterKey: "name",
    past: [],
    future: [],
    currentFilePath: "/Users/yosomi/Documents/pattern.nuinui.json",
    dirtySinceSave: false,
    isParameterEditMode: false,
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeExpressionInsertTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    selectedDependencyJumpIndex: 0,
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
    showPrintLayout: false,
    showPrintPreviewWindow: false,
    pendingImageImport: null,
    imageImportError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW
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

  afterEach(() => {
    clearTauriRuntime();
  });
});
