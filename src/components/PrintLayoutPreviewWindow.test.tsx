import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement, PrintLayout } from "../types/geometry";
import { PrintLayoutPreviewWindow } from "./PrintLayoutPreviewWindow";

const elements: CadElement[] = [
  {
    id: "print-group",
    name: "前身頃",
    type: "group",
    activity: "visible",
    printEnabled: true,
    printAnchor: { mode: "coordinate", x: 0, y: 0 }
  },
  {
    id: "origin",
    name: "基準",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "print-group",
    x: 0,
    y: 0
  },
  {
    id: "end",
    name: "端",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "print-group",
    x: 20,
    y: 0
  },
  {
    id: "printed-line",
    name: "印刷線",
    type: "line",
    activity: "visible",
    parentGroupId: "print-group",
    startPoint: { mode: "reference", pointId: "origin" },
    endPoint: { mode: "reference", pointId: "end" }
  },
  {
    id: "printed-text",
    name: "注記",
    type: "text",
    activity: "visible",
    parentGroupId: "print-group",
    text: "前中心\n地の目",
    anchor: { mode: "reference", pointId: "origin" },
    fontSize: 4
  }
];

const baseLayout: PrintLayout = {
  id: "layout-1",
  name: "プレビュー",
  outputKind: "pdf",
  paperSizeId: "a4",
  orientation: "portrait",
  columns: 1,
  rows: 1,
  overlapMm: 10,
  scale: 2,
  svgCanvasWidthMm: 410,
  svgCanvasHeightMm: 584,
  placements: [
    {
      id: "placement-1",
      groupId: "print-group",
      x: 50,
      y: 40,
      angleDeg: 0,
      mirrorX: false
    }
  ]
};

const renderPreview = (layout: PrintLayout) => {
  useCadDocumentStore.setState({
    elements,
    printLayouts: [layout],
    activePrintLayoutId: layout.id,
    evaluationLimitIndex: elements.length,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
  useCadUiStore.setState({
    ...initialCadUiState(),
    selectedElementId: elements[0].id,
    selectedElementIds: [elements[0].id],
    selectionAnchorElementId: elements[0].id,
    printPreviewWindow: {
      ...initialCadUiState().printPreviewWindow,
      layoutId: layout.id
    }
  });

  return render(
    <PrintLayoutPreviewWindow
      evaluation={evaluateElements(elements)}
      workspaceRef={createRef<HTMLDivElement>()}
    />
  );
};

describe("PrintLayoutPreviewWindow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders printable text in page-tiled preview mode with export-consistent Y-up placement", () => {
    const view = renderPreview(baseLayout);

    expect(screen.getByText("前中心")).toBeInTheDocument();
    expect(screen.getByText("地の目")).toBeInTheDocument();
    expect(view.container.querySelector(".print-page-tile rect")).toBeInTheDocument();

    const text = screen.getByText("前中心").closest("text");
    expect(text).not.toBeNull();
    expect(text).toHaveAttribute("x", "82");
    expect(text).toHaveAttribute("y", "289");
    expect(text).toHaveAttribute("font-size", "8");
    expect(text).toHaveAttribute("dominant-baseline", "text-before-edge");
  });

  it("renders printable text in SVG canvas preview mode without page tiles", () => {
    const view = renderPreview({
      ...baseLayout,
      outputKind: "svg",
      svgCanvasWidthMm: 120,
      svgCanvasHeightMm: 90
    });

    expect(screen.getByText("前中心")).toBeInTheDocument();
    expect(view.container.querySelector(".print-page-tile")).not.toBeInTheDocument();
    expect(view.container.querySelector(".print-preview-svg")).toHaveAttribute("viewBox", "0 0 184 154");

    const text = screen.getByText("前中心").closest("text");
    expect(text).not.toBeNull();
    expect(text).toHaveAttribute("x", "82");
    expect(text).toHaveAttribute("y", "82");
    expect(text).toHaveAttribute("font-size", "8");
  });
});
