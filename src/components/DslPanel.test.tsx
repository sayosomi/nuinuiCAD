import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
import { DslPanel } from "./DslPanel";

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
    printLayout: DEFAULT_PRINT_LAYOUT,
    printLayouts: [DEFAULT_PRINT_LAYOUT],
    activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
    evaluationLimitIndex: sampleElements.length,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    selectedParameterKey: "name",
    showDslPanel: false,
    dslPanelSourceRequest: null,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

describe("DslPanel", () => {
  beforeEach(() => resetStore());

  it("loads requested element ids into the editor in document order", async () => {
    useCadStore.setState({
      showDslPanel: true,
      dslPanelSourceRequest: {
        requestId: 1,
        elementIds: ["point-b", "point-a"]
      }
    });

    render(<DslPanel />);

    await waitFor(() => {
      const editor = screen.getByLabelText("DSLソース") as HTMLTextAreaElement;
      expect(editor.value).toContain("point 点A");
      expect(editor.value).toContain("point 点B");
      expect(editor.value.indexOf("point 点A")).toBeLessThan(editor.value.indexOf("point 点B"));
    });
  });
});
