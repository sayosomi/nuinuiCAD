import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { PX_TO_MM, buildOutputPlan, evaluateOutputPlan, OutputPlanError } from "./outputCore";

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
  "print P(layout: @L, paper: a4, margin: 10, overlap: 10)",
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

  it("computes oriented A4/A3 effective areas, exact strides, origins, and PDF order", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (400, 400))",
      "}",
      "layout L {",
      "  place @G(at: (-20, -30))",
      "}",
      "print P(layout: @L, paper: a3, orientation: landscape, margin: 10, overlap: 10)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    expect(plan.print).toMatchObject({ paperWidthMm: 420, paperHeightMm: 297, effectiveWidthMm: 400, effectiveHeightMm: 277, strideXmm: 390, strideYmm: 267 });
    expect(plan.print!.pages.map((page) => page.index)).toEqual(plan.print!.pages.map((_, index) => index));
    expect(plan.print!.pages[0].origin).toEqual({ x: plan.renderedBounds.minX - 10, y: plan.renderedBounds.minY - 10 });
    expect(plan.print!.pages[1].origin.x).toBe(plan.print!.pages[0].origin.x + 390);
  });

  it("emits overlap guides only on neighboring edges with repeated labels and shrink-to-fit", () => {
    const doc = sourceFor([
      "nui 4",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (2500, 2500))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, margin: 10, overlap: 1)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guides = plan.print!.pages.flatMap((page) => page.guides);
    expect(guides.some((guide) => guide.label === "10")).toBe(true);
    expect(guides.some((guide) => guide.label === "AA")).toBe(true);
    expect(guides.filter((guide) => guide.axis === "vertical" && guide.label === "1")).toHaveLength(plan.print!.rows * 2);
    expect(guides.filter((guide) => guide.axis === "vertical").every((guide) => guide.labelRotationDeg === 90)).toBe(true);
    expect(guides.filter((guide) => guide.axis === "horizontal").every((guide) => guide.labelRotationDeg === 0)).toBe(true);
    expect(guides.every((guide) => guide.labelFontSizeMm < 3)).toBe(true);
    for (const page of plan.print!.pages) {
      if (page.column === 0) expect(page.guides.some((guide) => guide.axis === "vertical" && guide.positionMm === 11)).toBe(false);
      if (page.row === 0) expect(page.guides.some((guide) => guide.axis === "horizontal" && guide.positionMm === 11)).toBe(false);
    }
  });
});
