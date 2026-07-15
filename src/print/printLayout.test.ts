import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { CadElement, PrintLayout } from "../types/geometry";
import {
  activePrintLayout,
  DEFAULT_PRINT_LAYOUT,
  normalizePrintLayout,
  resolvePrintLayout
} from "./printLayout";

const variable: CadElement = {
  id: "scale-var",
  name: "倍率",
  type: "variable",
  visible: true,
  enabled: true,
  scope: "global",
  valueMode: "expression",
  expression: 1.5,
  point1: { mode: "coordinate", x: 0, y: 0 },
  point2: { mode: "coordinate", x: 0, y: 0 },
  point: { mode: "coordinate", x: 0, y: 0 },
  lineId: ""
};

const group: CadElement = {
  id: "print-group",
  name: "印刷グループ",
  type: "group",
  visible: true,
  enabled: true,
  printEnabled: true,
  printAnchor: { mode: "coordinate", x: 0, y: 0 }
};

const elements = [variable, group];

describe("printLayout", () => {
  it("resolves the active layout by id, then the first layout, then the default", () => {
    const first = { ...DEFAULT_PRINT_LAYOUT, id: "first", name: "First" };
    const active = { ...DEFAULT_PRINT_LAYOUT, id: "active", name: "Active" };

    expect(activePrintLayout([first, active], active.id)).toBe(active);
    expect(activePrintLayout([first, active], "missing")).toBe(first);
    expect(activePrintLayout([], "missing")).toBe(DEFAULT_PRINT_LAYOUT);
  });

  it("normalizes print layout numeric expressions without breaking numeric values", () => {
    const layout = normalizePrintLayout({
      ...DEFAULT_PRINT_LAYOUT,
      columns: "3",
      scale: { kind: "expression", expression: "@scale-var" },
      svgCanvasWidthMm: "@scale-var * 100",
      numericVariables: [
        { id: "print-variable-1", name: "余白", value: "@scale-var * 10" },
        { id: "broken-variable", name: 12, value: 10 }
      ],
      placements: [
        {
          id: "placement-1",
          groupId: group.id,
          x: { kind: "expression", expression: "@scale-var * 10" },
          y: 20,
          angleDeg: "15",
          mirrorX: false
        }
      ]
    }, elements);

    expect(layout.outputKind).toBe("pdf");
    expect(layout.columns).toBe(3);
    expect(layout.scale).toEqual({ kind: "expression", expression: "@scale-var" });
    expect(layout.svgCanvasWidthMm).toEqual({ kind: "expression", expression: "@scale-var * 100" });
    expect(layout.numericVariables).toEqual([
      {
        id: "print-variable-1",
        name: "余白",
        value: { kind: "expression", expression: "@scale-var * 10" }
      }
    ]);
    expect(layout.placements[0]).toMatchObject({
      x: { kind: "expression", expression: "@scale-var * 10" },
      y: 20,
      angleDeg: 15
    });
  });

  it("normalizes SVG print layout output kind", () => {
    const layout = normalizePrintLayout({
      ...DEFAULT_PRINT_LAYOUT,
      outputKind: "svg"
    }, elements);

    expect(layout.outputKind).toBe("svg");
  });

  it("resolves print layout expressions with global variables and clamps page counts", () => {
    const layout: PrintLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      columns: { kind: "expression", expression: "30" },
      scale: { kind: "expression", expression: "@scale-var" },
      svgCanvasWidthMm: { kind: "expression", expression: "@scale-var * 100" },
      svgCanvasHeightMm: { kind: "expression", expression: "-20" },
      placements: [
        {
          id: "placement-1",
          groupId: group.id,
          x: { kind: "expression", expression: "@scale-var * 10" },
          y: 20,
          angleDeg: 0,
          mirrorX: false
        }
      ]
    };

    const resolved = resolvePrintLayout({
      layout,
      elements,
      evaluation: evaluateElements(elements)
    });

    expect(resolved.columns).toBe(20);
    expect(resolved.scale).toBe(1.5);
    expect(resolved.svgCanvasWidthMm).toBe(150);
    expect(resolved.svgCanvasHeightMm).toBe(1);
    expect(resolved.placements[0].x).toBe(15);
  });

  it("resolves print layout expressions with local print variables before globals", () => {
    const layout: PrintLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      scale: { kind: "expression", expression: "@倍率" },
      numericVariables: [
        { id: "print-scale", name: "倍率", value: 2 },
        { id: "print-spacing", name: "間隔", value: { kind: "expression", expression: "@倍率 * 10" } }
      ],
      placements: [
        {
          id: "placement-1",
          groupId: group.id,
          x: { kind: "expression", expression: "@間隔 + 5" },
          y: 20,
          angleDeg: 0,
          mirrorX: false
        }
      ]
    };

    const resolved = resolvePrintLayout({
      layout,
      elements,
      evaluation: evaluateElements(elements)
    });

    expect(resolved.numericVariables).toEqual([
      { id: "print-scale", name: "倍率", value: 2 },
      { id: "print-spacing", name: "間隔", value: 20 }
    ]);
    expect(resolved.scale).toBe(2);
    expect(resolved.placements[0].x).toBe(25);
  });
});
