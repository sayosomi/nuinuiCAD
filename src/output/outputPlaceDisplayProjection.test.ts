import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText, isLastGoodDslDocument } from "@nuinuicad/nui-language/document";
import {
  evaluateOutputPlan,
  rebuildOutputPlanFromResolvedPlacements,
  type OutputBounds,
  type OutputDrawable,
  type OutputPlan,
  type OutputPlacementPlan
} from "./outputCore";
import { projectOutputPlanForPlaceTranslation } from "./outputPlaceDisplayProjection";

const stroke = { widthMm: 2, style: "solid" as const, colorHex: "#123456" };
const bounds = (minX: number, minY: number, maxX: number, maxY: number): OutputBounds => ({
  minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY
});

const lineAt = (x: number): OutputDrawable => ({
  kind: "line",
  elementId: "AB",
  name: "AB",
  start: { x, y: 0 },
  end: { x: x + 10, y: 0 },
  stroke
});

const outputPlan = (kind: "print" | "svg", placements: OutputPlacementPlan[]): OutputPlan => {
  const drawables = placements.flatMap((placement) => placement.drawables);
  const renderedBounds = bounds(-1, -1, 31, 1);
  if (kind === "print") {
    const pages = [{ index: 0, column: 0, row: 0, origin: { x: -10, y: -10 }, guides: [] }];
    const payload = {
      version: 1 as const,
      kind: "print" as const,
      bounds: renderedBounds,
      drawables,
      paper: { widthMm: 210, heightMm: 297 },
      overlapMm: 10,
      stride: { x: 190, y: 277 },
      pages
    };
    return {
      kind,
      outputId: "output",
      outputName: "Sheet",
      layoutId: "layout",
      empty: false,
      placements,
      drawables,
      renderedBounds,
      bounds: renderedBounds,
      rustPayload: payload,
      print: {
        paper: "a4",
        orientation: "portrait",
        paperWidthMm: 210,
        paperHeightMm: 297,
        overlapMm: 10,
        strideXmm: 190,
        strideYmm: 277,
        columns: 1,
        rows: 1,
        pages
      }
    };
  }

  const svgBounds = bounds(-4, -4, 34, 4);
  return {
    kind,
    outputId: "output",
    outputName: "Preview",
    layoutId: "layout",
    marginMm: 3,
    empty: false,
    placements,
    drawables,
    renderedBounds,
    bounds: svgBounds,
    rustPayload: {
      version: 1,
      kind: "svg",
      bounds: renderedBounds,
      drawables,
      widthMm: 38,
      heightMm: 8,
      contentOrigin: { x: -4, y: -4 }
    },
    svg: { widthMm: 38, heightMm: 8, viewBox: { x: 0, y: 0, width: 38, height: 8 } }
  };
};

const pageBoundaryPlacements = (): OutputPlacementPlan[] => [
  {
    id: "first",
    groupId: "G",
    origin: { x: 3, y: 4 },
    at: { x: 0, y: 0 },
    scale: 2,
    angleDeg: 30,
    mirror: true,
    drawables: [lineAt(0)]
  },
  {
    id: "second",
    groupId: "G",
    origin: { x: 3, y: 4 },
    at: { x: 20, y: 0 },
    scale: 0.5,
    angleDeg: 15,
    mirror: false,
    drawables: [lineAt(20)]
  }
];

