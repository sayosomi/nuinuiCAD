import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { evaluateElements } from "../geometry/evaluate";
import {
  confirmVscodeReferencePickCanvasSession,
  referencePickHoverForCanvasOption,
  selectVscodeReferencePickCanvasDraft,
  startVscodeReferencePickCanvasSession
} from "./referencePickCanvasSession";
import {
  referencePickTargetProofFor,
  type VscodeReferencePickStartRequest
} from "./referencePickProtocol";

const REVISION = 93;

const compile = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-canvas:${index}`]))
  });
};

const setup = (source: string, fragment: string) => {
  const compiled = compile(source);
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  const start = source.indexOf(fragment);
  const position = start + Math.max(1, fragment.indexOf("@") + 2);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position,
    semantic: { sourceRevision: REVISION, sourceText: source, compiled }
  });
  if (!target) throw new Error(`missing target: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing proof: ${fragment}`);
  const evaluation = evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 44,
    documentUri: "file:///pick.nui",
    documentVersion: 7,
    normalizedSourceOffset: position,
    targetProof: proof
  };
  return { compiled, evaluation, request };
};

describe("VS Code Canvas reference pick session bridge", () => {
  it("reproduces the Source proof before starting and reports the current candidate snapshot", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line) {}",
      "instance X = M(straight: @Straight)"
    ].join("\n");
    const { compiled, evaluation, request } = setup(source, "straight: @Straight");
    const started = startVscodeReferencePickCanvasSession({
      request,
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      evaluation,
      evaluationIsCurrent: true
    });

    expect(started.session).not.toBeNull();
    expect(started.result.status).toBe("started");
    if (started.result.status === "started") {
      expect(started.result.candidateReferences).toContainEqual({ base: "Straight" });
      expect(started.result.candidateReferences).not.toContainEqual({ base: "Curve" });
    }

    const stale = startVscodeReferencePickCanvasSession({
      request: { ...request, targetProof: { ...request.targetProof, oldText: "@Other" } },
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      evaluation,
      evaluationIsCurrent: true
    });
    expect(stale.session).toBeNull();
    expect(stale.result.status).toBe("stale");
  });

  it("seeds a multiple draft, toggles candidates, and confirms without mutating Source", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "line C = segment(start: (0, 20), end: (10, 20))",
      "line Seam = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const { compiled, evaluation, request } = setup(source, "[@A, @B]");
    const started = startVscodeReferencePickCanvasSession({
      request,
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      evaluation,
      evaluationIsCurrent: true
    });
    if (!started.session) throw new Error("session did not start");
    expect(started.session.draft.draftReferences).toEqual([{ base: "A" }, { base: "B" }]);

    const optionFor = (base: string) => {
      for (const candidate of started.session!.candidates) {
        const option = candidate.options.find((entry) => entry.reference.base === base);
        if (option) return { candidate, option };
      }
      throw new Error(`missing candidate: ${base}`);
    };
    const c = optionFor("C");
    let session = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(c.candidate, c.option)
    );
    const b = optionFor("B");
    session = selectVscodeReferencePickCanvasDraft(
      session,
      referencePickHoverForCanvasOption(b.candidate, b.option)
    );
    const confirmed = confirmVscodeReferencePickCanvasSession(session);

    expect(source).toContain("sources: [@A, @B]");
    expect(confirmed.result?.references).toEqual([{ base: "A" }, { base: "C" }]);
  });
});
