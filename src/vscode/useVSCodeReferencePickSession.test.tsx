import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { parseDslSnapshot } from "../dsl/dslParser";
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

describe("useVSCodeReferencePickSession readiness lifecycle", () => {
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

    expect(resultMessages(activeApi)).toHaveLength(1);
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
      targetProof: { ...fixture.request.targetProof, oldText: "@Other" }
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
