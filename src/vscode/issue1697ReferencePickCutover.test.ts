import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDslSnapshot,
  parseDslSourceReference,
  queryDslReferencePickTarget,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import { compileFreshCanonicalText, isLastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { referencePickCandidates } from "../model/referencePickCandidates";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import { referencePickCandidateReferences } from "./referencePickCanvasSession";
import {
  referencePickNumericPropertyDraftFor,
  referencePickReplacementText,
  referencePickSeedReferences,
  referencePickSourceForReference,
  referencePickTargetProofFor
} from "./referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "./referencePickSourceEdit";
import { projectIncompleteReferencePickCandidate } from "./referencePickCandidateProjection";

const REVISION = 1697;

const compile = (source: string, sourceRevision = REVISION): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue1697-pick:${index}`]))
  });
};

const targetAt = (
  source: string,
  fragment: string,
  sourceRevision = REVISION,
  relativeOffset?: number
) => {
  const parsed = compile(source, sourceRevision);
  const from = source.indexOf(fragment);
  if (from < 0) throw new Error(`missing source fragment: ${fragment}`);
  const normalizedSourceOffset = from + (relativeOffset ?? Math.max(1, Math.floor(fragment.length / 2)));
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision },
    position: normalizedSourceOffset,
    semantic: { sourceText: source, sourceRevision, compiled: parsed }
  });
  if (!target) throw new Error(`missing Reference Pick target for: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing Reference Pick proof for: ${fragment}`);
  return { compiled: parsed, normalizedSourceOffset, target, proof };
};

const canonicalTargetAt = (source: string, fragment: string, relativeOffset: number) => {
  const compiled = compileFreshCanonicalText(source).currentCompiled;
  const sourceRevision = compiled.spans.sourceMap.sourceRevision;
  const from = source.indexOf(fragment);
  if (from < 0) throw new Error(`missing source fragment: ${fragment}`);
  const normalizedSourceOffset = from + relativeOffset;
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision },
    position: normalizedSourceOffset,
    semantic: { sourceText: source, sourceRevision, compiled }
  });
  if (!target) throw new Error(`missing Reference Pick target for: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing Reference Pick proof for: ${fragment}`);
  return { compiled, sourceRevision, normalizedSourceOffset, target, proof };
};

const evaluate = (compiled: CompiledDslDocument) => {
  if (!isLastGoodDslDocument(compiled)) throw new Error("expected a last-good compiled Source document");
  return evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  }));
};

const referenceSource = `nui 1
const left: number = 50
const side: choice(left, right) = @left
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
line AB = segment(start: A, end: B)
line CD = segment(start: (0, 10), end: (20, 10))
line EF = segment(start: (0, 20), end: (20, 20))`;

describe("Issue #1697 Reference Pick source cutover", () => {
  it("formats canonical bare references and preserves qualified, absolute, property, and occurrence identity", () => {
    expect(referencePickSourceForReference({ base: "A" })).toBe("A");
    expect(referencePickSourceForReference({ base: "front::seam" })).toBe("front::seam");
    expect(referencePickSourceForReference({ base: "::front::seam" })).toBe("::front::seam");
    expect(referencePickSourceForReference({ base: "A", pointKey: "end" })).toBe("A.end");
    expect(referencePickSourceForReference({ base: "Mark", occurrenceIndex: 1, pointKey: "length" }))
      .toBe("Mark[1].length");
    expect(referencePickReplacementText("multiple", [{ base: "A" }, { base: "B" }])).toBe("[A, B]");
    expect(referencePickReplacementText("multiple", [
      { base: "A", pointKey: "end" }, { base: "B", pointKey: "start" }
    ])).toBe("[A.end, B.start]");
    expect(parseDslSourceReference("@left").kind).toBe("invalid");

    const source = `${referenceSource}\ngroup front {\n  line seam = segment(start: A, end: B)\n}\nreverse front::seam()\nreverse ::front::seam()`;
    const relative = targetAt(source, "front::seam");
    const absolute = targetAt(source, "::front::seam");
    expect(relative.proof.oldText).toBe("front::seam");
    expect(referencePickSeedReferences(relative.proof)).toEqual([{ base: "front::seam" }]);
    expect(absolute.proof.oldText).toBe("::front::seam");
    expect(referencePickSeedReferences(absolute.proof)).toEqual([{ base: "::front::seam" }]);
  });

  it("seeds completed and partial bare lists while rejecting legacy sigils as geometry", () => {
    const completedSource = `${referenceSource}\nmove [AB, CD](from: (0, 0), to: (1, 0))`;
    const completed = targetAt(completedSource, "[AB, CD]");
    expect(completed.proof.oldText).toBe("[AB, CD]");
    expect(referencePickSeedReferences(completed.proof)).toEqual([{ base: "AB" }, { base: "CD" }]);

    const partialSource = `${referenceSource}\nmove [AB, ](from: (0, 0), to: (1, 0))`;
    const partial = targetAt(partialSource, "[AB, ]");
    expect(partial.proof.oldText).toBe("[AB, ]");
    expect(referencePickSeedReferences(partial.proof)).toEqual([{ base: "AB" }]);
    expect(referencePickSeedReferences({ ...partial.proof, oldText: "[@AB, @]" })).toBeNull();

    const invalidChoiceTarget = `${referenceSource}\nreverse @left()`;
    const invalid = targetAt(invalidChoiceTarget, "reverse @left()", REVISION, "reverse @".length);
    expect(referencePickSeedReferences(invalid.proof)).toBeNull();
    expect(invalidChoiceTarget).toContain("const side: choice(left, right) = @left");
    expect(invalidChoiceTarget.slice(0, invalidChoiceTarget.lastIndexOf("reverse"))).toContain("= @left");
  });

  it("replaces the exact ordered transformation target using compiler-owned candidates and rejects stale or forged proof", () => {
    const source = `${referenceSource}\nmove [AB, CD](from: (0, 0), to: (1, 0)) // keep this comment`;
    const { compiled, normalizedSourceOffset, target, proof } = targetAt(source, "[AB, CD]");
    expect([...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])].filter(item => item.severity === "error"))
      .toEqual([]);
    const candidates = referencePickCandidates({ compiled, evaluation: evaluate(compiled), target });
    const allowedCandidateReferences = referencePickCandidateReferences(candidates);
    expect(allowedCandidateReferences.map(reference => reference.base)).toEqual(expect.arrayContaining(["AB", "CD", "EF"]));

    const references: CanonicalGeometrySourceReference[] = [{ base: "CD" }, { base: "AB" }];
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset,
      targetProof: proof,
      references,
      allowedCandidateReferences
    });
    expect(plan).toMatchObject({
      range: { from: source.indexOf("[AB, CD]"), to: source.indexOf("[AB, CD]") + "[AB, CD]".length },
      replacement: "[CD, AB]",
      caretNormalizedOffset: source.indexOf("[AB, CD]") + "[CD, AB]".length
    });
    const next = source.slice(0, plan!.range.from) + plan!.replacement + source.slice(plan!.range.to);
    expect(next).toBe(source.replace("[AB, CD]", "[CD, AB]"));
    expect(next).toContain("const side: choice(left, right) = @left");
    expect(next).toContain("// keep this comment");
    expect([...compile(next).diagnostics, ...(compile(next).bindingIssueDiagnostics ?? [])].filter(item => item.severity === "error"))
      .toEqual([]);

    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset,
      targetProof: proof,
      references: [{ base: "Forged" }],
      allowedCandidateReferences
    })).toBeNull();

    const staleSource = source.replace("[AB, CD]", "[AB, EF]");
    const staleCompiled = compile(staleSource, REVISION + 1);
    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: staleSource, sourceRevision: REVISION + 1 },
      compiled: staleCompiled,
      normalizedSourceOffset,
      targetProof: proof,
      references: [{ base: "EF" }, { base: "AB" }],
      allowedCandidateReferences
    })).toBeNull();
  });

  it("targets complete numeric properties and replaces them with a captured numeric candidate", () => {
    const source = `${referenceSource}\nconst measured: number = AB.length`;
    const { compiled, normalizedSourceOffset, target, proof } = targetAt(source, "AB.length");
    const expectedRange = { from: source.indexOf("AB.length"), to: source.indexOf("AB.length") + "AB.length".length };
    expect(target.range).toEqual(expectedRange);
    expect(proof.oldText).toBe("AB.length");
    expect(proof.numericProperty).toEqual({ kind: "propertySelectionRequired" });
    expect(referencePickNumericPropertyDraftFor(proof)).toEqual({ reference: { base: "AB" }, property: "length" });

    const candidates = referencePickCandidates({ compiled, evaluation: evaluate(compiled), target });
    const allowedCandidateReferences = referencePickCandidateReferences(candidates);
    const allowedNumericCandidates = candidates.flatMap(candidate => candidate.options.flatMap(option =>
      option.kind === "numericProperty" ? [{ reference: option.reference, properties: option.properties }] : []
    ));
    expect(allowedNumericCandidates.some(candidate => candidate.reference.base === "CD" && candidate.properties.includes("length")))
      .toBe(true);
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset,
      targetProof: proof,
      references: [],
      allowedCandidateReferences,
      numericProperty: { reference: { base: "CD" }, property: "length" },
      allowedNumericCandidates
    });
    expect(plan).toMatchObject({
      range: expectedRange,
      replacement: "CD.length",
      caretNormalizedOffset: expectedRange.from + "CD.length".length
    });
    const next = source.slice(0, plan!.range.from) + plan!.replacement + source.slice(plan!.range.to);
    expect(next).toBe(source.replace("AB.length", "CD.length"));
    expect(next).toContain("const side: choice(left, right) = @left");

    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset,
      targetProof: proof,
      references: [],
      allowedCandidateReferences,
      numericProperty: { reference: { base: "Forged" }, property: "length" },
      allowedNumericCandidates
    })).toBeNull();

    const staleSource = source.replace("AB.length", "CD.length");
    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: staleSource, sourceRevision: REVISION + 1 },
      compiled: compile(staleSource, REVISION + 1),
      normalizedSourceOffset,
      targetProof: proof,
      references: [],
      allowedCandidateReferences,
      numericProperty: { reference: { base: "AB" }, property: "length" },
      allowedNumericCandidates
    })).toBeNull();
  });

  it("preserves occurrence property identity and separates an empty hole from an invalid complete selector", () => {
    const occurrenceSource = `${referenceSource}\nfor i in range(min: 0, max: 2, step: 1) {\n  line Mark = segment(start: (0, i), end: (10, i))\n  const measuredOccurrence: number = Mark[1].length\n}`;
    const occurrence = targetAt(occurrenceSource, "Mark[1].length");
    const occurrenceRange = {
      from: occurrenceSource.indexOf("Mark[1].length"),
      to: occurrenceSource.indexOf("Mark[1].length") + "Mark[1].length".length
    };
    expect(occurrence.target.range).toEqual(occurrenceRange);
    expect(occurrence.proof.oldText).toBe("Mark[1].length");
    expect(referencePickNumericPropertyDraftFor(occurrence.proof)).toEqual({
      reference: { base: "Mark", occurrenceIndex: "1" },
      property: "length"
    });

    const incompleteSource = `${referenceSource}\nreverse ()`;
    const incomplete = canonicalTargetAt(incompleteSource, "reverse ()", "reverse ".length);
    const incompleteRequest = {
      type: "referencePickStartRequest" as const,
      requestId: 1697,
      documentUri: "file:///issue1697-incomplete.nui",
      documentVersion: 1,
      normalizedSourceOffset: incomplete.normalizedSourceOffset,
      targetProof: incomplete.proof
    };
    expect(incomplete.proof.oldText).toBe("");
    expect(projectIncompleteReferencePickCandidate({
      source: { normalizedSource: incompleteSource, sourceRevision: incomplete.sourceRevision },
      compiled: incomplete.compiled,
      request: incompleteRequest
    })).not.toBeNull();

    const invalidSource = `${referenceSource}\nreverse @left()`;
    const invalid = targetAt(invalidSource, "reverse @left()", REVISION, "reverse @".length);
    expect(referencePickSeedReferences(invalid.proof)).toBeNull();
    expect(projectIncompleteReferencePickCandidate({
      source: { normalizedSource: invalidSource, sourceRevision: invalid.compiled.spans.sourceMap.sourceRevision },
      compiled: invalid.compiled,
      request: {
        ...incompleteRequest,
        documentUri: "file:///issue1697-invalid.nui",
        normalizedSourceOffset: invalid.normalizedSourceOffset,
        targetProof: invalid.proof
      }
    })).toBeNull();
  });
});
