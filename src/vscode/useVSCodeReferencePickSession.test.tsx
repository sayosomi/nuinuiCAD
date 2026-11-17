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

const layerVisibilityGraphFixture = async ({ importedMembership = "implicit" }: { importedMembership?: "implicit" | "explicit" } = {}) => {
  const [workspace, language, { buildEvaluationOptions }, { projectCanvasLayerPresentation, canvasLayerSourceDocumentFor }, { projectReferencePickGraphSnapshot }] = await Promise.all([
    import("@nuinuicad/nui-language/workspace"),
    import("@nuinuicad/nui-language"),
    import("../geometry/productionEvaluationContext"),
    import("../model/canvasLayerPresentation"),
    import("./referencePickGraphSnapshot")
  ]);
  const documentUri = "file:///workspace/patterns/pick_layer_visibility.nui";
  const libraryUri = "file:///workspace/modules/pick_module.nui";
  const normalizedSource = [
    "nui 1",
    'import "../modules/pick_module.nui" as probe',
    "layer seam_layer",
    "point root_default = coordinate(x: 0, y: 0)",
    "point root_marker in @seam_layer = coordinate(x: 20, y: 0)",
    "point target = offset(from: @root_default, dx: 1, dy: 0)",
    "instance N = probe::Probe(x: 30)"
  ].join("\n");
  const dependencySource = importedMembership === "explicit"
    ? "nui 1\nexport module Probe(x: number) {\nlayer module_layer\npoint marker in @module_layer = coordinate(x: @x, y: 0)\n}\n"
    : "nui 1\nexport module Probe(x: number) {\npoint marker = coordinate(x: @x, y: 0)\n}\n";
  const source = { normalizedSource, sourceRevision: 12 };
  const graph = await workspace.buildMultiDocumentImportGraph({
    root: { ...source, kind: "root-current", documentId: workspace.documentIdFromHost(documentUri) },
    loader: { async loadSavedDependency() { return { status: "loaded" as const, snapshot: {
      kind: "dependency-saved" as const,
      documentId: workspace.documentIdFromHost(libraryUri),
      savedSourceFingerprint: workspace.savedSourceFingerprintFromHost(dependencySource),
      normalizedSource: dependencySource
    } }; } },
    declarationContributors: [workspace.moduleDeclarationContributor]
  });
  const moduleContext = language.createModuleRuntimeContext(graph, workspace.analyzeMultiDocumentModuleSemantics(graph));
  const compiled = compileDslDocument(normalizedSource, {
    preparsed: graph.nodes.get(graph.rootDocumentId)!.artifact.parsed,
    sourceRevision: source.sourceRevision,
    assignedStatementIds: graph.nodes.get(graph.rootDocumentId)!.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: moduleContext
  });
  if (!compiled.document || !compiled.statementMap) throw new Error("layer visibility fixture did not compile");
  const evaluation = evaluateElements(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: compiled as Parameters<typeof buildEvaluationOptions>[0]["compiledDocument"],
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  }));
  const normalizedSourceOffset = normalizedSource.indexOf("@root_default") + 2;
  const target = queryDslReferencePickTarget({ source, position: normalizedSourceOffset,
    semantic: { sourceRevision: source.sourceRevision, sourceText: normalizedSource, compiled } });
  if (!target) throw new Error("layer visibility fixture has no target");
  const targetProof = referencePickTargetProofFor(normalizedSource, target);
  if (!targetProof) throw new Error("layer visibility fixture has no target proof");
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest", requestId: 88, documentUri, documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset, targetProof
  };
  const rootRuntimeDocument = moduleContext.documentFor(moduleContext.rootDocumentId);
  if (!rootRuntimeDocument) throw new Error("layer visibility fixture has no graph root");
  const sourceDocuments = [
    canvasLayerSourceDocumentFor({ documentId: String(rootRuntimeDocument.documentId),
      sourceLexicalNamespace: rootRuntimeDocument.sourceLexicalNamespace,
      statements: rootRuntimeDocument.statements, document: compiled.document }),
    ...[...moduleContext.documentsById.values()]
      .filter(sourceDocument => sourceDocument.documentId !== moduleContext.rootDocumentId)
      .map(sourceDocument => canvasLayerSourceDocumentFor({ documentId: String(sourceDocument.documentId),
        sourceLexicalNamespace: sourceDocument.sourceLexicalNamespace, statements: sourceDocument.statements }))
  ];
  const presentationFor = (hiddenLayerIds: ReadonlySet<string>) => projectCanvasLayerPresentation({
    rootDocumentId: String(moduleContext.rootDocumentId), compiledDocument: compiled, sourceDocuments,
    moduleMaterialization: compiled.moduleMaterialization, elements: compiled.document!.elements, evaluation, hiddenLayerIds
  });
  const semantic = { sourceDocumentUri: documentUri, rootDocumentId: String(moduleContext.rootDocumentId),
    documentVersion: DOCUMENT_VERSION, graphRevision: 41, sourceRevision: source.sourceRevision,
    sourceText: normalizedSource, compiled };
  const graphSnapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation });
  if (!graphSnapshot) throw new Error("layer visibility fixture did not produce a host snapshot");
  const context: VscodeReferencePickCurrentContext = {
    source, compiled, evaluation, evaluationIsCurrent: true,
    graph: { rootDocumentId: String(moduleContext.rootDocumentId), graphRevision: 41, sourceRevision: source.sourceRevision, ready: true }
  };
  const defaultLayerId = "source-layer:builtin:default";
  const seamLayerId = presentationFor(new Set()).layers.find(layer => layer.name === "seam_layer")?.id;
  if (!seamLayerId) throw new Error("layer visibility fixture has no seam Layer");
  const moduleLayerId = presentationFor(new Set()).layers.find(layer => layer.name === "module_layer")?.id;
  const elementIdFor = (name: string) => compiled.document!.elements.find(element => element.name === name)?.id;
  return { request, graphSnapshot, context, compiled, defaultLayerId, seamLayerId, moduleLayerId, elementIdFor, presentationFor };
};

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

