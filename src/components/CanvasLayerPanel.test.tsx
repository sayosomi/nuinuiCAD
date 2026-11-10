import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasLayerRow } from "../model/canvasLayerPresentation";
import { CanvasLayerPanel } from "./CanvasLayerPanel";

const layers: CanvasLayerRow[] = [
  { id: 'canvas-layer-name:"default"', name: "default", label: "default", isDefault: true },
  { id: 'canvas-layer-name:"draft"', name: "draft", label: "draft", isDefault: false }
];
const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

type Rect = { left: number; top: number; width: number; height: number };
type PanelMeasurements = {
  viewport: Rect;
  panel: { width: number; height: number };
  ribbons: Map<number, Rect>;
};

const domRect = ({ left, top, width, height }: Rect): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({})
});

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  static notify(target: Element) {
    for (const observer of TestResizeObserver.instances) {
      if (!observer.targets.has(target)) continue;
      observer.callback([{ target } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    }
  }
}

const installMeasurements = (measurements: PanelMeasurements) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains("canvas-viewport")) return domRect(measurements.viewport);
    if (this.classList.contains("canvas-layer-panel")) {
      const left = measurements.viewport.left + (Number.parseFloat(this.style.left) || 0);
      const top = measurements.viewport.top + (Number.parseFloat(this.style.top) || 0);
      return domRect({ left, top, ...measurements.panel });
    }
    if (this.classList.contains("test-ribbon-container")) {
      const index = Number(this.dataset.ribbonIndex);
      return domRect(measurements.ribbons.get(index) ?? { left: 0, top: 0, width: 0, height: 0 });
    }
    return domRect({ left: 0, top: 0, width: 0, height: 0 });
  });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
};

const renderPanel = ({
  measurements,
  ribbonIndices = [...measurements.ribbons.keys()],
  topInset = 0,
  onToggle = vi.fn()
}: {
  measurements: PanelMeasurements;
  ribbonIndices?: number[];
  topInset?: number;
  onToggle?: (layerId: string) => void;
}) => {
  installMeasurements(measurements);
  const view = render(
    <div className="canvas-viewport">
      <CanvasLayerPanel layers={layers} hiddenLayerIds={new Set()} onToggle={onToggle} topInset={topInset} />
      <div className="command-ribbon-layer">
        {ribbonIndices.map((index) => <div key={index} data-ribbon-index={index} className="test-ribbon-container">
          <div className="command-ribbon">
            <div className="command-ribbon-buttons"><button type="button">Ribbon action</button></div>
          </div>
        </div>)}
      </div>
    </div>
  );
  const panel = view.container.querySelector<HTMLElement>(".canvas-layer-panel");
  const viewport = view.container.querySelector<HTMLElement>(".canvas-viewport");
  const layer = view.container.querySelector<HTMLElement>(".command-ribbon-layer");
  if (!panel || !viewport || !layer) throw new Error("Expected Layers panel and Canvas ribbon viewport");
  return { ...view, panel, viewport, layer, onToggle };
};

const positionOf = (panel: HTMLElement) => ({
  left: Number.parseFloat(panel.style.left),
  top: Number.parseFloat(panel.style.top)
});

const expectClearance = (panel: HTMLElement, ribbon: HTMLElement, gap = 8) => {
  const panelLeft = positionOf(panel).left;
  const panelTop = positionOf(panel).top;
  const panelRight = panelLeft + 160;
  const panelBottom = panelTop + 120;
  const ribbonRect = ribbon.getBoundingClientRect();
  const viewportRect = ribbon.closest(".canvas-viewport")!.getBoundingClientRect();
  const ribbonLeft = ribbonRect.left - viewportRect.left;
  const ribbonTop = ribbonRect.top - viewportRect.top;
  const ribbonRight = ribbonRect.right - viewportRect.left;
  const ribbonBottom = ribbonRect.bottom - viewportRect.top;
  expect(
    panelRight <= ribbonLeft - gap ||
      panelLeft >= ribbonRight + gap ||
      panelBottom <= ribbonTop - gap ||
      panelTop >= ribbonBottom + gap
  ).toBe(true);
};

