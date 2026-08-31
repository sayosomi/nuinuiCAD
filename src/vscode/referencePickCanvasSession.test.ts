import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationResult } from "../types/geometry";
import {
  confirmVscodeReferencePickCanvasSession,
  referencePickCanvasResultMatchesSession,
  referencePickHoverForCanvasOption,
  selectVscodeReferencePickCanvasDraft,
  selectVscodeReferencePickCanvasNumericProperty,
  startVscodeReferencePickCanvasSession,
  type VscodeReferencePickCanvasSnapshot
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

const dualAuthorityFixture = (
  currentSource: string,
  canvasSource: string,
  normalizedSourceOffset: number
) => {
  const currentCompiled = compile(currentSource, HOST_REVISION, "shared-pick");
  const canvasCompiled = compile(canvasSource, CANVAS_REVISION, "shared-pick");
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: currentSource, sourceRevision: HOST_REVISION },
    position: normalizedSourceOffset,
    semantic: {
      sourceRevision: HOST_REVISION,
      sourceText: currentSource,
      compiled: currentCompiled
    }
  });
  if (!target) throw new Error("fixture did not produce a current Source target");
  const targetProof = referencePickTargetProofFor(currentSource, target);
  if (!targetProof) throw new Error("fixture did not produce a current Source proof");
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 144,
    documentUri: DOCUMENT_URI,
    documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset,
    targetProof
  };
  const canvasEvaluation = evaluate(canvasCompiled);
  const canvasSnapshot: VscodeReferencePickCanvasSnapshot = {
    source: {
      normalizedSource: canvasSource,
      sourceRevision: CANVAS_REVISION
    },
    compiled: canvasCompiled,
    evaluation: canvasEvaluation
  };
  return {
    currentSource,
    currentCompiled,
    canvasEvaluation,
    canvasSnapshot,
    request
  };
};

const startWithCanvasSnapshot = (
  fixture: ReturnType<typeof dualAuthorityFixture>
) => startVscodeReferencePickCanvasSession({
  request: fixture.request,
  authoritativeDocumentUri: DOCUMENT_URI,
  authoritativeDocumentVersion: DOCUMENT_VERSION,
  source: {
    normalizedSource: fixture.currentSource,
    sourceRevision: HOST_REVISION
  },
  compiled: fixture.currentCompiled,
  evaluation: fixture.canvasEvaluation,
  evaluationIsCurrent: false,
  candidateSnapshot: fixture.canvasSnapshot
});

