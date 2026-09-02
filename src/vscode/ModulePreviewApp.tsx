import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutomationDocument } from "../document/automationDocument";
import {
  canvasSelectionForElement,
  canvasSelectionSnapshot
} from "../commands/selectionCommands";
import { canvasRectangleSelectionForMembers } from "../commands/canvasRectangleSelectionCommands";
import { dispatchCommand } from "../commands/commands";
import { DrawingCanvas, type DrawingCanvasHandle } from "../components/DrawingCanvas";
import type {
  CanvasBezierHandleDragAction,
  CanvasHostAdapter,
  CanvasPointDragAction
} from "../components/canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import type { ModulePreviewRootResult } from "../dsl/modulePreviewRoot";
import { createModulePreviewSession, type ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { evaluationStateIsCurrentFor } from "../geometry/useEvaluationEngine";
import { evaluateElementsWithRust } from "../geometry/evaluationEngine";
import { applyLineSplices } from "../document/textPatch";
import {
  planBakeGeometry,
  resolveDisabledBakeTargetIds,
  resolveModulePreviewBakeTargets,
  type BakeResolvedTarget
} from "../commands/bakeGeometry";
import { bakeOperationSummaryForPlan } from "../commands/bakeOperationResult";
import { buildModuleOwnerElementPatch } from "../document/moduleModelBridge";
import { moveBezierHandleByDeltaInElements, movePointElementByDeltaInElements } from "../model/elementDragTransforms";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";
import { modulePreviewParameterSnapshotFor } from "./modulePreviewParameterProjection";
import { modulePreviewReferencePickTargetFor } from "./modulePreviewReferencePick";
import type {
  ExtensionToVscodeMessage,
  VscodeCanvasCommandId,
  VscodeBakeOperationResult,
  VscodeBakeSettings,
  VscodeModulePreviewModelPatchRequest,
  VscodeModulePreviewParameterSnapshot,
  VscodeWebviewApi
} from "./protocol";
import { vscodeCanvasContextDataFor } from "./protocol";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";
import { VscodeRustTransport, isExtensionToVscodeMessage } from "./vscodeRustTransport";
import { useVSCodeModulePreviewReferencePickSession } from "./useVSCodeModulePreviewReferencePickSession";
import type { VscodeModulePreviewReferencePickStartRequest } from "./modulePreviewProtocol";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const nonWritingCanvasCommands = new Set<VscodeCanvasCommandId>([
  "clearCanvasSelection",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasElementNames",
  "toggleCanvasPoints"
]);

type ValidModulePreview = {
  root: ModulePreviewRootResult;
  evaluationOptions: ReturnType<typeof buildModulePreviewEvaluationOptions>;
  moduleSemanticContext: CanvasHostAdapter["moduleSemanticContext"];
  revision: number;
};

type ModulePreviewDragProof = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  targetDefinitionStatementId: string;
  previewRevision: number;
  materialization: ModulePreviewRootResult["moduleMaterialization"];
  sourceOwners: ModulePreviewSourceOwnerProof[];
  baseElements: CadElement[];
  baseEvaluation: EvaluationResult;
  evaluationRevision: number;
};

type ModulePreviewSourceOwnerProof = {
  runtimeElementId: string;
  sourceStatementId: string;
};

type ModulePreviewAuthority = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  targetDefinitionStatementId: string;
  previewRevision: number;
  materialization: ModulePreviewRootResult["moduleMaterialization"];
  authoredCompiled: ReturnType<AutomationDocument["getState"]>["doc"];
  elements: CadElement[];
  evaluationOptions: ValidModulePreview["evaluationOptions"];
  evaluation: EvaluationResult;
  evaluationRevision: number;
  evaluationRequestRevision: number;
};

type ModulePreviewBakeProof = ModulePreviewAuthority & {
  selectedRuntimeElementIds: string[];
  resolvedTargets: BakeResolvedTarget[];
  sourceOwners: ModulePreviewSourceOwnerProof[];
};

type PendingModulePreviewBakeResult = {
  operationId: number;
  mode: "current" | "base";
  result: VscodeBakeOperationResult;
};

type PendingModulePreviewModelPatch = {
  operationId: number;
  expectedDocumentVersion: number;
  expectedPatchedSource: string;
};

const bakeTargetsSignature = (targets: readonly BakeResolvedTarget[]) => JSON.stringify(
  targets.map((target) => ({
    targetId: target.targetId,
    runtimeElementIds: target.runtimeElementIds,
    sourceElementId: target.sourceElementId,
    instanceBaseId: target.instanceBaseId,
    insertionStatementIndex: target.insertionStatementIndex,
    insertionParentGroupId: target.insertionParentGroupId,
    sourceLabel: target.sourceLabel,
    wholeInstance: target.wholeInstance
  }))
);

const sourceOwnersSignature = (owners: readonly ModulePreviewSourceOwnerProof[]) => JSON.stringify(owners);

const diagnosticMessagesFor = (document: AutomationDocument): string[] => {
  const state = document.getState();
  return [...state.currentCompiled.diagnostics, ...(state.currentCompiled.bindingIssueDiagnostics ?? [])]
    .slice(0, 4)
    .map((diagnostic) => diagnostic.message);
};

