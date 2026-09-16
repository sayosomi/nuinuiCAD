import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import type { OutputPreviewPlaceDragProof } from "./outputPreviewPlaceDrag";
import { OutputPreviewPlaceOverlay } from "./OutputPreviewPlaceOverlay";

const sourceText = "layout L {\n  place @G(at: (10, 20))\n}\n";
const xFrom = sourceText.indexOf("10");
const yFrom = sourceText.indexOf("20");

const projection = (): OutputPlaceProjection => ({
  placeId: "place-1",
  sourceRevision: 4,
  layoutId: "layout-1",
  layoutName: "Layout",
  groupId: "group-1",
  groupName: "Front",
  transformedOrigin: { x: 10, y: 20 },
  drawables: [],
  statementRange: { from: sourceText.indexOf("place"), to: sourceText.indexOf("\n}") },
  authored: {
    group: { text: "@G", sourceSpan: null, references: [], targetRange: null },
    at: {
      text: "(10, 20)",
      sourceSpan: null,
      references: [],
      x: {
        text: "10",
        sourceSpan: { sourceRevision: 4, segments: [{ from: xFrom, to: xFrom + 2 }] },
        references: []
      },
      y: {
        text: "20",
        sourceSpan: { sourceRevision: 4, segments: [{ from: yFrom, to: yFrom + 2 }] },
        references: []
      }
    }
  },
  dragability: { draggable: true, literals: { x: 10, y: 20 } }
});

const proof: OutputPreviewPlaceDragProof = {
  placeId: "place-1",
  documentVersion: 7,
  sourceRevision: 4,
  normalizedSourceSnapshot: sourceText,
  planIdentity: "print:print-1:layout-1",
  statementRange: { from: sourceText.indexOf("place"), to: sourceText.indexOf("\n}") },
  x: { range: { from: xFrom, to: xFrom + 2 }, sourceText: "10", literal: 10 },
  y: { range: { from: yFrom, to: yFrom + 2 }, sourceText: "20", literal: 20 }
};

type OutputPreviewPlaceAxis = "horizontal" | "vertical";

const axisGuide = (container: HTMLElement, axis: OutputPreviewPlaceAxis): SVGLineElement | null =>
  container.querySelector<SVGLineElement>(`[data-output-preview-place-axis-guide="${axis}"]`);

const anyAxisGuide = (container: HTMLElement): SVGLineElement | null =>
  container.querySelector<SVGLineElement>("[data-output-preview-place-axis-guide]");

const renderDragOverlay = (overrides: Partial<ComponentProps<typeof OutputPreviewPlaceOverlay>> = {}) => {
  const callbacks = {
    onBeginDrag: vi.fn(() => proof),
    onPreviewDrag: vi.fn(() => true),
    onCommitDrag: vi.fn(() => true),
    onCancelDrag: vi.fn()
  };
  const props: ComponentProps<typeof OutputPreviewPlaceOverlay> = {
    projections: [projection()],
    sourceText,
    viewportSize: { width: 400, height: 300 },
    viewport: { panX: 0, panY: 0, zoom: 2 },
    onNavigate: vi.fn(),
    onHighlightPlaceIdChange: vi.fn(),
    dragContextKey: "7:4:print-1",
    ...callbacks,
    ...overrides
  };
  const view = render(<OutputPreviewPlaceOverlay {...props} />);
  return { ...view, callbacks, props };
};

afterEach(() => cleanup());

