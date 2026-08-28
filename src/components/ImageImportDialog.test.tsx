import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { ImageImportDialog } from "./ImageImportDialog";

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    evaluationLimitIndex: sampleElements.length,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    past: [],
    future: [],
    currentFilePath: null,
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

describe("ImageImportDialog", () => {
  beforeEach(resetStore);

  it("creates an image and admits it after Canvas publishes the fresh presentation", () => {
    useCadStore.setState({
      pendingImageImport: {
        sourcePath: "/tmp/underlay.png",
        displayName: "underlay.png",
        naturalWidthPx: 5000,
        naturalHeightPx: 5000,
        detectedDpi: 72.009,
        sourceDpi: 72.009,
        targetPixelsPerMm: 72.009 / 25.4,
        sourceInsertion: null,
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
    expect(state.selectedElementId).toBe(sampleElements[0].id);
    publishTestCanvasSelectionEligibility(state.elements);
    useCadUiStore.getState().setSelectedElementId(image!.id);
    expect(useCadStore.getState().selectedElementId).toBe(image?.id);
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
        sourceInsertion: null,
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
