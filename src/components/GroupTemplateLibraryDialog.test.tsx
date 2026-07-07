import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
import type { GroupTemplateLibrary } from "../templates/groupTemplate";
import { GroupTemplateLibraryDialog } from "./GroupTemplateLibraryDialog";

const STORAGE_KEY = "nuinuiCAD.groupTemplateLibrary.v1";

const library: GroupTemplateLibrary = {
  version: 1,
  templates: [
    {
      id: "template-sleeve",
      name: "袖テンプレート",
      rootGroupId: "group",
      elements: [],
      inputs: [
        { id: "point:base", kind: "point", label: "基準点", sourceElementId: "base" },
        { id: "line:guide", kind: "line", label: "基準線", sourceElementId: "guide" },
        {
          id: "numeric:length",
          kind: "numeric",
          label: "袖丈",
          variableElementId: "length",
          defaultValue: 55
        }
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "template-collar",
      name: "衿テンプレート",
      rootGroupId: "group",
      elements: [],
      inputs: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
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
    activeTemplateInsertion: null,
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
    showGroupTemplateLibrary: true,
    groupTemplateLibraryMode: "insert",
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

describe("GroupTemplateLibraryDialog", () => {
  beforeEach(() => {
    resetStore();
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  });

  it("shows insertion-focused template details and starts insertion", async () => {
    const lastElement = sampleElements[sampleElements.length - 1];
    useCadStore.setState({
      evaluationLimitIndex: 2,
      selectedElementId: lastElement.id,
      selectedElementIds: [lastElement.id],
      selectionAnchorElementId: lastElement.id
    });

    render(<GroupTemplateLibraryDialog />);

    expect(await screen.findByRole("heading", { name: "テンプレートを挿入" })).toBeInTheDocument();
    expect(screen.getByText(`${library.templates.length}件 / 挿入位置 3`)).toBeInTheDocument();
    expect(screen.getByText("袖テンプレート")).toBeInTheDocument();
    expect(screen.getByText("0要素 / 点1 / 線1 / 数値1")).toBeInTheDocument();
    expect(screen.getByText("基準点")).toBeInTheDocument();
    expect(screen.getByText("基準線")).toBeInTheDocument();
    expect(screen.getByText("袖丈")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /挿入を開始/ }));

    await waitFor(() => {
      expect(useCadStore.getState().activeTemplateInsertion?.template.id).toBe("template-sleeve");
    });
    expect(useCadStore.getState().activeTemplateInsertion?.insertionIndex).toBe(2);
    expect(useCadStore.getState().showGroupTemplateLibrary).toBe(false);
  });

  it("filters templates by search text", async () => {
    render(<GroupTemplateLibraryDialog />);

    await screen.findByText("袖テンプレート");
    fireEvent.change(screen.getByLabelText("テンプレートを検索"), { target: { value: "衿" } });

    expect(screen.getByText("衿テンプレート")).toBeInTheDocument();
    expect(screen.queryByText("袖テンプレート")).not.toBeInTheDocument();
  });
});
