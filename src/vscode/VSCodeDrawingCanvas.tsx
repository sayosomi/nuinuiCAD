import { canvasImageSourceUrl } from "./canvasImageResources";
import type { VscodeCanvasGraphCommitAuthority, VscodeCanvasImageResources } from "./protocol";
import type { RefObject } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext, CommandId } from "../commands/commandTypes";
import { commitCanvasRectangleSelection } from "../commands/canvasRectangleSelectionCommands";
import {
  canvasSelectionSnapshot,
  canvasSelectionForElement,
  finalizeCanvasSelectionSession,
  previewCanvasSelection,
  resolveOwningModuleInstanceId
} from "../commands/selectionCommands";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import {
  evaluationStateIsCurrentFor,
  type EvaluationEngineState
} from "../geometry/useEvaluationEngine";
import {
  effectiveCompiledDocument,
  effectiveElements,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ElementId, EvaluationResult, ForGroupGeneratedRow } from "../types/geometry";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import { DrawingCanvas } from "../components/DrawingCanvas";
import { CanvasModeStatus } from "../components/CanvasModeStatus";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type {
  CanvasHostAdapter,
  CanvasPointDragAction,
  CanvasBezierHandleDragAction,
  CanvasPointPickAction
} from "../components/canvasHostAdapter";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";
import type { VscodeWebviewPresentation } from "./webviewPresentation";
import { useRevisionCoherentCanvasPresentation } from "../components/canvasRevisionPresentation";
import { buildModuleModelPatch, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { projectIncompleteReferencePickCandidate, projectIndependentReferencePickBrowseCandidate } from "./referencePickCandidateProjection";
import { referencePickCanvasEvaluationFor } from "./referencePickCanvasSession";
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";
import type { VscodeCanvasRibbonPositions } from "./vscodeCanvasRibbonConfig";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";
import { VSCodeReferencePickModeStatus } from "./VSCodeReferencePickModeStatus";
import { CommandLineBar } from "../components/CommandLineBar";
import { PickModeStatus } from "../components/PickModeStatus";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type { CommandRibbonPresentationActionItem } from "../components/CommandRibbonView";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";
import {
  DEFAULT_CANVAS_GRID_SETTINGS,
  type CanvasGridSettings
} from "../components/canvasGrid";
import { vscodeCanvasContextDataFor, type VscodeCanvasPointer } from "./protocol";
import {
  useVSCodeReferencePickSession,
  type VscodeReferencePickAuthorityFor,
  type VscodeReferencePickCurrentContext
} from "./useVSCodeReferencePickSession";
import type { VscodeReferencePickStartRequest } from "./referencePickProtocol";
import {
  useVSCodeCoordinatePointConversionSession,
  type VscodeCoordinatePointConversionAuthority,
  type VscodeCoordinatePointConversionCurrentContext
} from "./useVSCodeCoordinatePointConversionSession";
import { coordinatePointConversionTargetEligibility } from "../commands/coordinatePointConversion";
import {
  coordinatePointConversionBaseKeyForPick,
  isCoordinatePointConversionPickTarget
} from "./coordinatePointConversionPick";
import { vscodeWebviewApi } from "./vscodeWebviewApiContext";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";
import { projectCanvasLayerPresentation } from "../model/canvasLayerPresentation";
import { CanvasLayerPanel } from "../components/CanvasLayerPanel";
import {
  canvasModalCanvasCommandAllowed,
  canvasModalCanvasOperationAllowed,
  canvasModalModeFor
} from "./pickModeCanvasPolicy";
import {
  activatePickModeDraftEntry,
  matchingPickModeSessionForTargets,
  pickModeDraftEntryForOption
} from "../model/pickModeSession";

const EMPTY_IMAGE_RESOURCES: VscodeCanvasImageResources = {};
const NO_RUNTIME_ONLY_ELEMENTS: ReadonlySet<ElementId> = new Set();
const EMPTY_CANVAS_EVALUATION = emptyEvaluationResult([]);

type VSCodeDrawingCanvasProps = {
  imageResources?: VscodeCanvasImageResources;
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  postCanonicalSourceText: (
    sourceText: string,
    operationId?: number,
    graphAuthority?: VscodeCanvasGraphCommitAuthority
  ) => void;
  postCanvasCommit?: (operationId?: number, coordinatePointConversionRequestId?: number) => void;
  postCanvasPointerPosition?: (pointer: VscodeCanvasPointer) => void;
  canvasTheme?: CanvasTheme;
  canvasGridSettings?: CanvasGridSettings;
  canvasRibbonPositions?: VscodeCanvasRibbonPositions;
  onCanvasRibbonPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  onToggleCanvasGrid?: () => void;
  onConfigureCanvasGrid?: () => void;
  onToggleCanvasGridSnap?: () => void;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
  multiDocumentRuntimePresentation?: VscodeMultiDocumentCanvasRuntimePresentation | null;
  staleCanvasPresentation?: {
    status: "loading" | "ready" | "failed";
    currentGraphRevision: number;
    currentSourceRevision: number;
    lastGoodGraphRevision: number;
    lastGoodSourceRevision: number;
  } | null;
  hostRootDocumentId?: string | null;
  hostDocumentEpoch?: number;
  awaitingHostGraph?: boolean;
  webviewPresentation?: VscodeWebviewPresentation | null;
  currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
  evaluateReferencePickCandidate?: (compiled: LastGoodDslDocument) => Promise<EvaluationResult>;
  currentCoordinatePointConversionAuthorityFor?: (
    expectedDocumentVersion: number
  ) => VscodeCoordinatePointConversionAuthority | null;
  coordinatePointCreationActive?: boolean;
  onFinishCoordinatePointCreation?: () => void;
  postCoordinatePointCreationClick?: (pointer: VscodeCanvasPointer) => void;
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const mutationWasApplied = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "status" in value && value.status === "applied";

const mutationFeedbackMessage = (value: unknown): string | null =>
  typeof value === "object" && value !== null && "feedbackMessage" in value &&
  typeof value.feedbackMessage === "string"
    ? value.feedbackMessage
    : null;

export type VSCodeDrawingCanvasHandle = DrawingCanvasHandle & {
  isReferencePickActive: () => boolean;
  fitDrawing: () => void;
};

export const VSCodeDrawingCanvas = forwardRef<VSCodeDrawingCanvasHandle, VSCodeDrawingCanvasProps>(
  function VSCodeDrawingCanvas({
    imageResources = EMPTY_IMAGE_RESOURCES,
    evaluation,
    evaluationState,
    canvasFocusRef,
    postCanonicalSourceText,
    postCanvasCommit,
    postCanvasPointerPosition,
    canvasTheme = LEGACY_CANVAS_THEME,
    canvasGridSettings = DEFAULT_CANVAS_GRID_SETTINGS,
    canvasRibbonPositions = {},
    onCanvasRibbonPositionCommit,
    onToggleCanvasGrid,
    onConfigureCanvasGrid,
    onToggleCanvasGridSnap,
    measureCanvasTextWidth,
    multiDocumentRuntimePresentation: runtimePresentation = null,
    staleCanvasPresentation = null,
    hostRootDocumentId = runtimePresentation?.rootDocumentId,
    hostDocumentEpoch = 0,
    awaitingHostGraph = false,
    webviewPresentation = null,
    currentReferencePickAuthorityFor,
    evaluateReferencePickCandidate,
    currentCoordinatePointConversionAuthorityFor,
    coordinatePointCreationActive = false,
    onFinishCoordinatePointCreation,
    postCoordinatePointCreationClick
  }, ref) {
    const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
    const runtimePresentationForRoot = runtimePresentation?.rootDocumentId === hostRootDocumentId
      ? runtimePresentation
      : null;
    const referencePickActiveRef = useRef(false);
    const nextSourceCommitOperationIdRef = useRef(-1);
    const preparedGraphCommitAuthorityRef = useRef<{
      elementId: ElementId;
      authority: VscodeCanvasGraphCommitAuthority;
    } | null>(null);
    const ownedDragPreviewElementsRef = useRef<CadElement[] | null>(null);
    const elements = useCadDocumentStore(effectiveElements);
    const canonicalElements = useCadDocumentStore((state) => state.elements);
    const compiledDocument = useCadDocumentStore(effectiveCompiledDocument);
    const sourceText = useCadDocumentStore((state) => state.sourceText);
    const sourceMatchesLastGoodDocument = useCadDocumentStore((state) => state.sourceText === state.docText);
    const sourceMutationRevision = useCadDocumentStore((state) => state.sourceRevision);
    const currentSourceRevision = useCadDocumentStore((state) => state.currentSourceRevision);
    const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
    const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
    const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
    const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
    const moduleMaterialization = useCadDocumentStore((state) => state.doc.moduleMaterialization);
    const moduleSemanticAnalysis = useCadDocumentStore((state) => state.doc.moduleSemanticAnalysis);
    const sourceLexicalNamespace = useCadDocumentStore((state) => state.doc.sourceLexicalNamespace);
    const statementInfoByElementId = useCadDocumentStore((state) => state.doc.statementMap?.byElementId);
    const holdLastStableCanvasPresentation = useCadDocumentStore((state) =>
      state.sourceUpdate.kind === "editor" && (
        state.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
        state.bindingIssueDiagnostics.some((diagnostic) => diagnostic.severity === "error")
      )
    );
    const selectedElementId = useCadUiStore((state) => state.selectedElementId);
    const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
    const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);
    const canvasViewport = useCadUiStore((state) => state.canvasViewport);
    const showCanvasPointNames = useCadUiStore((state) => state.showCanvasPointNames);
    const showCanvasGeometryNames = useCadUiStore((state) => state.showCanvasGeometryNames);
    const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
    const showCanvasDirectionArrows = useCadUiStore((state) => state.showCanvasDirectionArrows);
    const hiddenCanvasLayerIds = useCadUiStore((state) => state.hiddenCanvasLayerIds);
    const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
    const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
    const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
    const activePickModeSession = useCadUiStore((state) => state.activePickModeSession);
    const commandLineSession = useCadUiStore((state) => state.commandLineSession);
    const rootOnlySourceEditing = runtimePresentationForRoot?.sourceEditing;
    const rootOnlySourceElementIds = new Set(rootOnlySourceEditing?.compiled.document.elements.map((element) => element.id) ?? []);
    const rootOnlyRuntimeElementIds = new Set(runtimePresentationForRoot?.elements.map((element) => element.id) ?? []);
    const rootOnlySourceAuthorityIsCurrent = Boolean(
      runtimePresentationForRoot?.rootOnly &&
      rootOnlySourceEditing &&
      rootOnlySourceEditing.sourceText.replace(/\r\n/g, "\n") === sourceText.replace(/\r\n/g, "\n") &&
      rootOnlySourceEditing.sourceRevision === runtimePresentationForRoot.rootSourceRevision &&
      rootOnlySourceEditing.compiled.spans.sourceMap.source === rootOnlySourceEditing.sourceText &&
      rootOnlySourceEditing.compiled.spans.sourceMap.sourceRevision === rootOnlySourceEditing.sourceRevision &&
      rootOnlySourceEditing.compiled.statementMap.sourceRevision === rootOnlySourceEditing.sourceRevision &&
      rootOnlySourceElementIds.size === rootOnlyRuntimeElementIds.size &&
      [...rootOnlyRuntimeElementIds].every((elementId) => rootOnlySourceElementIds.has(elementId))
    );
    const rejectedRootOnlyPresentation = Boolean(
      runtimePresentation?.rootOnly && (!runtimePresentationForRoot || !rootOnlySourceAuthorityIsCurrent)
    );
    const multiDocumentRuntimePresentation = runtimePresentationForRoot && (
      !runtimePresentationForRoot.rootOnly || rootOnlySourceAuthorityIsCurrent
    ) ? runtimePresentationForRoot : null;
    const stalePresentationIsCurrent = Boolean(
      staleCanvasPresentation?.status === "ready" &&
      multiDocumentRuntimePresentation &&
      multiDocumentRuntimePresentation.graphRevision === staleCanvasPresentation.lastGoodGraphRevision &&
      multiDocumentRuntimePresentation.rootSourceRevision === staleCanvasPresentation.lastGoodSourceRevision &&
      multiDocumentRuntimePresentation.rootDocumentId === hostRootDocumentId &&
      (staleCanvasPresentation.currentGraphRevision > staleCanvasPresentation.lastGoodGraphRevision ||
        staleCanvasPresentation.currentSourceRevision > staleCanvasPresentation.lastGoodSourceRevision)
    );
    const rejectedGraphPresentation = Boolean(
      runtimePresentation && (!runtimePresentationForRoot || rejectedRootOnlyPresentation)
    );
    const runtimeOnlyElementIds = useMemo(() => {
      if (!multiDocumentRuntimePresentation) {
        return sourceMatchesLastGoodDocument
          ? NO_RUNTIME_ONLY_ELEMENTS
          : new Set(canonicalElements.map((element) => element.id));
      }
      const sourceEditing = multiDocumentRuntimePresentation.sourceEditing;
      if (sourceEditing) {
        if (
          sourceEditing.sourceText.replace(/\r\n/g, "\n") !== sourceText.replace(/\r\n/g, "\n") ||
          sourceEditing.sourceRevision !== multiDocumentRuntimePresentation.rootSourceRevision ||
          sourceEditing.compiled.spans.sourceMap.source !== sourceEditing.sourceText ||
          sourceEditing.compiled.spans.sourceMap.sourceRevision !== sourceEditing.sourceRevision ||
          sourceEditing.compiled.statementMap.sourceRevision !== sourceEditing.sourceRevision
        ) return new Set(multiDocumentRuntimePresentation.elements.map((element) => element.id));
        return new Set(multiDocumentRuntimePresentation.elements.flatMap((element) => {
          const owner = sourceOwnerForRuntimeElementId(sourceEditing.compiled, element.id);
          return owner?.kind === "ordinary" ? [] : [element.id];
        }));
      }
      const canonicalIds = new Set(canonicalElements.map((element) => element.id));
      return new Set(multiDocumentRuntimePresentation.elements
        .filter((element) => !canonicalIds.has(element.id))
        .map((element) => element.id));
    }, [canonicalElements, multiDocumentRuntimePresentation, sourceMatchesLastGoodDocument, sourceText]);
    const presentationCompiledDocumentRevision = multiDocumentRuntimePresentation?.graphRevision ?? compiledDocumentRevision;
    const graphSourceEditing = multiDocumentRuntimePresentation?.sourceEditing;
    const graphSourceEditingIsCurrent = Boolean(
      !staleCanvasPresentation &&
      multiDocumentRuntimePresentation && graphSourceEditing &&
      graphSourceEditing.sourceText.replace(/\r\n/g, "\n") === sourceText.replace(/\r\n/g, "\n") &&
      graphSourceEditing.sourceRevision === multiDocumentRuntimePresentation.rootSourceRevision &&
      graphSourceEditing.compiled.spans.sourceMap.source === graphSourceEditing.sourceText &&
      graphSourceEditing.compiled.spans.sourceMap.sourceRevision === graphSourceEditing.sourceRevision &&
      graphSourceEditing.compiled.statementMap.sourceRevision === graphSourceEditing.sourceRevision
    );
    const currentGraphCommitAuthority = useMemo(() => graphSourceEditingIsCurrent && multiDocumentRuntimePresentation
      ? {
          rootDocumentId: multiDocumentRuntimePresentation.rootDocumentId,
          graphRevision: multiDocumentRuntimePresentation.graphRevision
        }
      : undefined, [graphSourceEditingIsCurrent, multiDocumentRuntimePresentation]);
    const postCanvasSourceText = useCallback((
      nextSourceText: string,
      operationId?: number,
      graphAuthority?: VscodeCanvasGraphCommitAuthority
    ) => {
      if (staleCanvasPresentation) {
        useCadUiStore.getState().setCommandErrorMessage(
          "Canvas editing is disabled while the displayed geometry is stale. Review Source diagnostics and restore a current graph first."
        );
        return;
      }
      if (rejectedRootOnlyPresentation) {
        useCadUiStore.getState().setCommandErrorMessage(
          "Canvas editing was rejected because the Host Source or graph authority is no longer current."
        );
        return;
      }
      const authority = graphAuthority ?? currentGraphCommitAuthority;
      if (authority) return postCanonicalSourceText(nextSourceText, operationId, authority);
      if (operationId !== undefined) return postCanonicalSourceText(nextSourceText, operationId);
      return postCanonicalSourceText(nextSourceText);
    },
    [currentGraphCommitAuthority, postCanonicalSourceText, rejectedRootOnlyPresentation, staleCanvasPresentation]);
    const graphRuntimeElementIds = useMemo(
      () => new Set(multiDocumentRuntimePresentation?.elements.map((element) => element.id) ?? []),
      [multiDocumentRuntimePresentation]
    );
    const graphRuntimeImageIds = useMemo(
      () => new Set(multiDocumentRuntimePresentation?.elements
        .filter((element) => element.type === "image")
        .map((element) => element.id) ?? []),
      [multiDocumentRuntimePresentation]
    );
    const graphImageRowsByGeneratedId = useMemo(() => {
      const graph = multiDocumentRuntimePresentation;
      if (
        !graph ||
        !evaluationState ||
        evaluationState.evaluation !== evaluation ||
        evaluationState.evaluationRevision !== graph.graphRevision ||
        !evaluationStateIsCurrentFor(evaluationState, graph.graphRevision) ||
        !Array.isArray(evaluation.forGroupGeneratedRows)
      ) return null;

      const rowsByGeneratedId = new Map<ElementId, ForGroupGeneratedRow[]>();
      for (const row of evaluation.forGroupGeneratedRows) {
        if (!row || typeof row.generatedElementId !== "string" || row.generatedElementId.length === 0) continue;
        const rows = rowsByGeneratedId.get(row.generatedElementId) ?? [];
        rows.push(row);
        rowsByGeneratedId.set(row.generatedElementId, rows);
      }
      return rowsByGeneratedId;
    }, [evaluation, evaluationState, multiDocumentRuntimePresentation]);
    const presentationEvaluationLimitIndex = multiDocumentRuntimePresentation
      ? multiDocumentRuntimePresentation.evaluationLimitIndex
      : evaluationLimitIndex;
    const presentationVisibilityProfiles = multiDocumentRuntimePresentation?.visibilityProfiles ?? visibilityProfiles;
    const presentationActiveVisibilityProfileId = multiDocumentRuntimePresentation?.activeVisibilityProfileId ?? activeVisibilityProfileId;
    const moduleSemanticContext = useMemo(() => ({
      moduleMaterialization,
      moduleSemanticAnalysis,
      sourceLexicalNamespace,
      statementInfoByElementId
    }), [moduleMaterialization, moduleSemanticAnalysis, sourceLexicalNamespace, statementInfoByElementId]);
    const commitMultiDocumentSourceElements = useCallback((nextElements: CadElement[]) => {
      const sourceEditing = multiDocumentRuntimePresentation?.sourceEditing;
      const current = useCadDocumentStore.getState();
      const reject = (feedbackMessage: string) => ({
        status: "rejected" as const,
        reason: "invalid-change" as const,
        feedbackMessage
      });
      if (
        staleCanvasPresentation ||
        !sourceEditing ||
        sourceEditing.sourceText.replace(/\r\n/g, "\n") !== sourceText.replace(/\r\n/g, "\n") ||
        sourceEditing.compiled.spans.sourceMap.source !== sourceEditing.sourceText ||
        sourceEditing.compiled.spans.sourceMap.sourceRevision !== sourceEditing.sourceRevision ||
        sourceEditing.compiled.statementMap.sourceRevision !== sourceEditing.sourceRevision ||
        sourceEditing.sourceRevision !== multiDocumentRuntimePresentation?.rootSourceRevision ||
        current.sourceRevision !== sourceMutationRevision ||
        current.sourceText !== sourceText
      ) {
        return reject(
          !sourceEditing
            ? "The current imported Source document is unavailable. Refresh the Canvas before editing."
            : "The Source text or revision no longer matches the imported Canvas graph. No Source edit was committed."
        );
      }

      const patch = buildModuleModelPatch({
        sourceText,
        docText: sourceEditing.sourceText,
        doc: sourceEditing.compiled as LastGoodDslDocument,
        diagnostics: [],
        bindingIssueDiagnostics: []
      }, {
        ...sourceEditing.compiled.document,
        elements: nextElements
      });
      if (patch.status === "noop") return { status: "noop" } as const;
      if (patch.status !== "ready") return reject(patch.reason);
      const previousCommandError = useCadUiStore.getState().commandErrorMessage;
      const result = current.commitAuthoritativeSourceSplices(
        { sourceText, sourceRevision: sourceMutationRevision },
        patch.splices
      );
      if (
        result.status === "rejected" &&
        useCadUiStore.getState().commandErrorMessage === previousCommandError
      ) {
        return {
          ...result,
          feedbackMessage: "The Source changed before the Canvas patch could be committed. No Source edit was committed."
        };
      }
      return result;
    }, [multiDocumentRuntimePresentation, sourceMutationRevision, sourceText, staleCanvasPresentation]);
    const resolveImageSourceUrl = useCallback(
      (sourcePath: string, elementId?: ElementId) => {
        const graph = multiDocumentRuntimePresentation;
        if (!graph) return canvasImageSourceUrl(sourcePath, imageResources);

        // Inline image sources carry no Host filesystem grant and remain valid
        // independently of graph ownership.
        const inlineSourceUrl = canvasImageSourceUrl(sourcePath, EMPTY_IMAGE_RESOURCES);
        if (inlineSourceUrl !== "data:,") return inlineSourceUrl;

        if (!elementId) return "data:,";

        let graphImageId = elementId;
        if (!graphRuntimeImageIds.has(graphImageId)) {
          if (!graphImageRowsByGeneratedId) return "data:,";
          const visited = new Set<ElementId>();
          while (!graphRuntimeImageIds.has(graphImageId)) {
            if (visited.has(graphImageId)) return "data:,";
            visited.add(graphImageId);
            const rows = graphImageRowsByGeneratedId.get(graphImageId);
            if (!rows || rows.length !== 1) return "data:,";
            const row = rows[0];
            if (
              row.elementType !== "image" ||
              row.generatedElementId !== graphImageId ||
              typeof row.templateElementId !== "string" ||
              row.templateElementId.length === 0 ||
              typeof row.forGroupId !== "string" ||
              row.forGroupId.length === 0 ||
              !Number.isInteger(row.iterationIndex) ||
              row.iterationIndex < 0 ||
              !Array.isArray(row.occurrencePath) ||
              typeof row.variableName !== "string" ||
              typeof row.variableValue !== "number" ||
              !Number.isFinite(row.variableValue) ||
              typeof row.elementName !== "string"
            ) return "data:,";
            graphImageId = row.templateElementId;
          }
        }

        if (!graphRuntimeElementIds.has(graphImageId)) return "data:,";
        const origins = graph.moduleMaterialization?.originByRuntimeElementId;
        if (!origins) return "data:,";
        if (origins.has(graphImageId)) {
          const origin = origins.get(graphImageId);
          if (!origin || origin.sourceDocumentId !== graph.rootDocumentId) return "data:,";
        }
        return canvasImageSourceUrl(sourcePath, imageResources);
      },
      [
        graphImageRowsByGeneratedId,
        graphRuntimeElementIds,
        graphRuntimeImageIds,
        imageResources,
        multiDocumentRuntimePresentation
      ]
    );
    const currentCanvasPresentation = useMemo(() => ({
      graphRootDocumentId: multiDocumentRuntimePresentation?.rootDocumentId,
      canvasModuleMaterialization: multiDocumentRuntimePresentation?.moduleMaterialization,
      resolveImageSourceUrl,
      elements: rejectedRootOnlyPresentation ? [] : multiDocumentRuntimePresentation?.elements ?? elements,
      canonicalElements: rejectedRootOnlyPresentation ? [] : multiDocumentRuntimePresentation?.elements ?? canonicalElements,
      compiledDocument: multiDocumentRuntimePresentation
        ? multiDocumentRuntimePresentation.sourceEditing?.compiled
        : rejectedRootOnlyPresentation ? undefined : compiledDocument,
      evaluationLimitIndex: presentationEvaluationLimitIndex,
      visibilityProfiles: presentationVisibilityProfiles,
      activeVisibilityProfileId: presentationActiveVisibilityProfileId,
      moduleSemanticContext,
      canvasLayerSourceDocuments: multiDocumentRuntimePresentation?.layerSourceDocuments ?? [],
      canvasLayerMaterialization: rejectedRootOnlyPresentation
        ? undefined
        : multiDocumentRuntimePresentation?.revealMaterialization ??
          (multiDocumentRuntimePresentation ? undefined : moduleMaterialization)
    }), [
      resolveImageSourceUrl,
      canonicalElements,
      compiledDocument,
      elements,
      presentationActiveVisibilityProfileId,
      presentationEvaluationLimitIndex,
      presentationVisibilityProfiles,
      multiDocumentRuntimePresentation,
      rejectedRootOnlyPresentation,
      moduleMaterialization,
      moduleSemanticContext,
    ]);
    const canvasPresentationAdapter = useMemo(
      () => webviewCanvasPresentationFor(webviewPresentation),
      [webviewPresentation]
    );
    const canvasPresentation = useRevisionCoherentCanvasPresentation({
      current: currentCanvasPresentation,
      evaluation: rejectedGraphPresentation ? EMPTY_CANVAS_EVALUATION : evaluation,
      compiledDocumentRevision: presentationCompiledDocumentRevision,
      evaluationState,
      holdLastStable: stalePresentationIsCurrent || (rejectedGraphPresentation && !rejectedRootOnlyPresentation) || (multiDocumentRuntimePresentation
        ? evaluationState?.evaluation !== evaluation || Boolean(graphSourceEditing && !graphSourceEditingIsCurrent)
        : holdLastStableCanvasPresentation),
      allowCoherentPinnedCurrent: stalePresentationIsCurrent,
      retainLastStable: !rejectedRootOnlyPresentation,
      scopeKey: hostRootDocumentId ? JSON.stringify([hostRootDocumentId, hostDocumentEpoch]) : undefined,
      awaitingGraph: awaitingHostGraph
    });
    const graphFramePinned = canvasPresentation.isPinned && Boolean(canvasPresentation.graphRootDocumentId);
    const commandEvaluation = graphFramePinned ? EMPTY_CANVAS_EVALUATION : canvasPresentation.renderEvaluation;
    const canvasLayerPresentation = useMemo(() => projectCanvasLayerPresentation({
      rootDocumentId: canvasPresentation.graphRootDocumentId,
      compiledDocument: canvasPresentation.compiledDocument,
      sourceDocuments: canvasPresentation.canvasLayerSourceDocuments,
      moduleMaterialization: canvasPresentation.canvasLayerMaterialization ??
        canvasPresentation.moduleSemanticContext.moduleMaterialization,
      elements: canvasPresentation.elements,
      evaluation: canvasPresentation.renderEvaluation,
      hiddenLayerIds: hiddenCanvasLayerIds
    }), [
      canvasPresentation.canvasLayerMaterialization,
      canvasPresentation.graphRootDocumentId,
      canvasPresentation.canvasLayerSourceDocuments,
      canvasPresentation.compiledDocument,
      canvasPresentation.elements,
      canvasPresentation.moduleSemanticContext.moduleMaterialization,
      canvasPresentation.renderEvaluation,
      hiddenCanvasLayerIds
    ]);
    const currentReferencePickContext = useCallback(() => {
      const state = useCadDocumentStore.getState();
      if (
        effectiveElements(state) !== elements ||
        state.compiledDocumentRevision !== compiledDocumentRevision ||
        state.sourceText !== sourceText ||
        state.currentSourceRevision !== currentSourceRevision
      ) return null;
      const normalizedSource = state.sourceText.replace(/\r\n/g, "\n");
      const effectiveCompiled = effectiveCompiledDocument(state);
      if (state.previewElements !== null && effectiveCompiled.spans.sourceMap.source !== normalizedSource) return null;
      const compiled = effectiveCompiled.spans.sourceMap.source === normalizedSource
        ? effectiveCompiled
        : state.currentCompiled;
      if (
        compiled.spans.sourceMap.source !== normalizedSource ||
        compiled.spans.sourceMap.sourceRevision !== state.currentSourceRevision
      ) return null;
      const evaluationIsCurrent = evaluationStateIsCurrentFor(
        canvasPresentation.renderEvaluationState,
        state.compiledDocumentRevision
      ) && canvasPresentation.compiledDocument === compiled;
      const canvasSnapshot = !evaluationIsCurrent &&
        canvasPresentation.isPinned &&
        !graphFramePinned &&
        canvasPresentation.hasCoherentSnapshot &&
        canvasPresentation.compiledDocument
        ? {
            source: {
              normalizedSource: canvasPresentation.compiledDocument.spans.sourceMap.source,
              sourceRevision: canvasPresentation.compiledDocument.spans.sourceMap.sourceRevision
            },
            compiled: canvasPresentation.compiledDocument,
            evaluation: canvasPresentation.renderEvaluation
          }
        : undefined;
      return {
        source: {
          normalizedSource,
          sourceRevision: compiled.spans.sourceMap.sourceRevision
        },
        compiled,
        evaluation: commandEvaluation,
        evaluationIsCurrent,
        ...(multiDocumentRuntimePresentation ? { graph: {
          rootDocumentId: multiDocumentRuntimePresentation.rootDocumentId,
          sourceRevision: multiDocumentRuntimePresentation.rootSourceRevision,
          graphRevision: multiDocumentRuntimePresentation.graphRevision,
          ready: evaluationStateIsCurrentFor(canvasPresentation.renderEvaluationState, multiDocumentRuntimePresentation.graphRevision),
          failed: canvasPresentation.renderEvaluationState?.status === "failed"
        } } : {}),
        ...(canvasSnapshot ? { canvasSnapshot } : {})
      };
    }, [
      multiDocumentRuntimePresentation,
      canvasPresentation.renderEvaluation,
      canvasPresentation.renderEvaluationState,
      canvasPresentation.hasCoherentSnapshot,
      canvasPresentation.isPinned,
      graphFramePinned,
      canvasPresentation.compiledDocument,
      commandEvaluation,
      compiledDocumentRevision,
      elements,
      sourceText,
      currentSourceRevision
    ]);
    const prepareCandidateSnapshot = useCallback(async (
      request: VscodeReferencePickStartRequest,
      current: VscodeReferencePickCurrentContext
    ) => {
      if (!evaluateReferencePickCandidate) return null;
      const targetCandidate = projectIncompleteReferencePickCandidate({ ...current, request });
      let compiled = targetCandidate ?? projectIndependentReferencePickBrowseCandidate(current);
      if (!compiled) return null;
      let evaluation = await evaluateReferencePickCandidate(compiled);
      let browseOnly = !targetCandidate;
      if (evaluation.errors.length && targetCandidate) {
        compiled = projectIndependentReferencePickBrowseCandidate({ ...current, evaluation, evaluationIsCurrent: true });
        if (!compiled) return null;
        evaluation = await evaluateReferencePickCandidate(compiled);
        browseOnly = true;
      }
      if (evaluation.errors.length) return null;
      return {
        source: {
          normalizedSource: compiled.spans.sourceMap.source,
          sourceRevision: compiled.spans.sourceMap.sourceRevision
        },
        compiled,
        evaluation,
        ...(browseOnly ? { browseOnly: true as const } : {}),
        ...(targetCandidate && request.targetProof && request.targetProof.range.from === request.targetProof.range.to &&
          compiled.spans.sourceMap.source === current.source.normalizedSource.slice(0, request.targetProof.range.from) + "end" + current.source.normalizedSource.slice(request.targetProof.range.to)
          ? { temporaryExtract: true as const } : {})
      };
    }, [evaluateReferencePickCandidate]);
    const {
      session: referencePickSession,
      candidateSnapshot: referencePickCandidateSnapshot,
      setHover: setReferencePickHover,
      select: selectReferencePick,
      selectNumericProperty: selectReferencePickNumericProperty,
      moveDraftEntry: moveReferencePickDraftEntry,
      removeDraftEntry: removeReferencePickDraftEntry,
      confirm: confirmReferencePick,
      browse: browseReferencePick,
      copy: copyReferencePick,
      insert: insertReferencePick,
      cancel: cancelReferencePick
    } = useVSCodeReferencePickSession({
      api: vscodeWebviewApi(),
      currentContextFor: currentReferencePickContext,
      currentReferencePickAuthorityFor,
      canvasLayerPresentation,
      ...(evaluateReferencePickCandidate ? { prepareCandidateSnapshot } : {}),
      canStart: () => !staleCanvasPresentation && !coordinatePointCreationActive && !(
        useCadUiStore.getState().activePickModeSession || referencePickActiveRef.current
      )
    });
    referencePickActiveRef.current = referencePickSession !== null;
    const effectivePickModeActive = Boolean(activePickModeSession || referencePickSession);
    const canvasModalMode = canvasModalModeFor({
      pickModeActive: effectivePickModeActive,
      coordinatePointCreationActive
    });
    const referencePickPresentationContext = referencePickSession
      ? currentReferencePickContext()
      : null;
    const currentCoordinatePointConversionContext = useCallback((): VscodeCoordinatePointConversionCurrentContext | null => {
      const state = useCadDocumentStore.getState();
      if (
        state.previewElements !== null ||
        effectiveElements(state) !== elements ||
        state.compiledDocumentRevision !== compiledDocumentRevision ||
        state.sourceText !== sourceText ||
        state.currentSourceRevision !== currentSourceRevision
      ) return null;
      const compiled = state.doc;
      const normalizedSource = normalizedSourceFor(state.sourceText);
      if (
        compiled.spans.sourceMap.source !== normalizedSource ||
        compiled.spans.sourceMap.sourceRevision !== state.currentSourceRevision ||
        state.docText !== state.sourceText
      ) return null;
      return {
        document: {
          sourceText: state.sourceText,
          doc: state.doc,
          docText: state.docText,
          diagnostics: state.diagnostics,
          bindingIssueDiagnostics: state.bindingIssueDiagnostics,
          typedDependencyGraph: state.typedDependencyGraph
        },
        source: {
          normalizedSource,
          sourceRevision: state.currentSourceRevision
        },
        evaluation: commandEvaluation,
        evaluationIsCurrent: evaluationStateIsCurrentFor(
          canvasPresentation.renderEvaluationState,
          state.compiledDocumentRevision
        )
      };
    }, [canvasPresentation.renderEvaluationState, commandEvaluation, compiledDocumentRevision, currentSourceRevision, elements, sourceText]);
    const {
      session: coordinatePointConversionSession,
      canvasBasePick: coordinatePointConversionCanvasBasePick,
      setQuery: setCoordinatePointConversionQuery,
      selectBase: selectCoordinatePointConversionBase,
      startPick: startCoordinatePointConversionPick,
      confirm: confirmCoordinatePointConversion,
      cancel: cancelCoordinatePointConversion
    } = useVSCodeCoordinatePointConversionSession({
      api: vscodeWebviewApi(),
      currentContextFor: currentCoordinatePointConversionContext,
      currentAuthorityFor: currentCoordinatePointConversionAuthorityFor ?? currentReferencePickAuthorityFor,
      postCanvasCommit: postCanvasCommit ?? (() => undefined),
      presentation: canvasPresentationAdapter,
      canStart: () => !staleCanvasPresentation && !coordinatePointCreationActive && !(
        useCadUiStore.getState().activePickModeSession || referencePickActiveRef.current
      )
    });
    const hasCoordinatePointConversionTarget = useMemo(() => {
      if (!evaluationStateIsCurrentFor(canvasPresentation.renderEvaluationState, compiledDocumentRevision)) return false;
      const state = useCadDocumentStore.getState();
      return selectedElementIds.some((elementId) => coordinatePointConversionTargetEligibility({
        document: {
          sourceText: state.sourceText,
          doc: state.doc,
          docText: state.docText,
          diagnostics: state.diagnostics,
          bindingIssueDiagnostics: state.bindingIssueDiagnostics,
          typedDependencyGraph: state.typedDependencyGraph
        },
        evaluation: canvasPresentation.renderEvaluation
      }, elementId).eligible);
    }, [canvasPresentation.renderEvaluation, canvasPresentation.renderEvaluationState, compiledDocumentRevision, selectedElementIds]);

    const ribbonCommandContext = useMemo(() => ({
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      showCanvasDirectionArrows,
      canvasGridEnabled: canvasGridSettings.enabled,
      canvasGridSpacingMm: canvasGridSettings.spacingMm,
      canvasGridMajorEvery: canvasGridSettings.majorEvery,
      canvasGridSnapEnabled: canvasGridSettings.snapEnabled,
      canvasGridSnapAvailable: true,
      pickModeActive: effectivePickModeActive,
      canvasModalMode
    }), [canvasGridSettings.enabled, canvasGridSettings.majorEvery, canvasGridSettings.spacingMm, canvasGridSettings.snapEnabled, canvasModalMode, effectivePickModeActive, showCanvasDirectionArrows, showCanvasGeometryNames, showCanvasPointNames, showCanvasPoints]);

    const dispatchSharedCanvasCommand = useCallback((commandId: CommandId) => {
      drawingCanvasRef.current?.finalizeCanvasInteraction();
      const pick = referencePickSession?.draft.status === "active" ? referencePickSession : null;
      const pickDocument = referencePickCandidateSnapshot?.compiled.document;
      const pickEvaluation = pick ? referencePickCanvasEvaluationFor(
        pick, referencePickCandidateSnapshot?.evaluation ?? canvasPresentation.renderEvaluation
      ) : undefined;
      dispatchCommand(commandId, {
        evaluation: pick ? pickEvaluation : commandId === "fitDrawing" ? canvasPresentation.renderEvaluation : evaluation,
        ...(commandId === "fitDrawing" ? {
          getCanvasFitDrawingPresentation: () => pick ? ({
            elements: pickDocument?.elements ?? canvasPresentation.elements,
            visibilityProfiles: pickDocument?.visibilityProfiles ?? canvasPresentation.visibilityProfiles,
            activeVisibilityProfileId: pickDocument?.activeVisibilityProfileId ?? canvasPresentation.activeVisibilityProfileId
          }) : ({
            elements: canvasPresentation.elements,
            visibilityProfiles: canvasPresentation.visibilityProfiles,
            activeVisibilityProfileId: canvasPresentation.activeVisibilityProfileId,
            canvasLayerPresentation
          })
        } : {}),
        getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
        measureCanvasTextWidth,
        recordSelectionHistory: true,
        finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
        focusCanvas: () => canvasFocusRef.current?.focus()
      });
      canvasFocusRef.current?.focus();
    }, [canvasFocusRef, canvasLayerPresentation, canvasPresentation, evaluation, measureCanvasTextWidth, referencePickCandidateSnapshot, referencePickSession]);

    const executeRibbonCommand = useCallback((item: CommandRibbonPresentationActionItem) => {
      const currentUiState = useCadUiStore.getState();
      if (!canvasModalCanvasCommandAllowed(item.commandId, canvasModalMode)) return;
      const definition = vscodeCanvasRibbonCommandFor(item.commandId);
      if (!definition || !definition.isAvailable({
        showCanvasPointNames: currentUiState.showCanvasPointNames,
        showCanvasGeometryNames: currentUiState.showCanvasGeometryNames,
        showCanvasPoints: currentUiState.showCanvasPoints,
        showCanvasDirectionArrows: currentUiState.showCanvasDirectionArrows,
        canvasGridEnabled: canvasGridSettings.enabled,
        canvasGridSpacingMm: canvasGridSettings.spacingMm,
        canvasGridMajorEvery: canvasGridSettings.majorEvery,
        canvasGridSnapEnabled: canvasGridSettings.snapEnabled,
        canvasGridSnapAvailable: true,
        pickModeActive: canvasModalMode !== null,
        canvasModalMode
      })) return;
      drawingCanvasRef.current?.finalizeCanvasInteraction();
      if (definition.hostAction === "toggleCanvasGrid") {
        onToggleCanvasGrid?.();
        return;
      }
      if (definition.hostAction === "configureCanvasGrid") {
        onConfigureCanvasGrid?.();
        return;
      }
      if (definition.hostAction === "toggleCanvasGridSnap") {
        onToggleCanvasGridSnap?.();
        return;
      }
      if (!definition.sharedCommandId) return;
      dispatchSharedCanvasCommand(definition.sharedCommandId);
    }, [canvasGridSettings.enabled, canvasGridSettings.majorEvery, canvasGridSettings.spacingMm, canvasGridSettings.snapEnabled, canvasModalMode, dispatchSharedCanvasCommand, onConfigureCanvasGrid, onToggleCanvasGrid, onToggleCanvasGridSnap]);

    const dispatchGeometryAction = useMemo(
      () => (action: CanvasPointDragAction | CanvasBezierHandleDragAction) => {
        if (graphFramePinned || runtimeOnlyElementIds.has(action.elementId)) return false;
        if (action.commitMode === "preview") {
          preparedGraphCommitAuthorityRef.current = currentGraphCommitAuthority
            ? { elementId: action.elementId, authority: currentGraphCommitAuthority }
            : null;
        }
        const commandContext = multiDocumentRuntimePresentation?.sourceEditing
          ? { ...action, commitCanvasSourceElements: commitMultiDocumentSourceElements }
          : action;
        const before = useCadDocumentStore.getState().previewElements;
        const result = dispatchCommand(
          "bezierHandleRole" in action ? "moveBezierHandleByDelta" : "movePointElementByDelta", commandContext
        );
        const after = useCadDocumentStore.getState().previewElements;
        if (action.commitMode === "preview" && multiDocumentRuntimePresentation && after !== before) {
          ownedDragPreviewElementsRef.current = after;
        }
        return result;
      },
      [commitMultiDocumentSourceElements, currentGraphCommitAuthority, graphFramePinned, multiDocumentRuntimePresentation, runtimeOnlyElementIds]
    );
    const dragPreviewScheduler = useMemo(
      () => new VscodeDragPreviewScheduler(dispatchGeometryAction),
      [dispatchGeometryAction]
    );
    const cancelHostDragPreview = useCallback(() => {
      dragPreviewScheduler.cancel();
      preparedGraphCommitAuthorityRef.current = null;
      const ownedElements = ownedDragPreviewElementsRef.current;
      ownedDragPreviewElementsRef.current = null;
      const document = useCadDocumentStore.getState();
      if (ownedElements && document.previewElements === ownedElements) document.clearPreviewDocumentChange();
    }, [dragPreviewScheduler]);

    const creationCommandContext = useMemo<CommandContext>(() => ({
      evaluation: commandEvaluation,
      evaluationIsCurrent: evaluationStateIsCurrentFor(
        canvasPresentation.renderEvaluationState,
        compiledDocumentRevision
      ),
      getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
      measureCanvasTextWidth,
      recordSelectionHistory: true,
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
      focusCanvas: () => canvasFocusRef.current?.focus(),
      clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
      clearSourceEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
      postCanonicalSourceText: postCanvasSourceText,
      completeCommandLineSession: true
    }), [canvasFocusRef, canvasPresentation.renderEvaluationState, commandEvaluation, compiledDocumentRevision, measureCanvasTextWidth, postCanvasSourceText]);

    useEffect(() => () => {
      dragPreviewScheduler.dispose();
      cancelHostDragPreview();
    }, [cancelHostDragPreview, dragPreviewScheduler]);
    useEffect(() => {
      if (!evaluationState) return;
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) dragPreviewScheduler.observeEvaluationState(evaluationState);
      });
      return () => {
        cancelled = true;
      };
    }, [dragPreviewScheduler, evaluationState]);

    const commitGeometryCommand = useMemo(() => ({
      movePointElementByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["movePointElementByDelta"]>>[0]) => {
        if (graphFramePinned || runtimeOnlyElementIds.has(action.elementId)) return false;
        const prepared = preparedGraphCommitAuthorityRef.current;
        const graphAuthority = prepared?.elementId === action.elementId
          ? prepared.authority
          : currentGraphCommitAuthority;
        if (prepared?.elementId === action.elementId) preparedGraphCommitAuthorityRef.current = null;
        const graphBacked = graphAuthority !== undefined || Boolean(multiDocumentRuntimePresentation?.sourceEditing);
        const previousCommandError = useCadUiStore.getState().commandErrorMessage;
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          if (graphBacked) {
            postCanvasSourceText(sourceText, nextSourceCommitOperationIdRef.current--, graphAuthority);
          } else {
            postCanvasSourceText(sourceText);
          }
        } else if (graphBacked &&
          !(typeof result === "object" && result !== null && "status" in result && result.status === "noop")) {
          const feedbackMessage = mutationFeedbackMessage(result);
          if (feedbackMessage) {
            useCadUiStore.getState().setCommandErrorMessage(feedbackMessage);
          } else if (useCadUiStore.getState().commandErrorMessage === previousCommandError) {
            useCadUiStore.getState().setCommandErrorMessage(
              "The Canvas edit was rejected because the current Source or imported graph changed. No Source edit was committed."
            );
          }
        }
        return result;
      },
      moveBezierHandleByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["moveBezierHandleByDelta"]>>[0]) => {
        if (graphFramePinned || runtimeOnlyElementIds.has(action.elementId)) return false;
        const prepared = preparedGraphCommitAuthorityRef.current;
        const graphAuthority = prepared?.elementId === action.elementId
          ? prepared.authority
          : currentGraphCommitAuthority;
        if (prepared?.elementId === action.elementId) preparedGraphCommitAuthorityRef.current = null;
        const graphBacked = graphAuthority !== undefined || Boolean(multiDocumentRuntimePresentation?.sourceEditing);
        const previousCommandError = useCadUiStore.getState().commandErrorMessage;
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          if (graphBacked) {
            postCanvasSourceText(sourceText, nextSourceCommitOperationIdRef.current--, graphAuthority);
          } else {
            postCanvasSourceText(sourceText);
          }
        } else if (graphBacked &&
          !(typeof result === "object" && result !== null && "status" in result && result.status === "noop")) {
          const feedbackMessage = mutationFeedbackMessage(result);
          if (feedbackMessage) {
            useCadUiStore.getState().setCommandErrorMessage(feedbackMessage);
          } else if (useCadUiStore.getState().commandErrorMessage === previousCommandError) {
            useCadUiStore.getState().setCommandErrorMessage(
              "The Canvas edit was rejected because the current Source or imported graph changed. No Source edit was committed."
            );
          }
        }
        return result;
      }
    }), [currentGraphCommitAuthority, dragPreviewScheduler, graphFramePinned, multiDocumentRuntimePresentation, postCanvasSourceText, runtimeOnlyElementIds]);

    const applyCoordinatePointConversionBasePick = useCallback((action: CanvasPointPickAction) => {
      const currentTarget = useCadUiStore.getState().activePointPickTarget;
      if (!coordinatePointConversionSession || !isCoordinatePointConversionPickTarget(currentTarget)) return false;
      const baseKey = coordinatePointConversionBaseKeyForPick({
        session: coordinatePointConversionSession,
        anchor: action.pickedPointAnchor,
        ...(action.pickedPointSourceReference
          ? { sourceReference: action.pickedPointSourceReference }
          : {})
      });
      const base = baseKey
        ? coordinatePointConversionSession.baseCandidates.find((candidate) => candidate.key === baseKey)
        : null;
      const pickModeSession = useCadUiStore.getState().activePickModeSession;
      if (!base || !pickModeSession || pickModeSession.kind !== "point" || pickModeSession.targetElementId === null ||
        !isCoordinatePointConversionPickTarget({
          elementId: pickModeSession.targetElementId,
          parameterKey: pickModeSession.targetParameterKey
        })) return false;
      const draftEntry = pickModeDraftEntryForOption(
        action.pickedPointCandidateElementId ?? base.sourceElementId,
        {
          kind: "point",
          label: "",
          anchor: action.pickedPointAnchor,
          ...(action.pickedPointSourceReference
            ? { sourceReference: action.pickedPointSourceReference }
            : {})
        }
      );
      useCadUiStore.setState({
        activePickModeSession: activatePickModeDraftEntry(pickModeSession, draftEntry),
        activePickCursor: null
      });
      return true;
    }, [coordinatePointConversionSession]);

    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      compiledDocument: canvasPresentation.compiledDocument,
      elements: canvasPresentation.elements,
      canonicalElements: canvasPresentation.canonicalElements,
      runtimeElementIds: runtimeOnlyElementIds,
      evaluationLimitIndex: canvasPresentation.evaluationLimitIndex,
      compiledDocumentRevision: presentationCompiledDocumentRevision,
      canvasTheme,
      canvasGridSettings,
      canvasModalMode,
      presentation: canvasPresentationAdapter,
      canvasLayerPresentation,
      visibilityProfiles: canvasPresentation.visibilityProfiles,
      activeVisibilityProfileId: canvasPresentation.activeVisibilityProfileId,
      moduleSemanticContext: canvasPresentation.moduleSemanticContext,
      canvasModuleMaterialization: canvasPresentation.canvasModuleMaterialization,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      canvasViewport,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      showCanvasDirectionArrows,
      spacePrimaryPanEnabled: true,
      renderFixedCanvasChrome: false,
      activePointPickTarget,
      activeNumericReferencePickTarget,
      activeLinePickTarget,
      activePickModeSession,
      commandLineSession,
      canvasContextMenuData: vscodeCanvasContextDataFor(
        "blank",
        selectedElementIds.length > 0,
        undefined,
        false,
        hasCoordinatePointConversionTarget,
        {
          showCanvasPointNames,
          showCanvasGeometryNames,
          showCanvasPoints,
          showCanvasDirectionArrows,
          canvasGridEnabled: canvasGridSettings.enabled,
          canvasGridSnapEnabled: canvasGridSettings.snapEnabled
        }
      ),
      publishCanvasPointerPosition: postCanvasPointerPosition,
      publishCanvasContextMenu: ({ kind, pointer }) => {
        const viewport = canvasFocusRef.current;
        if (!viewport) return;
        const currentSelection = useCadUiStore.getState();
        const canSelectInstance = !graphFramePinned && kind === "element" && resolveOwningModuleInstanceId({
          selectedElementId: currentSelection.selectedElementId,
          elements: canvasPresentation.elements,
          moduleMaterialization: multiDocumentRuntimePresentation?.moduleMaterialization ??
            canvasPresentation.moduleSemanticContext.moduleMaterialization
        }) !== null;
        viewport.dataset.vscodeContext = vscodeCanvasContextDataFor(
          kind,
          currentSelection.selectedElementIds.length > 0,
          pointer,
          canSelectInstance,
          hasCoordinatePointConversionTarget,
          {
            showCanvasPointNames: currentSelection.showCanvasPointNames,
            showCanvasGeometryNames: currentSelection.showCanvasGeometryNames,
            showCanvasPoints: currentSelection.showCanvasPoints,
            showCanvasDirectionArrows: currentSelection.showCanvasDirectionArrows,
            canvasGridEnabled: canvasGridSettings.enabled,
            canvasGridSnapEnabled: canvasGridSettings.snapEnabled
          }
        );
      },
      flushSourceEditorOnCanvasPointerDown: () => "clean",
      setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
      focusSourceEditor: () => undefined,
      getCurrentCanonicalDocument: () => {
        const state = useCadDocumentStore.getState();
        const graph = multiDocumentRuntimePresentation;
        const sourceEditing = graph?.sourceEditing;
        if (
          graph && sourceEditing &&
          sourceEditing.sourceText.replace(/\r\n/g, "\n") === state.sourceText.replace(/\r\n/g, "\n") &&
          sourceEditing.sourceRevision === graph.rootSourceRevision &&
          sourceEditing.compiled.spans.sourceMap.source === sourceEditing.sourceText &&
          sourceEditing.compiled.spans.sourceMap.sourceRevision === sourceEditing.sourceRevision &&
          sourceEditing.compiled.statementMap.sourceRevision === sourceEditing.sourceRevision
        ) {
          return {
            elements: graph.elements,
            sourceRevision: sourceEditing.sourceRevision,
            compiledDocumentRevision: graph.graphRevision,
            sourceText: state.sourceText,
            docText: sourceEditing.sourceText
          };
        }
        return {
          elements: state.elements,
          sourceRevision: state.sourceRevision,
          compiledDocumentRevision: state.compiledDocumentRevision,
          sourceText: state.sourceText,
          docText: state.docText
        };
      },
      panCanvasViewport: (dx, dy) => useCadUiStore.getState().panCanvasViewport(dx, dy),
      zoomCanvasViewportAt: (zoomFactor, anchor) => useCadUiStore.getState().zoomCanvasViewportAt(zoomFactor, anchor),
      selectElement: (elementId, selectionMode, recordHistory) => {
        if (graphFramePinned || !canvasModalCanvasOperationAllowed("normal-selection", canvasModalMode)) {
          return false;
        }
        if (multiDocumentRuntimePresentation) {
          const previousSelection = canvasSelectionSnapshot();
          const selection = canvasSelectionForElement(
            canvasPresentation.elements,
            previousSelection,
            elementId,
            selectionMode
          );
          if (!selection) return false;
          useCadUiStore.getState().applySelection(canvasPresentation.elements, selection);
          if (recordHistory) useCadDocumentStore.getState().recordCanvasSelection(previousSelection);
          useCadUiStore.getState().clearPickMode();
          return true;
        }
        return dispatchCommand("selectElement", {
          elementId,
          selectionMode,
          recordSelectionHistory: recordHistory ?? true
        });
      },
      getCanvasSelectionSnapshot: () => canvasSelectionSnapshot(),
      previewCanvasSelection: (previousSelection, elementId, selectionMode) =>
        graphFramePinned || !canvasModalCanvasOperationAllowed("normal-selection", canvasModalMode)
          ? false
          : multiDocumentRuntimePresentation
          ? previewCanvasSelection(previousSelection, elementId, selectionMode, canvasPresentation.elements)
          : previewCanvasSelection(previousSelection, elementId, selectionMode),
      finalizeCanvasSelectionSession: (previousSelection) =>
        canvasModalCanvasOperationAllowed("normal-selection", canvasModalMode)
          ? finalizeCanvasSelectionSession(previousSelection)
          : false,
      commitCanvasRectangleSelection: (memberIds, mode) =>
        graphFramePinned || !canvasModalCanvasOperationAllowed("rectangle-selection", canvasModalMode)
          ? false
          : multiDocumentRuntimePresentation
          ? commitCanvasRectangleSelection(memberIds, mode, true, canvasPresentation.elements)
          : commitCanvasRectangleSelection(memberIds, mode, true),
      clearCanvasSelection: () => canvasModalCanvasOperationAllowed("clear-selection", canvasModalMode)
        ? dispatchCommand("clearCanvasSelection", { recordSelectionHistory: true })
        : false,
      movePointElementByDelta: (action) => action.commitMode === "preview"
        ? graphFramePinned || !canvasModalCanvasOperationAllowed("point-drag", canvasModalMode)
          ? false
          : runtimeOnlyElementIds.has(action.elementId) ? false : dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : !graphFramePinned && canvasModalCanvasOperationAllowed("point-drag", canvasModalMode)
          ? commitGeometryCommand.movePointElementByDelta(action)
          : false,
      moveBezierHandleByDelta: (action) => action.commitMode === "preview"
        ? graphFramePinned || !canvasModalCanvasOperationAllowed("bezier-drag", canvasModalMode)
          ? false
          : runtimeOnlyElementIds.has(action.elementId) ? false : dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : !graphFramePinned && canvasModalCanvasOperationAllowed("bezier-drag", canvasModalMode)
          ? commitGeometryCommand.moveBezierHandleByDelta(action)
          : false,
      applyPickedNumericReference: (numericReferenceExpression, candidateElementId) => graphFramePinned ? false : dispatchCommand("applyPickedNumericReference", {
        ...creationCommandContext,
        numericReferenceExpression,
        ...(candidateElementId ? { numericReferenceCandidateElementId: candidateElementId } : {})
      }),
      applyNumericExpressionReference: (action) => graphFramePinned ? false : dispatchCommand("applyNumericExpressionReference", action),
      applyPickedLine: (action) => graphFramePinned ? false : dispatchCommand("applyPickedLine", {
        ...creationCommandContext,
        ...action
      }),
      applyPickedPoint: (action) => {
        if (graphFramePinned) return false;
        const currentTarget = useCadUiStore.getState().activePointPickTarget;
        if (coordinatePointConversionSession && isCoordinatePointConversionPickTarget(currentTarget)) {
          applyCoordinatePointConversionBasePick(action);
          return;
        }
        return dispatchCommand("applyPickedPoint", {
          ...creationCommandContext,
          ...action
        });
      },
      dispatchCanvasPickCommand: (commandId, pointPickAction, pickCandidateAuthority) => {
        if (graphFramePinned) return false;
        const currentTarget = useCadUiStore.getState().activePointPickTarget;
        const coordinatePointConversionCanvasBasePick = coordinatePointConversionSession &&
          isCoordinatePointConversionPickTarget(currentTarget);
        if (coordinatePointConversionCanvasBasePick && commandId === "applySelectedPickCandidate" && pointPickAction) {
          return applyCoordinatePointConversionBasePick(pointPickAction);
        }
        const commandContext = pickCandidateAuthority
          ? { ...creationCommandContext, pickCandidateAuthority }
          : creationCommandContext;
        if (!coordinatePointConversionCanvasBasePick || commandId !== "finishPickMode") {
          return dispatchCommand(commandId, commandContext);
        }

        const draft = useCadUiStore.getState().activePickModeSession?.draft ?? [];
        const result = dispatchCommand(commandId, commandContext);
        if (!result) return result;
        const entry = draft.find((candidate) => candidate.kind === "point");
        if (!entry || entry.kind !== "point") return result;
        const baseKey = coordinatePointConversionBaseKeyForPick({
          session: coordinatePointConversionSession,
          anchor: entry.anchor,
          ...(entry.sourceReference ? { sourceReference: entry.sourceReference } : {})
        });
        if (!baseKey) return result;
        selectCoordinatePointConversionBase(baseKey);
        confirmCoordinatePointConversion();
        return result;
      },
      filterPointPickCandidates: coordinatePointConversionSession &&
        isCoordinatePointConversionPickTarget(activePointPickTarget)
        ? (candidates) => candidates
            .map((candidate) => ({
              ...candidate,
              options: candidate.options.filter((option) => option.kind === "point" &&
                coordinatePointConversionBaseKeyForPick({
                  session: coordinatePointConversionSession,
                  anchor: option.anchor,
                  ...(option.sourceReference ? { sourceReference: option.sourceReference } : {})
                }) !== null)
            }))
            .filter((candidate) => candidate.options.length > 0)
        : undefined,
      cancelCanvasPickOperation: coordinatePointConversionSession ? cancelCoordinatePointConversion : undefined,
      createCoordinatePointAtPointer: graphFramePinned ? undefined : postCoordinatePointCreationClick,
      finishCoordinatePointCreation: onFinishCoordinatePointCreation,
      toggleCanvasPointNames: () => dispatchCommand("toggleCanvasPointNames"),
      toggleCanvasGeometryNames: () => dispatchCommand("toggleCanvasGeometryNames"),
      toggleCanvasDirectionArrows: () => dispatchCommand("toggleCanvasDirectionArrows"),
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      resolveImageSourceUrl: graphFramePinned
        ? (sourcePath) => canvasImageSourceUrl(sourcePath, EMPTY_IMAGE_RESOURCES)
        : canvasPresentation.resolveImageSourceUrl ?? resolveImageSourceUrl,
      renderCanvasModeChrome: () => canvasModalMode === "coordinate-point-creation" ? (
        <CanvasModeStatus model={{
          title: "COORDINATE POINTS",
          instruction: canvasPresentationAdapter.text(
            "canvas.coordinatePointCreation.instruction",
            "Click the Canvas to create coordinate points"
          ),
          finishLabel: canvasPresentationAdapter.text(
            "canvas.coordinatePointCreation.finish",
            "Finish"
          ),
          finishHint: canvasPresentationAdapter.text(
            "canvas.coordinatePointCreation.finishHint",
            "Press Enter to finish"
          ),
          onFinish: onFinishCoordinatePointCreation ?? (() => undefined)
        }} />
      ) : referencePickSession && referencePickPresentationContext &&
        referencePickSession.draft.status === "active" ? (
        <VSCodeReferencePickModeStatus
          session={referencePickSession}
          context={referencePickPresentationContext}
          onFinish={confirmReferencePick}
          onBrowse={browseReferencePick}
          onCopy={copyReferencePick}
          onInsert={insertReferencePick}
          onCancel={cancelReferencePick}
          onMoveDraftEntry={moveReferencePickDraftEntry}
          onRemoveDraftEntry={removeReferencePickDraftEntry}
        />
      ) : matchingPickModeSessionForTargets(activePickModeSession, {
        point: activePointPickTarget,
        numericReference: activeNumericReferencePickTarget,
        line: activeLinePickTarget
      }) ? <PickModeStatus /> : null,
      renderHostDrawingOverlay: referencePickSession ? (viewportSize) => (
        <VSCodeReferencePickOverlay
          canvasFocusRef={canvasFocusRef}
          viewportSize={viewportSize}
          canvasViewport={canvasViewport}
          canvasTheme={canvasTheme}
          elements={referencePickCandidateSnapshot?.compiled.document?.elements ?? canvasPresentation.elements}
          evaluation={referencePickCandidateSnapshot?.evaluation ?? canvasPresentation.renderEvaluation}
          visibilityProfiles={referencePickCandidateSnapshot?.compiled.document?.visibilityProfiles ?? canvasPresentation.visibilityProfiles}
          activeVisibilityProfileId={referencePickCandidateSnapshot?.compiled.document?.activeVisibilityProfileId ?? canvasPresentation.activeVisibilityProfileId}
          canvasLayerPresentation={canvasLayerPresentation}
          session={referencePickSession}
          showCanvasGeometryNames={showCanvasGeometryNames}
          onHover={setReferencePickHover}
          onSelect={selectReferencePick}
          onSelectNumericProperty={selectReferencePickNumericProperty}
          onConfirm={confirmReferencePick}
          onCancel={cancelReferencePick}
          presentation={canvasPresentationAdapter}
        />
      ) : undefined,
      renderHostOverlay: (viewportSize, layout = { canvasModeChromeHeight: 0 }) => (
        <>
          <CanvasLayerPanel
            layers={canvasLayerPresentation.layers}
            hiddenLayerIds={hiddenCanvasLayerIds}
            onToggle={useCadUiStore.getState().toggleCanvasLayerVisibility}
            topInset={layout.canvasModeChromeHeight}
          />
          {coordinatePointConversionSession && !coordinatePointConversionCanvasBasePick ? (
            <CommandLineBar
              coordinatePointConversion={{
                session: coordinatePointConversionSession,
                onQuery: setCoordinatePointConversionQuery,
                onSelectBase: selectCoordinatePointConversionBase,
                onStartPick: startCoordinatePointConversionPick,
                onConfirm: confirmCoordinatePointConversion,
                onCancel: cancelCoordinatePointConversion
              }}
              presentation={canvasPresentationAdapter}
            />
          ) : null}
          <VSCodeCanvasRibbonOverlay
            canvasFocusRef={canvasFocusRef}
            canvasViewport={canvasViewport}
            canvasRibbonPositions={canvasRibbonPositions}
            viewportSize={viewportSize}
            canvasModeChromeHeight={layout.canvasModeChromeHeight}
            ribbonCommandContext={ribbonCommandContext}
            presentation={canvasPresentationAdapter}
            onCommand={executeRibbonCommand}
            onPositionCommit={onCanvasRibbonPositionCommit}
          />
        </>
      )
    }), [
      resolveImageSourceUrl,
      graphFramePinned,
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      activePickModeSession,
      canvasPresentation,
      canvasPresentationAdapter,
      canvasLayerPresentation,
      canvasViewport,
      canvasModalMode,
      commandLineSession,
      commitGeometryCommand,
      canvasTheme,
      canvasGridSettings,
      dragPreviewScheduler,
      evaluationState,
      onFinishCoordinatePointCreation,
      postCoordinatePointCreationClick,
      multiDocumentRuntimePresentation,
      presentationCompiledDocumentRevision,
      runtimeOnlyElementIds,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      showCanvasDirectionArrows,
      hiddenCanvasLayerIds,
      executeRibbonCommand,
      onCanvasRibbonPositionCommit,
      canvasRibbonPositions,
      ribbonCommandContext,
      canvasFocusRef,
      creationCommandContext,
      referencePickPresentationContext,
      referencePickSession,
      setReferencePickHover,
      referencePickCandidateSnapshot,
      selectReferencePick,
      selectReferencePickNumericProperty,
      moveReferencePickDraftEntry,
      removeReferencePickDraftEntry,
      confirmReferencePick,
      browseReferencePick,
      copyReferencePick,
      insertReferencePick,
      cancelReferencePick,
      postCanvasPointerPosition,
      coordinatePointConversionSession,
      applyCoordinatePointConversionBasePick,
      coordinatePointConversionCanvasBasePick,
      setCoordinatePointConversionQuery,
      selectCoordinatePointConversionBase,
      startCoordinatePointConversionPick,
      confirmCoordinatePointConversion,
      cancelCoordinatePointConversion,
      hasCoordinatePointConversionTarget
    ]);

    useImperativeHandle(ref, () => ({
      clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
      clearEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
      isReferencePickActive: () => referencePickActiveRef.current,
      fitDrawing: () => dispatchSharedCanvasCommand("fitDrawing")
    }), [dispatchSharedCanvasCommand]);

    // An imported graph's ephemeral edit preview stays in the shared edit
    // boundary. The graph evaluator and canonical frame read the Host snapshot.
    const staleCanvasMessage = staleCanvasPresentation
      ? staleCanvasPresentation.status === "ready"
        ? `Showing stale Canvas geometry from graph revision ${staleCanvasPresentation.lastGoodGraphRevision} and Source revision ${staleCanvasPresentation.lastGoodSourceRevision}. Current graph revision ${staleCanvasPresentation.currentGraphRevision} and Source revision ${staleCanvasPresentation.currentSourceRevision} have unresolved geometry. This frame is display only; hit testing and edits are disabled. Review Source diagnostics.`
        : staleCanvasPresentation.status === "loading"
          ? `Current Canvas geometry is unavailable. Loading the last valid frame from graph revision ${staleCanvasPresentation.lastGoodGraphRevision} and Source revision ${staleCanvasPresentation.lastGoodSourceRevision} for current graph revision ${staleCanvasPresentation.currentGraphRevision} and Source revision ${staleCanvasPresentation.currentSourceRevision}. Review Source diagnostics.`
          : `Current Canvas geometry is unavailable, and the last valid frame from graph revision ${staleCanvasPresentation.lastGoodGraphRevision} and Source revision ${staleCanvasPresentation.lastGoodSourceRevision} could not be evaluated. Current graph revision ${staleCanvasPresentation.currentGraphRevision} and Source revision ${staleCanvasPresentation.currentSourceRevision} remain invalid. Review Source diagnostics.`
      : null;

    return (
      <>
        {staleCanvasMessage ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="stale-canvas-status"
            style={{
              position: "absolute",
              zIndex: 10,
              top: 8,
              left: 8,
              right: 8,
              padding: "8px 12px",
              background: "var(--vscode-editorWarning-background, #4b3b16)",
              color: "var(--vscode-editorWarning-foreground, #fff)",
              border: "1px solid var(--vscode-editorWarning-border, #9a7d2e)",
              borderRadius: 4,
              pointerEvents: "none"
            }}
          >
            {staleCanvasMessage}
          </div>
        ) : null}
        <DrawingCanvas
          ref={drawingCanvasRef}
          evaluation={canvasPresentation.renderEvaluation}
          evaluationState={canvasPresentation.renderEvaluationState}
          canvasFocusRef={canvasFocusRef}
          hostAdapter={hostAdapter}
          retainedImageSourceUrl={graphFramePinned ? canvasPresentation.resolveImageSourceUrl : undefined}
          renderDragProjection
          cancelHostDragPreview={multiDocumentRuntimePresentation ? cancelHostDragPreview : undefined}
          nativePointerBoundaryFallback
        />
      </>
    );
  }
);
