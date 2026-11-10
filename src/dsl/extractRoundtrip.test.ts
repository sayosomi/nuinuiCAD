import { describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { parseDsl, serializeExtractDeclaration } from "@nuinuicad/nui-language";
import { sourceExtractTemplate } from "../commands/sourceExtractTemplate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";

const base = `nui 1\nline Path = segment(start: (0,0), end: (100,0))\npoint Cut = coordinate(x: 40, y: 0)\npoint Cut1 = coordinate(x: 30, y: 0)\npoint Cut2 = coordinate(x: 70, y: 0)\n`;
describe("extract saved Source and serializer", () => {
  it("serializes head and per-part Style/layer selectors with legal reference syntax", () => {
    const input = "extract E[Common] in @finished(source: @Path, parts: [a[Local] in @draft: start..end, b: end..start], visible: true)";
    const head = parseDsl(input).statements[0];
    if (head.kind !== "extract") throw new Error("Missing head");
    const formatted = serializeExtractDeclaration(head);
    expect(formatted).toContain("extract E[Common] in @finished(");
    expect(formatted).toContain("a[Local] in @draft: start..end,");
    const reparsed = parseDsl(formatted);
    expect(reparsed.diagnostics).toEqual([]);
    expect(serializeExtractDeclaration(reparsed.statements[0] as typeof head)).toBe(formatted);
  });
  it.each([1,2,3] as const)("compiles and serializes the %s-part Source template, then reopens and reevaluates", count => {
    const template = sourceExtractTemplate(count).parts.map(part => part.kind === "text" ? part.text : part.defaultText).join("");
    const parsed = parseDsl(template);
    const head = parsed.statements.find(statement => statement.kind === "extract")!;
    if (head.kind !== "extract") throw new Error("Missing head");
    expect(head.parts).toHaveLength(count);
    const formatted = serializeExtractDeclaration(head);
    expect(serializeExtractDeclaration(parseDsl(formatted).statements[0] as typeof head)).toBe(formatted);
    const cold = compileFreshCanonicalText(base + formatted);
    expect(cold.status).toBe("valid");
    const evaluate = (compiled: typeof cold.doc) => evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }));
    const lengths = (result: ReturnType<typeof evaluate>) => [...result.computedGeometry.values()].filter(g => g.kind === "joinedPath").map(g => g.length);
    expect(lengths(evaluate(cold.doc))).toEqual(count === 1 ? [40] : count === 2 ? [40,60] : [30,40,30]);
    const warm = compileCanonicalText(cold, base + formatted);
    expect(warm.doc.document.elements.map(e => e.id)).toEqual(cold.doc.document.elements.map(e => e.id));
    const reopened = compileFreshCanonicalText(base + formatted);
    expect(lengths(evaluate(reopened.doc))).toEqual(lengths(evaluate(cold.doc)));
    const edited = compileCanonicalText(warm, (base + formatted).replace("end: (100,0)", "end: (120,0)"));
    expect(lengths(evaluate(edited.doc))).toEqual(count === 1 ? [40] : count === 2 ? [40,80] : [30,40,50]);
  });
});
