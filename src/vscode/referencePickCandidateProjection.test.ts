import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { referencePickTargetProofFor } from "./referencePickProtocol";
import { proveTemporarilyCompletedExtract } from "./referencePickExtractProjectionProof";
import { startVscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { projectIncompleteReferencePickCandidate, projectIndependentReferencePickBrowseCandidate } from "./referencePickCandidateProjection";

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
  it("projects an incomplete extract boundary in the middle without losing later source identities", () => {
    const text = `${base}\npoint Cut = coordinate(x: 10, y: 0)\nextract E(source: @A, parts: [lower: start..@Cut, upper: @Cut..])\nline Later = segment(start: (50,0), end: (60,0))`;
    const compiled = compileFreshCanonicalText(text).currentCompiled;
    const source = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
    const normalizedSourceOffset = text.indexOf("@Cut..]") + "@Cut..".length;
    const target = queryDslReferencePickTarget({ source, position: normalizedSourceOffset, semantic: { sourceRevision: source.sourceRevision, compiled } })!;
    expect(target).not.toBeNull();
    const input = { source, compiled, request: { type: "referencePickStartRequest" as const, requestId: 1565, documentUri: "file:///extract.nui", documentVersion: 1, normalizedSourceOffset, targetProof: referencePickTargetProofFor(text, target)! } };
    const candidate = projectIncompleteReferencePickCandidate(input)!;
    expect(candidate).not.toBeNull();
    const evaluation = evaluateElementsReference(candidate.document.elements, buildEvaluationOptions({ compiledDocument: candidate, evaluationLimitIndex: undefined }));
    const { result } = startVscodeReferencePickCanvasSession({ ...input, authoritativeDocumentUri: input.request.documentUri, authoritativeDocumentVersion: 1, evaluation, evaluationIsCurrent: false, candidateSnapshot: { source: { normalizedSource: candidate.spans.sourceMap.source, sourceRevision: candidate.spans.sourceMap.sourceRevision }, compiled: candidate, evaluation } });
    expect(result.status).toBe("started");
    if (result.status !== "started") throw new Error("Pick failed");
    expect(result.candidateReferences.map(r => r.base)).toContain("Cut");
  });
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

it.each([false, true])("preserves extract ownership and independent candidates with downstream move=%s", withMove => {
  const text = `nui 1
line Base = segment(start: (0, 0), end: (200, 0))
point Cut40 = coordinate(x: 40, y: 0)
point Cut100 = coordinate(x: 100, y: 0)
extract F(source: @Base, parts: [whole: start..end])
path FromF = from(source: @F::whole)
extract E(
  source: @Base,
  parts: [lower: start..@Cut40, upper: @Cut40..,],
)
${withMove ? 'move @E::upper(from: (0, 0), to: (0, 10))' : ''}
path Dependent = from(source: @E::upper)`;
  const compiled = compileFreshCanonicalText(text).currentCompiled;
  const source = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
  const normalizedSourceOffset = text.indexOf("@Cut40..,") + "@Cut40..".length;
  const target = queryDslReferencePickTarget({ source, position: normalizedSourceOffset, semantic: { sourceRevision: source.sourceRevision, compiled } })!;
  expect(target).not.toBeNull();
  const input = { source, compiled, request: { type: "referencePickStartRequest" as const, requestId: 1590, documentUri: "file:///extract.nui", documentVersion: 1, normalizedSourceOffset, targetProof: referencePickTargetProofFor(text, target)! } };
  const candidate = projectIncompleteReferencePickCandidate(input)!;
  expect(candidate).not.toBeNull();
  expect(candidate.spans.sourceMap.source).toBe(text.slice(0, normalizedSourceOffset) + "end" + text.slice(normalizedSourceOffset));
  const evaluation = evaluateElementsReference(candidate.document.elements, buildEvaluationOptions({ compiledDocument: candidate, evaluationLimitIndex: undefined }));
  expect(evaluation.errors).toEqual([]);
  const started = startVscodeReferencePickCanvasSession({ ...input, authoritativeDocumentUri: input.request.documentUri, authoritativeDocumentVersion: 1, evaluation, evaluationIsCurrent: false, candidateSnapshot: { source: { normalizedSource: candidate.spans.sourceMap.source, sourceRevision: candidate.spans.sourceMap.sourceRevision }, compiled: candidate, evaluation } });
  expect(started.result.status).toBe("started");
  const bases = started.session!.candidates.flatMap(c => c.options.map(o => o.reference.base));
  expect(bases).toEqual(expect.arrayContaining(["Cut100", "F::whole", "FromF"]));
  expect(bases.some(b => b.startsWith("E::") || b === "Dependent")).toBe(false);
});

it.each(['source: , parts: [a: start..end]', 'source: @Base, parts: [a: ..end]', 'source: @Base, parts: [a: .., b: ..]'])("grounds incomplete extract Browse in unchanged independent prefix: %s", args => {
  const text = `${base}\nextract E(${args})\nmove @E::a(from: (0,0), to: (0,10))`;
  const compiled = compileFreshCanonicalText(text).currentCompiled;
  const candidate = projectIndependentReferencePickBrowseCandidate({ source: { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision }, compiled });
  expect(candidate).not.toBeNull();
  expect(candidate!.spans.sourceMap.source).toBe(base + '\n');
  expect(candidate!.document.elements.map(e => e.name)).toContain('A');
  expect(compiled.spans.sourceMap.source).toBe(text);
});

it.each(['upstream', 'downstream', 'completion', 'missing-id', 'duplicate-id', 'inverse-id', 'owner', 'scope', 'part-index', 'part-name', 'element-map', 'element-owner', 'revision', 'fingerprint', 'multiple-holes'])("keeps the scoped extract proof closed for %s", mutation => {
  const text = `${base}\npoint Cut = coordinate(x: 10, y: 0)\nextract E(source: @A, parts: [lower: start..@Cut, upper: @Cut..])\nmove @E::upper(from: (0,0), to: (0,10))`;
  const compiled = compileFreshCanonicalText(text).currentCompiled;
  const source = { normalizedSource: text, sourceRevision: compiled.spans.sourceMap.sourceRevision };
  const position = text.indexOf('@Cut..]') + '@Cut..'.length;
  const target = queryDslReferencePickTarget({ source, position, semantic: { sourceRevision: source.sourceRevision, compiled } })!;
  const request = { type: 'referencePickStartRequest' as const, requestId: 1590, documentUri: 'file:///scope.nui', documentVersion: 1, normalizedSourceOffset: position, targetProof: referencePickTargetProofFor(text, target)! };
  const candidate = projectIncompleteReferencePickCandidate({ source, compiled, request })!;
  expect(candidate).not.toBeNull();
  const snapshot = { compiled: { ...candidate, statements: candidate.statements.map(s => s.kind === "element" ? { ...s, ...(s.extractPart ? { extractPart: { ...s.extractPart } } : {}) } : { ...s }), statementMap: { ...candidate.statementMap, elementIdByStatementIndex: new Map(candidate.statementMap.elementIdByStatementIndex), byElementId: new Map(candidate.statementMap.byElementId), statementIdByStatementIndex: new Map(candidate.statementMap.statementIdByStatementIndex), statementIndexByStatementId: new Map(candidate.statementMap.statementIndexByStatementId) }, sourceLexicalNamespace: { ...candidate.sourceLexicalNamespace!, scopeIndex: { ...candidate.sourceLexicalNamespace!.scopeIndex, scopeOfStatement: new Map(candidate.sourceLexicalNamespace!.scopeIndex.scopeOfStatement) } } }, source: { normalizedSource: candidate.spans.sourceMap.source, sourceRevision: candidate.spans.sourceMap.sourceRevision } };
  expect(proveTemporarilyCompletedExtract({ target, currentCompiled: compiled, canvasSnapshot: snapshot })).not.toBeNull();
  const head = target.sourceAnchor.statementIndex;
  const memberIndex = head + 1;
  const member = snapshot.compiled.statements[memberIndex]!;
  if (mutation === 'upstream') snapshot.source.normalizedSource = snapshot.source.normalizedSource.replace('(20, 0)', '(21, 0)');
  if (mutation === 'downstream') snapshot.source.normalizedSource += '\n// extra';
  if (mutation === 'completion') snapshot.source.normalizedSource = snapshot.source.normalizedSource.replace('@Cut..end', '@Cut..@Cut');
  if (mutation === 'missing-id') snapshot.compiled.statementMap!.statementIdByStatementIndex!.delete(memberIndex);
  if (mutation === 'duplicate-id') snapshot.compiled.statementMap!.statementIdByStatementIndex!.set(memberIndex, target.sourceAnchor.statementId);
  if (mutation === 'inverse-id') snapshot.compiled.statementMap!.statementIndexByStatementId!.delete(target.sourceAnchor.statementId);
  if (mutation === 'owner' && member.kind === 'element') member.extractPart!.declarationIndex = head - 1;
  if (mutation === 'part-index' && member.kind === 'element') member.extractPart!.partIndex = 1;
  if (mutation === 'part-name') member.name = 'fake';
  if (mutation === 'element-map') snapshot.compiled.statementMap!.elementIdByStatementIndex.set(memberIndex, snapshot.compiled.statementMap!.elementIdByStatementIndex.get(1)!);
  if (mutation === 'element-owner') {
    const id = snapshot.compiled.statementMap!.elementIdByStatementIndex.get(memberIndex)!;
    snapshot.compiled.statementMap!.byElementId.set(id, { ...snapshot.compiled.statementMap!.byElementId.get(id)!, statementIndex: 1 });
  }
  if (mutation === 'scope') snapshot.compiled.sourceLexicalNamespace!.scopeIndex.scopeOfStatement.set(memberIndex, 'wrong');
  if (mutation === 'revision') snapshot.source.sourceRevision++;
  if (mutation === 'multiple-holes') snapshot.source.normalizedSource = snapshot.source.normalizedSource.replace('start..@Cut', 'start..');
  if (mutation === 'fingerprint') snapshot.compiled.moduleRuntimeContext = { valid: false } as never;
  expect(proveTemporarilyCompletedExtract({ target, currentCompiled: compiled, canvasSnapshot: snapshot })).toBeNull();
});