describe("Output Preview place display projection", () => {
  it("translates every drawable position for exactly one repeated Group occurrence", () => {
    const path = {
      kind: "bezier" as const,
      elementId: "curve",
      name: "Curve",
      start: { x: 0, y: 0 },
      control1: { x: 1, y: 2 },
      control2: { x: 3, y: 4 },
      end: { x: 5, y: 6 },
      stroke
    };
    const offsetLine = {
      kind: "offsetLine" as const,
      elementId: "offset",
      name: "Offset",
      segments: [
        { kind: "line" as const, start: { x: 0, y: 1 }, end: { x: 1, y: 2 } },
        { kind: "bezier" as const, start: { x: 1, y: 2 }, control1: { x: 2, y: 3 }, control2: { x: 3, y: 4 }, end: { x: 4, y: 5 } },
        { kind: "arc" as const, center: { x: 3, y: 4 }, radius: 2, startAngleDeg: 10, sweepAngleDeg: 40 }
      ],
      stroke
    };
    const mirrorCopyJoinedPath = {
      kind: "joinedPath" as const,
      elementId: "mirror-owner",
      name: "Mirror",
      segments: [
        { kind: "line" as const, start: { x: 2, y: 3 }, end: { x: 4, y: 5 } },
        { kind: "arc" as const, center: { x: 5, y: 6 }, radius: 3, startAngleDeg: 45, sweepAngleDeg: -90 }
      ],
      stroke
    };
    const polyline = {
      kind: "polyline" as const,
      elementId: "polyline",
      name: "Polyline",
      segments: [{ kind: "line" as const, start: { x: 6, y: 7 }, end: { x: 8, y: 9 } }],
      closed: true,
      stroke
    };
    const text = {
      kind: "text" as const,
      elementId: "label",
      name: "Label",
      text: "grain",
      anchor: { x: 3, y: 4 },
      fontSizeMm: 4,
      widthMm: 9,
      lineWidthsMm: [9],
      lineAdvancesMm: [[4, 5]],
      lineHeightMm: 5,
      rotationDeg: 25,
      mirrorX: true,
      colorHex: "#334455"
    };
    const selected: OutputDrawable[] = [lineAt(1), path, {
      kind: "arc", elementId: "arc", name: "Arc", center: { x: 2, y: 3 },
      radius: 4, startAngleDeg: 20, sweepAngleDeg: 80, stroke
    }, offsetLine, mirrorCopyJoinedPath, polyline, text];
    const placements = [
      { ...pageBoundaryPlacements()[0]!, drawables: selected },
      pageBoundaryPlacements()[1]!
    ];
    const accepted = outputPlan("print", placements);
    const projected = projectOutputPlanForPlaceTranslation({
      acceptedPlan: accepted,
      placeId: "first",
      delta: { x: 7, y: -11 }
    });
    if (!projected) throw new Error("missing projected display plan");

    expect(projected.placements[0]).toMatchObject({
      id: "first",
      groupId: "G",
      origin: { x: 3, y: 4 },
      at: { x: 7, y: -11 },
      scale: 2,
      angleDeg: 30,
      mirror: true
    });
    expect(projected.placements[1]).toBe(accepted.placements[1]);
    expect(projected.drawables).toEqual([
      { ...selected[0]!, start: { x: 8, y: -11 }, end: { x: 18, y: -11 } },
      { ...path, start: { x: 7, y: -11 }, control1: { x: 8, y: -9 }, control2: { x: 10, y: -7 }, end: { x: 12, y: -5 } },
      { ...selected[2]!, center: { x: 9, y: -8 } },
      {
        ...offsetLine,
        segments: [
          { kind: "line", start: { x: 7, y: -10 }, end: { x: 8, y: -9 } },
          { kind: "bezier", start: { x: 8, y: -9 }, control1: { x: 9, y: -8 }, control2: { x: 10, y: -7 }, end: { x: 11, y: -6 } },
          { kind: "arc", center: { x: 10, y: -7 }, radius: 2, startAngleDeg: 10, sweepAngleDeg: 40 }
        ]
      },
      {
        ...mirrorCopyJoinedPath,
        segments: [
          { kind: "line", start: { x: 9, y: -8 }, end: { x: 11, y: -6 } },
          { kind: "arc", center: { x: 12, y: -5 }, radius: 3, startAngleDeg: 45, sweepAngleDeg: -90 }
        ]
      },
      { ...polyline, segments: [{ kind: "line", start: { x: 13, y: -4 }, end: { x: 15, y: -2 } }] },
      { ...text, anchor: { x: 10, y: -7 } },
      ...accepted.placements[1]!.drawables
    ]);
    expect(projected.placements[0]!.drawables[0]).toMatchObject({
      elementId: "AB", name: "AB", stroke: { widthMm: 2, style: "solid", colorHex: "#123456" }
    });
    expect(accepted.placements[0]!.at).toEqual({ x: 0, y: 0 });
    expect(accepted.placements[0]!.drawables).toEqual(selected);
  });

  it("reuses stroke-inclusive bounds, SVG margin, and print tiling at page-boundary crossings", () => {
    const placements = pageBoundaryPlacements();
    const print = projectOutputPlanForPlaceTranslation({
      acceptedPlan: outputPlan("print", placements),
      placeId: "first",
      delta: { x: 200, y: 0 }
    });
    const svg = projectOutputPlanForPlaceTranslation({
      acceptedPlan: outputPlan("svg", placements),
      placeId: "first",
      delta: { x: 200, y: 0 }
    });
    if (!print || !svg || print.print?.pages.length !== 2) throw new Error("missing crossed print pages");

    expect(print.renderedBounds).toEqual({ minX: 19, minY: -1, maxX: 211, maxY: 1, width: 192, height: 2 });
    expect(print.bounds).toEqual(print.renderedBounds);
    expect(print.print).toMatchObject({
      paperWidthMm: 210,
      paperHeightMm: 297,
      overlapMm: 10,
      strideXmm: 190,
      strideYmm: 277,
      columns: 2,
      rows: 1
    });
    expect(print.print.pages.map((page) => page.origin)).toEqual([
      { x: -10, y: -10 },
      { x: 180, y: -10 }
    ]);
    expect(print.print.warning).toEqual({ kind: "negative-rendered-bounds" });
    expect(print.print.pages[0]!.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 200)?.label)
      .toMatchObject({ text: "1", center: { x: 205, y: 148.5 } });
    expect(print.print.pages[1]!.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 10)?.label)
      .toMatchObject({ text: "1", center: { x: 5, y: 148.5 } });
    expect(print.rustPayload.kind === "print" && print.rustPayload.pages.map((page) => page.origin)).toEqual([
      { x: -10, y: -10 },
      { x: 180, y: -10 }
    ]);

    expect(svg.renderedBounds).toEqual({ minX: 19, minY: -1, maxX: 211, maxY: 1, width: 192, height: 2 });
    expect(svg.bounds).toEqual({ minX: 16, minY: -4, maxX: 214, maxY: 4, width: 198, height: 8 });
    expect(svg.svg).toMatchObject({ widthMm: 198, heightMm: 8, viewBox: { x: 0, y: 0, width: 198, height: 8 } });
    expect(svg.rustPayload.kind === "svg" && svg.rustPayload.contentOrigin).toEqual({ x: 16, y: -4 });
  });

  it("matches canonical output recomputed from the patched place coordinate", async () => {
    const source = [
      "nui 1",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "  place G(at: (20, 5))",
      "}",
      "print Sheet(layout: L, layers: [default], paper: a4, overlap: 10)",
      "svg Preview(layout: L, layers: [default], margin: 3)"
    ].join("\n");
    const movedSource = source.replace("place G(at: (0, 0))", "place G(at: (7, 1))");
    const original = compileFreshCanonicalText(source);
    if (original.status === "fatal") throw new Error("invalid projection fixture");
    const moved = compileDslDocument(movedSource, {
      assignedStatementIds: original.doc.statementMap.statementIdByStatementIndex,
      sourceRevision: original.doc.statementMap.sourceRevision + 1
    });
    if (!isLastGoodDslDocument(moved)) throw new Error("invalid moved projection fixture");
    const print = await evaluateOutputPlan({ compiledDocument: original.doc, output: original.doc.document.printOutputs[0]! });
    const svg = await evaluateOutputPlan({ compiledDocument: original.doc, output: original.doc.document.svgOutputs[0]! });
    const canonicalPrint = await evaluateOutputPlan({ compiledDocument: moved, output: moved.document.printOutputs[0]! });
    const canonicalSvg = await evaluateOutputPlan({ compiledDocument: moved, output: moved.document.svgOutputs[0]! });
    const firstPlaceId = original.doc.document.layouts[0]!.placements[0]!.id;

    const projectedPrint = projectOutputPlanForPlaceTranslation({
      acceptedPlan: print,
      placeId: firstPlaceId,
      delta: { x: 7, y: 1 }
    });
    expect(projectedPrint).toEqual(canonicalPrint);
    expect(projectedPrint?.print?.warning).toBeNull();
    expect(projectOutputPlanForPlaceTranslation({ acceptedPlan: svg, placeId: firstPlaceId, delta: { x: 7, y: 1 } }))
      .toEqual(canonicalSvg);
  });

  it("retains exact fractional SVG margin across large coordinates and repeated absolute movement", async () => {
    const source = [
      "nui 1",
      "group G {",
      "  line Large = segment(start: (100000000, 0), end: (100000010, 10))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg Sheet(layout: L, layers: [default], margin: 0.1)"
    ].join("\n");
    const original = compileFreshCanonicalText(source);
    if (original.status === "fatal") throw new Error("invalid large-coordinate fixture");
    const movedSource = source.replace("place G(at: (0, 0))", "place G(at: (0.2, 0.3))");
    const moved = compileDslDocument(movedSource, {
      assignedStatementIds: original.doc.statementMap.statementIdByStatementIndex,
      sourceRevision: original.doc.statementMap.sourceRevision + 1
    });
    if (!isLastGoodDslDocument(moved)) throw new Error("invalid moved large-coordinate fixture");
    const accepted = await evaluateOutputPlan({
      compiledDocument: original.doc,
      output: original.doc.document.svgOutputs[0]!
    });
    const canonical = await evaluateOutputPlan({
      compiledDocument: moved,
      output: moved.document.svgOutputs[0]!
    });
    const placeId = original.doc.document.layouts[0]!.placements[0]!.id;

    expect(() => rebuildOutputPlanFromResolvedPlacements(accepted, accepted.placements)).not.toThrow();
    const first = projectOutputPlanForPlaceTranslation({
      acceptedPlan: accepted,
      placeId,
      delta: { x: 0.2, y: 0.3 }
    });
    const repeated = projectOutputPlanForPlaceTranslation({
      acceptedPlan: accepted,
      placeId,
      delta: { x: 0.2, y: 0.3 }
    });
    if (!first || !repeated) throw new Error("missing large-coordinate projection");
    const line = first.placements[0]!.drawables.find((drawable) => drawable.kind === "line");
    const acceptedLine = accepted.placements[0]!.drawables.find((drawable) => drawable.kind === "line");
    if (!line || line.kind !== "line" || !acceptedLine || acceptedLine.kind !== "line") {
      throw new Error("missing large-coordinate line");
    }

    expect(line.start).toEqual({ x: acceptedLine.start.x + 0.2, y: acceptedLine.start.y + 0.3 });
    expect(first.renderedBounds.minX - first.bounds.minX).not.toBeCloseTo(0.1, 9);
    expect(first.renderedBounds.minY - first.bounds.minY).toBeCloseTo(0.1, 9);
    expect(first.marginMm).toBe(0.1);
    const halfStrokePlusMargin = line.stroke.widthMm / 2 + 0.1;
    expect(first.bounds.minX).toBeCloseTo(line.start.x - halfStrokePlusMargin, 6);
    expect(first.bounds.minY).toBeCloseTo(line.start.y - halfStrokePlusMargin, 9);
    expect(first.bounds.maxX).toBeCloseTo(line.end.x + halfStrokePlusMargin, 6);
    expect(first.bounds.maxY).toBeCloseTo(line.end.y + halfStrokePlusMargin, 9);
    expect(first.bounds.width).toBe(line.end.x - line.start.x + line.stroke.widthMm + 0.2);
    expect(first.bounds.height).toBe(line.end.y - line.start.y + line.stroke.widthMm + 0.2);
    expect(first).toEqual(canonical);
    expect(repeated).toEqual(first);
    expect(rebuildOutputPlanFromResolvedPlacements(accepted, [])).toMatchObject({
      empty: true,
      marginMm: 0.1,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
    });
    const emptySource = [
      "nui 1",
      "layout Empty {",
      "}",
      "svg EmptySheet(layout: Empty, layers: [default], margin: 0.1)"
    ].join("\n");
    const emptyCompiled = compileFreshCanonicalText(emptySource);
    if (emptyCompiled.status === "fatal") throw new Error("invalid empty-output fixture");
    const emptyAccepted = await evaluateOutputPlan({
      compiledDocument: emptyCompiled.doc,
      output: emptyCompiled.doc.document.svgOutputs[0]!
    });
    expect(emptyAccepted.empty).toBe(true);
    expect(emptyAccepted.marginMm).toBe(0.1);
    expect(rebuildOutputPlanFromResolvedPlacements(emptyAccepted, [])).toEqual(emptyAccepted);
  });

  it("fails closed for an unknown or ambiguous placement identity and ignores non-finite movement", () => {
    const accepted = outputPlan("print", pageBoundaryPlacements());
    expect(projectOutputPlanForPlaceTranslation({ acceptedPlan: accepted, placeId: "missing", delta: { x: 1, y: 0 } })).toBeNull();
    expect(projectOutputPlanForPlaceTranslation({ acceptedPlan: accepted, placeId: "first", delta: { x: Infinity, y: 0 } })).toBeNull();
    expect(projectOutputPlanForPlaceTranslation({
      acceptedPlan: outputPlan("print", [...pageBoundaryPlacements(), pageBoundaryPlacements()[0]!]),
      placeId: "first",
      delta: { x: 1, y: 0 }
    })).toBeNull();
  });
});
