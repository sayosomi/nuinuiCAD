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

const renderDragOverlay = (overrides: Partial<ComponentProps<typeof OutputPreviewPlaceOverlay>> = {}) => {
  const callbacks = {
    onBeginDrag: vi.fn(() => proof),
    onPreviewDrag: vi.fn(() => true),
    onCommitDrag: vi.fn(() => true),
    onCancelDrag: vi.fn()
  };
  const view = render(
    <OutputPreviewPlaceOverlay
      projections={[projection()]}
      sourceText={sourceText}
      viewportSize={{ width: 400, height: 300 }}
      viewport={{ panX: 0, panY: 0, zoom: 2 }}
      onNavigate={vi.fn()}
      onHighlightPlaceIdChange={vi.fn()}
      dragContextKey="7:4:print-1"
      {...callbacks}
      {...overrides}
    />
  );
  return { ...view, callbacks };
};

afterEach(() => cleanup());

describe("OutputPreviewPlaceOverlay drag lifecycle", () => {
  it("starts after the drag threshold, reuses X/Y key locks, and commits the final coordinates", () => {
    const { callbacks } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 });
    expect(callbacks.onBeginDrag).toHaveBeenCalledTimes(1);
    expect(handle).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 102, clientY: 100 });
    expect(callbacks.onPreviewDrag).not.toHaveBeenCalled();

    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 110, clientY: 90 });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 25 });

    fireEvent.keyDown(window, { key: "x" });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 15, y: 20 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 120, clientY: 80 });
    expect(callbacks.onPreviewDrag).toHaveBeenLastCalledWith(proof, { x: 20, y: 20 });

    fireEvent.pointerUp(handle, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    expect(callbacks.onCommitDrag).toHaveBeenCalledWith(proof, { x: 20, y: 20 });
    expect(callbacks.onCancelDrag).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-dragging", "false");
  });

  it("cancels with Escape and never commits the source", () => {
    const { callbacks } = renderDragOverlay();
    const handle = screen.getByRole("button", { name: "Place Front" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 2, clientX: 110, clientY: 90 });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(callbacks.onCommitDrag).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("data-dragging", "false");
  });

  it("cancels when the authoritative drag context changes", () => {
    const callbacks = {
      onBeginDrag: vi.fn(() => proof),
      onPreviewDrag: vi.fn(() => true),
      onCommitDrag: vi.fn(() => true),
      onCancelDrag: vi.fn()
    };
    const { rerender } = render(
      <OutputPreviewPlaceOverlay
        projections={[projection()]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 2 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        dragContextKey="7:4:print-1"
        {...callbacks}
      />
    );
    const handle = screen.getByRole("button", { name: "Place Front" });
    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 3, clientX: 110, clientY: 90 });

    rerender(
      <OutputPreviewPlaceOverlay
        projections={[projection()]}
        sourceText={sourceText}
        viewportSize={{ width: 400, height: 300 }}
        viewport={{ panX: 0, panY: 0, zoom: 2 }}
        onNavigate={vi.fn()}
        onHighlightPlaceIdChange={vi.fn()}
        dragContextKey="8:5:print-1"
        {...callbacks}
      />
    );

    expect(callbacks.onCancelDrag).toHaveBeenCalledWith(proof);
    expect(callbacks.onCommitDrag).not.toHaveBeenCalled();
  });
});