it.each(["C", "F"] as const)("#1623 %s consumes a graph Pick snapshot despite a fatal standalone compiler", async relation => {
  const { importedPickFixture } = await import("./importedReferencePickFixture");
  const { projectReferencePickGraphSnapshot } = await import("./referencePickGraphSnapshot");
  const f = await importedPickFixture(relation);
  const semantic = { sourceDocumentUri: f.request.documentUri, rootDocumentId: f.request.documentUri, documentVersion: 7, graphRevision: 41,
    sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
  for (const mode of ["target-bound", "browse"] as const) {
    const api = createApi();
    const request = { ...f.request, mode, ...(mode === "browse" ? { targetProof: null } : {}) };
    const graphSnapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation })!;
    const message = JSON.parse(JSON.stringify({ ...request, graphSnapshot }));
    let context: VscodeReferencePickCurrentContext = { source: f.source, compiled: f.standalone, evaluation: f.evaluation,
      evaluationIsCurrent: false, graph: { rootDocumentId: f.request.documentUri, graphRevision: 41, sourceRevision: 12, ready: false } };
    const prepare = vi.fn();
    const hook = renderHook(() => useVSCodeReferencePickSession({ api, currentContextFor: () => context,
      currentReferencePickAuthorityFor: version => version === 7 ? { documentVersion: 7, normalizedSource: f.source.normalizedSource } : null,
      prepareCandidateSnapshot: prepare }));
    dispatch(message);
    expect(resultMessages(api)).toEqual([]);
    context = { ...context, graph: { ...context.graph!, ready: true } };
    hook.rerender();
    expect(resultMessages(api).at(-1)?.status).toBe("started");
    expect(prepare).not.toHaveBeenCalled();
    expect(hook.result.current.session?.candidates.flatMap(c => c.options.map(o => o.reference.base))).toContain("A");
    act(() => hook.result.current.cancel());
    expect(resultMessages(api).at(-1)?.status).toBe("canceled");
    dispatch({ ...message, requestId: 2, graphSnapshot: { ...graphSnapshot, result: { ...graphSnapshot.result, requestId: 2 } } });
    expect(resultMessages(api).at(-1)?.status).toBe("started");
    context = { ...context, graph: { ...context.graph!, graphRevision: 42 } };
    hook.rerender();
    expect(resultMessages(api).at(-1)?.status).toBe("stale");
    expect(hook.result.current.session).toBeNull();
    hook.unmount();
  }
});

