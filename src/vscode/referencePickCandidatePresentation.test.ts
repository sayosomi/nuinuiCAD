import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { referencePickCandidates } from "../model/referencePickCandidates";
import type { ReferencePickCandidate, ReferencePickGeometryOption } from "../model/referencePickCandidates";
import {
  confirmVscodeReferencePickCanvasSession,
  referencePickHoverForCanvasOption,
  selectVscodeReferencePickCanvasDraft,
  startVscodeReferencePickCanvasSession
} from "./referencePickCanvasSession";
import { referencePickTargetProofFor } from "./referencePickProtocol";
import { referencePickCandidatePresentationForHits } from "./referencePickCandidatePresentation";

const geometryOption = (
  base: string,
  pointKey?: string,
  occurrenceIndex?: number,
  label = `@${base}${occurrenceIndex === undefined ? "" : `[${occurrenceIndex}]`}${pointKey ? `.${pointKey}` : ""}`
): ReferencePickGeometryOption => ({
  kind: "geometry",
  label,
  reference: {
    base,
    ...(occurrenceIndex === undefined ? {} : { occurrenceIndex }),
    ...(pointKey === undefined ? {} : { pointKey })
  }
});

const candidate = (
  elementId: string,
  options: readonly ReferencePickGeometryOption[]
): ReferencePickCandidate => ({ elementId, actualGeometryInterface: "line", options });

const labels = (options: readonly { option: ReferencePickGeometryOption }[]) =>
  options.map(({ option }) => option.label);

describe("referencePickCandidatePresentationForHits", () => {
  it("presents a compiler-authorized generated hit as its exact occurrence with bulk available in Details", () => {
    const source = `nui 1
for i in range(min: 0, max: 1, step: 1, showGenerated: true) {
  line Mark = segment(start: (@i * 20, 0), end: (@i * 20 + 10, 0))
  line Anchor = segment(start: (100, 0), end: (110, 0))
  reverse @Anchor()
}
`;
    const compiled = compileFreshCanonicalText(source).currentCompiled;
    if (!compiled.document || !compiled.statementMap) throw new Error(JSON.stringify(compiled.diagnostics));
    const sourceSnapshot = { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision };
    const targetOffset = source.lastIndexOf("@Anchor") + 1;
    const target = queryDslReferencePickTarget({
      source: sourceSnapshot,
      position: targetOffset,
      semantic: { sourceRevision: sourceSnapshot.sourceRevision, sourceText: source, compiled }
    });
    if (!target) throw new Error("fixture did not produce a transformation target");
    const evaluation = evaluateElements(compiled.document.elements, buildEvaluationOptions({
      compiledDocument: compiled as LastGoodDslDocument,
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    }));
    expect(evaluation.errors).toEqual([]);
    const candidates = referencePickCandidates({ compiled, evaluation, target });
    const rows = evaluation.forGroupGeneratedRows?.filter((row) =>
      row.templateElementId === compiled.document?.elements.find((element) => element.name === "Mark")?.id
    ) ?? [];
    const second = rows.find((row) => row.iterationIndex === 1);
    expect(rows.map((row) => row.iterationIndex)).toEqual([0, 1]);
    expect(second).toBeDefined();
    const hit = candidates.find((candidate) => candidate.elementId === second?.generatedElementId);
    expect(hit).toBeDefined();

    const result = referencePickCandidatePresentationForHits(hit ? [hit] : []);
    expect(labels(result.primary)).toEqual(["@Mark[1]"]);
    expect(labels(result.details)).toEqual(["@Mark"]);
    expect(result.primary.map(({ explanation }) => explanation)).toEqual(["individualOccurrence"]);
    expect(result.details.map(({ explanation }) => explanation)).toEqual(["allOccurrences"]);

    const targetProof = referencePickTargetProofFor(source, target);
    if (!targetProof) throw new Error("fixture did not produce a target proof");
    const started = startVscodeReferencePickCanvasSession({
      request: {
        type: "referencePickStartRequest",
        requestId: 1559,
        documentUri: "file:///reference-pick-generated.nui",
        documentVersion: 1,
        normalizedSourceOffset: targetOffset,
        targetProof
      },
      authoritativeDocumentUri: "file:///reference-pick-generated.nui",
      authoritativeDocumentVersion: 1,
      source: sourceSnapshot,
      compiled,
      evaluation,
      evaluationIsCurrent: true
    });
    expect(started.result.status).toBe("started");
    if (!started.session) throw new Error("session did not start for a valid generated target");
    const sessionHit = started.session.candidates.find((item) => item.elementId === second?.generatedElementId);
    const exactOption = sessionHit?.options.find((option) =>
      option.kind === "geometry" && option.reference.base === "Mark" && option.reference.occurrenceIndex === 1
    );
    expect(exactOption).toBeDefined();
    if (!sessionHit || !exactOption || exactOption.kind !== "geometry") throw new Error("missing exact generated occurrence option");
    const selected = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(sessionHit, exactOption)
    );
    expect(selected.draft.draftReferences).toEqual([{ base: "Mark", occurrenceIndex: 1 }]);
    expect(confirmVscodeReferencePickCanvasSession(selected).result).toMatchObject({
      status: "confirmed",
      resultKind: "geometry",
      references: [{ base: "Mark", occurrenceIndex: 1 }]
    });
  });

  it("keeps an occurrence primary and the legal bulk reference in Details", () => {
    const result = referencePickCandidatePresentationForHits([candidate("drawn-occurrence", [
      geometryOption("Mark", undefined, 1),
      geometryOption("Mark", "end", 1),
      geometryOption("Mark"),
      geometryOption("Mark", "end")
    ])]);

    expect(labels(result.primary)).toEqual([
      "@Mark[1]",
      "@Mark[1].end"
    ]);
    expect(labels(result.details)).toEqual([
      "@Mark",
      "@Mark.end"
    ]);
    expect(result.primary.map(({ explanation }) => explanation)).toEqual([
      "individualOccurrence",
      "individualOccurrence"
    ]);
    expect(result.details.map(({ explanation }) => explanation)).toEqual([
      "allOccurrences",
      "allOccurrences"
    ]);
  });

  it("keeps ordinary source geometry and its legal endpoint options primary", () => {
    const result = referencePickCandidatePresentationForHits([candidate("authored-A", [
      geometryOption("A"),
      geometryOption("A", "start"),
      geometryOption("A", "end")
    ])]);

    expect(labels(result.primary)).toEqual(["@A", "@A.start", "@A.end"]);
    expect(labels(result.details)).toEqual([]);
    expect(result.primary.map(({ explanation }) => explanation)).toEqual([
      "sourceGeometry",
      "sourceGeometry",
      "sourceGeometry"
    ]);
  });

  it("deduplicates canonical options within one real hit but preserves equal references from overlapping owners", () => {
    const repeated = geometryOption("Mark", "end", 1, "display label does not define identity");
    const first = candidate("real-hit-first", [
      geometryOption("Mark", undefined, 1),
      repeated,
      geometryOption("Mark", "end", 1, "another label")
    ]);
    const second = candidate("real-hit-second", [
      geometryOption("Mark", undefined, 1),
      geometryOption("Mark", "end", 1)
    ]);
    const result = referencePickCandidatePresentationForHits([second, first]);

    expect(result.primary.map(({ candidateElementId, option }) => [candidateElementId, option.label])).toEqual([
      ["real-hit-second", "@Mark[1]"],
      ["real-hit-second", "@Mark[1].end"],
      ["real-hit-first", "@Mark[1]"],
      ["real-hit-first", "display label does not define identity"]
    ]);
    expect(result.details).toEqual([]);
  });
});
