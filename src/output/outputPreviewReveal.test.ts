import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { OutputDrawable, OutputPlan } from "./outputCore";
import {
  outputPreviewRevealOutputKeyFor,
  resolveOutputPreviewReveal,
  type OutputPreviewRevealTarget
} from "./outputPreviewReveal";

const element = (id: string, type: CadElement["type"], parentGroupId?: string): CadElement => ({
  id,
  name: id,
  type,
  activity: "visible",
  ...(parentGroupId ? { parentGroupId } : {})
} as CadElement);

const drawable = (elementId: string, name = elementId): OutputDrawable => ({
  kind: "line",
  elementId,
  name,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  stroke: { widthMm: 0.2, style: "solid", colorHex: "#000000" }
});

const plan = (
  kind: "print" | "svg",
  outputId: string,
  layoutId: string,
  placements: readonly { id: string; drawables: readonly OutputDrawable[] }[]
): OutputPlan => ({
  kind,
  outputId,
  outputName: outputId,
  layoutId,
  placements: placements.map((placement) => ({
    id: placement.id,
    groupId: "G",
    origin: { x: 0, y: 0 },
    at: { x: 0, y: 0 },
    scale: 1,
    angleDeg: 0,
    mirror: false,
    drawables: [...placement.drawables]
  })),
  drawables: placements.flatMap((placement) => placement.drawables),
  renderedBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
  rustPayload: {
    version: 1,
    kind,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
    drawables: placements.flatMap((placement) => placement.drawables),
    ...(kind === "svg"
      ? { widthMm: 1, heightMm: 1, contentOrigin: { x: 0, y: 0 } }
      : { paper: { widthMm: 210, heightMm: 297 }, overlapMm: 0, stride: { x: 210, y: 297 }, pages: [] })
  } as OutputPlan["rustPayload"]
});

const elements = [
  element("G", "group"),
  element("A", "line", "G"),
  element("N", "group", "G"),
  element("B", "line", "N")
];

const target = (overrides: Partial<Extract<OutputPreviewRevealTarget, { kind: "geometry" }>> = {}): OutputPreviewRevealTarget => ({
  kind: "geometry",
  sourceStatementIndex: 1,
  runtimeElementIds: ["A"],
  ...overrides
});

describe("resolveOutputPreviewReveal", () => {
  const first = plan("print", "P1", "L1", [
    { id: "place-1", drawables: [drawable("A", "first-A"), drawable("B", "first-B")] },
    { id: "place-2", drawables: [drawable("A", "second-A"), drawable("B", "second-B")] }
  ]);
  const second = plan("svg", "S1", "L2", [
    { id: "place-3", drawables: [drawable("A", "third-A"), drawable("B", "third-B")] }
  ]);
  const plans = [first, second];

  it("keeps the current containing Output, otherwise uses source order, and fails closed", () => {
    const selected = resolveOutputPreviewReveal({
      target: target(),
      elements,
      plans,
      selectedOutputKey: outputPreviewRevealOutputKeyFor(second)
    });
    expect(selected.status).toBe("resolved");
    if (selected.status === "resolved") expect(selected.outputKey).toBe("svg:S1");

    const firstInSourceOrder = resolveOutputPreviewReveal({
      target: target(),
      elements,
      plans,
      selectedOutputKey: null
    });
    expect(firstInSourceOrder.status).toBe("resolved");
    if (firstInSourceOrder.status === "resolved") expect(firstInSourceOrder.outputKey).toBe("print:P1");

    expect(resolveOutputPreviewReveal({
      target: target({ runtimeElementIds: ["missing"] }),
      elements,
      plans,
      selectedOutputKey: null
    })).toEqual({ status: "failed", reason: "no-containing-output" });
  });

  it("highlights an exact Output or Layout as the whole plan", () => {
    const outputTarget: OutputPreviewRevealTarget = { kind: "output", outputKind: "print", outputId: "P1", sourceStatementIndex: 8 };
    const outputResult = resolveOutputPreviewReveal({ target: outputTarget, elements, plans, selectedOutputKey: null });
    expect(outputResult.status).toBe("resolved");
    if (outputResult.status === "resolved") expect(outputResult.highlightedDrawables).toBe(first.drawables);

    const layoutTarget: OutputPreviewRevealTarget = { kind: "layout", layoutId: "L1", sourceStatementIndex: 7 };
    const layoutResult = resolveOutputPreviewReveal({ target: layoutTarget, elements, plans, selectedOutputKey: null });
    expect(layoutResult.status).toBe("resolved");
    if (layoutResult.status === "resolved") expect(layoutResult.highlightedDrawables).toBe(first.drawables);
  });

  it("highlights only the exact place occurrence", () => {
    const result = resolveOutputPreviewReveal({
      target: { kind: "place", layoutId: "L1", placementId: "place-2", placementIndex: 1, sourceStatementIndex: 9 },
      elements,
      plans,
      selectedOutputKey: null
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.highlightedDrawables.map((item) => item.name)).toEqual(["second-A", "second-B"]);
  });

  it("matches nested group subtrees across repeated placements and retains duplicates in order", () => {
    const result = resolveOutputPreviewReveal({
      target: { kind: "group", sourceStatementIndex: 1, runtimeElementIds: ["G"] },
      elements,
      plans: [first],
      selectedOutputKey: null
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.highlightedDrawables.map((item) => item.name)).toEqual([
        "first-A", "first-B", "second-A", "second-B"
      ]);
    }
  });

  it("matches ordinary geometry occurrences without deduping repeated drawables", () => {
    const result = resolveOutputPreviewReveal({
      target: target({ runtimeElementIds: ["A"] }),
      elements,
      plans: [first],
      selectedOutputKey: null
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.highlightedDrawables.map((item) => item.name)).toEqual(["first-A", "second-A"]);
  });
});
