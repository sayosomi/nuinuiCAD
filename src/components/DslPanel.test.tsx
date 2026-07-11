import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
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
    dslPanelWindow: null,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

describe("DslPanel", () => {
  let unregisterSourceEditSession = () => {};

  beforeEach(() => resetStore());
  afterEach(() => unregisterSourceEditSession());

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
      expect(editor.value).toContain("# @dsl-export: selected");
      expect(editor.value).toContain("point 点A");
      expect(editor.value).toContain("point 点B");
      expect(editor.value.indexOf("point 点A")).toBeLessThan(editor.value.indexOf("point 点B"));
    });
  });

  it("focuses the editor on open and returns focus to the previous element list target on Escape", async () => {
    const previousTarget = document.createElement("div");
    previousTarget.tabIndex = -1;
    previousTarget.dataset.elementList = "true";
    document.body.appendChild(previousTarget);
    previousTarget.focus();
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース");
    await waitFor(() => expect(editor).toHaveFocus());

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(useCadStore.getState().showDslPanel).toBe(false);
    expect(previousTarget).toHaveFocus();
  });

  it("exports the current selection from the keyboard", async () => {
    useCadStore.setState({
      showDslPanel: true,
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"],
      selectionAnchorElementId: "point-b"
    });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "E", metaKey: true, shiftKey: true });

    expect(editor.value).toContain("# @dsl-export: dependency");
    expect(editor.value).toContain("point 点A");
    expect(editor.value).toContain("point 点B");
    expect(screen.getByText("実選択1件、依存元1件をDSLへ書き出しました。")).toBeInTheDocument();
  });

  it("selects DSL names with F2 and Shift+F2", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: {
        value: [
          "point \"長い 点A\" = (0, 0)",
          "point \"長い 点B\" = offset \"長い 点A\" dx=10 dy=0"
        ].join("\n")
      }
    });

    fireEvent.keyDown(editor, { key: "F2" });
    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("長い 点A");
    });

    fireEvent.keyDown(editor, { key: "F2" });
    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("長い 点B");
    });

    fireEvent.keyDown(editor, { key: "F2", shiftKey: true });
    await waitFor(() => {
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("長い 点A");
    });
  });

  it("surfaces warning counts for pulled dependencies", async () => {
    const elements: CadElement[] = [
      {
        id: "line-ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "point-a",
        name: "A",
        type: "freePoint",
        visible: true,
        enabled: false,
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      }
    ];
    const evaluation: EvaluationResult = {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [{
        elementId: "point-a",
        elementName: "A",
        missingDependencyId: "point-a",
        missingDependencyName: "A",
        message: "invalid"
      }],
      warnings: []
    };
    useCadStore.setState({
      elements,
      showDslPanel: true,
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectionAnchorElementId: "line-ab"
    });

    render(<DslPanel evaluation={evaluation} />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "E", metaKey: true, shiftKey: true });

    expect(editor.value).toContain("warning=disabled,invalid,too-late");
    expect(screen.getByText(/評価OFF1件、評価エラー1件、順序違い2件/)).toBeInTheDocument();
  });

  it("validates from the keyboard without closing", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "nonsense" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true, shiftKey: true });

    expect(useCadStore.getState().showDslPanel).toBe(true);
    expect(screen.getByLabelText("DSL診断")).toBeInTheDocument();
  });

  it("keeps the panel open when keyboard apply finds errors", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "nonsense" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    expect(useCadStore.getState().showDslPanel).toBe(true);
    expect(screen.getByLabelText("DSL診断")).toBeInTheDocument();
  });

  it("undoes and redoes DSL source edits while the editor is focused", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    const initialSource = editor.value;
    fireEvent.change(editor, { target: { value: "point A = (1, 2)" } });
    fireEvent.change(editor, { target: { value: "point A = (3, 4)" } });

    fireEvent.keyDown(editor, { key: "z", metaKey: true });
    expect(editor.value).toBe("point A = (1, 2)");

    fireEvent.keyDown(editor, { key: "z", metaKey: true });
    expect(editor.value).toBe(initialSource);

    fireEvent.keyDown(editor, { key: "y", metaKey: true });
    expect(editor.value).toBe("point A = (1, 2)");

    fireEvent.keyDown(editor, { key: "z", metaKey: true, shiftKey: true });
    expect(editor.value).toBe("point A = (3, 4)");
  });

  it("clears DSL redo history after a new source edit", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "point A = (1, 2)" } });
    fireEvent.change(editor, { target: { value: "point A = (3, 4)" } });
    fireEvent.keyDown(editor, { key: "z", metaKey: true });
    expect(editor.value).toBe("point A = (1, 2)");

    fireEvent.change(editor, { target: { value: "point A = (5, 6)" } });
    fireEvent.keyDown(editor, { key: "y", metaKey: true });

    expect(editor.value).toBe("point A = (5, 6)");
  });

  it("undoes a DSL selection export back to the previous source", async () => {
    useCadStore.setState({
      showDslPanel: true,
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"],
      selectionAnchorElementId: "point-b"
    });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "point Custom = (1, 2)" } });
    fireEvent.keyDown(editor, { key: "E", metaKey: true, shiftKey: true });
    expect(editor.value).toContain("point 点B");

    fireEvent.keyDown(editor, { key: "z", metaKey: true });

    expect(editor.value).toBe("point Custom = (1, 2)");
  });

  it("does not change the editor when Cmd+Z is pressed before any edit", async () => {
    useCadStore.setState({
      showDslPanel: true,
      dslPanelSourceRequest: {
        requestId: 1,
        elementIds: ["point-b"]
      }
    });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("point 点B"));
    const displayedBeforeUndo = editor.value;

    fireEvent.keyDown(editor, { key: "z", metaKey: true });

    expect(editor.value).toBe(displayedBeforeUndo);
  });

  it("undoes the first edit of an auto-loaded selection back to the loaded text, not the placeholder", async () => {
    useCadStore.setState({
      showDslPanel: true,
      dslPanelSourceRequest: {
        requestId: 1,
        elementIds: ["point-b"]
      }
    });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("point 点B"));
    const loadedSource = editor.value;
    const editedSource = `${loadedSource}\n# edited`;
    fireEvent.change(editor, { target: { value: editedSource } });
    expect(editor.value).toBe(editedSource);

    fireEvent.keyDown(editor, { key: "z", metaKey: true });

    expect(editor.value).toBe(loadedSource);
    expect(editor.value).not.toContain("var bust = 840");

    fireEvent.keyDown(editor, { key: "z", metaKey: true, shiftKey: true });

    expect(editor.value).toBe(editedSource);
  });

  it("resets local undo history when a new source request supersedes the current draft", async () => {
    useCadStore.setState({
      showDslPanel: true,
      dslPanelSourceRequest: {
        requestId: 1,
        elementIds: ["point-b"]
      }
    });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("point 点B"));
    const firstRequestLoadedSource = editor.value;
    fireEvent.change(editor, { target: { value: `${firstRequestLoadedSource}\n# edited request 1` } });

    // Simulates re-opening the panel on a different selection (e.g. via the
    // element list context menu) while the panel stays mounted.
    useCadStore.setState({
      dslPanelSourceRequest: {
        requestId: 2,
        elementIds: ["point-a"]
      }
    });

    await waitFor(() => {
      expect(editor.value).toContain("point 点A");
      expect(editor.value).not.toContain("edited request 1");
    });
    const secondRequestLoadedSource = editor.value;

    fireEvent.keyDown(editor, { key: "z", metaKey: true });

    expect(editor.value).toBe(secondRequestLoadedSource);
    expect(editor.value).not.toContain("edited request 1");
  });

  it("applies valid DSL from the keyboard, closes, and returns focus", async () => {
    const previousTarget = document.createElement("div");
    previousTarget.tabIndex = -1;
    previousTarget.dataset.canvasViewport = "true";
    document.body.appendChild(previousTarget);
    previousTarget.focus();
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    await waitFor(() => expect(editor).toHaveFocus());
    fireEvent.change(editor, { target: { value: "point K = (10, 20)" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    expect(useCadStore.getState().showDslPanel).toBe(false);
    expect(useCadStore.getState().elements.some((element) => element.name === "K")).toBe(true);
    expect(previousTarget).toHaveFocus();

    expect(useCadStore.getState().past).toHaveLength(1);
    useCadStore.getState().undo();
    expect(useCadStore.getState().elements.some((element) => element.name === "K")).toBe(false);
  });

  it("does not report success or close the panel when the store rejects the apply", async () => {
    // isComposing stays false so dispatchCommand's own top-level flush gate lets the
    // apply command run; hasPendingText staying true makes commitDocumentChange's own
    // guard reject it once apply actually calls it, exercising apply()'s own handling
    // of a DocumentMutationResult reject (not the earlier, coarser composition gate).
    unregisterSourceEditSession = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => false,
      flush: () => "flushed"
    });
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    await waitFor(() => expect(editor).toHaveFocus());
    fireEvent.change(editor, { target: { value: "point K = (10, 20)" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    expect(useCadStore.getState().showDslPanel).toBe(true);
    expect(useCadStore.getState().elements.some((element) => element.name === "K")).toBe(false);
    expect(screen.getByText(/適用できませんでした/)).toBeInTheDocument();
  });

  it("does not intercept ordinary text editing shortcuts in the DSL editor", async () => {
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const editor = await screen.findByLabelText("DSLソース") as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "a", metaKey: true });

    expect(useCadStore.getState().showDslPanel).toBe(true);
  });

  it("moves the panel by dragging the header and saves its position", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const panel = screen.getByLabelText("DSLパネル");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 460,
      y: 68,
      left: 460,
      top: 68,
      right: 980,
      bottom: 780,
      width: 520,
      height: 712,
      toJSON: () => ({})
    } as DOMRect);

    const header = panel.querySelector(".dsl-panel-header");
    if (!(header instanceof HTMLElement)) throw new Error("Missing DSL panel header");

    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 500, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 420, clientY: 130 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 420, clientY: 130 });

    expect(useCadStore.getState().dslPanelWindow).toEqual({ x: 380, y: 80, width: 520, height: 712 });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "{}")).toMatchObject({
        dslPanelWindow: { x: 380, y: 80, width: 520, height: 712 }
      })
    );
  });

  it("does not start panel dragging from the close button", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    useCadStore.setState({ showDslPanel: true });

    render(<DslPanel />);

    const panel = screen.getByLabelText("DSLパネル");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 460,
      y: 68,
      left: 460,
      top: 68,
      right: 980,
      bottom: 780,
      width: 520,
      height: 712,
      toJSON: () => ({})
    } as DOMRect);

    const header = panel.querySelector(".dsl-panel-header");
    if (!(header instanceof HTMLElement)) throw new Error("Missing DSL panel header");
    fireEvent.pointerDown(screen.getByRole("button", { name: "DSLパネルを閉じる" }), {
      button: 0,
      pointerId: 2,
      clientX: 900,
      clientY: 90
    });
    fireEvent.pointerMove(header, { pointerId: 2, clientX: 700, clientY: 140 });

    expect(useCadStore.getState().dslPanelWindow).toBeNull();
  });

  it("resizes the panel from the resize handle and saves its size", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    useCadStore.setState({
      showDslPanel: true,
      dslPanelWindow: { x: 300, y: 80, width: 520, height: 400 }
    });

    render(<DslPanel />);

    const resizeHandle = screen.getByRole("separator", { name: "DSLパネルのサイズを変更" });

    fireEvent.pointerDown(resizeHandle, { button: 0, pointerId: 3, clientX: 820, clientY: 480 });
    fireEvent.pointerMove(resizeHandle, { pointerId: 3, clientX: 900, clientY: 530 });
    fireEvent.pointerUp(resizeHandle, { pointerId: 3, clientX: 900, clientY: 530 });

    expect(useCadStore.getState().dslPanelWindow).toEqual({ x: 300, y: 80, width: 600, height: 450 });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "{}")).toMatchObject({
        dslPanelWindow: { x: 300, y: 80, width: 600, height: 450 }
      })
    );
  });
});
