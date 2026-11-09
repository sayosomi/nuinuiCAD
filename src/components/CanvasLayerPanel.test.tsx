import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasLayerRow } from "../model/canvasLayerPresentation";
import { CanvasLayerPanel } from "./CanvasLayerPanel";

const layers: CanvasLayerRow[] = [
  { id: "canvas-layer-name:\"default\"", name: "default", label: "default", isDefault: true },
  { id: "canvas-layer-name:\"draft\"", name: "draft", label: "draft", isDefault: false }
];

describe("Canvas layer panel", () => {
  it("offers keyboard-accessible visibility controls and stops their pointer and wheel input at the overlay", () => {
    const onToggle = vi.fn();
    const parentPointerDown = vi.fn();
    const parentWheel = vi.fn();
    const view = render(
      <div onPointerDown={parentPointerDown} onWheel={parentWheel}>
        <div className="canvas-viewport">
          <CanvasLayerPanel layers={layers} hiddenLayerIds={new Set()} onToggle={onToggle} />
        </div>
      </div>
    );
    const checkbox = screen.getByRole("checkbox", { name: "Show layer draft" });

    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect((checkbox as HTMLInputElement).type).toBe("checkbox");
    fireEvent.pointerDown(checkbox, { button: 0, buttons: 1, pointerId: 2 });
    fireEvent.wheel(view.container.querySelector(".canvas-layer-list")!, { deltaY: 50 });
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentWheel).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(layers[1]!.id);
  });

  it("repositions from its move handle, clamps to the viewport and does not start a drag from rows", () => {
    const onToggle = vi.fn();
    const view = render(
      <div className="canvas-viewport" style={{ width: 200, height: 150 }}>
        <CanvasLayerPanel layers={layers} hiddenLayerIds={new Set()} onToggle={onToggle} />
      </div>
    );
    const panel = view.container.querySelector<HTMLElement>(".canvas-layer-panel")!;
    const viewport = view.container.querySelector<HTMLElement>(".canvas-viewport")!;
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 150 });
    viewport.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 150, width: 200, height: 150, toJSON: () => ({})
    });
    panel.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 80, width: 120, height: 80, toJSON: () => ({})
    });
    const handle = screen.getByRole("button", { name: "Move Layers panel" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, isPrimary: true, clientX: 10, clientY: 10, pointerId: 5 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 190, clientY: 140, pointerId: 5 });
    fireEvent.pointerUp(handle, { buttons: 0, clientX: 190, clientY: 140, pointerId: 5 });
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(76);
    expect(Number.parseFloat(panel.style.top)).toBeLessThanOrEqual(66);

    const previousPosition = { left: panel.style.left, top: panel.style.top };
    const checkbox = screen.getByRole("checkbox", { name: "Show layer draft" });
    fireEvent.pointerDown(checkbox, { button: 0, buttons: 1, clientX: 20, clientY: 20, pointerId: 6 });
    fireEvent.pointerMove(checkbox, { buttons: 1, clientX: 80, clientY: 90, pointerId: 6 });
    fireEvent.pointerUp(checkbox, { buttons: 0, clientX: 80, clientY: 90, pointerId: 6 });
    expect({ left: panel.style.left, top: panel.style.top }).toEqual(previousPosition);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
