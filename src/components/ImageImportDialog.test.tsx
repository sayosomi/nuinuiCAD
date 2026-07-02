import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { useCadStore } from "../state/useCadStore";
import { DEFAULT_CANVAS_VIEWPORT } from "../state/cadUiStore";
import { ImageImportDialog } from "./ImageImportDialog";

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
    currentFilePath: null,
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
    pendingImageImport: null,
    imageImportError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT
  });
};

describe("ImageImportDialog", () => {
  beforeEach(resetStore);

  it("creates and selects an image element when confirmed", () => {
    useCadStore.setState({
      pendingImageImport: {
        sourcePath: "/tmp/underlay.png",
        displayName: "underlay.png",
        naturalWidthPx: 5000,
        naturalHeightPx: 5000,
        detectedDpi: 72.009,
        sourceDpi: 72.009,
        targetPixelsPerMm: 72.009 / 25.4,
        error: null
      }
    });

    render(<ImageImportDialog />);
    fireEvent.change(screen.getByLabelText("読み込み時の基準解像度 px/mm"), {
      target: { value: "10" }
    });
    fireEvent.click(screen.getByRole("button", { name: "読み込む" }));

    const state = useCadStore.getState();
    const image = state.elements.find((element) => element.type === "image");
    expect(image).toMatchObject({
      name: "underlay.png",
      sourcePath: "/tmp/underlay.png",
      naturalWidthPx: 5000,
      naturalHeightPx: 5000,
      sourceDpi: 72.009,
      targetPixelsPerMm: 10
    });
    expect(image && image.type === "image" ? image.scale : null).toBeCloseTo(72.009 / 254);
    expect(state.selectedElementId).toBe(image?.id);
    expect(state.pendingImageImport).toBeNull();
  });

  it("keeps the dialog open and does not create an image for invalid numbers", () => {
    useCadStore.setState({
      pendingImageImport: {
        sourcePath: "/tmp/underlay.png",
        displayName: "underlay.png",
        naturalWidthPx: 5000,
        naturalHeightPx: 5000,
        detectedDpi: null,
        sourceDpi: 300,
        targetPixelsPerMm: 10,
        error: null
      }
    });

    render(<ImageImportDialog />);
    fireEvent.change(screen.getByLabelText("DPI"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "読み込む" }));

    expect(screen.getByText("DPIとpx/mmは0より大きい数値で入力してください。")).toBeInTheDocument();
    expect(useCadStore.getState().elements.some((element) => element.type === "image")).toBe(false);
  });

  it("shows metadata errors", () => {
    useCadStore.setState({ imageImportError: "画像メタデータを読み取れません。" });

    render(<ImageImportDialog />);

    expect(screen.getByText("画像メタデータを読み取れません。")).toBeInTheDocument();
  });
});