it("#1623 rejects graph Pick mismatches and genuine Source edits", async () => {
  const { importedPickFixture } = await import("./importedReferencePickFixture");
  const { projectReferencePickGraphSnapshot } = await import("./referencePickGraphSnapshot");
  const f = await importedPickFixture("C");
  const graphSnapshot = projectReferencePickGraphSnapshot({ request: f.request, evaluation: f.evaluation,
    semantic: { sourceDocumentUri: f.request.documentUri, rootDocumentId: f.request.documentUri, documentVersion: 7, graphRevision: 41,
      sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled } })!;
  for (const variant of ["uri", "revision", "version", "target", "source", "candidate", "evaluation"]) {
    const api = createApi();
    const message = structuredClone({ ...f.request, graphSnapshot });
    if (variant === "uri") message.documentUri = "file:///wrong.nui";
    if (variant === "version") message.documentVersion = 8;
    if (variant === "target") message.targetProof!.range = { from: 0, to: 1 };
    if (variant === "candidate") message.graphSnapshot.result.documentVersion = 8;
    let context: VscodeReferencePickCurrentContext = { source: f.source, compiled: f.standalone, evaluation: f.evaluation,
      evaluationIsCurrent: false, graph: { rootDocumentId: f.request.documentUri, graphRevision: 41, sourceRevision: variant === "revision" ? 13 : 12, ready: variant !== "evaluation", failed: variant === "evaluation" } };
    const hook = renderHook(() => useVSCodeReferencePickSession({ api, currentContextFor: () => context,
      currentReferencePickAuthorityFor: version => version === 7 ? { documentVersion: 7, normalizedSource: f.source.normalizedSource } : null }));
    dispatch(message);
    if (variant === "source") {
      expect(resultMessages(api).at(-1)?.status).toBe("started");
      context = { ...context, source: { ...context.source, normalizedSource: context.source.normalizedSource + "// edit" } };
      hook.rerender();
    }
    expect(resultMessages(api).at(-1)?.status).toBe("stale");
    expect(hook.result.current.session).toBeNull();
    hook.unmount();
  }
});

it("#1631 accepts a Source URI paired with the same canonical Canvas graph root", async () => {
  const { importedPickFixture } = await import("./importedReferencePickFixture");
  const { projectReferencePickGraphSnapshot } = await import("./referencePickGraphSnapshot");
  const f = await importedPickFixture("C");
  const sourcePath = "/synthetic/型紙-ず/pick_ascii.nui";
  const sourceUri = `file://${sourcePath}`;
  const canonicalRoot = `file://${sourcePath.normalize("NFD")}`;
  const request = { ...f.request, documentUri: sourceUri };
  const semantic = { sourceDocumentUri: sourceUri, rootDocumentId: canonicalRoot,
    documentVersion: 7, graphRevision: 41, sourceRevision: 12,
    sourceText: f.source.normalizedSource, compiled: f.compiled };
  const graphSnapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation })!;
  const message = JSON.parse(JSON.stringify({ ...request, graphSnapshot }));
  const api = createApi();
  let context: VscodeReferencePickCurrentContext = { source: f.source, compiled: f.standalone,
    evaluation: f.evaluation, evaluationIsCurrent: false,
    graph: { rootDocumentId: canonicalRoot, graphRevision: 41, sourceRevision: 12, ready: true } };
  const hook = renderHook(() => useVSCodeReferencePickSession({ api,
    currentContextFor: () => context,
    currentReferencePickAuthorityFor: version => version === 7
      ? { documentVersion: 7, normalizedSource: f.source.normalizedSource }
      : null }));

  dispatch(message);
  expect(resultMessages(api).at(-1)?.status).toBe("started");
  expect(hook.result.current.session?.candidates.flatMap(c => c.options.map(o => o.reference.base))).toContain("A");

  context = { ...context, graph: { ...context.graph!, rootDocumentId: "file:///foreign/pick_ascii.nui" } };
  hook.rerender();
  expect(resultMessages(api).at(-1)?.status).toBe("stale");
  expect(hook.result.current.session).toBeNull();
  hook.unmount();
});

