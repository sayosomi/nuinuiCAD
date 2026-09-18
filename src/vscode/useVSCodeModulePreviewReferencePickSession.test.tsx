import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { DslReferencePickTarget } from "@nuinuicad/nui-language";
import type { EvaluationResult } from "../types/geometry";
import type { ReferencePickCandidate } from "../model/referencePickCandidates";
import { referenceAnchor } from "../model/pointAnchors";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewReferencePickResult,
  VscodeModulePreviewReferencePickStartRequest,
  VscodeWebviewApi
} from "./protocol";
import { referencePickCandidates } from "../model/referencePickCandidates";
import {
  useVSCodeModulePreviewReferencePickSession,
  type VscodeModulePreviewReferencePickCurrentContext
} from "./useVSCodeModulePreviewReferencePickSession";

vi.mock("../model/referencePickCandidates", async () => {
  const actual = await vi.importActual<typeof import("../model/referencePickCandidates")>("../model/referencePickCandidates");
  return { ...actual, referencePickCandidates: vi.fn() };
});

const REQUEST_BASE = {
  sessionId: "module-preview-session:1",
  documentUri: "file:///preview.nui",
  documentVersion: 3,
  normalizedSource: "nui 1\nmodule Target(anchor: point) {}",
  sourceRevision: 11,
  sessionRevision: 4,
  targetDefinitionStatementIndex: 5,
  targetName: "Target",
  definitionStatementIndex: 5,
  definitionName: "Target",
  blockKind: "target" as const,
  parameterIndex: 0,
  parameterName: "anchor",
  expectedGeometryInterface: "point" as const,
  role: "geometry" as const,
  multiplicity: "single" as const
};

const requestFor = (requestId: number): VscodeModulePreviewReferencePickStartRequest => ({
  type: "modulePreviewReferencePickStartRequest",
  requestId,
  ...REQUEST_BASE
});

const target: DslReferencePickTarget = {
  sourceAnchor: {
    sourceRevision: REQUEST_BASE.sourceRevision,
    statementId: "module:target",
    statementIndex: 5,
    sourceOrderIndex: 5,
    scopeId: "root",
    statementRange: { from: 20, to: 50, startLine: 5, endLine: 5 }
  },
  expectedGeometryInterface: "point",
  role: "geometry",
  multiplicity: "single",
  range: { from: 20, to: 50 }
};

const candidate: ReferencePickCandidate = {
  elementId: "Top",
  actualGeometryInterface: "point",
  options: [{
    kind: "point",
    label: "Top",
    anchor: referenceAnchor("Top"),
    point: { kind: "point", elementId: "Top", name: "Top", x: 0, y: 0 },
    reference: { base: "Top" }
  }]
};

const context: VscodeModulePreviewReferencePickCurrentContext = {
  source: { normalizedSource: "nui 1\nmodule Target(anchor: point) {}", sourceRevision: REQUEST_BASE.sourceRevision },
  compiled: {} as CompiledDslDocument,
  evaluation: { computedGeometry: new Map(), errors: [], warnings: [] } as EvaluationResult,
  evaluationIsCurrent: true,
  target
};

const createApi = () => ({ postMessage: vi.fn() }) satisfies VscodeWebviewApi;

const previewResultsFor = (api: ReturnType<typeof createApi>): VscodeModulePreviewReferencePickResult[] =>
  api.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message): message is VscodeModulePreviewReferencePickResult =>
      message?.type === "modulePreviewReferencePickResult"
    );

const dispatch = (message: ExtensionToVscodeMessage): void => {
  act(() => window.dispatchEvent(new MessageEvent("message", { data: message })));
};

