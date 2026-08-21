import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { evaluateOutputPlan } from "./outputCore";
import {
  classifyOutputPlaceAtDragability,
  projectOutputPlaces
} from "./outputPlaceProjection";

const compileSource = (lines: string[]) => {
  const compiled = compileFreshCanonicalText(lines.join("\n"));
  if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.doc;
};

const spanText = (source: string, span: DslPhysicalSpan | null) =>
  span?.segments.map((segment) => source.slice(segment.from, segment.to)).join("\n") ?? null;

const rangeText = (source: string, range: { from: number; to: number } | null) =>
  range ? source.slice(range.from, range.to) : null;

describe("SAY-108 output place projection", () => {
  it("projects transformed origin, authored properties, placed geometry, and exact source targets", async () => {
    const doc = compileSource([
      "nui 4",
      "const dx: number = 30",
      "group G {",
      "  point A = coordinate(x: 5, y: 5)",
      "  point B = coordinate(x: 15, y: 5)",
      "  line AB = segment(start: @A, end: @B)",
      "}",
      "layout L {",
      "  place @G(origin: @G::A, at: (10, 20), scale: 2, angle: 30, mirror: true)",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]! });
    const [projection] = projectOutputPlaces({ compiledDocument: doc, plan });
    const source = doc.spans.sourceMap.source;

    expect(projection).toBeDefined();
    expect(projection).toMatchObject({
      layoutName: "L",
      groupName: "G",
      transformedOrigin: { x: 10, y: 20 },
      dragability: { draggable: true, literals: { x: 10, y: 20 } }
    });
    expect(projection!.drawables.some((drawable) => drawable.name === "AB")).toBe(true);
    expect(rangeText(source, projection!.statementRange)).toContain("place @G");
    expect(spanText(source, projection!.authored.group.sourceSpan)).toBe("@G");
    expect(rangeText(source, projection!.authored.group.targetRange)).toBe("G");
    expect(projection!.authored.at.text).toBe("(10, 20)");
    expect(spanText(source, projection!.authored.at.x?.sourceSpan ?? null)).toBe("10");
    expect(spanText(source, projection!.authored.at.y?.sourceSpan ?? null)).toBe("20");
    expect(projection!.authored.origin?.text).toBe("@G::A");
    expect(rangeText(source, projection!.authored.origin?.targetRange ?? null)).toBe("A");
    expect(projection!.authored.scale?.text).toBe("2");
    expect(projection!.authored.angle?.text).toBe("30");
    expect(projection!.authored.mirror?.text).toBe("true");
  });

  it("keeps reference/expression-driven at non-draggable while preserving individual definition targets", async () => {
    const doc = compileSource([
      "nui 4",
      "const x: number = 10",
      "const y: number = 20",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place @G(at: (@x + 5, @y))",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]! });
    const [projection] = projectOutputPlaces({ compiledDocument: doc, plan });
    const source = doc.spans.sourceMap.source;

    expect(projection?.dragability).toEqual({
      draggable: false,
      reason: {
        code: "at-not-direct-finite-numeric-literals",
        issues: [
          { axis: "x", reason: "not-direct-numeric-literal" },
          { axis: "y", reason: "not-direct-numeric-literal" }
        ]
      }
    });
    expect(projection?.authored.at.x?.text).toBe("@x + 5");
    expect(projection?.authored.at.y?.text).toBe("@y");
    expect(projection?.authored.at.x?.references.map((reference) => rangeText(source, reference.targetRange))).toEqual(["x"]);
    expect(projection?.authored.at.y?.references.map((reference) => rangeText(source, reference.targetRange))).toEqual(["y"]);
  });

  it("marks only the non-literal axis when the other coordinate is a direct literal", () => {
    expect(classifyOutputPlaceAtDragability("10", "@y")).toEqual({
      draggable: false,
      reason: {
        code: "at-not-direct-finite-numeric-literals",
        issues: [{ axis: "y", reason: "not-direct-numeric-literal" }]
      }
    });
  });

  it("accepts signed and exponent literals but rejects a non-finite direct literal", () => {
    expect(classifyOutputPlaceAtDragability("-10", "+2.5e1")).toEqual({
      draggable: true,
      literals: { x: -10, y: 25 }
    });
    expect(classifyOutputPlaceAtDragability("1e999", "20")).toEqual({
      draggable: false,
      reason: {
        code: "at-not-direct-finite-numeric-literals",
        issues: [{ axis: "x", reason: "non-finite-numeric-literal" }]
      }
    });
  });

  it("does not invent omitted place properties", async () => {
    const doc = compileSource([
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "svg S(layout: @L)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]! });
    const [projection] = projectOutputPlaces({ compiledDocument: doc, plan });

    expect(projection?.authored.origin).toBeUndefined();
    expect(projection?.authored.scale).toBeUndefined();
    expect(projection?.authored.angle).toBeUndefined();
    expect(projection?.authored.mirror).toBeUndefined();
  });
});
