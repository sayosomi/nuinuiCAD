import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { AppLayout } from "./AppLayout";

const source = [
  "nui 1",
  "group G {",
  "  point A = (0, 0)",
  "  point B = (100, 0)",
  "}"
].join("\n");

const canvasContext = () => ({
  arc: vi.fn(), bezierCurveTo: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), fill: vi.fn(),
  fillRect: vi.fn(), lineTo: vi.fn(), moveTo: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn()
});

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  useCadDocumentStore.getState().commitText(source, "test");
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 400, width: 500, height: 400, toJSON: () => ({})
  }));
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext() as unknown as CanvasRenderingContext2D);
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

const pointId = (name: string) => {
  const id = useCadDocumentStore.getState().elements.find((element) => element.name === name)?.id;
  if (!id) throw new Error(`Missing point ${name}`);
  return id;
};

describe("AppLayout Source Editor production integration", () => {
  it("uses the real Canvas and controller for Canvas⇄cursor sync and folded descendants", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const groupId = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!.id;
    act(() => useCadUiStore.getState().setGroupFold(groupId, { expanded: false }));

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });

    await waitFor(() => expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B")));
    expect(useCadUiStore.getState().sourceCursorLine).toBe(4);
    expect(useCadUiStore.getState().groupFoldById.get(groupId)?.expanded).toBe(true);

  });

  it("keeps cursor selection through a model patch and exposes command errors in the real pane", async () => {
    const view = render(<AppLayout />);
    const pointB = pointId("B");
    useCadUiStore.getState().setSelectedElementId(pointB);
    await waitFor(() => expect(useCadUiStore.getState().sourceCursorLine).toBe(4));
    const beforeCursorLine = useCadUiStore.getState().sourceCursorLine;

    act(() => {
      const elements = useCadDocumentStore.getState().elements.map((element) =>
        element.id === pointB ? { ...element, locked: true } : element
      );
      useCadDocumentStore.getState().commitDocumentChange({ elements });
      useCadUiStore.getState().setCommandErrorMessage("統合テストのエラー");
    });

    await waitFor(() => expect(view.container.querySelector(".cm-content")?.textContent).toContain("locked=true"));
    expect(useCadUiStore.getState().sourceCursorLine).toBe(beforeCursorLine);
    expect(view.getByRole("alert")).toHaveTextContent("統合テストのエラー");
  });

  it("renders pickable-only search in the real Source Editor pane", async () => {
    const view = render(<AppLayout />);
    const pointB = pointId("B");
    useCadUiStore.getState().setActivePointPickTarget({ elementId: pointB, parameterKey: "fromPoint" as never });
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    viewport.focus();
    fireEvent.keyDown(window, { key: "f", metaKey: true });

    const checkbox = await view.findByLabelText("選択可能のみ");
    fireEvent.click(checkbox);
    expect(useCadUiStore.getState().elementSearchPickableOnly).toBe(true);
  });

  it("applies a dirty drag through the real editor flush and the fresh evaluation", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const cmView = EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;

    // Uncommitted editor text at gesture time: the canvas must defer to the
    // real flush and resolve against the freshly evaluated document.
    act(() => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: "\npoint C = (0, 60)" } });
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 400, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 400, clientY: 190, pointerId: 1 });

    await waitFor(() => {
      const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B");
      expect(pointB).toMatchObject({ x: 150, y: 10 });
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B"));
    expect(useCadDocumentStore.getState().sourceText).toContain("point C");
    const pointC = useCadDocumentStore.getState().elements.find((element) => element.name === "C");
    expect(pointC).toMatchObject({ x: 0, y: 60 });
  });

  it("rejects canvas gestures during IME composition and recovers after compositionend", async () => {
    const view = render(<AppLayout />);
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const content = view.container.querySelector<HTMLElement>(".cm-content")!;
    const cmView = EditorView.findFromDOM(view.container.querySelector<HTMLElement>(".cm-editor")!)!;

    fireEvent.compositionStart(content);
    act(() => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: "\npoint 未確定 = (0, 60)" } });
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    expect(view.getByRole("alert")).toHaveTextContent("日本語入力の確定中");
    expect(useCadUiStore.getState().selectedElementId).not.toBe(pointId("B"));

    fireEvent.compositionEnd(content);
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 2 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 2 });

    await waitFor(() => expect(useCadUiStore.getState().selectedElementId).toBe(pointId("B")));
    expect(useCadDocumentStore.getState().sourceText).toContain("未確定");
  });

  it("applies a pick candidate from search Enter through the real controller", async () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "point C = (0, -50)",
      "line AB = A -> B"
    ].join("\n"), "test");
    const view = render(<AppLayout />);
    const lineId = useCadDocumentStore.getState().elements.find((element) => element.name === "AB")!.id;
    const pointC = pointId("C");
    act(() => {
      useCadUiStore.getState().setActivePointPickTarget({ elementId: lineId, parameterKey: "startPoint" });
    });

    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    viewport.focus();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const input = await view.findByLabelText("要素を検索");
    fireEvent.change(input, { target: { value: "C" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const lineElement = useCadDocumentStore.getState().elements.find((element) => element.name === "AB");
      expect(lineElement).toMatchObject({ startPoint: { mode: "reference", pointId: pointC } });
    });
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

});
