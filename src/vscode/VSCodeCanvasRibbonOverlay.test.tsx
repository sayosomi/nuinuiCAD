import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasViewport } from "../state/cadUiStore";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";

const ribbonWithStatus: VscodeCanvasRibbon[] = [{
  id: "ribbon",
  label: "Canvas Ribbon",
  x: null,
  y: 12,
  orientation: "horizontal",
  items: [{ id: "status", type: "value", valueId: "canvasZoom" }]
}];

const commandContext = {
  hasSelection: false,
  showCanvasElementNames: false,
  showCanvasPoints: false
};

const domRectFor = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({})
} as DOMRect);

const renderStatus = (canvasViewport: CanvasViewport) => {
  const canvasFocusRef = createRef<HTMLDivElement>();
  const view = render(
    <div ref={canvasFocusRef}>
      <VSCodeCanvasRibbonOverlay
        canvasFocusRef={canvasFocusRef}
        canvasViewport={canvasViewport}
        canvasRibbonRibbons={ribbonWithStatus}
        viewportSize={{ width: 400, height: 300 }}
        ribbonCommandContext={commandContext}
      />
    </div>
  );
  const viewport = canvasFocusRef.current;
  if (!viewport) throw new Error("Canvas viewport was not mounted");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(domRectFor(100, 50, 400, 300));
  const rerenderStatus = (nextCanvasViewport: CanvasViewport) => {
    view.rerender(
      <div ref={canvasFocusRef}>
        <VSCodeCanvasRibbonOverlay
          canvasFocusRef={canvasFocusRef}
          canvasViewport={nextCanvasViewport}
          canvasRibbonRibbons={ribbonWithStatus}
          viewportSize={{ width: 400, height: 300 }}
          ribbonCommandContext={commandContext}
        />
      </div>
    );
  };
  return { rerenderStatus, view, viewport };
};

describe("VSCodeCanvasRibbonOverlay Canvas status", () => {
  it("formats zoom as an integer percent and starts with unavailable coordinates", () => {
    renderStatus({ panX: 20, panY: -10, zoom: 1.234 });

    expect(screen.getByRole("status", {
      name: "Canvas status: ZOOM: 123%, X: —, Y: —"
    })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM123%X—Y—");
    expect(screen.queryByText("px/mm")).not.toBeInTheDocument();
  });

  it("tracks pointer world coordinates locally and preserves Y-up semantics", () => {
    const { viewport } = renderStatus({ panX: 20, panY: -10, zoom: 2 });

    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 150 });
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM200%X-35.0Y20.0");

    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 250 });
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM200%X-35.0Y-30.0");

    fireEvent.pointerLeave(viewport);
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM200%X—Y—");
  });

  it("refreshes stationary-pointer coordinates when the viewport zooms and pans", () => {
    const { rerenderStatus, viewport } = renderStatus({ panX: 0, panY: 0, zoom: 1 });

    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 150 });
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM100%X-50.0Y50.0");

    rerenderStatus({ panX: 0, panY: 0, zoom: 2 });
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM200%X-25.0Y25.0");

    rerenderStatus({ panX: 20, panY: -10, zoom: 2 });
    expect(screen.getByRole("status", { name: /Canvas status:/ })).toHaveTextContent("ZOOM200%X-35.0Y20.0");
  });

  it("renders the status as a read-only value item without dispatching commands", () => {
    const onCommand = vi.fn();
    const canvasFocusRef = createRef<HTMLDivElement>();
    render(
      <div ref={canvasFocusRef}>
        <VSCodeCanvasRibbonOverlay
          canvasFocusRef={canvasFocusRef}
          canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
          canvasRibbonRibbons={ribbonWithStatus}
          viewportSize={{ width: 400, height: 300 }}
          ribbonCommandContext={commandContext}
          onCommand={onCommand}
        />
      </div>
    );

    const status = screen.getByRole("status", { name: /Canvas status:/ });
    expect(status).not.toBeInstanceOf(HTMLButtonElement);
    expect(status).not.toHaveAttribute("data-command-id");
    fireEvent.click(status);
    expect(onCommand).not.toHaveBeenCalled();
  });
});