afterEach(() => {
  TestResizeObserver.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Canvas layer panel", () => {
  it("places itself at the upper-right clear of the measured default ribbon stack", () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 40, top: 60, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map([
        [0, { left: 48, top: 68, width: 140, height: 34 }],
        [1, { left: 48, top: 110, width: 140, height: 34 }],
        [2, { left: 48, top: 152, width: 140, height: 34 }]
      ])
    };
    const { panel, layer } = renderPanel({ measurements });

    expect(positionOf(panel)).toEqual({ left: 236, top: 4 });
    for (const ribbon of layer.querySelectorAll<HTMLElement>(".test-ribbon-container")) {
      expectClearance(panel, ribbon);
    }
  });

  it("chooses a collision-free alternative below a saved upper-right ribbon", () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map([
        [0, { left: 8, top: 8, width: 140, height: 34 }],
        [1, { left: 8, top: 50, width: 140, height: 34 }],
        [2, { left: 8, top: 92, width: 140, height: 34 }],
        [3, { left: 250, top: 8, width: 140, height: 40 }]
      ])
    };
    const { panel, layer } = renderPanel({ measurements });

    expect(positionOf(panel)).toEqual({ left: 236, top: 56 });
    for (const ribbon of layer.querySelectorAll<HTMLElement>(".test-ribbon-container")) {
      expectClearance(panel, ribbon);
    }
  });

  it("recalculates after delayed ribbon rendering and measurement", async () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map()
    };
    const { panel, layer } = renderPanel({ measurements, ribbonIndices: [] });
    expect(positionOf(panel)).toEqual({ left: 236, top: 4 });

    measurements.ribbons.set(0, { left: 250, top: 8, width: 140, height: 40 });
    const delayedRibbon = document.createElement("div");
    delayedRibbon.className = "test-ribbon-container";
    delayedRibbon.dataset.ribbonIndex = "0";
    delayedRibbon.innerHTML = '<div class="command-ribbon"><div class="command-ribbon-buttons"><button>Ribbon action</button></div></div>';
    act(() => layer.append(delayedRibbon));

    await waitFor(() => expect(positionOf(panel)).toEqual({ left: 236, top: 56 }));
    expectClearance(panel, delayedRibbon);
  });

  it("tracks ribbon movement and resizing before manual panel movement", async () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map([[0, { left: 8, top: 8, width: 140, height: 40 }]])
    };
    const { panel, layer } = renderPanel({ measurements });
    const ribbon = layer.querySelector<HTMLElement>(".test-ribbon-container")!;
    expect(positionOf(panel)).toEqual({ left: 236, top: 4 });

    measurements.ribbons.set(0, { left: 250, top: 8, width: 140, height: 40 });
    ribbon.style.left = "250px";
    await waitFor(() => expect(positionOf(panel)).toEqual({ left: 236, top: 56 }));
    expectClearance(panel, ribbon);

    measurements.ribbons.set(0, { left: 250, top: 8, width: 100, height: 150 });
    ribbon.style.width = "100px";
    act(() => TestResizeObserver.notify(ribbon));
    await waitFor(() => expect(positionOf(panel)).toEqual({ left: 198, top: 166 }));
    expectClearance(panel, ribbon);
  });

  it("keeps a dragged placement through ribbon changes and clamps it after viewport resizing", async () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map([[0, { left: 8, top: 8, width: 140, height: 40 }]])
    };
    const { panel, layer, viewport } = renderPanel({ measurements });
    const handle = screen.getByRole("button", { name: "Move Layers panel" });

    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 300, clientY: 20, pointerId: 5 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 400, clientY: 260, pointerId: 5 });
    fireEvent.pointerUp(handle, { buttons: 0, clientX: 400, clientY: 260, pointerId: 5 });
    expect(positionOf(panel)).toEqual({ left: 236, top: 176 });

    const ribbon = layer.querySelector<HTMLElement>(".test-ribbon-container")!;
    measurements.ribbons.set(0, { left: 250, top: 8, width: 140, height: 40 });
    ribbon.style.left = "250px";
    await waitFor(() => expect(positionOf(panel)).toEqual({ left: 236, top: 176 }));

    measurements.viewport = { left: 0, top: 0, width: 220, height: 180 };
    act(() => fireEvent(window, new Event("resize")));
    await waitFor(() => expect(positionOf(panel)).toEqual({ left: 56, top: 56 }));
    expect(positionOf(panel).left + 160).toBeLessThanOrEqual(220 - 4);
    expect(positionOf(panel).top + 120).toBeLessThanOrEqual(180 - 4);
    expect(viewport).toBeInTheDocument();
  });

  it("uses an in-bounds minimum-overlap fallback when no placement can clear a ribbon", () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 180, height: 160 },
      panel: { width: 140, height: 100 },
      ribbons: new Map([[0, { left: 120, top: 0, width: 60, height: 160 }]])
    };
    const { panel } = renderPanel({ measurements, topInset: 40 });

    expect(positionOf(panel)).toEqual({ left: 4, top: 44 });
    expect(positionOf(panel).left).toBeGreaterThanOrEqual(4);
    expect(positionOf(panel).left + 140).toBeLessThanOrEqual(180 - 4);
    expect(positionOf(panel).top).toBeGreaterThanOrEqual(44);
    expect(positionOf(panel).top + 100).toBeLessThanOrEqual(160 - 4);
  });

  it("keeps the Canvas mode chrome inset clear at initial placement", () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map()
    };
    const { panel } = renderPanel({ measurements, ribbonIndices: [], topInset: 52 });

    expect(positionOf(panel)).toEqual({ left: 236, top: 56 });
  });

  it("keeps checkbox keyboard behavior, drag structure, list scroll surface, and pointer isolation", () => {
    const onToggle = vi.fn();
    const parentPointerDown = vi.fn();
    const parentWheel = vi.fn();
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 400, height: 300 },
      panel: { width: 160, height: 120 },
      ribbons: new Map()
    };
    installMeasurements(measurements);
    const view = render(
      <div onPointerDown={parentPointerDown} onWheel={parentWheel}>
        <div className="canvas-viewport">
          <CanvasLayerPanel layers={layers} hiddenLayerIds={new Set()} onToggle={onToggle} />
        </div>
      </div>
    );
    const checkbox = screen.getByRole("checkbox", { name: "Show layer draft" }) as HTMLInputElement;
    const list = view.container.querySelector<HTMLElement>(".canvas-layer-list")!;
    const handle = screen.getByRole("button", { name: "Move Layers panel" });

    expect(screen.getByText("Layers")).toBeInTheDocument();
    expect(handle).toHaveClass("command-ribbon-handle", "canvas-layer-move-handle");
    expect(handle.querySelector(".command-ribbon-grip")).toHaveTextContent("⋮⋮");
    expect(handle).toHaveAttribute("title", "Drag to move Layers panel");
    expect(view.container).not.toHaveTextContent("⠿ Move");
    expect(list).toHaveAttribute("aria-label", "Layer visibility list");
    expect(list).toHaveClass("canvas-layer-list");
    expect(checkbox.type).toBe("checkbox");

    checkbox.focus();
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    checkbox.dispatchEvent(tabEvent);
    const spaceEvent = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    checkbox.dispatchEvent(spaceEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(spaceEvent.defaultPrevented).toBe(false);

    fireEvent.pointerDown(checkbox, { button: 0, buttons: 1, pointerId: 2 });
    fireEvent.wheel(list, { deltaY: 50 });
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentWheel).not.toHaveBeenCalled();
    const listRule = stylesheet.match(/\.canvas-layer-list\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(listRule).toMatch(/max-height:\s*min\(30vh,\s*220px\)/);
    expect(listRule).toMatch(/overflow:\s*auto/);

    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(layers[1]!.id);
  });

  it("connects the ribbon-style grip pointer handlers to a bounded panel drag", () => {
    const measurements: PanelMeasurements = {
      viewport: { left: 0, top: 0, width: 200, height: 150 },
      panel: { width: 120, height: 80 },
      ribbons: new Map()
    };
    const { panel } = renderPanel({ measurements, ribbonIndices: [] });
    const handle = screen.getByRole("button", { name: "Move Layers panel" });

    fireEvent.pointerDown(handle, { button: 0, buttons: 1, isPrimary: true, clientX: 10, clientY: 10, pointerId: 5 });
    fireEvent.pointerMove(handle, { buttons: 1, clientX: 190, clientY: 140, pointerId: 5 });
    fireEvent.pointerUp(handle, { buttons: 0, clientX: 190, clientY: 140, pointerId: 5 });

    expect(positionOf(panel)).toEqual({ left: 76, top: 66 });
  });
});
