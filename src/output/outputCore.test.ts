import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  OUTPUT_PALETTE,
  OUTPUT_TEXT_ASCENT,
  OUTPUT_TEXT_DESCENT,
  OUTPUT_TEXT_LINE_HEIGHT,
  PX_TO_MM,
  buildOutputPlan,
  deterministicTextLayout,
  evaluateOutputPlan,
  outputDrawableBounds,
  OutputPlanError
} from "./outputCore";

const sourceFor = (lines: string[]) => {
  const compiled = compileFreshCanonicalText(lines.join("\n"));
  if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.doc;
};

const simpleSource = (extra: string[] = []) => sourceFor([
  "nui 4",
  ...extra,
  "group G {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 10, y: 0)",
  "  line AB = segment(start: @A, end: @B)",
  "  text Label = label(text: \"AB\", anchor: @A, size: 10)",
  "}",
  "layout L {",
  "  place @G(at: (0, 0))",
  "}",
  "print P(layout: @L, paper: a4, overlap: 10)",
  "svg S(layout: @L, margin: 5)"
]);

const output = (doc: ReturnType<typeof simpleSource>, name: "P" | "S") => {
  const candidate = name === "P" ? doc.document.printOutputs[0] : doc.document.svgOutputs[0];
  if (!candidate) throw new Error(`missing ${name}`);
  return candidate;
};

const evaluationFor = (doc: ReturnType<typeof simpleSource>, profileId?: string) =>
  evaluateElementsReference(doc.document.elements, buildEvaluationOptions({
    compiledDocument: doc,
    evaluationLimitIndex: doc.document.evaluationLimitIndex,
    ...(profileId ? { selectedDrawingProfileId: profileId } : {})
  }));

