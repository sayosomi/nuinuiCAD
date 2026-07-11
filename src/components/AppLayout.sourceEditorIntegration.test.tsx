import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

});
