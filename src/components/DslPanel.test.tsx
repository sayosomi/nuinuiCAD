import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    dslPanelWindow: null,
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

    expect(editor.value).toContain("point 点B");
    expect(editor.value).not.toContain("point 点A");
    expect(screen.getByText("選択要素をDSLへ書き出しました。")).toBeInTheDocument();
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

    expect(useCadStore.getState().dslPanelWindow).toEqual({ x: 380, y: 80 });
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.layoutSettings.v1") ?? "{}")).toMatchObject({
        dslPanelWindow: { x: 380, y: 80 }
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
});