describe("SAY-64 output core", () => {
  it("evaluates an output profile separately from common Canvas evaluation", async () => {
    const doc = simpleSource([
      "profile Print",
      "modifier PrintOnly {",
      "  for @Print {",
      "    state: hidden,",
      "  }",
      "}"
    ]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    const profile = doc.document.drawingProfiles!.find((candidate) => candidate.name === "Print")!;
    line.modifierNames = ["PrintOnly"];
    const common = evaluationFor(doc);
    const calls: unknown[] = [];
    const plan = await evaluateOutputPlan({
      compiledDocument: doc,
      output: output(doc, "S"),
      evaluate: (elements, options) => {
        calls.push(options.selectedDrawingProfileId);
        return evaluateElementsReference(elements, options);
      }
    });
    expect(common.effectiveVisibleElementIds).toContain(line.id);
    expect(calls).toEqual([undefined]);
    expect(plan.drawables.some((drawable) => drawable.elementId === line.id)).toBe(true);
    expect(profile.id).toBeDefined();
  });

  it("applies profile selection through the production context boundary", async () => {
    const doc = simpleSource(["profile Print"]);
    const profile = doc.document.drawingProfiles!.find((candidate) => candidate.name === "Print")!;
    const calls: string[] = [];
    await evaluateOutputPlan({
      compiledDocument: doc,
      output: { ...output(doc, "S"), profileId: profile.id },
      evaluate: (elements, options) => {
        if (options.selectedDrawingProfileId) calls.push(options.selectedDrawingProfileId);
        return evaluateElementsReference(elements, options);
      }
    });
    expect(calls).toEqual([profile.id]);
  });

  it("omits a drawable hidden by the selected output profile", async () => {
    const doc = simpleSource([
      "profile Print",
      "modifier PrintOnly {",
      "  for @Print {",
      "    state: hidden,",
      "  }",
      "}"
    ]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    const profile = doc.document.drawingProfiles!.find((candidate) => candidate.name === "Print")!;
    line.modifierNames = ["PrintOnly"];

    const plan = await evaluateOutputPlan({
      compiledDocument: doc,
      output: { ...output(doc, "S"), profileId: profile.id }
    });

    expect(plan.drawables.some((drawable) => drawable.elementId === line.id)).toBe(false);
    expect(plan.drawables.some((drawable) => drawable.kind === "text")).toBe(true);
  });

  it("fails output closed when the selected profile disables geometry", () => {
    const doc = sourceFor([
      "nui 4",
      "profile Print",
      "modifier DisableInPrint {",
      "  for @Print {",
      "    state: disabled,",
      "  }",
      "}",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB [DisableInPrint] = segment(start: @A, end: @B)",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "svg S(layout: @L)"
    ]);
    const profile = doc.document.drawingProfiles!.find((candidate) => candidate.name === "Print")!;
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    const evaluation = evaluationFor(doc, profile.id);

    expect(evaluation.computedGeometry.has(line.id)).toBe(false);
    expect(evaluation.effectiveEnabledElementIds).not.toContain(line.id);
    expect(() => buildOutputPlan({
      compiledDocument: doc,
      output: { ...doc.document.svgOutputs[0], profileId: profile.id },
      evaluation
    })).toThrow(OutputPlanError);
  });

  it("fails output closed when a selected profile disables a geometry dependency", () => {
    const doc = sourceFor([
      "nui 4",
      "profile Print",
      "modifier DisableInPrint {",
      "  for @Print {",
      "    state: disabled,",
      "  }",
      "}",
      "group G {",
      "  point Base [DisableInPrint] = coordinate(x: 0, y: 0)",
      "  line AB = segment(start: @Base, end: (10, 0))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "svg S(layout: @L)"
    ]);
    const profile = doc.document.drawingProfiles!.find((candidate) => candidate.name === "Print")!;
    const dependency = doc.document.elements.find((element) => element.name === "Base")!;
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    const evaluation = evaluationFor(doc, profile.id);
    const error = evaluation.errors.find((candidate) => candidate.elementId === line.id);

    expect(error).toMatchObject({ missingDependencyId: dependency.id });
    expect(() => buildOutputPlan({
      compiledDocument: doc,
      output: { ...doc.document.svgOutputs[0], profileId: profile.id },
      evaluation
    })).toThrow(/Output evaluation failed/);
  });

  it("uses mirror, scale, rotation, and translation in a stable transform order", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "}",
      "layout L(scale: 2) {",
      "  place @G(origin: @G::A, at: (10, 20), angle: 90, mirror: true)",
      "}",
      "svg S(layout: @L, margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const line = plan.drawables.find((drawable) => drawable.kind === "line");
    expect(line?.start.x).toBeCloseTo(10);
    expect(line?.start.y).toBeCloseTo(20);
    expect(line?.end.x).toBeCloseTo(10);
    expect(line?.end.y).toBeCloseTo(0);
  });

  it("emits supported final geometry from alternate and derived constructions", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  point C = coordinate(x: 5, y: 5)",
      "  line Polar = polar(start: @A, angle: 0, length: 10)",
      "  arc Through = through(point1: @A, point2: @B, point3: @C, start: 0, end: 180)",
      "  line Copy = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Polar])",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });

    expect(plan.drawables.some((drawable) => drawable.name === "Polar" && drawable.kind === "line")).toBe(true);
    expect(plan.drawables.some((drawable) => drawable.name === "Through" && drawable.kind === "arc")).toBe(true);
    expect(plan.drawables.some((drawable) => drawable.name === "Copy" && drawable.kind === "offsetLine")).toBe(true);
  });

  it("supports nested targets and repeated independent placements", () => {
    const doc = sourceFor([
      "nui 4",
      "group Outer {",
      "  group Inner {",
      "    point A = coordinate(x: 0, y: 0)",
      "    point B = coordinate(x: 10, y: 0)",
      "    line AB = segment(start: @A, end: @B)",
      "  }",
      "}",
      "layout L {",
      "  place @Outer::Inner(at: (0, 0))",
      "  place @Outer::Inner(at: (100, 0))",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const lines = plan.drawables.filter((drawable) => drawable.kind === "line");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.start.x)).toEqual([0, 100]);
  });

  it("resolves layout and output numbers from compiled typed scalar runtime values", async () => {
    const doc = sourceFor([
      "nui 4",
      "const unit: number = 2",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L(scale: @unit) {",
      "  place @G(at: (@unit, @unit), scale: @unit)",
      "}",
      "svg S(layout: @L, margin: @unit)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0] });
    expect(plan.placements[0]).toMatchObject({ scale: 2, at: { x: 2, y: 2 } });
    expect(plan.svg?.widthMm).toBe(plan.renderedBounds.width + 4);
  });

  it("normalizes typed runtime placement angles for geometry and text output", async () => {
    const doc = sourceFor([
      "nui 4",
      "const negative: number = -90",
      "const over: number = 450",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "  text Label = label(text: \"AB\", anchor: @A, size: 3)",
      "}",
      "layout L {",
      "  place @G(at: (0, 0), angle: @negative)",
      "  place @G(at: (20, 0), angle: @over)",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0] });

    expect(plan.placements.map((placement) => placement.angleDeg)).toEqual([270, 90]);
    const lines = plan.placements.map((placement) => {
      const line = placement.drawables.find((drawable) => drawable.kind === "line");
      if (!line || line.kind !== "line") throw new Error("missing output line");
      return line;
    });
    expect(lines[0].end.x).toBeCloseTo(0);
    expect(lines[0].end.y).toBeCloseTo(-10);
    expect(lines[1].end.x).toBeCloseTo(20);
    expect(lines[1].end.y).toBeCloseTo(10);
    const texts = plan.placements.map((placement) => {
      const text = placement.drawables.find((drawable) => drawable.kind === "text");
      if (!text || text.kind !== "text") throw new Error("missing output text");
      return text;
    });
    expect(texts.map((text) => text.rotationDeg)).toEqual([270, 90]);
  });

  it("includes final stroke width and deterministic text bounds", () => {
    const doc = simpleSource(["modifier Heavy {", "  width: 4px,", "  color: #FF3355,", "}"]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    line.modifierNames = ["Heavy"];
    const plan = buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: evaluationFor(doc) });
    expect(plan.renderedBounds.minX).toBeLessThan(0);
    expect(plan.renderedBounds.maxX).toBeGreaterThan(10);
    expect(plan.drawables.find((drawable) => drawable.kind === "line")).toMatchObject({
      stroke: { widthMm: 4 * PX_TO_MM, colorHex: "#ff3355" }
    });
    expect(plan.drawables.find((drawable) => drawable.kind === "text")).toBeDefined();
  });

  it("keeps a styled stroke physical across placement scales while transforming geometry", () => {
    const doc = sourceFor([
      "nui 4",
      "modifier Styled {",
      "  width: 1px,",
      "}",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB [Styled] = segment(start: @A, end: @B)",
      "}",
      "layout L {",
      "  place @G(at: (0, 0), scale: 0.5)",
      "  place @G(at: (0, 20), scale: 1)",
      "  place @G(at: (0, 40), scale: 2)",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const lines = plan.placements.map((placement) => {
      const line = placement.drawables.find((drawable) => drawable.kind === "line");
      if (!line || line.kind !== "line") throw new Error("missing styled output line");
      return line;
    });

    expect(lines.map((line) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y))).toEqual([5, 10, 20]);
    for (const line of lines) {
      expect(line.stroke.widthMm).toBeCloseTo(PX_TO_MM);
      const bounds = outputDrawableBounds(line);
      const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
      expect(bounds.width).toBeCloseTo(length + PX_TO_MM);
      expect(bounds.height).toBeCloseTo(PX_TO_MM);
    }
  });

  it("fails closed for an empty layout and inflates SVG bounds by margin", () => {
    const doc = sourceFor([
      "nui 4",
      "layout Empty {",
      "}",
      "svg S(layout: @Empty, margin: 5)"
    ]);
    expect(() => buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) })).toThrow(OutputPlanError);

    const populated = simpleSource();
    const plan = buildOutputPlan({ compiledDocument: populated, output: output(populated, "S"), evaluation: evaluationFor(populated) });
    const svg = plan.svg!;
    expect(svg.widthMm).toBe(plan.renderedBounds.width + 10);
    expect(svg.heightMm).toBe(plan.renderedBounds.height + 10);
    expect(svg.viewBox).toEqual({ x: 0, y: 0, width: svg.widthMm, height: svg.heightMm });
  });

  it("computes physical first-page areas, strides, and page counts for every A4/A3 orientation", () => {
    const cases = [
      { paper: "a4", orientation: "portrait", paperWidthMm: 210, paperHeightMm: 297, columns: 4, rows: 2 },
      { paper: "a4", orientation: "landscape", paperWidthMm: 297, paperHeightMm: 210, columns: 3, rows: 3 },
      { paper: "a3", orientation: "portrait", paperWidthMm: 297, paperHeightMm: 420, columns: 3, rows: 2 },
      { paper: "a3", orientation: "landscape", paperWidthMm: 420, paperHeightMm: 297, columns: 2, rows: 2 }
    ] as const;

    for (const testCase of cases) {
      const doc = sourceFor([
        "nui 4",
        "group G {",
        "  line Large = segment(start: (0, 0), end: (650, 500))",
        "}",
        "layout L {",
        "  place @G(at: (0, 0))",
        "}",
        `print P(layout: @L, paper: ${testCase.paper}, orientation: ${testCase.orientation}, overlap: 10)`
      ]);
      const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
      const print = plan.print!;
      const usableWidthMm = testCase.paperWidthMm - 20;
      const usableHeightMm = testCase.paperHeightMm - 20;
      const strideXmm = usableWidthMm;
      const strideYmm = usableHeightMm;
      const expectedColumns = Math.max(1, Math.ceil(plan.renderedBounds.width / usableWidthMm));
      const expectedRows = Math.max(1, Math.ceil(plan.renderedBounds.height / usableHeightMm));

      expect(print).toMatchObject({
        paperWidthMm: testCase.paperWidthMm,
        paperHeightMm: testCase.paperHeightMm,
        usableWidthMm,
        usableHeightMm,
        strideXmm,
        strideYmm,
        columns: testCase.columns,
        rows: testCase.rows
      });
      expect(expectedColumns).toBe(testCase.columns);
      expect(expectedRows).toBe(testCase.rows);
      expect(print.pages).toHaveLength(testCase.columns * testCase.rows);
      expect(plan.rustPayload).toMatchObject({ overlapMm: 10, stride: { x: strideXmm, y: strideYmm } });
      expect(plan.rustPayload).not.toHaveProperty("marginMm");
      expect(plan.rustPayload).not.toHaveProperty("stride.xMm");
      expect(plan.rustPayload).not.toHaveProperty("stride.yMm");
      expect(print.pages.map((page) => page.index)).toEqual(print.pages.map((_, index) => index));
      expect(print.pages[0].origin).toEqual({ x: plan.renderedBounds.minX - 10, y: plan.renderedBounds.minY - 10 });
      expect(print.pages[0].origin.x + 10).toBeCloseTo(plan.renderedBounds.minX);
      expect(print.pages[0].origin.y + 10).toBeCloseTo(plan.renderedBounds.minY);
      if (testCase.columns > 1) {
        const first = print.pages[0];
        const adjacent = print.pages[1];
        expect(adjacent.origin.x - first.origin.x).toBe(strideXmm);
        expect(first.origin.x + testCase.paperWidthMm - adjacent.origin.x).toBe(20);
      }
      if (testCase.rows > 1) {
        const first = print.pages[0];
        const adjacent = print.pages[testCase.columns];
        expect(adjacent.origin.y - first.origin.y).toBe(strideYmm);
        expect(first.origin.y + testCase.paperHeightMm - adjacent.origin.y).toBe(20);
      }
    }
  });

  it("emits unique matching labels, resolved centers, and rotated shrink-to-fit guides", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (2500, 2500))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, overlap: 1)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guides = plan.print!.pages.flatMap((page) => page.guides);
    expect(guides.some((guide) => guide.label?.text === "10")).toBe(true);
    expect(guides.some((guide) => guide.label?.text === "AA")).toBe(true);
    expect(guides.filter((guide) => guide.label && guide.axis === "vertical").every((guide) => guide.label!.rotationDeg === 90)).toBe(true);
    expect(guides.filter((guide) => guide.label && guide.axis === "horizontal").every((guide) => guide.label!.rotationDeg === 0)).toBe(true);
    expect(new Set(guides.filter((guide) => guide.axis === "vertical").map((guide) => guide.positionMm))).toEqual(new Set([1, 209]));
    expect(new Set(guides.filter((guide) => guide.axis === "horizontal").map((guide) => guide.positionMm))).toEqual(new Set([1, 296]));
    const verticalPairs = new Map<string, string[]>();
    const horizontalPairs = new Map<string, string[]>();
    for (const page of plan.print!.pages) {
      for (const guide of page.guides) {
        if (!guide.label) continue;
        if (guide.axis === "vertical") {
          const boundary = guide.positionMm === plan.print!.overlapMm ? page.column - 1 : page.column;
          const key = `${page.row}:${boundary}`;
          verticalPairs.set(key, [...(verticalPairs.get(key) ?? []), guide.label.text]);
        } else {
          const boundary = guide.positionMm === plan.print!.overlapMm ? page.row - 1 : page.row;
          const key = `${boundary}:${page.column}`;
          horizontalPairs.set(key, [...(horizontalPairs.get(key) ?? []), guide.label.text]);
        }
      }
    }
    expect([...verticalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect([...horizontalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect(new Set([...verticalPairs.values(), ...horizontalPairs.values()].map(([label]) => label)).size).toBe(verticalPairs.size + horizontalPairs.size);
    expect(verticalPairs.get("0:0")).toEqual(["1", "1"]);
    expect(verticalPairs.get("1:0")).toEqual([`${plan.print!.columns - 1 + 1}`, `${plan.print!.columns - 1 + 1}`]);
    expect(guides.filter((guide) => guide.label).every((guide) => guide.label!.fontSizeMm <= 3)).toBe(true);
    expect(guides.every((guide) => {
      if (!guide.label) return true;
      if (guide.axis === "vertical") {
        const expectedX = guide.positionMm === plan.print!.overlapMm
          ? plan.print!.overlapMm / 2
          : plan.print!.paperWidthMm - plan.print!.overlapMm / 2;
        return guide.label.center.x === expectedX && guide.label.center.y === plan.print!.paperHeightMm / 2;
      }
      const expectedY = guide.positionMm === plan.print!.overlapMm
        ? plan.print!.overlapMm / 2
        : plan.print!.paperHeightMm - plan.print!.overlapMm / 2;
      return guide.label.center.x === plan.print!.paperWidthMm / 2 && guide.label.center.y === expectedY;
    })).toBe(true);
    for (const page of plan.print!.pages) {
      expect(page.guides).toHaveLength(4);
      const left = page.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 1)!;
      const right = page.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 209)!;
      const bottom = page.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 1)!;
      const top = page.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 296)!;
      expect(left.label !== undefined).toBe(page.column > 0);
      expect(right.label !== undefined).toBe(page.column < plan.print!.columns - 1);
      expect(bottom.label !== undefined).toBe(page.row > 0);
      expect(top.label !== undefined).toBe(page.row < plan.print!.rows - 1);
      if (page.column < plan.print!.columns - 1) {
        const adjacent = plan.print!.pages.find((candidate) => candidate.column === page.column + 1 && candidate.row === page.row)!;
        const adjacentLeft = adjacent.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 1)!;
        expect(page.origin.x + right.positionMm).toBeCloseTo(adjacent.origin.x + adjacentLeft.positionMm);
        expect(right.label?.text).toBe(adjacentLeft.label?.text);
      }
      if (page.row < plan.print!.rows - 1) {
        const adjacent = plan.print!.pages.find((candidate) => candidate.column === page.column && candidate.row === page.row + 1)!;
        const adjacentBottom = adjacent.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 1)!;
        expect(page.origin.y + top.positionMm).toBeCloseTo(adjacent.origin.y + adjacentBottom.positionMm);
        expect(top.label?.text).toBe(adjacentBottom.label?.text);
      }
    }
  });

  it("keeps a long joining label inside the physical overlap strip", () => {
    const overlapMm = 1.99;
    const paperWidthMm = 297;
    const paperHeightMm = 420;
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (2.3, 500))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      `print P(layout: @L, paper: a3, orientation: portrait, overlap: ${overlapMm})`
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guide = plan.print!.pages
      .flatMap((page) => page.guides)
      .find((candidate) => candidate.axis === "horizontal" && candidate.label);
    if (!guide) throw new Error("missing long horizontal joining label");
    if (!guide.label) throw new Error("missing joining label metadata");

    const relativeBounds = outputDrawableBounds({
      kind: "text",
      elementId: "joining-label",
      name: guide.label.text,
      text: guide.label.text,
      anchor: { x: 0, y: 0 },
      fontSizeMm: guide.label.fontSizeMm,
      widthMm: guide.label.widthMm,
      lineWidthsMm: [guide.label.widthMm],
      lineAdvancesMm: [guide.label.advancesMm],
      lineHeightMm: guide.label.fontSizeMm * OUTPUT_TEXT_LINE_HEIGHT,
      rotationDeg: guide.label.rotationDeg,
      mirrorX: false,
      colorHex: OUTPUT_PALETTE.foreground
    });
    const centeredAnchor = {
      x: guide.label.center.x - (relativeBounds.minX + relativeBounds.maxX) / 2,
      y: guide.label.center.y - (relativeBounds.minY + relativeBounds.maxY) / 2
    };
    const absoluteBounds = {
      minX: relativeBounds.minX + centeredAnchor.x,
      minY: relativeBounds.minY + centeredAnchor.y,
      maxX: relativeBounds.maxX + centeredAnchor.x,
      maxY: relativeBounds.maxY + centeredAnchor.y
    };
    const stripMinY = guide.positionMm === overlapMm
      ? 0
      : paperHeightMm - overlapMm;

    expect(absoluteBounds.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(absoluteBounds.maxX).toBeLessThanOrEqual(paperWidthMm + 1e-9);
    expect(absoluteBounds.minY).toBeGreaterThanOrEqual(stripMinY - 1e-9);
    expect(absoluteBounds.maxY).toBeLessThanOrEqual(stripMinY + overlapMm + 1e-9);
  });

  it("uses stroke-inclusive rendered bounds at the one-page threshold", () => {
    const exactThresholdDoc = (epsilonMm: number) => sourceFor([
      "nui 4",
      "group G {",
      `  line Large = segment(start: (0, 0), end: (${190 - PX_TO_MM + epsilonMm}, ${277 - PX_TO_MM + epsilonMm}))`,
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, overlap: 10)"
    ]);
    const exactThresholdSource = exactThresholdDoc(0);
    const exactThreshold = buildOutputPlan({
      compiledDocument: exactThresholdSource,
      output: exactThresholdSource.document.printOutputs[0],
      evaluation: evaluationFor(exactThresholdSource)
    });
    expect(exactThreshold.renderedBounds.width).toBe(190);
    expect(exactThreshold.renderedBounds.height).toBe(277);
    expect(exactThreshold.print).toMatchObject({ columns: 1, rows: 1, strideXmm: 190, strideYmm: 277 });
    expect(exactThreshold.print!.pages).toHaveLength(1);

    const justOverThresholdDoc = exactThresholdDoc(1e-6);
    const justOverThreshold = buildOutputPlan({
      compiledDocument: justOverThresholdDoc,
      output: justOverThresholdDoc.document.printOutputs[0],
      evaluation: evaluationFor(justOverThresholdDoc)
    });
    expect(justOverThreshold.renderedBounds.width).toBeGreaterThan(190);
    expect(justOverThreshold.renderedBounds.height).toBeGreaterThan(277);
    expect(justOverThreshold.print).toMatchObject({ columns: 2, rows: 2, strideXmm: 190, strideYmm: 277 });
    expect(justOverThreshold.print!.pages).toHaveLength(4);
    expect(justOverThreshold.print!.pages[1].origin.x - justOverThreshold.print!.pages[0].origin.x).toBe(190);
    expect(justOverThreshold.print!.pages[2].origin.y - justOverThreshold.print!.pages[0].origin.y).toBe(277);
  });

  it("emits no joining guides or labels when physical overlap is zero", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (500, 500))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, overlap: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    expect(plan.print!.pages.length).toBeGreaterThan(1);
    expect(plan.print).toMatchObject({ strideXmm: 210, strideYmm: 297 });
    expect(plan.print!.pages.every((page) => page.guides.length === 0)).toBe(true);
  });

  it("owns the fixed output palette and preserves fixed modifier colors", () => {
    expect(OUTPUT_PALETTE).toEqual({
      foreground: "#31322f",
      muted: "#53564f",
      accent: "#0f766e",
      info: "#2563eb",
      warning: "#73320d",
      error: "#b91c1c"
    });
    const doc = simpleSource(["modifier Fixed {", "  color: #Ab12Ef,", "}"]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    line.modifierNames = ["Fixed"];
    const plan = buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: evaluationFor(doc) });
    const fixedDrawable = plan.drawables.find((drawable) => drawable.elementId === line.id);
    if (!fixedDrawable || fixedDrawable.kind === "text") throw new Error("missing fixed-color line");
    expect(fixedDrawable.stroke.colorHex).toBe("#ab12ef");
  });

  it("uses one baseline-anchor text layout for Latin, Japanese, multiline, rotation, and mirroring", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  text Label = label(text: \"AB\\n日本\", anchor: (0, 0), size: 4)",
      "}",
      "layout L {",
      "  place @G(at: (0, 0), angle: 30, mirror: true)",
      "}",
      "svg S(layout: @L, margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const text = plan.drawables.find((drawable) => drawable.kind === "text");
    if (!text || text.kind !== "text") throw new Error("missing output text");
    const layout = deterministicTextLayout("AB\n日本", 4);
    expect(text).toMatchObject({
      anchor: { x: 0, y: 0 },
      fontSizeMm: 4,
      widthMm: 8,
      lineWidthsMm: [4.96, 8],
      lineAdvancesMm: [[2.48, 2.48], [4, 4]],
      lineHeightMm: 4.8,
      rotationDeg: 30,
      mirrorX: true
    });
    expect(layout).toEqual({ lineWidthsMm: text.lineWidthsMm, lineAdvancesMm: text.lineAdvancesMm, widthMm: text.widthMm });
    const ascent = text.fontSizeMm * OUTPUT_TEXT_ASCENT;
    const descent = text.fontSizeMm * OUTPUT_TEXT_DESCENT;
    expect(outputDrawableBounds(text)).toEqual(plan.renderedBounds);
    expect(plan.renderedBounds.width).toBeGreaterThan(Math.max(...text.lineWidthsMm));
    expect(plan.renderedBounds.height).toBeGreaterThan(text.lineHeightMm + ascent - descent);
    expect(ascent + descent).toBe(text.fontSizeMm);
  });
});