describe("useVSCodeModulePreviewReferencePickSession", () => {
  it("starts through shared candidates, confirms one allowlisted reference, and cancels without Source output", () => {
    vi.mocked(referencePickCandidates).mockReturnValue([candidate]);
    const api = createApi();
    const hook = renderHook(() => useVSCodeModulePreviewReferencePickSession({
      api,
      currentContextFor: () => context
    }));

    dispatch(requestFor(1));

    expect(referencePickCandidates).toHaveBeenCalledWith({
      compiled: context.compiled,
      evaluation: context.evaluation,
      target: context.target
    });
    expect(previewResultsFor(api)).toEqual([expect.objectContaining({
      requestId: 1,
      status: "started",
      candidateReferences: [{ base: "Top" }]
    })]);
    expect(hook.result.current.session).not.toBeNull();

    act(() => hook.result.current.confirm({ base: "Top" }));
    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 1, status: "started" }),
      expect.objectContaining({
        requestId: 1,
        status: "confirmed",
        resultKind: "geometry",
        references: [{ base: "Top" }]
      })
    ]);
    expect(hook.result.current.session).toBeNull();
    expect(api.postMessage.mock.calls.some(([message]) => message?.type === "referencePickResult")).toBe(false);

    dispatch(requestFor(2));
    dispatch({
      type: "modulePreviewReferencePickCancelRequest",
      requestId: 2,
      sessionId: REQUEST_BASE.sessionId,
      documentUri: REQUEST_BASE.documentUri,
      documentVersion: REQUEST_BASE.documentVersion
    });
    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 1, status: "started" }),
      expect.objectContaining({ requestId: 1, status: "confirmed" }),
      expect.objectContaining({ requestId: 2, status: "started" }),
      expect.objectContaining({ requestId: 2, status: "canceled" })
    ]);
    expect(hook.result.current.session).toBeNull();
    hook.unmount();
  });

  it("fails a started transaction closed when the exact Preview context becomes stale", () => {
    vi.mocked(referencePickCandidates).mockReturnValue([candidate]);
    const api = createApi();
    let currentContext: VscodeModulePreviewReferencePickCurrentContext | null = context;
    const hook = renderHook(() => useVSCodeModulePreviewReferencePickSession({
      api,
      currentContextFor: () => currentContext
    }));

    dispatch(requestFor(7));
    expect(hook.result.current.session).not.toBeNull();

    act(() => {
      currentContext = null;
      hook.rerender();
    });

    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 7, status: "started" }),
      expect.objectContaining({ requestId: 7, status: "stale" })
    ]);
    expect(hook.result.current.session).toBeNull();
    hook.unmount();
  });

  it("retains an exact start request while Preview evaluation catches up, then starts it", () => {
    vi.mocked(referencePickCandidates).mockReturnValue([candidate]);
    const api = createApi();
    let currentContext: VscodeModulePreviewReferencePickCurrentContext | { kind: "pending" } = { kind: "pending" };
    const hook = renderHook(() => useVSCodeModulePreviewReferencePickSession({
      api,
      currentContextFor: () => currentContext
    }));

    dispatch(requestFor(8));
    expect(previewResultsFor(api)).toEqual([]);
    expect(hook.result.current.session).toBeNull();

    act(() => {
      currentContext = context;
      hook.rerender();
    });

    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 8, status: "started" })
    ]);
    expect(hook.result.current.session).not.toBeNull();
    hook.unmount();
  });

  it("cancels a prior pending request when a new exact start replaces it", () => {
    const api = createApi();
    let currentContext: VscodeModulePreviewReferencePickCurrentContext | { kind: "pending" } = { kind: "pending" };
    const hook = renderHook(() => useVSCodeModulePreviewReferencePickSession({
      api,
      currentContextFor: () => currentContext
    }));

    dispatch(requestFor(10));
    dispatch(requestFor(11));

    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 10, status: "canceled" })
    ]);
    act(() => {
      currentContext = context;
      hook.rerender();
    });
    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 10, status: "canceled" }),
      expect.objectContaining({ requestId: 11, status: "started" })
    ]);
    hook.unmount();
  });

  it("fails a request closed when the Preview has no coherent candidate context", () => {
    const api = createApi();
    const hook = renderHook(() => useVSCodeModulePreviewReferencePickSession({
      api,
      currentContextFor: () => ({ kind: "unavailable" })
    }));

    dispatch(requestFor(9));

    expect(previewResultsFor(api)).toEqual([
      expect.objectContaining({ requestId: 9, status: "stale" })
    ]);
    expect(hook.result.current.session).toBeNull();
    hook.unmount();
  });
});
