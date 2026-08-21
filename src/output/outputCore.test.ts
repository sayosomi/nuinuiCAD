import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  OUTPUT_PALETTE,
  OUTPUT_TEXT_ASCENT,
  OUTPUT_TEXT_DESCENT,
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
    expect(plan.rustPayload).toMatchObject({ stride: { x: 390, y: 267 } });
    expect(plan.rustPayload).not.toHaveProperty("stride.xMm");
    expect(plan.rustPayload).not.toHaveProperty("stride.yMm");
    expect(plan.print!.pages.map((page) => page.index)).toEqual(plan.print!.pages.map((_, index) => index));
    expect(plan.print!.pages[0].origin).toEqual({ x: plan.renderedBounds.minX - 10, y: plan.renderedBounds.minY - 10 });
    expect(plan.print!.pages[1].origin.x).toBe(plan.print!.pages[0].origin.x + 390);
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
      "print P(layout: @L, paper: a4, margin: 10, overlap: 1)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guides = plan.print!.pages.flatMap((page) => page.guides);
    expect(guides.some((guide) => guide.label === "10")).toBe(true);
    expect(guides.some((guide) => guide.label === "AA")).toBe(true);
    expect(guides.filter((guide) => guide.axis === "vertical").every((guide) => guide.labelRotationDeg === 90)).toBe(true);
    expect(guides.filter((guide) => guide.axis === "horizontal").every((guide) => guide.labelRotationDeg === 0)).toBe(true);
    const verticalPairs = new Map<string, string[]>();
    const horizontalPairs = new Map<string, string[]>();
    for (const page of plan.print!.pages) {
      for (const guide of page.guides) {
        if (guide.axis === "vertical") {
          const boundary = guide.positionMm === plan.print!.marginMm + plan.print!.overlapMm ? page.column - 1 : page.column;
          const key = `${page.row}:${boundary}`;
          verticalPairs.set(key, [...(verticalPairs.get(key) ?? []), guide.label]);
        } else {
          const boundary = guide.positionMm === plan.print!.marginMm + plan.print!.overlapMm ? page.row - 1 : page.row;
          const key = `${boundary}:${page.column}`;
          horizontalPairs.set(key, [...(horizontalPairs.get(key) ?? []), guide.label]);
        }
      }
    }
    expect([...verticalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect([...horizontalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect(new Set([...verticalPairs.values(), ...horizontalPairs.values()].map(([label]) => label)).size).toBe(verticalPairs.size + horizontalPairs.size);
    expect(verticalPairs.get("0:0")).toEqual(["1", "1"]);
    expect(verticalPairs.get("1:0")).toEqual([`${plan.print!.columns - 1 + 1}`, `${plan.print!.columns - 1 + 1}`]);
    expect(guides.every((guide) => guide.labelFontSizeMm <= 3)).toBe(true);
    expect(guides.every((guide) => {
      if (guide.axis === "vertical") {
        const expectedX = guide.positionMm === plan.print!.marginMm + plan.print!.overlapMm
          ? plan.print!.marginMm + plan.print!.overlapMm / 2
          : plan.print!.paperWidthMm - plan.print!.marginMm - plan.print!.overlapMm / 2;
        return guide.labelCenter.x === expectedX && guide.labelCenter.y === plan.print!.paperHeightMm / 2;
      }
      const expectedY = guide.positionMm === plan.print!.marginMm + plan.print!.overlapMm
        ? plan.print!.marginMm + plan.print!.overlapMm / 2
        : plan.print!.paperHeightMm - plan.print!.marginMm - plan.print!.overlapMm / 2;
      return guide.labelCenter.x === plan.print!.paperWidthMm / 2 && guide.labelCenter.y === expectedY;
    })).toBe(true);
    for (const page of plan.print!.pages) {
      if (page.column === 0) expect(page.guides.some((guide) => guide.axis === "vertical" && guide.positionMm === 11)).toBe(false);
      if (page.row === 0) expect(page.guides.some((guide) => guide.axis === "horizontal" && guide.positionMm === 11)).toBe(false);
    }
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