export const ModulePreviewApp = ({ api }: { api: VscodeWebviewApi }) => {
  const automationDocumentRef = useRef<AutomationDocument | null>(null);
  const documentVersionRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionDocumentUriRef = useRef<string | null>(null);
  const parameterSessionRevisionRef = useRef(0);
  const nextPreviewRevisionRef = useRef(1);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const evaluationRef = useRef<EvaluationResult | null>(null);
  const previewRef = useRef<ValidModulePreview | null>(null);
  const previewSession = useMemo(() => createModulePreviewSession(), []);
  const [preview, setPreview] = useState<ValidModulePreview | null>(null);
  const [ephemeralElements, setEphemeralElements] = useState<CadElement[] | null>(null);
  const ephemeralElementsRef = useRef<CadElement[] | null>(null);
  const dragProofRef = useRef<ModulePreviewDragProof | null>(null);
  const nextModelPatchOperationIdRef = useRef(1);
  const pendingModelPatchRef = useRef<PendingModulePreviewModelPatch | null>(null);
  const pendingBakeResultRef = useRef<PendingModulePreviewBakeResult | null>(null);
  const [statusMessages, setStatusMessages] = useState<string[]>([
    "Open Module Preview from a Module definition in the Source Editor."
  ]);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [canvasRibbonRibbons, setCanvasRibbonRibbons] = useState<VscodeCanvasRibbon[]>([]);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);
  const canvasViewport = useCadUiStore((state) => state.canvasViewport);
  const showCanvasPointNames = useCadUiStore((state) => state.showCanvasPointNames);
  const showCanvasGeometryNames = useCadUiStore((state) => state.showCanvasGeometryNames);
  const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
  const measureCanvasTextWidth = useMemo(
    () => createCanvasTextWidthMeasurer(() =>
      document.querySelector<HTMLElement>('[data-canvas-viewport="true"]')
    ),
    []
  );
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);

  const publishParameterSnapshot = useCallback((snapshot: ModulePreviewSessionSnapshot) => {
    const sessionId = sessionIdRef.current;
    const documentUri = sessionDocumentUriRef.current;
    const documentVersion = documentVersionRef.current;
    if (!sessionId || !documentUri || documentVersion === null) return;
    const sessionRevision = parameterSessionRevisionRef.current + 1;
    parameterSessionRevisionRef.current = sessionRevision;
    const message: VscodeModulePreviewParameterSnapshot = modulePreviewParameterSnapshotFor({
      snapshot,
      sessionId,
      documentUri,
      documentVersion,
      sessionRevision
    });
    api.postMessage(message);
  }, [api]);

  const publishParameterUnavailable = useCallback((
    reason: "not-ready" | "source-stale" | "target-unavailable" | "disposed",
    targetDefinitionStatementId: string | null = previewSession.getState()?.target.definitionStatementId ?? null
  ) => {
    const sessionId = sessionIdRef.current;
    const documentUri = sessionDocumentUriRef.current;
    const documentVersion = documentVersionRef.current;
    if (!sessionId || !documentUri || documentVersion === null) return;
    const state = automationDocumentRef.current?.getState();
    const sessionRevision = parameterSessionRevisionRef.current + 1;
    parameterSessionRevisionRef.current = sessionRevision;
    api.postMessage({
      type: "modulePreviewParametersUnavailable",
      sessionId,
      documentUri,
      documentVersion,
      sourceRevision: state?.currentCompiled.spans.sourceMap.sourceRevision ?? null,
      sessionRevision,
      targetDefinitionStatementId,
      reason
    });
  }, [api, previewSession]);

  const evaluationElements = useMemo(
    () => ephemeralElements ?? preview?.root.compileResult.elements ?? [],
    [ephemeralElements, preview]
  );
  const evaluationOptions = preview?.evaluationOptions ?? {};
  const evaluationState = useEvaluationEngine(
    evaluationElements,
    evaluationOptions,
    preview?.revision ?? 0,
    rustTransport.transport
  );
  const evaluationStateRef = useRef(evaluationState);
  useEffect(() => {
    evaluationRef.current = evaluationState.evaluation;
    evaluationStateRef.current = evaluationState;
  }, [evaluationState]);

  const clearEphemeralPreview = useCallback(() => {
    ephemeralElementsRef.current = null;
    setEphemeralElements(null);
    dragProofRef.current = null;
  }, []);

  const clearPendingModelPatch = useCallback(() => {
    pendingModelPatchRef.current = null;
    pendingBakeResultRef.current = null;
  }, []);

  const currentModulePreviewReferencePickContext = useCallback((
    request: VscodeModulePreviewReferencePickStartRequest
  ) => {
    const document = automationDocumentRef.current;
    const activePreview = previewRef.current;
    const state = previewSession.getState();
    const evaluation = evaluationRef.current;
    if (!document || !activePreview || !state || state.preview.kind !== "current" ||
      state.preview.result !== activePreview.root || !evaluation) return null;
    const documentState = document.getState();
    const source = {
      normalizedSource: normalizedSourceFor(document.getSource()),
      sourceRevision: documentState.currentCompiled.spans.sourceMap.sourceRevision
    };
    if (
      request.sessionId !== sessionIdRef.current ||
      request.documentUri !== sessionDocumentUriRef.current ||
      request.documentVersion !== documentVersionRef.current ||
      request.sourceRevision !== state.sourceRevision ||
      request.sessionRevision !== parameterSessionRevisionRef.current ||
      request.targetDefinitionStatementId !== state.target.definitionStatementId ||
      source.normalizedSource !== activePreview.root.candidateCompiledDocument.spans.sourceMap.source ||
      source.sourceRevision !== activePreview.root.candidateCompiledDocument.spans.sourceMap.sourceRevision
    ) return null;
    const row = [
      ...state.ancestorContexts.flatMap((group) => group.parameters),
      ...state.parameters.parameters
    ].find((parameter) =>
      parameter.definitionStatementId === request.definitionStatementId &&
      parameter.parameterIndex === request.parameterIndex
    );
    if (!row) return null;
    const target = modulePreviewReferencePickTargetFor({
      root: activePreview.root,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      expectedGeometryInterface: request.expectedGeometryInterface
    });
    if (!target) return null;
    return {
      source,
      compiled: activePreview.root.candidateCompiledDocument,
      evaluation,
      evaluationIsCurrent: evaluationStateIsCurrentFor(evaluationState, activePreview.revision),
      target
    };
  }, [evaluationState, previewSession]);

  const {
    session: modulePreviewReferencePickSession,
    setHover: setModulePreviewReferencePickHover,
    select: selectModulePreviewReferencePick,
    confirm: confirmModulePreviewReferencePick,
    cancel: cancelModulePreviewReferencePick
  } = useVSCodeModulePreviewReferencePickSession({
    api,
    currentContextFor: currentModulePreviewReferencePickContext
  });

  const renderElements = useMemo(() => {
    if (!preview) return [];
    const targetIds = new Set(preview.root.targetRuntimeElementIds);
    return evaluationElements.filter((element) => targetIds.has(element.id));
  }, [evaluationElements, preview]);

  const applyValidPreview = useCallback((
    root: ModulePreviewRootResult,
    moduleSemanticContext: CanvasHostAdapter["moduleSemanticContext"],
    nextStatusMessages: string[]
  ) => {
    clearEphemeralPreview();
    let evaluationOptions: ReturnType<typeof buildModulePreviewEvaluationOptions>;
    try {
      evaluationOptions = buildModulePreviewEvaluationOptions(root);
    } catch {
      const document = automationDocumentRef.current;
      setStatusMessages(document ? [
        "Module Preview could not build the current evaluation context.",
        ...diagnosticMessagesFor(document)
      ] : ["Module Preview could not build the current evaluation context."]);
      return;
    }
    const revision = nextPreviewRevisionRef.current++;
    const nextPreview = { root, evaluationOptions, moduleSemanticContext, revision };
    previewRef.current = nextPreview;
    setPreview(nextPreview);
    setStatusMessages(nextStatusMessages);
  }, [clearEphemeralPreview]);

  const applySessionSnapshot = useCallback((snapshot: ModulePreviewSessionSnapshot): void => {
    publishParameterSnapshot(snapshot);
    const root = snapshot.preview.result;
    const document = automationDocumentRef.current;
    if (!root || !document) {
      clearEphemeralPreview();
      previewRef.current = null;
      setPreview(null);
      setStatusMessages([
        "Module Preview cannot evaluate the exact current target with the current inputs.",
        ...snapshot.inputDiagnostics.map((diagnostic) => diagnostic.message)
      ]);
      return;
    }
    const state = document.getState();
    const nextStatusMessages = [
      ...(snapshot.preview.kind === "lastGood"
        ? ["Module Preview is showing the last valid preview for the current target."]
        : []),
      ...snapshot.inputDiagnostics.map((diagnostic) => diagnostic.message),
      ...root.diagnostics.map((diagnostic) => diagnostic.message)
    ];
    applyValidPreview(root, {
      moduleMaterialization: root.moduleMaterialization,
      moduleSemanticAnalysis: root.moduleSemanticAnalysis,
      sourceLexicalNamespace: state.currentCompiled.sourceLexicalNamespace,
      statementInfoByElementId: state.currentCompiled.statementMap?.byElementId
    }, nextStatusMessages);
  }, [applyValidPreview, clearEphemeralPreview, publishParameterSnapshot]);

  const compileTargetAt = useCallback((normalizedSourceOffset: number) => {
    clearEphemeralPreview();
    const document = automationDocumentRef.current;
    if (!document) return;
    const state = document.getState();
    const normalizedSource = normalizedSourceFor(document.getSource());
    const source = {
      normalizedSource,
      sourceRevision: state.currentCompiled.spans.sourceMap.sourceRevision
    };
    const semantic = {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedSource,
      compiled: state.currentCompiled
    };
    const target = queryModulePreviewTarget({ source, position: normalizedSourceOffset, semantic });
    const snapshot = target ? previewSession.activate({ source, semantic, target }) : null;
    if (snapshot) publishParameterSnapshot(snapshot);
    const root = snapshot?.preview.result ?? null;
    if (!snapshot || !root) {
      if (!snapshot) publishParameterUnavailable("target-unavailable");
      previewRef.current = null;
      setPreview(null);
      const diagnostics = snapshot?.inputDiagnostics.map((diagnostic) => diagnostic.message)
        ?? diagnosticMessagesFor(document);
      setStatusMessages([
        "Module Preview cannot evaluate the exact current target with the current inputs.",
        ...diagnostics
      ]);
      return;
    }

    const nextStatusMessages = [
      ...(snapshot.preview.kind === "lastGood"
        ? ["Module Preview is showing the last valid preview for the current target."]
        : []),
      ...snapshot.inputDiagnostics.map((diagnostic) => diagnostic.message),
      ...root.diagnostics.map((diagnostic) => diagnostic.message)
    ];
    applyValidPreview(root, {
      moduleMaterialization: root.moduleMaterialization,
      moduleSemanticAnalysis: root.moduleSemanticAnalysis,
      sourceLexicalNamespace: state.currentCompiled.sourceLexicalNamespace,
      statementInfoByElementId: state.currentCompiled.statementMap?.byElementId
    }, nextStatusMessages);
  }, [applyValidPreview, clearEphemeralPreview, previewSession, publishParameterSnapshot, publishParameterUnavailable]);

  const currentPreviewAuthority = useCallback((): ModulePreviewAuthority | null => {
    const document = automationDocumentRef.current;
    const activePreview = previewRef.current;
    const session = previewSession.getState();
    const sessionId = sessionIdRef.current;
    const documentUri = sessionDocumentUriRef.current;
    const documentVersion = documentVersionRef.current;
    const currentEvaluationState = evaluationStateRef.current;
    if (
      !document ||
      !activePreview ||
      !session ||
      session.preview.kind !== "current" ||
      session.preview.result !== activePreview.root ||
      !sessionId ||
      !documentUri ||
      documentVersion === null ||
      ephemeralElementsRef.current !== null ||
      !evaluationStateIsCurrentFor(currentEvaluationState, activePreview.revision)
    ) return null;

    const documentState = document.getState();
    const normalizedSource = normalizedSourceFor(document.getSource());
    const sourceRevision = documentState.doc.spans.sourceMap.sourceRevision;
    if (
      documentState.doc.spans.sourceMap.source !== normalizedSource ||
      session.sourceRevision !== sourceRevision ||
      activePreview.root.target.definitionStatementId !== session.target.definitionStatementId
    ) return null;
    return {
      sessionId,
      documentUri,
      documentVersion,
      normalizedSource,
      sourceRevision,
      targetDefinitionStatementId: session.target.definitionStatementId,
      previewRevision: activePreview.revision,
      materialization: activePreview.root.moduleMaterialization,
      authoredCompiled: documentState.doc,
      elements: activePreview.root.compileResult.elements,
      evaluationOptions: activePreview.evaluationOptions,
      evaluation: currentEvaluationState.evaluation,
      evaluationRevision: currentEvaluationState.evaluationRevision,
      evaluationRequestRevision: currentEvaluationState.evaluationRequestRevision
    };
  }, [previewSession]);

  const currentDragAuthority = useCallback(() => {
    const authority = currentPreviewAuthority();
    if (!authority) return null;
    return {
      ...authority,
      baseElements: authority.elements,
      baseEvaluation: authority.evaluation
    };
  }, [currentPreviewAuthority]);

  const captureDragProof = useCallback((): ModulePreviewDragProof | null => {
    const authority = currentDragAuthority();
    if (!authority) return null;
    const proof: ModulePreviewDragProof = {
      ...authority,
      sourceOwners: []
    };
    dragProofRef.current = proof;
    return proof;
  }, [currentDragAuthority]);

  const proofIsCurrent = useCallback((proof: ModulePreviewDragProof): boolean => {
    const document = automationDocumentRef.current;
    const activePreview = previewRef.current;
    const session = previewSession.getState();
    const documentVersion = documentVersionRef.current;
    const currentEvaluationState = evaluationStateRef.current;
    if (
      !document ||
      !activePreview ||
      !session ||
      session.preview.kind !== "current" ||
      session.preview.result !== activePreview.root ||
      documentVersion === null ||
      proof.sessionId !== sessionIdRef.current ||
      proof.documentUri !== sessionDocumentUriRef.current ||
      proof.documentVersion !== documentVersion ||
      proof.targetDefinitionStatementId !== session.target.definitionStatementId ||
      proof.previewRevision !== activePreview.revision ||
      proof.materialization !== activePreview.root.moduleMaterialization ||
      proof.targetDefinitionStatementId !== activePreview.root.target.definitionStatementId
    ) return false;
    const documentState = document.getState();
    if (
      proof.normalizedSource !== normalizedSourceFor(document.getSource()) ||
      proof.sourceRevision !== documentState.currentCompiled.spans.sourceMap.sourceRevision ||
      proof.sourceRevision !== session.sourceRevision ||
      currentEvaluationState.evaluationRevision !== proof.evaluationRevision ||
      (currentEvaluationState.isStale && ephemeralElementsRef.current === null)
    ) return false;
    return true;
  }, [previewSession]);

  const sourceOwnerForDrag = useCallback((
    action: CanvasPointDragAction | CanvasBezierHandleDragAction,
    proof: ModulePreviewDragProof
  ) => {
    const document = automationDocumentRef.current;
    const activePreview = previewRef.current;
    if (!document || !activePreview) return null;
    const existingOwner = proof.sourceOwners[0];
    if (existingOwner && existingOwner.runtimeElementId !== action.elementId) return null;
    const documentState = document.getState();
    const owner = sourceOwnerForRuntimeElementId({
      statementMap: documentState.doc.statementMap,
      moduleMaterialization: activePreview.root.moduleMaterialization,
      moduleRuntimeContext: documentState.doc.moduleRuntimeContext
    }, action.elementId);
    if (!owner || owner.kind !== "moduleBody") return null;
    if (existingOwner && existingOwner.sourceStatementId !== owner.sourceStatementId) return null;
    if (!existingOwner) {
      proof.sourceOwners.push({
        runtimeElementId: action.elementId,
        sourceStatementId: owner.sourceStatementId
      });
    }
    return owner;
  }, []);

  const transformedElementsFor = useCallback((
    action: CanvasPointDragAction | CanvasBezierHandleDragAction
  ): CadElement[] | null => {
    if ("bezierHandleRole" in action) {
      return moveBezierHandleByDeltaInElements(action.baseElements, action.elementId, {
        dx: action.dx,
        dy: action.dy,
        angleLocked: action.angleLocked,
        distanceLocked: action.distanceLocked,
        role: action.bezierHandleRole,
        intermediatePointId: action.intermediatePointId,
        baseEvaluation: action.baseEvaluation
      });
    }
    return movePointElementByDeltaInElements(action.baseElements, action.elementId, {
      dx: action.dx,
      dy: action.dy,
      angleLocked: action.angleLocked,
      distanceLocked: action.distanceLocked,
      baseEvaluation: action.baseEvaluation
    });
  }, []);

  const dispatchPreviewGeometry = useCallback((
    action: CanvasPointDragAction | CanvasBezierHandleDragAction
  ) => {
    const proof = dragProofRef.current;
    if (
      !proof ||
      action.baseElements !== proof.baseElements ||
      action.baseEvaluation !== proof.baseEvaluation ||
      !proofIsCurrent(proof)
    ) {
      clearEphemeralPreview();
      return { status: "rejected", reason: "Module Preview drag state is stale." };
    }
    if (!sourceOwnerForDrag(action, proof)) {
      clearEphemeralPreview();
      return { status: "rejected", reason: "Module Preview geometry has no writable authored owner." };
    }
    const nextElements = transformedElementsFor(action);
    if (!nextElements) return { status: "noop" };
    ephemeralElementsRef.current = nextElements;
    setEphemeralElements(nextElements);
    return { status: "applied" };
  }, [clearEphemeralPreview, proofIsCurrent, sourceOwnerForDrag, transformedElementsFor]);

  const dispatchCommitGeometry = useCallback((
    action: CanvasPointDragAction | CanvasBezierHandleDragAction
  ) => {
    const proof = dragProofRef.current;
    if (
      !proof ||
      action.baseElements !== proof.baseElements ||
      action.baseEvaluation !== proof.baseEvaluation ||
      !proofIsCurrent(proof)
    ) {
      clearEphemeralPreview();
      return { status: "rejected", reason: "Module Preview drag state is stale." };
    }
    const owner = sourceOwnerForDrag(action, proof);
    if (!owner) {
      clearEphemeralPreview();
      return { status: "rejected", reason: "Module Preview geometry has no writable authored owner." };
    }
    const nextElements = transformedElementsFor(action);
    if (!nextElements) {
      clearEphemeralPreview();
      return { status: "noop" };
    }
    const before = action.baseElements.find((element) => element.id === action.elementId);
    const after = nextElements.find((element) => element.id === action.elementId);
    const document = automationDocumentRef.current;
    if (!before || !after || !document) {
      clearEphemeralPreview();
      return { status: "rejected", reason: "Module Preview drag target is unavailable." };
    }
    const patch = buildModuleOwnerElementPatch(document.getState(), owner, before, after);
    if (patch.status === "unapplied") {
      clearEphemeralPreview();
      return { status: "rejected", reason: patch.reason };
    }
    if (patch.status === "noop") {
      clearEphemeralPreview();
      return { status: "noop" };
    }
    let expectedPatchedSource: string;
    try {
      expectedPatchedSource = applyLineSplices(document.getSource(), patch.splices);
    } catch (error) {
      clearEphemeralPreview();
      return { status: "rejected", reason: error instanceof Error ? error.message : String(error) };
    }
    const operationId = nextModelPatchOperationIdRef.current++;
    const request: VscodeModulePreviewModelPatchRequest = {
      type: "modulePreviewModelPatch",
      operationId,
      sessionId: proof.sessionId,
      documentUri: proof.documentUri,
      expectedDocumentVersion: proof.documentVersion,
      normalizedSource: proof.normalizedSource,
      sourceRevision: proof.sourceRevision,
      targetDefinitionStatementId: proof.targetDefinitionStatementId,
      previewRevision: proof.previewRevision,
      sourceOwners: proof.sourceOwners,
      splices: patch.splices,
      expectedPatchedSource
    };
    clearEphemeralPreview();
    clearPendingModelPatch();
    pendingModelPatchRef.current = {
      operationId,
      expectedDocumentVersion: request.expectedDocumentVersion,
      expectedPatchedSource: request.expectedPatchedSource
    };
    try {
      api.postMessage(request);
    } catch (error) {
      clearPendingModelPatch();
      return { status: "rejected", reason: error instanceof Error ? error.message : String(error) };
    }
    return { status: "pending" };
  }, [api, clearEphemeralPreview, clearPendingModelPatch, proofIsCurrent, sourceOwnerForDrag, transformedElementsFor]);

  const sourceOwnersForBakeTargets = useCallback((
    authority: ModulePreviewAuthority,
    targets: readonly BakeResolvedTarget[]
  ): ModulePreviewSourceOwnerProof[] | null => {
    const sourceOwnershipDocument = {
      statementMap: authority.authoredCompiled.statementMap,
      moduleMaterialization: authority.materialization,
      moduleRuntimeContext: authority.authoredCompiled.moduleRuntimeContext
    };
    const runtimeElementIds = [...new Set(targets.flatMap((target) => [
      target.targetId,
      ...target.runtimeElementIds
    ]))];
    const owners: ModulePreviewSourceOwnerProof[] = [];
    for (const runtimeElementId of runtimeElementIds) {
      const owner = sourceOwnerForRuntimeElementId(sourceOwnershipDocument, runtimeElementId);
      if (!owner) return null;
      owners.push({ runtimeElementId, sourceStatementId: owner.sourceStatementId });
    }
    return owners;
  }, []);

  const captureBakeProof = useCallback((): ModulePreviewBakeProof | null => {
    const authority = currentPreviewAuthority();
    if (!authority) return null;
    const selectedRuntimeElementIds = [...useCadUiStore.getState().selectedElementIds];
    const resolvedTargets = resolveModulePreviewBakeTargets({
      authoredCompiled: authority.authoredCompiled,
      previewMaterialization: authority.materialization,
      elements: authority.elements,
      selectedElementIds: selectedRuntimeElementIds
    });
    const sourceOwners = sourceOwnersForBakeTargets(authority, resolvedTargets);
    if (!sourceOwners) return null;
    return {
      ...authority,
      selectedRuntimeElementIds,
      resolvedTargets,
      sourceOwners
    };
  }, [currentPreviewAuthority, sourceOwnersForBakeTargets]);

  const bakeProofIsCurrent = useCallback((proof: ModulePreviewBakeProof): boolean => {
    const authority = currentPreviewAuthority();
    if (!authority) return false;
    const selectedRuntimeElementIds = [...useCadUiStore.getState().selectedElementIds];
    if (
      authority.sessionId !== proof.sessionId ||
      authority.documentUri !== proof.documentUri ||
      authority.documentVersion !== proof.documentVersion ||
      authority.normalizedSource !== proof.normalizedSource ||
      authority.sourceRevision !== proof.sourceRevision ||
      authority.targetDefinitionStatementId !== proof.targetDefinitionStatementId ||
      authority.previewRevision !== proof.previewRevision ||
      authority.materialization !== proof.materialization ||
      authority.evaluation !== proof.evaluation ||
      authority.evaluationRevision !== proof.evaluationRevision ||
      authority.evaluationRequestRevision !== proof.evaluationRequestRevision ||
      selectedRuntimeElementIds.length !== proof.selectedRuntimeElementIds.length ||
      selectedRuntimeElementIds.some((id, index) => id !== proof.selectedRuntimeElementIds[index])
    ) return false;
    const resolvedTargets = resolveModulePreviewBakeTargets({
      authoredCompiled: authority.authoredCompiled,
      previewMaterialization: authority.materialization,
      elements: authority.elements,
      selectedElementIds: selectedRuntimeElementIds
    });
    const sourceOwners = sourceOwnersForBakeTargets(authority, resolvedTargets);
    return sourceOwners !== null &&
      bakeTargetsSignature(resolvedTargets) === bakeTargetsSignature(proof.resolvedTargets) &&
      sourceOwnersSignature(sourceOwners) === sourceOwnersSignature(proof.sourceOwners);
  }, [currentPreviewAuthority, sourceOwnersForBakeTargets]);

  const executeModulePreviewBake = useCallback(async (
    commandId: Extract<VscodeCanvasCommandId, "bakeCurrentShape" | "bakeBaseShape">,
    settings: VscodeBakeSettings
  ): Promise<void> => {
    const proof = captureBakeProof();
    if (!proof) {
      setStatusMessages(["Module Preview Bake was rejected because its state is not exact-current."]);
      return;
    }
    if (proof.resolvedTargets.length === 0) {
      setStatusMessages(["Module Preview has no writable authored geometry selected for Bake."]);
      return;
    }

    const mode = commandId === "bakeCurrentShape" ? "current" : "base";
    const disabledTargetIds = settings.includeDisabledGeometry
      ? resolveDisabledBakeTargetIds({
          compiled: proof.authoredCompiled,
          elements: proof.elements,
          resolvedTargets: proof.resolvedTargets
        })
      : [];
    let bakeDisabledEvaluation: EvaluationResult | undefined;
    if (disabledTargetIds.length > 0) {
      try {
        bakeDisabledEvaluation = await evaluateElementsWithRust(
          proof.elements,
          {
            ...proof.evaluationOptions,
            allowDisabledElementIds: new Set(disabledTargetIds)
          },
          rustTransport.transport
        );
      } catch {
        setStatusMessages(["Module Preview Bake用のdisabled geometry評価に失敗しました。"]);
        return;
      }
      if (!bakeProofIsCurrent(proof)) {
        setStatusMessages(["Module Preview Bake was rejected because its state became stale."]);
        return;
      }
      const currentAuthority = currentPreviewAuthority();
      if (!currentAuthority) {
        setStatusMessages(["Module Preview Bake was rejected because its state became stale."]);
        return;
      }
      const currentTargets = resolveModulePreviewBakeTargets({
        authoredCompiled: currentAuthority.authoredCompiled,
        previewMaterialization: currentAuthority.materialization,
        elements: currentAuthority.elements,
        selectedElementIds: proof.selectedRuntimeElementIds
      });
      const currentDisabledTargetIds = resolveDisabledBakeTargetIds({
        compiled: currentAuthority.authoredCompiled,
        elements: currentAuthority.elements,
        resolvedTargets: currentTargets
      });
      if (
        disabledTargetIds.length !== currentDisabledTargetIds.length ||
        disabledTargetIds.some((id, index) => id !== currentDisabledTargetIds[index])
      ) {
        setStatusMessages(["Module Preview Bake was rejected because its disabled targets became stale."]);
        return;
      }
    }

    if (!bakeProofIsCurrent(proof)) {
      setStatusMessages(["Module Preview Bake was rejected because its state became stale."]);
      return;
    }
    const document = automationDocumentRef.current;
    if (!document) return;
    const plan = planBakeGeometry({
      mode,
      elements: proof.elements,
      evaluation: proof.evaluation,
      baseEvaluation: proof.evaluation,
      ...(bakeDisabledEvaluation ? { bakeDisabledEvaluation } : {}),
      compiled: proof.authoredCompiled,
      resolvedTargets: proof.resolvedTargets,
      emitSkippedComments: settings.emitSkippedComments,
      includeHiddenGeometry: settings.includeHiddenGeometry,
      includeDisabledGeometry: settings.includeDisabledGeometry
    });
    if (!plan) {
      setStatusMessages(["Module Preview has no writable authored geometry selected for Bake."]);
      return;
    }
    const operationResult: VscodeBakeOperationResult = {
      status: plan.splices.length > 0 ? "applied" : "nothing",
      summary: bakeOperationSummaryForPlan(plan)
    };
    if (plan.splices.length === 0) {
      if (operationResult.summary.skippedTargetCount > 0) {
        api.postMessage({
          type: "bakeOperationResult",
          surface: "modulePreview",
          mode,
          ...operationResult
        });
        return;
      }
      setStatusMessages(["Module Preview has no writable authored geometry selected for Bake."]);
      return;
    }
    let expectedPatchedSource: string;
    try {
      expectedPatchedSource = applyLineSplices(document.getSource(), plan.splices);
    } catch (error) {
      setStatusMessages([error instanceof Error ? error.message : String(error)]);
      return;
    }
    const operationId = nextModelPatchOperationIdRef.current++;
    const request: VscodeModulePreviewModelPatchRequest = {
      type: "modulePreviewModelPatch",
      operationId,
      sessionId: proof.sessionId,
      documentUri: proof.documentUri,
      expectedDocumentVersion: proof.documentVersion,
      normalizedSource: proof.normalizedSource,
      sourceRevision: proof.sourceRevision,
      targetDefinitionStatementId: proof.targetDefinitionStatementId,
      previewRevision: proof.previewRevision,
      sourceOwners: proof.sourceOwners,
      splices: plan.splices,
      expectedPatchedSource
    };
    clearEphemeralPreview();
    clearPendingModelPatch();
    pendingModelPatchRef.current = {
      operationId,
      expectedDocumentVersion: request.expectedDocumentVersion,
      expectedPatchedSource: request.expectedPatchedSource
    };
    pendingBakeResultRef.current = { operationId, mode, result: operationResult };
    try {
      api.postMessage(request);
    } catch (error) {
      clearPendingModelPatch();
      setStatusMessages([error instanceof Error ? error.message : String(error)]);
    }
  }, [api, bakeProofIsCurrent, captureBakeProof, clearEphemeralPreview, clearPendingModelPatch, currentPreviewAuthority, rustTransport.transport]);

  const executeSharedCanvasCommand = useCallback((commandId: VscodeCanvasCommandId) => {
    if (!nonWritingCanvasCommands.has(commandId)) return;
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    dispatchCommand(commandId, {
      evaluation: evaluationRef.current ?? undefined,
      getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
      measureCanvasTextWidth,
      recordSelectionHistory: false,
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
      focusCanvas: () => canvasFocusRef.current?.focus()
    });
    canvasFocusRef.current?.focus();
  }, [measureCanvasTextWidth]);

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtensionToVscodeMessage(event.data)) return;
      const message: ExtensionToVscodeMessage = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "modulePreviewSession") {
        if (sessionIdRef.current !== message.sessionId) {
          parameterSessionRevisionRef.current = 0;
          clearPendingModelPatch();
          clearEphemeralPreview();
          previewRef.current = null;
          setPreview(null);
        }
        sessionIdRef.current = message.sessionId;
        sessionDocumentUriRef.current = message.documentUri;
        return;
      }
      if (message.type === "modulePreviewSetValue" || message.type === "modulePreviewUseDefault") {
        const state = previewSession.getState();
        const document = automationDocumentRef.current;
        const row = state && [
          ...state.ancestorContexts.flatMap((group) => group.parameters),
          ...state.parameters.parameters
        ].find((parameter) =>
          parameter.definitionStatementId === message.definitionStatementId &&
          parameter.parameterIndex === message.parameterIndex
        );
        if (
          !state ||
          !document ||
          sessionIdRef.current !== message.sessionId ||
          sessionDocumentUriRef.current !== message.documentUri ||
          documentVersionRef.current !== message.documentVersion ||
          state.sourceRevision !== message.sourceRevision ||
          state.target.definitionStatementId !== message.targetDefinitionStatementId ||
          !Number.isInteger(message.sessionRevision) ||
          message.sessionRevision < 1 ||
          message.sessionRevision > parameterSessionRevisionRef.current ||
          !row
        ) return;
        if (message.type === "modulePreviewSetValue") {
          const next = previewSession.setValue(
            message.definitionStatementId,
            message.parameterIndex,
            message.expression
          );
          if (next) applySessionSnapshot(next);
          return;
        }
        const result = previewSession.useDefaultExplicitly(
          message.definitionStatementId,
          message.parameterIndex
        );
        if (result.state) applySessionSnapshot(result.state);
        return;
      }
      if (message.type === "replaceTextDocument") {
        clearPendingModelPatch();
        if (documentVersionRef.current !== null && message.documentVersion < documentVersionRef.current) return;
        clearEphemeralPreview();
        automationDocumentRef.current = AutomationDocument.fromSource(message.sourceText);
        documentVersionRef.current = message.documentVersion;
        publishParameterUnavailable("source-stale");
        setStatusMessages(previewRef.current
          ? ["Module Preview is waiting for the exact current target."]
          : ["No valid Module Preview is available yet."]);
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        return;
      }
      if (message.type === "commitText") {
        const pendingModelPatch = pendingModelPatchRef.current;
        const isOwnModelPatchCommit = pendingModelPatch !== null &&
          message.sourceText === pendingModelPatch.expectedPatchedSource &&
          message.documentVersion === pendingModelPatch.expectedDocumentVersion + 1;
        if (documentVersionRef.current !== null && message.documentVersion < documentVersionRef.current) {
          if (!isOwnModelPatchCommit) clearPendingModelPatch();
          return;
        }
        if (!isOwnModelPatchCommit) clearPendingModelPatch();
        clearEphemeralPreview();
        const document = automationDocumentRef.current ?? AutomationDocument.fromSource(message.sourceText);
        if (document.getSource() !== message.sourceText) document.replaceSource(message.sourceText);
        automationDocumentRef.current = document;
        documentVersionRef.current = message.documentVersion;
        publishParameterUnavailable("source-stale");
        setStatusMessages(previewRef.current
          ? ["Module Preview is waiting for the exact current target."]
          : ["No valid Module Preview is available yet."]);
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        return;
      }
      if (message.type === "modulePreviewTarget") {
        if (documentVersionRef.current !== message.documentVersion) return;
        compileTargetAt(message.normalizedSourceOffset);
        return;
      }
      if (message.type === "modulePreviewTargetUnavailable") {
        if (documentVersionRef.current !== message.documentVersion) return;
        clearPendingModelPatch();
        clearEphemeralPreview();
        previewRef.current = null;
        setPreview(null);
        publishParameterUnavailable("target-unavailable", null);
        const document = automationDocumentRef.current;
        setStatusMessages([
          "Module Preview target is not exact-current and was not rebound.",
          ...(document ? diagnosticMessagesFor(document) : [])
        ]);
        return;
      }
      if (message.type === "modulePreviewModelPatchResult") {
        const pendingModelPatch = pendingModelPatchRef.current;
        if (
          message.sessionId !== sessionIdRef.current ||
          message.documentUri !== sessionDocumentUriRef.current ||
          message.operationId !== pendingModelPatch?.operationId
        ) return;
        const pendingBakeResult = pendingBakeResultRef.current;
        clearPendingModelPatch();
        clearEphemeralPreview();
        if (message.status === "applied" && pendingBakeResult?.operationId === message.operationId) {
          api.postMessage({
            type: "bakeOperationResult",
            surface: "modulePreview",
            mode: pendingBakeResult.mode,
            ...pendingBakeResult.result
          });
          return;
        }
        if (message.status !== "applied") {
          setStatusMessages([
            message.status === "stale"
              ? "Module Preview edit became stale and was rejected."
              : "Module Preview edit was rejected.",
            ...(message.reason ? [message.reason] : [])
          ]);
        }
        return;
      }
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
        return;
      }
      if (message.type === "canvasRibbonConfiguration") {
        setCanvasRibbonRibbons(message.ribbons);
        return;
      }
      if (message.type === "canvasCommand") {
        if (message.commandId === "bakeCurrentShape" || message.commandId === "bakeBaseShape") {
          void executeModulePreviewBake(message.commandId, {
            emitSkippedComments: message.emitSkippedComments ?? true,
            includeHiddenGeometry: message.includeHiddenGeometry ?? false,
            includeDisabledGeometry: message.includeDisabledGeometry ?? false
          });
          return;
        }
        executeSharedCanvasCommand(message.commandId);
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      rustTransport.dispose();
    };
  }, [api, applySessionSnapshot, clearEphemeralPreview, clearPendingModelPatch, compileTargetAt, executeModulePreviewBake, executeSharedCanvasCommand, previewSession, publishParameterSnapshot, publishParameterUnavailable, rustTransport]);

  const selectElement = useCallback<CanvasHostAdapter["selectElement"]>((elementId, selectionMode) => {
    const before = canvasSelectionSnapshot();
    const selection = canvasSelectionForElement(renderElements, before, elementId, selectionMode);
    if (!selection) return;
    useCadUiStore.getState().applySelection(renderElements, selection);
  }, [renderElements]);

  const previewCanvasSelection = useCallback<CanvasHostAdapter["previewCanvasSelection"]>((before, elementId, selectionMode) => {
    const selection = canvasSelectionForElement(renderElements, before, elementId, selectionMode);
    if (!selection) return;
    useCadUiStore.getState().applySelection(renderElements, selection);
  }, [renderElements]);

  const commitCanvasRectangleSelection = useCallback<CanvasHostAdapter["commitCanvasRectangleSelection"]>((memberIds, mode) => {
    const selection = canvasRectangleSelectionForMembers(
      renderElements,
      canvasSelectionSnapshot(),
      memberIds,
      mode
    );
    if (!selection) return;
    useCadUiStore.getState().applySelection(renderElements, selection);
  }, [renderElements]);

  const ribbonCommandContext = useMemo(() => ({
    hasSelection: selectedElementIds.length > 0,
    showCanvasPointNames,
    showCanvasGeometryNames,
    showCanvasPoints
  }), [selectedElementIds.length, showCanvasGeometryNames, showCanvasPointNames, showCanvasPoints]);

  const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
    elements: renderElements,
    canonicalElements: preview?.root.compileResult.elements ?? [],
    runtimeElementIds: preview ? new Set(preview.root.targetRuntimeElementIds) : new Set(),
    evaluationLimitIndex: undefined,
    compiledDocumentRevision: preview?.revision ?? 0,
    canvasTheme,
    visibilityProfiles: preview?.root.compileResult.visibilityProfiles ?? [],
    activeVisibilityProfileId: preview?.root.compileResult.activeVisibilityProfileId ?? null,
    moduleSemanticContext: preview?.moduleSemanticContext ?? {},
    measureCanvasTextWidth,
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId,
    canvasViewport,
    showCanvasPointNames,
    showCanvasGeometryNames,
    showCanvasPoints,
    renderFixedCanvasChrome: false,
    canvasContextMenuData: vscodeCanvasContextDataFor("blank", selectedElementIds.length > 0),
    publishCanvasContextMenu: ({ kind }) => {
      const viewport = canvasFocusRef.current;
      if (!viewport) return;
      viewport.dataset.vscodeContext = vscodeCanvasContextDataFor(
        kind,
        useCadUiStore.getState().selectedElementIds.length > 0
      );
    },
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    commandLineSession: null,
    flushSourceEditorOnCanvasPointerDown: () => "clean",
    setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
    focusSourceEditor: () => undefined,
    getCurrentCanonicalDocument: () => {
      captureDragProof();
      const document = automationDocumentRef.current;
      return {
        elements: preview?.root.compileResult.elements ?? [],
        sourceRevision: document?.getState().currentCompiled.spans.sourceMap.sourceRevision ?? 0,
        compiledDocumentRevision: preview?.revision ?? 0,
        sourceText: document?.getSource() ?? "",
        docText: document?.getSource() ?? ""
      };
    },
    panCanvasViewport: (dx, dy) => useCadUiStore.getState().panCanvasViewport(dx, dy),
    zoomCanvasViewportAt: (zoomFactor, anchor) => useCadUiStore.getState().zoomCanvasViewportAt(zoomFactor, anchor),
    selectElement,
    getCanvasSelectionSnapshot: canvasSelectionSnapshot,
    previewCanvasSelection,
    finalizeCanvasSelectionSession: () => undefined,
    commitCanvasRectangleSelection,
    clearCanvasSelection: () => useCadUiStore.getState().clearElementSelection(),
    movePointElementByDelta: (action) => action.commitMode === "preview"
      ? dispatchPreviewGeometry(action)
      : dispatchCommitGeometry(action),
    moveBezierHandleByDelta: (action) => action.commitMode === "preview"
      ? dispatchPreviewGeometry(action)
      : dispatchCommitGeometry(action),
    applyPickedNumericReference: () => undefined,
    applyNumericExpressionReference: () => undefined,
    applyPickedLine: () => undefined,
    applyPickedPoint: () => undefined,
    toggleCanvasPointNames: () => executeSharedCanvasCommand("toggleCanvasPointNames"),
    toggleCanvasGeometryNames: () => executeSharedCanvasCommand("toggleCanvasGeometryNames"),
    toggleCanvasPoints: () => executeSharedCanvasCommand("toggleCanvasPoints"),
    resolveImageSourceUrl: (sourcePath) => sourcePath,
      renderHostOverlay: (viewportSize) => (
        <>
          {modulePreviewReferencePickSession ? (
            <VSCodeReferencePickOverlay
              canvasFocusRef={canvasFocusRef}
              viewportSize={viewportSize}
              canvasViewport={canvasViewport}
              canvasTheme={canvasTheme}
              elements={evaluationElements}
              evaluation={evaluationState.evaluation}
              visibilityProfiles={preview?.root.compileResult.visibilityProfiles ?? []}
              activeVisibilityProfileId={preview?.root.compileResult.activeVisibilityProfileId ?? null}
              session={modulePreviewReferencePickSession}
              onHover={setModulePreviewReferencePickHover}
              onSelect={selectModulePreviewReferencePick}
              onConfirm={confirmModulePreviewReferencePick}
              onCancel={cancelModulePreviewReferencePick}
            />
          ) : null}
          <VSCodeCanvasRibbonOverlay
            canvasFocusRef={canvasFocusRef}
            canvasViewport={canvasViewport}
            canvasRibbonRibbons={canvasRibbonRibbons}
            viewportSize={viewportSize}
            ribbonCommandContext={ribbonCommandContext}
            onCommand={(item) => {
              const definition = vscodeCanvasRibbonCommandFor(item.commandId);
              if (!definition || !definition.isAvailable(ribbonCommandContext)) return;
              if (definition.hostAction === "editCanvasRibbon") {
                api.postMessage({ type: "editCanvasRibbon" });
                return;
              }
              if (definition.sharedCommandId) executeSharedCanvasCommand(definition.sharedCommandId);
            }}
            onPositionCommit={(ribbonId, position) => api.postMessage({
              type: "canvasRibbonPositionCommit",
              ribbonId,
              x: position.x,
              y: position.y
            })}
          />
        </>
      )
  }), [
    api,
    canvasRibbonRibbons,
    canvasTheme,
    canvasViewport,
    captureDragProof,
    dispatchCommitGeometry,
    executeSharedCanvasCommand,
    evaluationElements,
    evaluationState.evaluation,
    modulePreviewReferencePickSession,
    setModulePreviewReferencePickHover,
    selectModulePreviewReferencePick,
    confirmModulePreviewReferencePick,
    cancelModulePreviewReferencePick,
    measureCanvasTextWidth,
    preview,
    dispatchPreviewGeometry,
    previewCanvasSelection,
    commitCanvasRectangleSelection,
    renderElements,
    ribbonCommandContext,
    selectElement,
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId,
    showCanvasGeometryNames,
    showCanvasPointNames,
    showCanvasPoints
  ]);

  return (
    <main className="canvas-workspace" style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {preview ? (
        <DrawingCanvas
          ref={drawingCanvasRef}
          evaluation={evaluationState.evaluation}
          evaluationState={evaluationState}
          canvasFocusRef={canvasFocusRef}
          hostAdapter={hostAdapter}
        />
      ) : null}
      {statusMessages.length > 0 ? (
        <div
          role="status"
          data-module-preview-status="true"
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            maxWidth: "min(560px, calc(100vw - 24px))",
            padding: "8px 10px",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: 4,
            background: "var(--vscode-editorWidget-background)",
            color: "var(--vscode-editorWidget-foreground)",
            fontSize: 12,
            pointerEvents: "none"
          }}
        >
          {statusMessages.map((message, index) => <div key={`${index}:${message}`}>{message}</div>)}
        </div>
      ) : null}
      {!preview ? (
        <div
          data-module-preview-empty="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--vscode-descriptionForeground)"
          }}
        >
          No valid Module Preview
        </div>
      ) : null}
    </main>
  );
};