it("#1621 filters a host graph Pick snapshot by the live Canvas Layers before exposing candidates", async () => {
  const fixture = await layerVisibilityGraphFixture();
  const hiddenLayerIds = new Set([fixture.defaultLayerId]);
  const canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  const api = createApi();
  const hook = renderHook(() => useVSCodeReferencePickSession({
    api,
    currentContextFor: () => fixture.context,
    currentReferencePickAuthorityFor: version => version === DOCUMENT_VERSION
      ? { documentVersion: DOCUMENT_VERSION, normalizedSource: fixture.context.source.normalizedSource }
      : null,
    canvasLayerPresentation
  }));

  dispatch(structuredClone({ ...fixture.request, graphSnapshot: fixture.graphSnapshot }) as VscodeReferencePickStartRequest);

  const session = hook.result.current.session;
  expect(resultMessages(api).at(-1)?.status).toBe("started");
  expect(session?.candidates.flatMap(candidate => candidate.options.map(option => option.reference.base)))
    .not.toContain("root_default");
  expect(session?.candidates.flatMap(candidate => candidate.options.map(option => option.reference.base)))
    .toContain("root_marker");
  expect(session?.candidates.map(candidate => candidate.elementId)).not.toContain(fixture.elementIdFor("marker"));
  const started = resultMessages(api).at(-1);
  expect(started?.status === "started" ? started.candidateReferences.map(reference => reference.base) : [])
    .toContain("root_default");
  const hostDefaultCandidate = fixture.graphSnapshot.session.candidates.find(candidate => candidate.elementId === fixture.elementIdFor("root_default"));
  const hostDefaultOption = hostDefaultCandidate?.options.find(option => option.kind === "point");
  if (!hostDefaultCandidate || hostDefaultOption?.kind !== "point") throw new Error("host snapshot omitted root_default authority");
  act(() => hook.result.current.select({ candidateElementId: hostDefaultCandidate.elementId, reference: hostDefaultOption.reference }));
  act(() => hook.result.current.copy());
  expect(resultMessages(api).map(message => message.status)).toEqual(["started"]);

  act(() => hook.result.current.browse());
  expect(hook.result.current.session?.mode).toBe("browse");
  expect(hook.result.current.session?.candidates.flatMap(candidate => candidate.options.map(option => option.reference.base)))
    .not.toContain("root_default");
  expect(hook.result.current.session?.candidates.map(candidate => candidate.elementId)).not.toContain(fixture.elementIdFor("marker"));
  hook.unmount();
});

it("#1621 projects explicit root and imported Module memberships independently", async () => {
  const { canvasLayerVisibleElementIds } = await import("../model/canvasLayerPresentation");
  const fixture = await layerVisibilityGraphFixture({ importedMembership: "explicit" });
  if (!fixture.moduleLayerId) throw new Error("explicit imported fixture has no module_layer");
  const rootDefaultId = fixture.elementIdFor("root_default");
  const rootMarkerId = fixture.elementIdFor("root_marker");
  const importedMarkerId = fixture.elementIdFor("marker");
  if (!rootDefaultId || !rootMarkerId || !importedMarkerId) throw new Error("explicit imported fixture omitted a drawable");
  const drawableIds = new Set([rootDefaultId, rootMarkerId, importedMarkerId]);
  for (const [hiddenLayerId, visibleElementIds] of [
    [fixture.defaultLayerId, [rootMarkerId, importedMarkerId]],
    [fixture.seamLayerId, [rootDefaultId, importedMarkerId]],
    [fixture.moduleLayerId, [rootDefaultId, rootMarkerId]]
  ] as const) {
    const visibleIds = canvasLayerVisibleElementIds(drawableIds, fixture.presentationFor(new Set([hiddenLayerId])));
    expect([...visibleIds].filter(id => drawableIds.has(id)).sort()).toEqual([...visibleElementIds].sort());
  }
});

