import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationResult } from "../types/geometry";
import type {
  ExtensionToVscodeMessage,
  VscodeToExtensionMessage,
  VscodeWebviewApi
} from "./protocol";
import {
  referencePickTargetProofFor,
  type VscodeReferencePickStartRequest
} from "./referencePickProtocol";
import type { VscodeReferencePickCanvasSnapshot } from "./referencePickCanvasSession";
import {
  useVSCodeReferencePickSession,
  type VscodeReferencePickCurrentContext
} from "./useVSCodeReferencePickSession";
import { projectIncompleteReferencePickCandidate } from "./referencePickCandidateProjection";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";

const DOCUMENT_URI = "file:///pick.nui";
const DOCUMENT_VERSION = 7;
const HOST_REVISION = 93;
const CANVAS_REVISION = 1093;

const sourceFor = (endX = 10): string => [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  `point B = coordinate(x: ${endX}, y: 0)`,
  "line Straight = segment(start: @A, end: @B)",
  "module M(straight: line) {",
  "}",
  "instance X = M(straight: @Straight)"
].join("\n");

const compile = (
  source: string,
  sourceRevision: number,
  statementIdPrefix: string
): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${statementIdPrefix}:${index}`]))
  });
};

const evaluationFor = (compiled: CompiledDslDocument): EvaluationResult => {
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
};

const fixtureFor = (source = sourceFor()) => {
  const hostCompiled = compile(source, HOST_REVISION, "host-pick");
  const normalizedSourceOffset = source.indexOf("@Straight") + 2;
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: HOST_REVISION },
    position: normalizedSourceOffset,
    semantic: { sourceRevision: HOST_REVISION, sourceText: source, compiled: hostCompiled }
  });
  if (!target) throw new Error("fixture did not produce a reference-pick target");
  const targetProof = referencePickTargetProofFor(source, target);
  if (!targetProof) throw new Error("fixture did not produce a target proof");
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 44,
    documentUri: DOCUMENT_URI,
    documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset,
    targetProof
  };
  const compiled = compile(source, CANVAS_REVISION, "canvas-pick");
  return {
    source,
    compiled,
    evaluation: evaluationFor(compiled),
    request
  };
};

const contextFor = (
  fixture: ReturnType<typeof fixtureFor>,
  evaluationIsCurrent: boolean
): VscodeReferencePickCurrentContext => ({
  source: {
    normalizedSource: fixture.source,
    sourceRevision: CANVAS_REVISION
  },
  compiled: fixture.compiled,
  evaluation: fixture.evaluation,
  evaluationIsCurrent
});

const pinnedContextFor = (
  fixture: ReturnType<typeof fixtureFor>
): VscodeReferencePickCurrentContext => {
  const canvasSnapshot: VscodeReferencePickCanvasSnapshot = {
    source: {
      normalizedSource: fixture.source,
      sourceRevision: CANVAS_REVISION
    },
    compiled: fixture.compiled,
    evaluation: fixture.evaluation
  };
  return {
    ...contextFor(fixture, false),
    canvasSnapshot
  };
};

const authorityFor = (
  fixture: ReturnType<typeof fixtureFor>,
  documentVersion = DOCUMENT_VERSION
) => ({
  documentVersion,
  normalizedSource: fixture.source
});

const createApi = () => ({ postMessage: vi.fn() }) satisfies VscodeWebviewApi;

const dispatch = (data: ExtensionToVscodeMessage): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent<ExtensionToVscodeMessage>("message", { data }));
  });
};

const resultMessages = (api: ReturnType<typeof createApi>) => api.postMessage.mock.calls
  .map(([message]) => message)
  .filter((message): message is Extract<VscodeToExtensionMessage, { type: "referencePickResult" }> =>
    message?.type === "referencePickResult"
  );

const incompleteFixtureFor = (empty: boolean, partialList = false) => {
  const header = partialList ? "move [@A](from: (0, 0), to: (1, 0))" : "reverse @A()";
  const valid = `nui 1\nline A = segment(start: (0, 0), end: (10, 0))\n${header}`;
  const source = valid.replace(header, partialList ? header.replace("[@A]", "[@A, @]") : "reverse ()");
  const baseline = compileFreshCanonicalText(valid);
  const compiled = compileCanonicalText(baseline, source).currentCompiled;
  const snapshotCompiled = baseline.doc;
  const snapshotEvaluation = evaluationFor(snapshotCompiled);
  const operation = partialList ? "move " : "reverse ";
  const normalizedSourceOffset = source.indexOf(operation) + operation.length;
  const currentSource = { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision };
  const target = queryDslReferencePickTarget({ source: currentSource, position: normalizedSourceOffset,
    semantic: { sourceRevision: currentSource.sourceRevision, sourceText: source, compiled } });
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest", requestId: 44, documentUri: DOCUMENT_URI, documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset, targetProof: referencePickTargetProofFor(source, target!)!
  };
  const context: VscodeReferencePickCurrentContext = {
    source: currentSource, compiled, evaluation: snapshotEvaluation, evaluationIsCurrent: false,
    canvasSnapshot: { source: { normalizedSource: valid, sourceRevision: snapshotCompiled.spans.sourceMap.sourceRevision }, compiled: snapshotCompiled,
      evaluation: empty ? { ...snapshotEvaluation, computedGeometry: new Map() } : snapshotEvaluation }
  };
  const projected = projectIncompleteReferencePickCandidate({ ...context, request })!;
  expect(projected).not.toBeNull();
  const snapshot = {
    source: { normalizedSource: projected.spans.sourceMap.source, sourceRevision: projected.spans.sourceMap.sourceRevision },
    compiled: projected, evaluation: evaluationFor(projected)
  };
  return { context, request, snapshot };
};

describe("useVSCodeReferencePickSession readiness lifecycle", () => {
  it.each(["empty", "usable"].flatMap(candidates => [false, true].map(partialList => ({ candidates, partialList }))))(
    "uses projection only for $candidates pinned candidates (partial list=$partialList)", async ({ candidates, partialList }) => {
    const { context, request, snapshot } = incompleteFixtureFor(candidates === "empty", partialList);
    const prepareCandidateSnapshot = vi.fn(async () => snapshot);
    const api = createApi();
    const hook = renderHook(() => useVSCodeReferencePickSession({ api,
      currentContextFor: () => context,
      currentReferencePickAuthorityFor: () => ({ documentVersion: DOCUMENT_VERSION, normalizedSource: context.source.normalizedSource }),
      prepareCandidateSnapshot
    }));
    await act(async () => dispatch(request));
    expect(prepareCandidateSnapshot).toHaveBeenCalledTimes(candidates === "empty" ? 1 : 0);
    expect(resultMessages(api)).toMatchObject([{ status: "started", candidateReferences: expect.arrayContaining([{ base: "A" }]) }]);
    expect(hook.result.current.session?.candidates).toHaveLength(1);
    expect(hook.result.current.session?.draft.draftReferences).toEqual(partialList ? [{ base: "A" }] : []);
    expect(hook.result.current.candidateSnapshot?.compiled).toBe(candidates === "empty" ? snapshot.compiled : undefined);
  });

  it.each(["unavailable", "empty"])("offers empty Browse with an actionable status after %s projection", async outcome => {
    const { context, request, snapshot } = incompleteFixtureFor(true);
    const prepareCandidateSnapshot = vi.fn(async () => outcome === "unavailable" ? null : {
      ...snapshot, evaluation: { ...snapshot.evaluation, computedGeometry: new Map() }
    });
    const api = createApi();
    const hook = renderHook(() => useVSCodeReferencePickSession({ api,
      currentContextFor: () => context,
      currentReferencePickAuthorityFor: () => ({ documentVersion: DOCUMENT_VERSION, normalizedSource: context.source.normalizedSource }),
      prepareCandidateSnapshot
    }));
    await act(async () => dispatch(request));
    expect(prepareCandidateSnapshot).toHaveBeenCalledTimes(1);
    expect(resultMessages(api)).toMatchObject([{ status: "started", sessionMode: "browse" }]);
    expect(hook.result.current.session?.candidates).toEqual([]);
  });

  it("preserves legitimate empty current sessions without projecting completed Source", () => {
    const fixture = fixtureFor();
    const api = createApi();
    const prepareCandidateSnapshot = vi.fn(async () => null);
    renderHook(() => useVSCodeReferencePickSession({ api,
      currentContextFor: () => ({ ...contextFor(fixture, true), evaluation: { ...fixture.evaluation, computedGeometry: new Map() } }),
      currentReferencePickAuthorityFor: () => authorityFor(fixture), prepareCandidateSnapshot
    }));
    dispatch(fixture.request);
    expect(resultMessages(api)).toMatchObject([{ status: "started", sessionMode: "target-bound", candidateReferences: [] }]);
    expect(prepareCandidateSnapshot).not.toHaveBeenCalled();
  });

  it("keeps an exact request pending while the current Source context hydrates", () => {
    const fixture = fixtureFor();
    const api = createApi();
    let hydrated = false;
    const hook = renderHook(() => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => hydrated ? contextFor(fixture, true) : null,
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }));

    dispatch(fixture.request);
    expect(resultMessages(api)).toEqual([]);

    hydrated = true;
    act(() => hook.rerender());
    expect(resultMessages(api)).toMatchObject([{ status: "started" }]);
    expect(hook.result.current.session).not.toBeNull();
  });

  it("retains a cold-open request without hook hydration until matching evaluation is current and starts it once", () => {
    const fixture = fixtureFor();
    const api = createApi();
    const hook = renderHook(({ evaluationIsCurrent }) => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => contextFor(fixture, evaluationIsCurrent),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }), { initialProps: { evaluationIsCurrent: false } });

    dispatch(fixture.request);

    expect(resultMessages(api)).toEqual([]);
    expect(hook.result.current.session).toBeNull();
    expect(fixture.source).toContain("Straight = segment");

    act(() => hook.rerender({ evaluationIsCurrent: true }));

    expect(resultMessages(api)).toHaveLength(1);
    expect(resultMessages(api)[0]).toMatchObject({
      requestId: fixture.request.requestId,
      status: "started"
    });
    expect(hook.result.current.session).not.toBeNull();

    act(() => hook.rerender({ evaluationIsCurrent: true }));
    expect(resultMessages(api)).toHaveLength(1);
  });

  it("keeps the warm current path immediate and starts it once", () => {
    const fixture = fixtureFor();
    const api = createApi();
    const hook = renderHook(({ evaluationIsCurrent }) => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => contextFor(fixture, evaluationIsCurrent),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }), { initialProps: { evaluationIsCurrent: true } });

    dispatch(fixture.request);

    expect(resultMessages(api)).toHaveLength(1);
    expect(resultMessages(api)[0]?.status).toBe("started");
    expect(hook.result.current.session).not.toBeNull();
  });

  it("starts immediately from a coherent pinned Canvas snapshot while Source remains exact-current", () => {
    const fixture = fixtureFor();
    const api = createApi();
    const hook = renderHook(() => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => pinnedContextFor(fixture),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }));

    dispatch(fixture.request);

    expect(resultMessages(api)).toMatchObject([{ status: "started" }]);
    expect(hook.result.current.session).not.toBeNull();
  });

  it("does not start a pending request after authoritative Source replacement", () => {
    const fixture = fixtureFor();
    const replacement = fixtureFor(sourceFor(20));
    const api = createApi();
    const hook = renderHook(({ fixture: currentFixture, evaluationIsCurrent, documentVersion }) => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => contextFor(currentFixture, evaluationIsCurrent),
      currentReferencePickAuthorityFor: () => authorityFor(currentFixture, documentVersion)
    }), { initialProps: { fixture, evaluationIsCurrent: false, documentVersion: DOCUMENT_VERSION } });

    dispatch(fixture.request);
    expect(resultMessages(api)).toEqual([]);

    act(() => hook.rerender({
      fixture: replacement,
      evaluationIsCurrent: true,
      documentVersion: DOCUMENT_VERSION + 1
    }));

    expect(resultMessages(api)).toEqual([]);
    expect(hook.result.current.session).toBeNull();
    hook.unmount();

    const activeFixture = fixtureFor();
    const activeApi = createApi();
    const activeHook = renderHook(({ documentVersion }) => useVSCodeReferencePickSession({
      api: activeApi,
      currentContextFor: () => contextFor(activeFixture, true),
      currentReferencePickAuthorityFor: () => authorityFor(activeFixture, documentVersion)
    }), { initialProps: { documentVersion: DOCUMENT_VERSION } });
    dispatch(activeFixture.request);
    expect(resultMessages(activeApi)).toMatchObject([{ status: "started" }]);

    act(() => activeHook.rerender({ documentVersion: DOCUMENT_VERSION + 1 }));

    expect(resultMessages(activeApi)).toMatchObject([{ status: "started" }, { status: "stale" }]);
    expect(activeHook.result.current.session).toBeNull();
    activeHook.unmount();
  });

  it("supersedes a pending request with the latest exact request", () => {
    const fixture = fixtureFor();
    const api = createApi();
    const hook = renderHook(({ evaluationIsCurrent }) => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => contextFor(fixture, evaluationIsCurrent),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }), { initialProps: { evaluationIsCurrent: false } });
    const replacementRequest = { ...fixture.request, requestId: fixture.request.requestId + 1 };

    dispatch(fixture.request);
    dispatch(replacementRequest);
    act(() => hook.rerender({ evaluationIsCurrent: true }));

    expect(resultMessages(api)).toHaveLength(1);
    expect(resultMessages(api)[0]).toMatchObject({ requestId: replacementRequest.requestId, status: "started" });
  });

  it("fails closed for source mismatch and invalid target proof", () => {
    const fixture = fixtureFor();
    const mismatched = fixtureFor(sourceFor(20));
    const api = createApi();
    const mismatchedHook = renderHook(() => useVSCodeReferencePickSession({
      api,
      currentContextFor: () => contextFor(mismatched, true),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }));

    dispatch(fixture.request);
    expect(resultMessages(api)).toMatchObject([{ status: "stale", requestId: fixture.request.requestId }]);
    mismatchedHook.unmount();

    const invalidProofRequest = {
      ...fixture.request,
      requestId: fixture.request.requestId + 1,
      targetProof: { ...fixture.request.targetProof!, oldText: "@Other" }
    };
    const validContextApi = createApi();
    renderHook(() => useVSCodeReferencePickSession({
      api: validContextApi,
      currentContextFor: () => contextFor(fixture, true),
      currentReferencePickAuthorityFor: () => authorityFor(fixture)
    }));
    dispatch(invalidProofRequest);
    expect(resultMessages(validContextApi)).toMatchObject([{ status: "stale", requestId: invalidProofRequest.requestId }]);
  });

  it("cancels pending and active requests without mutating Source", () => {
    const pendingFixture = fixtureFor();
    const pendingApi = createApi();
    const pendingHook = renderHook(({ evaluationIsCurrent }) => useVSCodeReferencePickSession({
      api: pendingApi,
      currentContextFor: () => contextFor(pendingFixture, evaluationIsCurrent),
      currentReferencePickAuthorityFor: () => authorityFor(pendingFixture)
    }), { initialProps: { evaluationIsCurrent: false } });
    const pendingSource = pendingFixture.source;
    dispatch(pendingFixture.request);
    dispatch({
      type: "referencePickCancelRequest",
      requestId: pendingFixture.request.requestId,
      documentUri: pendingFixture.request.documentUri,
      documentVersion: pendingFixture.request.documentVersion
    });
    act(() => pendingHook.rerender({ evaluationIsCurrent: true }));
    expect(resultMessages(pendingApi)).toEqual([]);
    expect(pendingHook.result.current.session).toBeNull();
    expect(pendingFixture.source).toBe(pendingSource);
    pendingHook.unmount();

    const activeFixture = fixtureFor();
    const activeApi = createApi();
    const activeHook = renderHook(() => useVSCodeReferencePickSession({
      api: activeApi,
      currentContextFor: () => contextFor(activeFixture, true),
      currentReferencePickAuthorityFor: () => authorityFor(activeFixture)
    }));
    const activeSource = activeFixture.source;
    dispatch(activeFixture.request);
    const replacementRequest = { ...activeFixture.request, requestId: activeFixture.request.requestId + 1 };
    dispatch(replacementRequest);
    dispatch({
      type: "referencePickCancelRequest",
      requestId: replacementRequest.requestId,
      documentUri: replacementRequest.documentUri,
      documentVersion: replacementRequest.documentVersion
    });
    expect(resultMessages(activeApi).map((message) => message.status)).toEqual([
      "started",
      "canceled",
      "started",
      "canceled"
    ]);
    expect(activeHook.result.current.session).toBeNull();
    expect(activeFixture.source).toBe(activeSource);
  });
});