describe("OutputPreviewPlaceOverlay drag lifecycle", () => {
  it("starts after the drag threshold, updates live with Shift, and commits the final coordinates", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 });
    expect(callbacks.onBeginDrag).toHaveBeenCalledTimes(1);
    expect(handle).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 102, clientY: 100 });
    expect(callbacks.onPreviewDrag).not.toHaveBeenCalled();
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 110, clientY: 90 });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 25 });
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 20 });
    const horizontalGuide = axisGuide(container, "horizontal");
    expect(horizontalGuide).not.toBeNull();
    expect(horizontalGuide).toHaveAttribute("x1", "0");
    expect(horizontalGuide).toHaveAttribute("x2", "400");
    expect(horizontalGuide).toHaveAttribute("y1", "110");
    expect(horizontalGuide).toHaveAttribute("y2", "110");
    expect(container.querySelector(".output-preview-place-axis-guides")).toHaveStyle({ pointerEvents: "none" });

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 110, clientY: 80 });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 10, y: 30 });
    expect(axisGuide(container, "horizontal")).toBeNull();
    const verticalGuide = axisGuide(container, "vertical");
    expect(verticalGuide).not.toBeNull();
    expect(verticalGuide).toHaveAttribute("x1", "220");
    expect(verticalGuide).toHaveAttribute("x2", "220");
    expect(verticalGuide).toHaveAttribute("y1", "0");
    expect(verticalGuide).toHaveAttribute("y2", "300");

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 120, clientY: 80 });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 20, y: 20 });
    expect(axisGuide(container, "vertical")).toBeNull();
    expect(axisGuide(container, "horizontal")).not.toBeNull();

    fireEvent.keyUp(window, { key: "Shift" });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 20, y: 30 });
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.pointerUp(handle, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    expect(callbacks.onCommitDrag).toHaveBeenCalledTimes(1);
    expect(callbacks.onCommitDrag).toHaveBeenCalledWith(proof, { x: 20, y: 30 });
    expect(callbacks.onCancelDrag).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-dragging", "false");
  });

  it("captures Shift already held at pointer-down", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      pointerId: 4,
      clientX: 100,
      clientY: 100,
      shiftKey: true
    });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 4, clientX: 110, clientY: 80 });

    expect(callbacks.onPreviewDrag).toHaveBeenCalledWith(proof, { x: 10, y: 30 });
    expect(axisGuide(container, "vertical")).not.toBeNull();
    expect(axisGuide(container, "horizontal")).toBeNull();
  });

  it("does not let X or Y constrain placement", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });
    const observedKeyEvents: KeyboardEvent[] = [];
    const observeKeyDown = (event: KeyboardEvent) => observedKeyEvents.push(event);
    window.addEventListener("keydown", observeKeyDown, { capture: true });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 5, clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyUp(window, { key: "x" });
    fireEvent.keyDown(window, { key: "y" });
    fireEvent.keyUp(window, { key: "y" });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 5, clientX: 110, clientY: 90 });

    window.removeEventListener("keydown", observeKeyDown, { capture: true });
    expect(observedKeyEvents).toHaveLength(2);
    expect(observedKeyEvents.every((event) => !event.defaultPrevented)).toBe(true);
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 25 });
    expect(anyAxisGuide(container)).toBeNull();
  });

  it("clears Shift after pointer-up before the next drag", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 6, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 6, clientX: 110, clientY: 80 });
    expect(axisGuide(container, "vertical")).not.toBeNull();
    fireEvent.pointerUp(handle, { button: 0, pointerId: 6, clientX: 110, clientY: 80 });
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 7, clientX: 110, clientY: 80 });

    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 30 });
  });

  it("clears Shift after pointer cancel before the next drag", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 8, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 8, clientX: 110, clientY: 80 });
    expect(axisGuide(container, "vertical")).not.toBeNull();
    fireEvent.pointerCancel(handle, { pointerId: 8 });
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 9, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 9, clientX: 110, clientY: 80 });

    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 30 });
  });

  it("cancels with Escape and never commits the source", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 2, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 2, clientX: 110, clientY: 90 });
    expect(axisGuide(container, "horizontal")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(callbacks.onCommitDrag).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-dragging", "false");
    expect(anyAxisGuide(container)).toBeNull();
  });

  it("clears Shift after Escape cancellation before the next drag", () => {
    const { callbacks } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 10, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 10, clientX: 110, clientY: 80 });
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 11, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 11, clientX: 110, clientY: 80 });

    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 30 });
  });

  it("clears Shift after blur cancellation before the next drag", () => {
    const { callbacks, container } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 12, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 12, clientX: 110, clientY: 80 });
    expect(axisGuide(container, "vertical")).not.toBeNull();
    fireEvent.blur(window);
    expect(anyAxisGuide(container)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 13, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 13, clientX: 110, clientY: 80 });

    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 30 });
  });

  it("cancels when the authoritative drag context changes", () => {
    const { callbacks, container, props, rerender } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });
    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      pointerId: 3,
      clientX: 100,
      clientY: 100,
      shiftKey: true
    });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 3, clientX: 110, clientY: 90 });
    expect(axisGuide(container, "horizontal")).not.toBeNull();

    rerender(<OutputPreviewPlaceOverlay {...props} dragContextKey="8:5:print-1" />);

    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(callbacks.onCommitDrag).not.toHaveBeenCalled();
    expect(anyAxisGuide(container)).toBeNull();
  });

  it("clears the guide when the interaction clear key changes", () => {
    const { callbacks, container, props, rerender } = renderDragOverlay({ clearInteractionKey: 0 });
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      pointerId: 14,
      clientX: 100,
      clientY: 100,
      shiftKey: true
    });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 14, clientX: 110, clientY: 90 });
    expect(axisGuide(container, "horizontal")).not.toBeNull();

    rerender(<OutputPreviewPlaceOverlay {...props} clearInteractionKey={1} />);

    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(anyAxisGuide(container)).toBeNull();
  });

  it("clears the guide when preview rejects the active drag", () => {
    const onPreviewDrag = vi.fn(() => false);
    const { callbacks, container } = renderDragOverlay({ onPreviewDrag });
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      pointerId: 15,
      clientX: 100,
      clientY: 100,
      shiftKey: true
    });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 15, clientX: 110, clientY: 90 });

    expect(onPreviewDrag).toHaveBeenCalledWith(proof, { x: 15, y: 20 });
    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(anyAxisGuide(container)).toBeNull();
  });

  it("clears the guide when the component is torn down", () => {
    const { callbacks, container, unmount } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      pointerId: 16,
      clientX: 100,
      clientY: 100,
      shiftKey: true
    });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 16, clientX: 110, clientY: 90 });
    expect(axisGuide(container, "horizontal")).not.toBeNull();

    unmount();

    expect(anyAxisGuide(container)).toBeNull();
    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
  });
});
