import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasViewport } from "../state/cadUiStore";
import { estimatedRibbonSize } from "../components/commandRibbonFloatingGeometry";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import { vscodeCanvasRibbonDefinitions } from "./vscodeCanvasRibbonConfig";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import { vscodeCanvasStatusPresentationFor } from "./vscodeCanvasRibbonStatus";

const commandContext = {
  showCanvasPointNames: true,
  showCanvasGeometryNames: false,
  showCanvasPoints: true,
  canvasGridEnabled: true,
  canvasGridSpacingMm: 10,
  canvasGridMajorEvery: 5,
  canvasGridSnapEnabled: true,
  canvasGridSnapAvailable: true
};

const renderOverlay = (
  options: {
    positions?: Parameters<typeof VSCodeCanvasRibbonOverlay>[0]["canvasRibbonPositions"];
    topInset?: number;
    viewportSize?: { width: number; height: number };
    onCommand?: (item: Parameters<NonNullable<Parameters<typeof VSCodeCanvasRibbonOverlay>[0]["onCommand"]>>[0]) => void;
    onPositionCommit?: (ribbonId: string, position: { x: number; y: number }) => void;
    canvasViewport?: CanvasViewport;
  } = {}
) => {
  const canvasFocusRef = createRef<HTMLDivElement>();
  return render(
    <div ref={canvasFocusRef}>
      <VSCodeCanvasRibbonOverlay
        canvasFocusRef={canvasFocusRef}
        canvasViewport={options.canvasViewport ?? { panX: 0, panY: 0, zoom: 1 }}
        canvasRibbonPositions={options.positions ?? {}}
        viewportSize={options.viewportSize ?? { width: 640, height: 480 }}
        canvasModeChromeHeight={options.topInset}
        ribbonCommandContext={commandContext}
        onCommand={options.onCommand}
        onPositionCommit={options.onPositionCommit}
      />
    </div>
  );
};

