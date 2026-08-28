import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationResult } from "../types/geometry";
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

const HOST_REVISION = 93;
const CANVAS_REVISION = 1093;
const DOCUMENT_URI = "file:///pick.nui";
const DOCUMENT_VERSION = 7;

const compile = (
  source: string,
  sourceRevision = HOST_REVISION,
  statementIdPrefix = "host-pick"
): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${statementIdPrefix}:${index}`]))
  });
};

const evaluate = (compiled: CompiledDslDocument): EvaluationResult => {
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
};

const setup = (source: string, fragment: string) => {
  const compiled = compile(source);
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  const start = source.indexOf(fragment);
  const position = start + Math.max(1, fragment.indexOf("@") + 2);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: HOST_REVISION },
    position,
    semantic: { sourceRevision: HOST_REVISION, sourceText: source, compiled }
  });
  if (!target) throw new Error(`missing target: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing proof: ${fragment}`);
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 44,
    documentUri: DOCUMENT_URI,
    documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset: position,
    targetProof: proof
  };
  return { compiled, evaluation: evaluate(compiled), request };
};

const startSession = ({
  source,
  compiled,
  evaluation,
  request,
  sourceRevision = HOST_REVISION,
  authoritativeDocumentUri = DOCUMENT_URI,
  authoritativeDocumentVersion = DOCUMENT_VERSION
}: ReturnType<typeof setup> & {
  source: string;
  sourceRevision?: number;
  authoritativeDocumentUri?: string;
  authoritativeDocumentVersion?: number;
}) => startVscodeReferencePickCanvasSession({
  request,
  authoritativeDocumentUri,
  authoritativeDocumentVersion,
  source: { normalizedSource: source, sourceRevision },
  compiled,
  evaluation,
  evaluationIsCurrent: true
});

describe("VS Code Canvas reference pick session bridge", () => {
  it("matches document/version proof across independent Host and Webview compiler sessions", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line) {",
      "}",
      "instance X = M(straight: @Straight)"
    ].join("\n");
    const host = setup(source, "straight: @Straight");
    const canvasCompiled = compile(source, CANVAS_REVISION, "canvas-pick");
    const canvasEvaluation = evaluate(canvasCompiled);
    const started = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION
    });

    expect(started.session).not.toBeNull();
    expect(started.result.status).toBe("started");
    if (started.result.status === "started") {
      expect(started.result.candidateReferences).toContainEqual({ base: "Straight" });
      expect(started.result.candidateReferences).not.toContainEqual({ base: "Curve" });
    }

    expect(startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      authoritativeDocumentVersion: DOCUMENT_VERSION + 1
    }).result.status).toBe("stale");
    expect(startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      authoritativeDocumentUri: "file:///other.nui"
    }).result.status).toBe("stale");

    const staleProof = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        targetProof: { ...host.request.targetProof, oldText: "@Other" }
      }
    });
    expect(staleProof.session).toBeNull();
    expect(staleProof.result.status).toBe("stale");
  });

  it("revalidates restored draft references against the current candidates", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "module M(straight: line) {",
      "}",
      "instance X = M(straight: @Straight)"
    ].join("\n");
    const host = setup(source, "straight: @Straight");
    const canvasCompiled = compile(source, CANVAS_REVISION, "canvas-restore");
    const canvasEvaluation = evaluate(canvasCompiled);
    const restored = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        requestId: host.request.requestId + 1,
        initialDraftReferences: [{ base: "Straight" }]
      }
    });

    expect(restored.result.status).toBe("started");
    expect(restored.session?.draft.draftReferences).toEqual([{ base: "Straight" }]);

    const missing = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        requestId: host.request.requestId + 2,
        initialDraftReferences: [{ base: "Missing" }]
      }
    });
    expect(missing.session).toBeNull();
    expect(missing.result.status).toBe("rejected");
  });

  it("seeds a multiple draft, toggles candidates, and confirms without mutating Source", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "line C = segment(start: (0, 20), end: (10, 20))",
      "line Seam = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const setupResult = setup(source, "[@A, @B]");
    const started = startSession({ source, ...setupResult });
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
