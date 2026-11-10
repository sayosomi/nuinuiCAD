import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { referencePickCandidates } from "../model/referencePickCandidates";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";

const source = `nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
extract E(
  source: @L,
  parts: [
    lower: start..@Cut,
    upper: @Cut..
  ],
)`;
const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 5 });
const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: new Map(parsed.statements.map((_,i) => [i,`extract-pick:${i}`])) });
const query = (position: number, revision = 5) => queryDslReferencePickTarget({ source: { normalizedSource: source, sourceRevision: revision }, position, semantic: { sourceRevision: 5, compiled } });

describe("extract Reference Pick slots", () => {
  it("emits a qualified virtual-part reference from a later path Pick", () => {
    const text = source.replace("upper: @Cut..", "upper: @Cut..end") + "\npath Copy = from(source: @L)";
    const compiled = compileFreshCanonicalText(text).doc;
    const snapshot = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
    const target = queryDslReferencePickTarget({ source: snapshot, position: text.lastIndexOf("@L") + 1, semantic: { sourceRevision: snapshot.sourceRevision, compiled } })!;
    const evaluation = evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }));
    const references = referencePickCandidates({ compiled, evaluation, target }).flatMap(candidate => candidate.options.map(option => option.reference.base));
    expect(references).toEqual(expect.arrayContaining(["E::lower", "E::upper"]));
    expect(references).not.toContain("lower");
    expect(references).not.toContain("upper");
  });
  it("keeps qualified private part candidates inside their Module occurrence", () => {
    const text = `nui 1\nmodule M() {\n line L = segment(start: (0,0), end: (100,0))\n extract E(source: @L, parts: [whole: start..end])\n path Copy = from(source: @L)\n}\ninstance One = M()\ninstance Two = M()`;
    const compiled = compileFreshCanonicalText(text).doc;
    const snapshot = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
    const target = queryDslReferencePickTarget({ source: snapshot, position: text.indexOf("source: @L", text.indexOf("path Copy")) + 9, semantic: { sourceRevision: snapshot.sourceRevision, compiled } })!;
    const evaluation = evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }));
    const references = referencePickCandidates({ compiled, evaluation, target }).flatMap(candidate => candidate.options.map(option => option.reference.base));
    expect(references).toContain("E::whole");
    expect(references).not.toContain("whole");
  });
  it("independently targets source, left and incomplete right with exact replacement ranges", () => {
    const sourceTarget = query(source.indexOf("source: @L")+9);
    expect(sourceTarget?.expectedGeometryInterface).toBe("path");
    expect(sourceTarget && source.slice(sourceTarget.range.from,sourceTarget.range.to)).toBe("@L");
    const left = query(source.indexOf("upper: @Cut")+10);
    expect(left?.expectedGeometryInterface).toBe("point");
    expect(left && source.slice(left.range.from,left.range.to)).toBe("@Cut");
    const end = source.indexOf("upper: @Cut..") + "upper: @Cut..".length;
    const right = query(end);
    expect(right?.expectedGeometryInterface).toBe("point");
    expect(right?.range).toEqual({ from: end, to: end });
    expect(right?.sourceAnchor.statementId).toBe(sourceTarget?.sourceAnchor.statementId);
    expect(right?.range).not.toEqual(left?.range);
  });
  it("rejects stale source proof", () => expect(query(source.indexOf("@L",source.indexOf("extract")),6)).toBeNull());
});