it("#1621 clears hidden Pick state and restores candidates for local pinned sessions after Layer toggles", async () => {
  const fixture = await layerVisibilityGraphFixture();
  const api = createApi();
  const pinnedContext: VscodeReferencePickCurrentContext = {
    ...fixture.context,
    evaluationIsCurrent: false,
    canvasSnapshot: {
      source: fixture.context.source,
      compiled: fixture.compiled,
      evaluation: fixture.context.evaluation
    }
  };
  let hiddenLayerIds = new Set<string>();
  let canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  const hook = renderHook(() => useVSCodeReferencePickSession({
    api,
    currentContextFor: () => pinnedContext,
    currentReferencePickAuthorityFor: version => version === DOCUMENT_VERSION
      ? { documentVersion: DOCUMENT_VERSION, normalizedSource: pinnedContext.source.normalizedSource }
      : null,
    canvasLayerPresentation
  }));

  dispatch(fixture.request);
  let session = hook.result.current.session;
  const hiddenId = fixture.elementIdFor("root_default");
  const hiddenCandidate = session?.candidates.find(candidate => candidate.elementId === hiddenId);
  const hiddenOption = hiddenCandidate?.options.find(option => option.kind === "point");
  if (!hiddenCandidate || hiddenOption?.kind !== "point") throw new Error("root_default was not a point Pick candidate");
  const hiddenSelection = { candidateElementId: hiddenCandidate.elementId, reference: hiddenOption.reference };
  act(() => hook.result.current.select(hiddenSelection));
  act(() => hook.result.current.setHover(hiddenSelection));
  act(() => hook.result.current.copy());
  expect(resultMessages(api).at(-1)).toMatchObject({ status: "copy", reference: { base: "root_default" } });
  api.postMessage.mockClear();

  hiddenLayerIds = new Set([fixture.defaultLayerId]);
  canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  hook.rerender();
  session = hook.result.current.session;
  expect(session?.candidates.map(candidate => candidate.elementId)).not.toContain(hiddenId);
  expect(session?.draft.draftReferences).toEqual([]);
  expect(session?.draft.hover).toBeNull();
  expect(session?.draft.numericProperty).toBeNull();
  act(() => hook.result.current.select(hiddenSelection));
  act(() => hook.result.current.setHover(hiddenSelection));
  act(() => hook.result.current.copy());
  act(() => hook.result.current.confirm());
  expect(resultMessages(api)).toEqual([]);

  const rootMarkerId = fixture.elementIdFor("root_marker");
  expect(session?.candidates.map(candidate => candidate.elementId)).toContain(rootMarkerId);
  const rootMarkerCandidate = session?.candidates.find(candidate => candidate.elementId === rootMarkerId);
  const rootMarkerOption = rootMarkerCandidate?.options.find(option => option.kind === "point");
  if (!rootMarkerCandidate || rootMarkerOption?.kind !== "point") throw new Error("root_marker was not a point Pick candidate");
  act(() => hook.result.current.select({ candidateElementId: rootMarkerCandidate.elementId, reference: rootMarkerOption.reference }));
  act(() => hook.result.current.copy());
  expect(resultMessages(api).at(-1)).toMatchObject({ status: "copy", reference: { base: "root_marker" } });
  api.postMessage.mockClear();

  act(() => hook.result.current.browse());
  expect(hook.result.current.session?.mode).toBe("browse");
  expect(hook.result.current.session?.candidates.map(candidate => candidate.elementId)).not.toContain(hiddenId);
  hiddenLayerIds = new Set();
  canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  hook.rerender();
  session = hook.result.current.session;
  expect(session?.candidates.map(candidate => candidate.elementId)).toContain(hiddenId);
  expect(session?.draft.draftReferences).toEqual([]);
  expect(session?.draft.hover).toBeNull();
  act(() => hook.result.current.copy());
  act(() => hook.result.current.confirm());
  expect(resultMessages(api)).toEqual([]);

  hiddenLayerIds = new Set([fixture.seamLayerId]);
  canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  hook.rerender();
  expect(hook.result.current.session?.candidates.map(candidate => candidate.elementId)).not.toContain(rootMarkerId);
  expect(hook.result.current.session?.candidates.map(candidate => candidate.elementId)).toContain(hiddenId);
  hiddenLayerIds = new Set();
  canvasLayerPresentation = fixture.presentationFor(hiddenLayerIds);
  hook.rerender();
  expect(hook.result.current.session?.candidates.map(candidate => candidate.elementId)).toContain(rootMarkerId);
  hook.unmount();
});