describe("VS Code Canvas reference pick session bridge", () => {
  it("uses coherent Canvas candidates for zero-width numeric targets while keeping the current Source target", () => {
    const declarationSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = "
    ].join("\n");
    const declarationCanvasSource = declarationSource.replace(
      "const X: number = ",
      "const X: number = @Base.length"
    );
    const declarationPosition = declarationSource.length;
    const declaration = startWithCanvasSnapshot(
      dualAuthorityFixture(declarationSource, declarationCanvasSource, declarationPosition)
    );
    expect(declaration.result.status).toBe("started");
    if (declaration.result.status !== "started") return;
    expect(declaration.result.candidateReferences).toContainEqual({ base: "Base" });
    expect(declaration.session?.target.sourceAnchor.sourceRevision).toBe(CANVAS_REVISION);

    const coordinateSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = coordinate(x: 0, y: )"
    ].join("\n");
    const coordinateCanvasSource = coordinateSource.replace("y: )", "y: @Base.length)");
    const coordinatePosition = coordinateSource.indexOf("y: )") + "y: ".length;
    const coordinate = startWithCanvasSnapshot(
      dualAuthorityFixture(coordinateSource, coordinateCanvasSource, coordinatePosition)
    );
    expect(coordinate.result.status).toBe("started");
    if (coordinate.result.status !== "started") return;
    expect(coordinate.result.candidateReferences).toContainEqual({ base: "Base" });
    expect(coordinate.session?.target.sourceAnchor.sourceRevision).toBe(CANVAS_REVISION);
  });

  it("preserves strict and broad Module candidate semantics from the pinned Canvas snapshot", () => {
    const currentSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line, broad: path) {",
      "}",
      "instance X = M(straight: @Straight, broad: )"
    ].join("\n");
    const canvasSource = currentSource.replace("broad: )", "broad: @Curve)");
    const position = currentSource.indexOf("broad: )") + "broad: ".length;
    const started = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toEqual(
      expect.arrayContaining([{ base: "Straight" }, { base: "Curve" }])
    );
    expect(started.result.candidateReferences).not.toContainEqual({ base: "A" });
  });

  it("fails closed when the Canvas snapshot cannot be reconciled or is stale", () => {
    const currentSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = "
    ].join("\n");
    const currentPosition = currentSource.length;
    const missingTargetCanvasSource = currentSource.slice(0, currentSource.lastIndexOf("\n"));
    const unmappable = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, missingTargetCanvasSource, currentPosition)
    );
    expect(unmappable.session).toBeNull();
    expect(unmappable.result.status).toBe("stale");

    const candidateSource = currentSource.replace(
      "const X: number = ",
      "const X: number = @Base.length"
    );
    const staleFixture = dualAuthorityFixture(currentSource, candidateSource, currentPosition);
    const staleSnapshot = {
      ...staleFixture.canvasSnapshot,
      source: {
        ...staleFixture.canvasSnapshot.source,
        sourceRevision: CANVAS_REVISION + 1
      }
    };
    const stale = startVscodeReferencePickCanvasSession({
      request: staleFixture.request,
      authoritativeDocumentUri: DOCUMENT_URI,
      authoritativeDocumentVersion: DOCUMENT_VERSION,
      source: {
        normalizedSource: staleFixture.currentSource,
        sourceRevision: HOST_REVISION
      },
      compiled: staleFixture.currentCompiled,
      evaluation: staleFixture.canvasEvaluation,
      evaluationIsCurrent: false,
      candidateSnapshot: staleSnapshot
    });
    expect(stale.session).toBeNull();
    expect(stale.result.status).toBe("stale");
  });

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
    if (confirmed.result?.resultKind !== "geometry") throw new Error("geometry result missing");
    expect(confirmed.result.references).toEqual([{ base: "A" }, { base: "C" }]);
  });

  it("moves from numeric geometry selection to a property chooser and explicit confirmation", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "20");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");
    expect(started.result.numericCandidates).toContainEqual({
      reference: { base: "Base" },
      properties: expect.arrayContaining([
        "length",
        "startAngleDeg",
        "endAngleDeg",
        "startTangentAngleDeg",
        "endTangentAngleDeg",
        "startPoint.x",
        "startPoint.y",
        "endPoint.x",
        "endPoint.y"
      ])
    });

    const candidate = started.session.candidates[0];
    const option = candidate?.options.find((entry) => entry.kind === "numericProperty");
    if (!candidate || !option || option.kind !== "numericProperty") throw new Error("numeric candidate missing");
    let session = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(candidate, option)
    );
    expect(session.draft.numericProperty?.stage).toBe("propertySelection");
    expect(confirmVscodeReferencePickCanvasSession(session).result).toBeNull();

    session = selectVscodeReferencePickCanvasNumericProperty(session, "length");
    const confirmed = confirmVscodeReferencePickCanvasSession(session);
    expect(confirmed.result).toMatchObject({
      status: "confirmed",
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "length"
    });
  });

  it("keeps every numeric geometry candidate and exposes its actual computed properties", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "point P = offset(from: @A, dx: @Arc.radius, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "@Arc.radius");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");
    const base = started.result.numericCandidates?.find((candidate) => candidate.reference.base === "Base");
    const arc = started.result.numericCandidates?.find((candidate) => candidate.reference.base === "Arc");
    expect(base?.properties).toContain("length");
    expect(base?.properties).not.toContain("radius");
    expect(arc?.properties).toContain("radius");
  });

  it("rejects numeric confirmations and allowlists with unsupported geometry-property pairs", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "20");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");

    expect(referencePickCanvasResultMatchesSession(started.session, {
      ...started.result,
      numericCandidates: [{ reference: { base: "Base" }, properties: ["startHandleLength"] }]
    })).toBe(false);
    expect(referencePickCanvasResultMatchesSession(started.session, {
      type: "referencePickResult",
      requestId: setupResult.request.requestId,
      documentUri: setupResult.request.documentUri,
      documentVersion: setupResult.request.documentVersion,
      targetProof: setupResult.request.targetProof,
      status: "confirmed",
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "startHandleLength"
    })).toBe(false);
  });

  it("retargets an existing numeric property through the property chooser", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "point P = offset(from: @A, dx: @Arc.radius, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "@Arc.radius");
    const started = startSession({ source, ...setupResult });
    if (!started.session) throw new Error("session did not start");
    const base = started.session.candidates.find((candidate) => candidate.options.some((option) => option.reference.base === "Base"));
    const option = base?.options.find((entry) => entry.kind === "numericProperty");
    if (!base || !option || option.kind !== "numericProperty") throw new Error("numeric candidate missing");
    let selected = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(base, option)
    );
    expect(selected.draft.numericProperty?.stage).toBe("propertySelection");
    expect(selected.draft.numericProperty?.draft).toBeNull();
    selected = selectVscodeReferencePickCanvasNumericProperty(selected, "length");
    expect(confirmVscodeReferencePickCanvasSession(selected).result).toMatchObject({
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "length"
    });
  });
});
