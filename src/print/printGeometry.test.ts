import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { CadElement, PrintLayout } from "../types/geometry";
import { printableGroups, printablePathsForLayout } from "./printGeometry";

const elements: CadElement[] = [
  {
    id: "print-group",
    name: "前身頃",
    type: "group",
    visible: true,
    enabled: true,
    expanded: true,
    printEnabled: true,
    printAnchor: { mode: "reference", pointId: "origin" }
  },
  {
    id: "origin",
    name: "基準",
    type: "freePoint",
    visible: true,
    enabled: true,
    parentGroupId: "print-group",
    x: 10,
    y: 0
  },
  {
    id: "end",
    name: "端",
    type: "freePoint",
    visible: true,
    enabled: true,
    parentGroupId: "print-group",
    x: 20,
    y: 0
  },
  {
    id: "printed-line",
    name: "印刷線",
    type: "line",
    visible: true,
    enabled: true,
    parentGroupId: "print-group",
    startPoint: { mode: "reference", pointId: "origin" },
    endPoint: { mode: "reference", pointId: "end" }
  },
  {
    id: "root-start",
    name: "root start",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "root-end",
    name: "root end",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 100,
    y: 0
  },
  {
    id: "root-line",
    name: "root line",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "root-start" },
    endPoint: { mode: "reference", pointId: "root-end" }
  },
  {
    id: "skip-group",
    name: "印刷しない",
    type: "group",
    visible: true,
    enabled: true,
    expanded: true,
    printEnabled: false,
    printAnchor: { mode: "coordinate", x: 0, y: 0 }
  }
];

const layout = (patch: Partial<PrintLayout> = {}): PrintLayout => ({
  id: "print-layout-1",
  name: "",
  paperSizeId: "a4",
  orientation: "portrait",
  columns: 1,
  rows: 1,
  overlapMm: 10,
  scale: 1,
  placements: [
    {
      id: "placement-1",
      groupId: "print-group",
      x: 50,
      y: 40,
      angleDeg: 0,
      mirrorX: false
    }
  ],
  ...patch
});

describe("printGeometry", () => {
  it("returns only groups explicitly enabled for printing", () => {
    expect(printableGroups(elements).map((group) => group.id)).toEqual(["print-group"]);
  });

  it("prints line geometry from placed groups and excludes root geometry", () => {
    const paths = printablePathsForLayout({
      elements,
      evaluation: evaluateElements(elements),
      layout: layout()
    });

    expect(paths).toEqual([
      expect.objectContaining({
        kind: "line",
        elementId: "printed-line",
        start: { x: 50, y: 40 },
        end: { x: 60, y: 40 }
      })
    ]);
  });

  it("applies linear scale and mirroring around the group print anchor", () => {
    const paths = printablePathsForLayout({
      elements,
      evaluation: evaluateElements(elements),
      layout: layout({
        scale: 0.5,
        placements: [
          {
            id: "placement-1",
            groupId: "print-group",
            x: 50,
            y: 40,
            angleDeg: 0,
            mirrorX: true
          }
        ]
      })
    });

    expect(paths[0]).toMatchObject({
      kind: "line",
      start: { x: 50, y: 40 },
      end: { x: 45, y: 40 }
    });
  });
});
