import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { referencePickTargetProofFor } from "./referencePickProtocol";
import { startVscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { projectIncompleteReferencePickCandidate } from "./referencePickCandidateProjection";

const base = "nui 1\nline A = segment(start: (0, 0), end: (20, 0))";
const fixture = (text = `${base}\nreverse ()`) => {
  const compiled = compileFreshCanonicalText(text).currentCompiled;
  const source = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
  const normalizedSourceOffset = text.lastIndexOf("reverse ") + "reverse ".length;
  const target = queryDslReferencePickTarget({
    source, position: normalizedSourceOffset,
    semantic: { sourceText: text, sourceRevision: source.sourceRevision, compiled }
  });
  expect(target).not.toBeNull();
  return {
    source, compiled,
    request: {
      type: "referencePickStartRequest" as const, requestId: 1538,
      documentUri: "file:///projection.nui", documentVersion: 1,
      normalizedSourceOffset, targetProof: referencePickTargetProofFor(text, target!)!
    }
  };
};

describe("bounded incomplete-target candidate projection", () => {
  it("compiles a separate artifact with inherited IDs, without modifying current authoring authority", () => {
    const input = fixture(`${base}\nreverse ()\nline C = segment(start: (40, 0), end: (60, 0))`);
    const candidate = projectIncompleteReferencePickCandidate(input)!;
    expect(candidate).not.toBeNull();
    expect(input.compiled.document).toBeNull();
    expect(input.compiled.spans.sourceMap.source).toBe(input.source.normalizedSource);
    expect(candidate.spans.sourceMap.sourceRevision).not.toBe(input.source.sourceRevision);
    expect(candidate.statementMap.statementIdByStatementIndex?.get(0)).toBeUndefined();
    for (const [index, id] of candidate.statementMap.statementIdByStatementIndex!) {
      expect(id).toBe(input.compiled.statementMap?.statementIdByStatementIndex?.get(index >= 2 ? index + 1 : index));
    }
    const evaluation = evaluateElementsReference(candidate.document.elements, buildEvaluationOptions({
      compiledDocument: candidate, evaluationLimitIndex: candidate.document.evaluationLimitIndex
    }));
    const result = startVscodeReferencePickCanvasSession({
      ...input, authoritativeDocumentUri: input.request.documentUri, authoritativeDocumentVersion: 1,
      evaluation, evaluationIsCurrent: false,
      candidateSnapshot: {
        source: { normalizedSource: candidate.spans.sourceMap.source, sourceRevision: candidate.spans.sourceMap.sourceRevision },
        compiled: candidate, evaluation
      }
    }).result;
    expect(result.status).toBe("started");
    if (result.status !== "started") throw new Error("Pick did not start");
    expect(new Set(result.candidateReferences.map(item => item.base))).toEqual(new Set(["A"]));
  });

  it.each([
    `${base}\nreverse ()\nreverse ()`,
    `${base}\npoint Bad = coordinate(x: !, y: 0)\nreverse ()`,
    `${base}\nreverse @Missing()`,
    `${base}\nreverse A()`,
    `${base}\nreverse @A()`,
    `${base}\nreverse (bogus: !)`,
    `${base}\nreverse @ as ()`
  ])("rejects unrelated errors, completed selectors and ambiguous removal: %s", text => {
    expect(projectIncompleteReferencePickCandidate(fixture(text))).toBeNull();
  });

  it("leaves unresolved-reference rejection to the existing evaluation boundary", () => {
    const candidate = projectIncompleteReferencePickCandidate(fixture(
      `${base}\nline Bad = segment(start: @Missing, end: (0, 0))\nreverse ()`
    ))!;
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({ code: "undefined-geometry-reference", severity: "warning" }));
    expect(evaluateElementsReference(candidate.document.elements, buildEvaluationOptions({
      compiledDocument: candidate, evaluationLimitIndex: undefined
    })).errors.length).toBeGreaterThan(0);
  });

  it("rejects revision, target proof, statement identity, source range and lexical scope mismatches", () => {
    const input = fixture();
    expect(projectIncompleteReferencePickCandidate({ ...input, source: { ...input.source, sourceRevision: 99 } })).toBeNull();
    expect(projectIncompleteReferencePickCandidate({ ...input, request: {
      ...input.request, targetProof: { ...input.request.targetProof, oldText: "different" }
    } })).toBeNull();
    const map = input.compiled.statementMap!;
    expect(projectIncompleteReferencePickCandidate({ ...input, compiled: {
      ...input.compiled, statementMap: { ...map, statementIndexByStatementId: new Map() }
    } })).toBeNull();
    expect(projectIncompleteReferencePickCandidate({ ...input, compiled: {
      ...input.compiled, statements: input.compiled.statements.map((statement, index) => index === 2
        ? { ...statement, documentRange: { ...statement.documentRange, to: 1_000_000 } } : statement)
    } })).toBeNull();
    const namespace = input.compiled.sourceLexicalNamespace!;
    expect(projectIncompleteReferencePickCandidate({ ...input, compiled: {
      ...input.compiled, sourceLexicalNamespace: { ...namespace, scopeIndex: {
        ...namespace.scopeIndex, scopeOfStatement: new Map([[0, "wrong-scope"], [1, "wrong-scope"], [2, "wrong-scope"]])
      } }
    } })).toBeNull();
  });
});
