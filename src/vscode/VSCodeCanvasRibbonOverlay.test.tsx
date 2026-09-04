import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasViewport } from "../state/cadUiStore";
import { estimatedRibbonSize } from "../components/commandRibbonFloatingGeometry";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";
import {
  VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH,
  vscodeCanvasStatusPresentationFor
} from "./vscodeCanvasRibbonStatus";
import { vscodeCanvasRibbonContextData } from "./protocol";

const ribbonWithStatus: VscodeCanvasRibbon[] = [{
  id: "ribbon",
  label: "Canvas Ribbon",
  x: null,
  y: 12,
  orientation: "horizontal",
  items: [{ id: "status", type: "value", valueId: "canvasZoom" }]
}];

const ribbonWithCommands: VscodeCanvasRibbon[] = [{
  id: "ribbon",
  label: "Canvas Ribbon",
  x: null,
  y: 12,
  orientation: "horizontal",
  items: [
    { id: "edit", type: "command", commandId: "editCanvasRibbon", icon: "settings-2", showLabel: false },
    { id: "point-names", type: "command", commandId: "toggleCanvasPointNames", icon: "tags", showLabel: false }
  ]
}];

const commandContext = {
  hasSelection: false,
  showCanvasPointNames: false,
  showCanvasGeometryNames: false,
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
  it("uses a stable presentation width estimate as status values change", () => {
    const baseViewport: CanvasViewport = { panX: 0, panY: 0, zoom: 1 };
    const presentationFor = (
      pointerWorldPoint: { x: number; y: number } | null,
      zoom = 1
    ) => ({
      id: "ribbon",
      label: "Canvas Ribbon",
      x: null,
      y: 12,
      orientation: "horizontal" as const,
      iconSize: 16,
      items: [vscodeCanvasStatusPresentationFor(
        "status",
        { ...baseViewport, zoom },
        pointerWorldPoint
      )]
    });

    const unavailable = presentationFor(null);
    const smallPositive = presentationFor({ x: 2.4, y: 3.5 }, 0.5);
    const coordinates = presentationFor({ x: 186.1, y: -183.4 });
    const largerCoordinates = presentationFor({ x: 1234.5, y: -987.6 }, 2.345);
    const unavailableItem = unavailable.items[0];
    const coordinatesItem = coordinates.items[0];

    expect(unavailableItem).toMatchObject({
      type: "value",
      estimatedWidth: VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH
    });
    expect(coordinatesItem).toMatchObject({
      type: "value",
      estimatedWidth: VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH
    });
    const widths = [unavailable, smallPositive, coordinates, largerCoordinates]
      .map((presentation) => estimatedRibbonSize(presentation).width);
    expect(new Set(widths)).toEqual(new Set([widths[0]]));
  });

  it("formats zoom as an integer percent and starts with unavailable coordinates", () => {
    renderStatus({ panX: 20, panY: -10, zoom: 1.234 });

    expect(document.querySelector(".command-ribbon")).toHaveAttribute(
      "data-vscode-context",
      vscodeCanvasRibbonContextData
    );
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

describe("VSCodeCanvasRibbonOverlay command presentation", () => {
  it("uses a concise localized tooltip for Edit Canvas Ribbon and informative defaults elsewhere", () => {
    const onCommand = vi.fn();
    const canvasFocusRef = createRef<HTMLDivElement>();
    const view = render(
      <div ref={canvasFocusRef}>
        <VSCodeCanvasRibbonOverlay
          canvasFocusRef={canvasFocusRef}
          canvasViewport={{ panX: 0, panY: 0, zoom: 1 }}
          canvasRibbonRibbons={ribbonWithCommands}
          viewportSize={{ width: 400, height: 300 }}
          ribbonCommandContext={commandContext}
          presentation={webviewCanvasPresentationFor(webviewPresentationFor("ja-JP"))}
          onCommand={onCommand}
        />
      </div>
    );

    const editButton = screen.getByRole("button", { name: "Canvas リボンを編集" });
    const editTooltip = document.getElementById(editButton.getAttribute("aria-describedby")!);
    expect(editButton).not.toHaveAttribute("title");
    expect(editTooltip?.textContent).toBe("Canvas リボンを編集");

    const pointNamesButton = screen.getByRole("button", { name: "点名" });
    const pointNamesTooltip = document.getElementById(pointNamesButton.getAttribute("aria-describedby")!);
    expect(pointNamesTooltip?.textContent).toBe("点名: Canvasの点名を表示または非表示にします。");
    expect(view.container.querySelector(".command-ribbon-handle")).toHaveAttribute("title", "ドラッグで移動");
    expect(view.container.querySelector(".command-ribbon")).toHaveAttribute(
      "data-vscode-context",
      vscodeCanvasRibbonContextData
    );

    fireEvent.click(editButton);
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "editCanvasRibbon",
      label: "Canvas リボンを編集",
      description: "Canvas リボン項目のVS Code設定を開きます。",
      tooltipText: "Canvas リボンを編集"
    }));
  });
});
