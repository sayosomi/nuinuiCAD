import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { CadElement, PrintLayout } from "../types/geometry";
import { DEFAULT_PRINT_LAYOUT, normalizePrintLayout, resolvePrintLayout } from "./printLayout";

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
  expanded: true,
  printEnabled: true,
  printAnchor: { mode: "coordinate", x: 0, y: 0 }
};

const elements = [variable, group];

describe("printLayout", () => {
  it("normalizes print layout numeric expressions without breaking numeric values", () => {
    const layout = normalizePrintLayout({
      ...DEFAULT_PRINT_LAYOUT,
      columns: "3",
      scale: { kind: "expression", expression: "@scale-var" },
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

    expect(layout.columns).toBe(3);
    expect(layout.scale).toEqual({ kind: "expression", expression: "@scale-var" });
    expect(layout.placements[0]).toMatchObject({
      x: { kind: "expression", expression: "@scale-var * 10" },
      y: 20,
      angleDeg: 15
    });
  });

  it("resolves print layout expressions with global variables and clamps page counts", () => {
    const layout: PrintLayout = {
      ...DEFAULT_PRINT_LAYOUT,
      columns: { kind: "expression", expression: "30" },
      scale: { kind: "expression", expression: "@scale-var" },
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
    expect(resolved.placements[0].x).toBe(15);
  });
});