describe("VSCodeCanvasRibbonOverlay", () => {
  it("renders the fixed Viewport, Display, and Grid controls in product order", () => {
    const onCommand = vi.fn();
    const view = renderOverlay({ onCommand });
    const ribbons = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon")];
    expect(ribbons.map((ribbon) => ribbon.dataset.ribbonId)).toEqual(["viewport", "display", "grid"]);
    expect(ribbons.map((ribbon) => ribbon.querySelectorAll("[data-command-id]").length)).toEqual([4, 3, 3]);
    expect(ribbons[0]?.querySelector("[role=status]")).toHaveTextContent("ZOOM100%");
    expect([...ribbons[0]!.querySelectorAll("[data-command-id]")].map((node) => node.getAttribute("data-command-id")))
      .toEqual(["zoomOutCanvas", "zoomInCanvas", "resetCanvasView", "fitDrawing"]);
    expect([...ribbons[1]!.querySelectorAll("[data-command-id]")].map((node) => node.getAttribute("data-command-id")))
      .toEqual(["toggleCanvasPoints", "toggleCanvasPointNames", "toggleCanvasGeometryNames"]);
    expect([...ribbons[2]!.querySelectorAll("[data-command-id]")].map((node) => node.getAttribute("data-command-id")))
      .toEqual(["toggleCanvasGrid", "configureCanvasGrid", "toggleCanvasGridSnap"]);
    expect(ribbons[0]?.querySelector("[data-command-id='resetCanvasView'] svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Point Names" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Geometry Names" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Points" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Grid Settings: 10 mm · ×5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Grid Snap" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Zoom In" }));
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ commandId: "zoomInCanvas" }));
    expect(view.container.querySelector(".command-ribbon[data-ribbon-id='viewport']"))
      .not.toHaveAttribute("data-vscode-context");
  });

  it("uses the current Canvas status presentation without making it actionable", () => {
    const viewport = { panX: 12, panY: -7, zoom: 1.234 };
    const presentation = vscodeCanvasStatusPresentationFor("status", viewport, null);
    expect(presentation).toMatchObject({
      type: "value",
      label: "Canvas status",
      fields: [
        { label: "ZOOM", value: "123%" },
        { label: "X", value: "—" },
        { label: "Y", value: "—" }
      ]
    });
    expect(vscodeCanvasRibbonDefinitions[0]?.items[1]).toEqual({
      id: "canvas-status",
      type: "value",
      valueId: "canvasStatus"
    });
  });

  it("stacks defaults at the upper left, preserving spacing under Canvas chrome inset", () => {
    const view = renderOverlay({ topInset: 40 });
    const placedRibbons = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon-layer > div")];
    const actualPositions = placedRibbons.map((ribbon) => ({
      x: Number.parseFloat(ribbon.style.left),
      y: Number.parseFloat(ribbon.style.top)
    }));
    const heights = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon")]
      .map((ribbon) => estimatedRibbonSize({
        id: ribbon.dataset.ribbonId!,
        label: ribbon.dataset.ribbonId!,
        x: null,
        y: 0,
        orientation: "horizontal",
        iconSize: 16,
        items: []
      }).height);
    expect(actualPositions.map(({ x }) => x)).toEqual([8, 8, 8]);
    expect(actualPositions[0]?.y).toBe(48);
    expect((actualPositions[1]?.y ?? Number.NaN) - (actualPositions[0]?.y ?? Number.NaN) - (heights[0] ?? Number.NaN)).toBe(8);
    expect((actualPositions[2]?.y ?? Number.NaN) - (actualPositions[1]?.y ?? Number.NaN) - (heights[1] ?? Number.NaN)).toBe(8);
  });

  it("preserves the top inset and measured gaps when the full default stack cannot fit", () => {
    const view = renderOverlay({ topInset: 40, viewportSize: { width: 640, height: 120 } });
    const placedRibbons = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon-layer > div")];
    const heights = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon")]
      .map((ribbon) => estimatedRibbonSize({
        id: ribbon.dataset.ribbonId!,
        label: ribbon.dataset.ribbonId!,
        x: null,
        y: 0,
        orientation: "horizontal",
        iconSize: 16,
        items: []
      }).height);
    const positions = placedRibbons.map((ribbon) => Number.parseFloat(ribbon.style.top));

    expect(positions[0]).toBe(48);
    expect((positions[1] ?? Number.NaN) - (positions[0] ?? Number.NaN) - (heights[0] ?? Number.NaN)).toBe(8);
    expect((positions[2] ?? Number.NaN) - (positions[1] ?? Number.NaN) - (heights[1] ?? Number.NaN)).toBe(8);
  });

  it("uses independent persisted positions and commits only the Ribbon dragged", () => {
    const onPositionCommit = vi.fn();
    const view = renderOverlay({
      positions: { viewport: { x: 80, y: 110 } },
      onPositionCommit
    });
    const placedRibbons = [...view.container.querySelectorAll<HTMLElement>(".command-ribbon-layer > div")];
    expect(placedRibbons[0]).toHaveStyle({ left: "80px", top: "110px" });
    expect(placedRibbons[1]).toHaveStyle({ left: "8px", top: "48px" });
    const displayHandle = screen.getByRole("button", { name: "Move Display" });
    fireEvent.pointerDown(displayHandle, { button: 0, pointerId: 7, clientX: 8, clientY: 48 });
    fireEvent.pointerMove(displayHandle, { pointerId: 7, clientX: 38, clientY: 78 });
    fireEvent.pointerUp(displayHandle, { pointerId: 7, clientX: 38, clientY: 78 });
    expect(onPositionCommit).toHaveBeenCalledTimes(1);
    expect(onPositionCommit).toHaveBeenCalledWith("display", { x: 38, y: 78 });
  });

  it("clamps presentation on resize without changing or committing stored coordinates", () => {
    const onPositionCommit = vi.fn();
    const view = renderOverlay({
      positions: { grid: { x: 600, y: 440 } },
      viewportSize: { width: 640, height: 480 },
      onPositionCommit
    });
    const original = view.container.querySelector<HTMLElement>("[data-ribbon-id='grid']")?.parentElement;
    expect(original?.style.left).not.toBe("600px");
    view.rerender(
      <VSCodeCanvasRibbonOverlay
        canvasFocusRef={createRef<HTMLDivElement>()}
        canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
        canvasRibbonPositions={{ grid: { x: 600, y: 440 } }}
        viewportSize={{ width: 180, height: 90 }}
        ribbonCommandContext={commandContext}
        onPositionCommit={onPositionCommit}
      />
    );
    expect(onPositionCommit).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-ribbon-id='grid']")?.parentElement).toHaveStyle({ left: "0px" });
  });

  it("keeps the existing Grid command owner and current-value interaction", () => {
    expect(vscodeCanvasRibbonCommandFor("configureCanvasGrid")?.hostAction).toBe("configureCanvasGrid");
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasGrid")?.hostAction).toBe("toggleCanvasGrid");
    expect(vscodeCanvasRibbonCommandFor("toggleCanvasGridSnap")?.hostAction).toBe("toggleCanvasGridSnap");
    const onCommand = vi.fn();
    renderOverlay({ onCommand });
    fireEvent.click(screen.getByRole("button", { name: "Grid Settings: 10 mm · ×5" }));
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ commandId: "configureCanvasGrid" }));
  });
});