it("#1621 filters numeric-property candidates and invalidates a hidden numeric draft", async () => {
  const { projectCanvasLayerPresentation } = await import("../model/canvasLayerPresentation");
  const source = [
    "nui 1",
    "point A = coordinate(x: 0, y: 0)",
    "point B = coordinate(x: 10, y: 0)",
    "point C = coordinate(x: 0, y: 20)",
    "point D = coordinate(x: 10, y: 20)",
    "layer seam_layer",
    "line Visible in @seam_layer = segment(start: @A, end: @B)",
    "line Hidden = segment(start: @C, end: @D)",
    "line Copy = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, baseLines: [@Visible])"
  ].join("\n");
  const compiled = compile(source, HOST_REVISION, "numeric-layer-pick");
  if (!compiled.document) throw new Error("numeric Layer fixture did not compile");
  const evaluation = evaluationFor(compiled);
  const normalizedSourceOffset = source.indexOf("scale: 1") + "scale: ".length;
  const target = queryDslReferencePickTarget({ source: { normalizedSource: source, sourceRevision: HOST_REVISION },
    position: normalizedSourceOffset, semantic: { sourceRevision: HOST_REVISION, sourceText: source, compiled } });
  if (!target) throw new Error("numeric Layer fixture has no target");
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest", requestId: 89, documentUri: DOCUMENT_URI, documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset,
    targetProof: referencePickTargetProofFor(source, target)!
  };
  let hiddenLayerIds = new Set<string>();
  let canvasLayerPresentation = projectCanvasLayerPresentation({
    compiledDocument: compiled, elements: compiled.document.elements, evaluation, hiddenLayerIds
  });
  const api = createApi();
  const hook = renderHook(() => useVSCodeReferencePickSession({
    api,
    currentContextFor: () => ({ source: { normalizedSource: source, sourceRevision: HOST_REVISION },
      compiled, evaluation, evaluationIsCurrent: true }),
    currentReferencePickAuthorityFor: version => version === DOCUMENT_VERSION
      ? { documentVersion: DOCUMENT_VERSION, normalizedSource: source }
      : null,
    canvasLayerPresentation
  }));
  dispatch(request);
  const hiddenCandidate = hook.result.current.session?.candidates.find(candidate => candidate.options.some(option =>
    option.kind === "numericProperty" && option.reference.base === "Hidden" && option.subgeometry.kind === "body"
  ));
  const hiddenOption = hiddenCandidate?.options.find(option => option.kind === "numericProperty" && option.subgeometry.kind === "body");
  if (!hiddenCandidate || hiddenOption?.kind !== "numericProperty") throw new Error("Hidden numeric candidate was not available");
  const hiddenSelection = {
    candidateElementId: hiddenCandidate.elementId,
    reference: hiddenOption.reference,
    numericSubgeometry: hiddenOption.subgeometry
  };
  act(() => hook.result.current.select(hiddenSelection));
  act(() => hook.result.current.selectNumericProperty("length"));
  expect(hook.result.current.session?.draft.numericProperty?.draft)
    .toMatchObject({ reference: { base: "Hidden" }, property: "length" });
  expect(hook.result.current.session?.candidates.flatMap(candidate => candidate.options
    .filter(option => option.kind === "numericProperty").map(option => option.reference.base)))
    .toContain("Hidden");

  hiddenLayerIds = new Set(["source-layer:builtin:default"]);
  canvasLayerPresentation = projectCanvasLayerPresentation({
    compiledDocument: compiled, elements: compiled.document.elements, evaluation, hiddenLayerIds
  });
  hook.rerender();
  expect(hook.result.current.session?.candidates.flatMap(candidate => candidate.options
    .filter(option => option.kind === "numericProperty").map(option => option.reference.base)))
    .not.toContain("Hidden");
  expect(hook.result.current.session?.candidates.flatMap(candidate => candidate.options
    .filter(option => option.kind === "numericProperty").map(option => option.reference.base)))
    .toContain("Visible");
  expect(hook.result.current.session?.draft.numericProperty?.draft).toBeNull();
  api.postMessage.mockClear();
  act(() => hook.result.current.copy());
  act(() => hook.result.current.confirm());
  expect(resultMessages(api)).toEqual([]);

  hiddenLayerIds = new Set();
  canvasLayerPresentation = projectCanvasLayerPresentation({
    compiledDocument: compiled, elements: compiled.document.elements, evaluation, hiddenLayerIds
  });
  hook.rerender();
  expect(hook.result.current.session?.candidates.flatMap(candidate => candidate.options
    .filter(option => option.kind === "numericProperty").map(option => option.reference.base)))
    .toContain("Hidden");
  expect(hook.result.current.session?.draft.numericProperty?.draft).toBeNull();
  hook.unmount();
});
