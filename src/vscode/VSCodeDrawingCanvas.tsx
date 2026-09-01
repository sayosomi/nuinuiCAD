import type { RefObject } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext, SourceCreationCommitMetadata } from "../commands/commandTypes";
import { commitCanvasRectangleSelection } from "../commands/canvasRectangleSelectionCommands";
import {
  canvasSelectionSnapshot,
  canvasSelectionForElement,
  finalizeCanvasSelectionSession,
  previewCanvasSelection,
  resolveOwningModuleInstanceId
} from "../commands/selectionCommands";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import {
  evaluationStateIsCurrentFor,
  type EvaluationEngineState
} from "../geometry/useEvaluationEngine";
import { compileCanonicalText } from "../document/canonicalDocument";
import {
  effectiveCompiledDocument,
  effectiveElements,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId, EvaluationResult } from "../types/geometry";
import { DrawingCanvas } from "../components/DrawingCanvas";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type {
  CanvasHostAdapter,
  CanvasPointDragAction,
  CanvasBezierHandleDragAction
} from "../components/canvasHostAdapter";
import { useRevisionCoherentCanvasPresentation } from "../components/canvasRevisionPresentation";
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";
import {
  type VscodeCanvasRibbon
} from "./vscodeCanvasRibbonConfig";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import { VSCodeCreationAssistOverlay } from "./VSCodeCreationAssistOverlay";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";
import { CommandLineBar } from "../components/CommandLineBar";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type { CommandRibbonPresentationCommandItem } from "../components/CommandRibbonView";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";
import { vscodeCanvasContextDataFor, type VscodeCanvasPointer } from "./protocol";
import {
  useVSCodeReferencePickSession,
  type VscodeReferencePickAuthorityFor
} from "./useVSCodeReferencePickSession";
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
import type { SourceCreationCursor } from "../commands/sourceCreationInsertion";

type VSCodeDrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  postCanonicalSourceText: (sourceText: string, metadata?: SourceCreationCommitMetadata) => void;
  canvasCreationRequest?: {
    requestId: number;
    sourceCursor: SourceCreationCursor;
  };
  postCanvasCommit?: (operationId?: number, coordinatePointConversionRequestId?: number) => void;
  postCanvasPointerPosition?: (pointer: VscodeCanvasPointer) => void;
  canvasTheme?: CanvasTheme;
  canvasRibbonRibbons?: VscodeCanvasRibbon[];
  onCanvasRibbonPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  onEditCanvasRibbon?: () => void;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
  multiDocumentRuntimePresentation?: VscodeMultiDocumentCanvasRuntimePresentation | null;
  currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
  currentCoordinatePointConversionAuthorityFor?: (
    expectedDocumentVersion: number
  ) => VscodeCoordinatePointConversionAuthority | null;
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const mutationWasApplied = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "status" in value && value.status === "applied";

export const VSCodeDrawingCanvas = forwardRef<DrawingCanvasHandle, VSCodeDrawingCanvasProps>(
  function VSCodeDrawingCanvas({
    evaluation,
    evaluationState,
    canvasFocusRef,
    postCanonicalSourceText,
    canvasCreationRequest,
    postCanvasCommit,
    postCanvasPointerPosition,
    canvasTheme = LEGACY_CANVAS_THEME,
    canvasRibbonRibbons = [],
    onCanvasRibbonPositionCommit,
    onEditCanvasRibbon,
    measureCanvasTextWidth,
    multiDocumentRuntimePresentation = null,
    currentReferencePickAuthorityFor,
    currentCoordinatePointConversionAuthorityFor
  }, ref) {
    const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
    const elements = useCadDocumentStore(effectiveElements);
    const canonicalElements = useCadDocumentStore((state) => state.elements);
    const compiledDocument = useCadDocumentStore(effectiveCompiledDocument);
    const sourceText = useCadDocumentStore((state) => state.sourceText);
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
    const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
    const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
    const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
    const commandLineSession = useCadUiStore((state) => state.commandLineSession);
    const runtimeOnlyElementIds = useMemo(() => {
      if (!multiDocumentRuntimePresentation) return new Set<ElementId>();
      const canonicalIds = new Set(canonicalElements.map((element) => element.id));
      return new Set(multiDocumentRuntimePresentation.elements
        .filter((element) => !canonicalIds.has(element.id))
        .map((element) => element.id));
    }, [canonicalElements, multiDocumentRuntimePresentation]);
    const presentationCompiledDocumentRevision = multiDocumentRuntimePresentation?.graphRevision ?? compiledDocumentRevision;
    const presentationElements = multiDocumentRuntimePresentation?.elements ?? elements;
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
    const currentCanvasPresentation = useMemo(() => ({
      elements: presentationElements,
      canonicalElements,
      compiledDocument,
      evaluationLimitIndex: presentationEvaluationLimitIndex,
      visibilityProfiles: presentationVisibilityProfiles,
      activeVisibilityProfileId: presentationActiveVisibilityProfileId,
      moduleSemanticContext
    }), [
      canonicalElements,
      compiledDocument,
      presentationActiveVisibilityProfileId,
      presentationElements,
      presentationEvaluationLimitIndex,
      presentationVisibilityProfiles,
      moduleSemanticContext,
    ]);
    const canvasPresentation = useRevisionCoherentCanvasPresentation({
      current: currentCanvasPresentation,
      evaluation,
      compiledDocumentRevision: presentationCompiledDocumentRevision,
      evaluationState,
      holdLastStable: multiDocumentRuntimePresentation ? false : holdLastStableCanvasPresentation,
      retainLastStable: !multiDocumentRuntimePresentation
    });
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
      const compiled = effectiveCompiled.spans.sourceMap.source === normalizedSource
        ? effectiveCompiled
        : compileCanonicalText(
            { ...state, sourceText: state.docText },
            state.sourceText
          ).currentCompiled;
      if (
        compiled.spans.sourceMap.source !== normalizedSource ||
        compiled.spans.sourceMap.sourceRevision !== state.currentSourceRevision
      ) return null;
      const evaluationIsCurrent = evaluationStateIsCurrentFor(
        canvasPresentation.renderEvaluationState,
        state.compiledDocumentRevision
      );
      const canvasSnapshot = !evaluationIsCurrent &&
        canvasPresentation.isPinned &&
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
        evaluation: canvasPresentation.renderEvaluation,
        evaluationIsCurrent,
        ...(canvasSnapshot ? { canvasSnapshot } : {})
      };
    }, [
      canvasPresentation.renderEvaluation,
      canvasPresentation.renderEvaluationState,
      canvasPresentation.hasCoherentSnapshot,
      canvasPresentation.isPinned,
      canvasPresentation.compiledDocument,
      compiledDocumentRevision,
      elements,
      sourceText,
      currentSourceRevision
    ]);
    const {
      session: referencePickSession,
      setHover: setReferencePickHover,
      select: selectReferencePick,
      selectNumericProperty: selectReferencePickNumericProperty,
      confirm: confirmReferencePick,
      cancel: cancelReferencePick
    } = useVSCodeReferencePickSession({
      api: vscodeWebviewApi(),
      currentContextFor: currentReferencePickContext,
      currentReferencePickAuthorityFor
    });
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
        evaluation: canvasPresentation.renderEvaluation,
        evaluationIsCurrent: evaluationStateIsCurrentFor(
          canvasPresentation.renderEvaluationState,
          state.compiledDocumentRevision
        )
      };
    }, [canvasPresentation.renderEvaluation, canvasPresentation.renderEvaluationState, compiledDocumentRevision, currentSourceRevision, elements, sourceText]);
    const {
      session: coordinatePointConversionSession,
      setQuery: setCoordinatePointConversionQuery,
      selectBase: selectCoordinatePointConversionBase,
      startPick: startCoordinatePointConversionPick,
      confirm: confirmCoordinatePointConversion,
      cancel: cancelCoordinatePointConversion
    } = useVSCodeCoordinatePointConversionSession({
      api: vscodeWebviewApi(),
      currentContextFor: currentCoordinatePointConversionContext,
      currentAuthorityFor: currentCoordinatePointConversionAuthorityFor ?? currentReferencePickAuthorityFor,
      postCanvasCommit: postCanvasCommit ?? (() => undefined)
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
      hasSelection: selectedElementIds.length > 0,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints
    }), [selectedElementIds.length, showCanvasGeometryNames, showCanvasPointNames, showCanvasPoints]);

    const executeRibbonCommand = useCallback((item: CommandRibbonPresentationCommandItem) => {
      drawingCanvasRef.current?.finalizeCanvasInteraction();
      const definition = vscodeCanvasRibbonCommandFor(item.commandId);
      if (!definition || !definition.isAvailable({
        hasSelection: useCadUiStore.getState().selectedElementIds.length > 0,
        showCanvasPointNames: useCadUiStore.getState().showCanvasPointNames,
        showCanvasGeometryNames: useCadUiStore.getState().showCanvasGeometryNames,
        showCanvasPoints: useCadUiStore.getState().showCanvasPoints
      })) return;
      if (definition.hostAction === "editCanvasRibbon") {
        onEditCanvasRibbon?.();
        return;
      }
      if (!definition.sharedCommandId) return;
      dispatchCommand(definition.sharedCommandId, {
        evaluation,
        getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
        measureCanvasTextWidth,
        recordSelectionHistory: true,
        finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
        focusCanvas: () => canvasFocusRef.current?.focus()
      });
      canvasFocusRef.current?.focus();
    }, [canvasFocusRef, evaluation, measureCanvasTextWidth, onEditCanvasRibbon]);

    const dispatchGeometryAction = useMemo(
      () => (action: CanvasPointDragAction | CanvasBezierHandleDragAction) => {
        if (runtimeOnlyElementIds.has(action.elementId)) return false;
        if ("bezierHandleRole" in action) {
          return dispatchCommand("moveBezierHandleByDelta", action);
        }
        return dispatchCommand("movePointElementByDelta", action);
      },
      [runtimeOnlyElementIds]
    );
    const dragPreviewScheduler = useMemo(
      () => new VscodeDragPreviewScheduler(dispatchGeometryAction),
      [dispatchGeometryAction]
    );

    const creationCommandContext = useMemo<CommandContext>(() => ({
      evaluation: canvasPresentation.renderEvaluation,
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
      postCanonicalSourceText,
      completeCommandLineSession: true,
      ...(canvasCreationRequest
        ? {
            currentSourceCursor: () => canvasCreationRequest.sourceCursor,
            sourceCreationOrigin: "canvas-retained" as const,
            canvasCreationRequestId: canvasCreationRequest.requestId
          }
        : {})
    }), [canvasCreationRequest, canvasFocusRef, canvasPresentation.renderEvaluation, canvasPresentation.renderEvaluationState, compiledDocumentRevision, measureCanvasTextWidth, postCanonicalSourceText]);

    useEffect(() => () => dragPreviewScheduler.dispose(), [dragPreviewScheduler]);
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
        if (runtimeOnlyElementIds.has(action.elementId)) return false;
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          postCanonicalSourceText(sourceText);
        }
        return result;
      },
      moveBezierHandleByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["moveBezierHandleByDelta"]>>[0]) => {
        if (runtimeOnlyElementIds.has(action.elementId)) return false;
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          postCanonicalSourceText(sourceText);
        }
        return result;
      }
    }), [dragPreviewScheduler, postCanonicalSourceText, runtimeOnlyElementIds]);

    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      elements: canvasPresentation.elements,
      canonicalElements: canvasPresentation.canonicalElements,
      runtimeElementIds: runtimeOnlyElementIds,
      evaluationLimitIndex: canvasPresentation.evaluationLimitIndex,
      compiledDocumentRevision: presentationCompiledDocumentRevision,
      canvasTheme,
      visibilityProfiles: canvasPresentation.visibilityProfiles,
      activeVisibilityProfileId: canvasPresentation.activeVisibilityProfileId,
      moduleSemanticContext: canvasPresentation.moduleSemanticContext,
      canvasModuleMaterialization: multiDocumentRuntimePresentation?.moduleMaterialization,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      canvasViewport,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      renderFixedCanvasChrome: false,
      activePointPickTarget,
      activeNumericReferencePickTarget,
      activeLinePickTarget,
      commandLineSession,
      canvasContextMenuData: vscodeCanvasContextDataFor("blank", selectedElementIds.length > 0, undefined, false, hasCoordinatePointConversionTarget),
      publishCanvasPointerPosition: postCanvasPointerPosition,
      publishCanvasContextMenu: ({ kind, pointer }) => {
        const viewport = canvasFocusRef.current;
        if (!viewport) return;
        const currentSelection = useCadUiStore.getState();
        const canSelectInstance = kind === "element" && resolveOwningModuleInstanceId({
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
          hasCoordinatePointConversionTarget
        );
      },
      flushSourceEditorOnCanvasPointerDown: () => "clean",
      setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
      focusSourceEditor: () => undefined,
      getCurrentCanonicalDocument: () => {
        const state = useCadDocumentStore.getState();
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
        multiDocumentRuntimePresentation
          ? previewCanvasSelection(previousSelection, elementId, selectionMode, canvasPresentation.elements)
          : previewCanvasSelection(previousSelection, elementId, selectionMode),
      finalizeCanvasSelectionSession: (previousSelection) =>
        finalizeCanvasSelectionSession(previousSelection),
      commitCanvasRectangleSelection: (memberIds, mode) =>
        multiDocumentRuntimePresentation
          ? commitCanvasRectangleSelection(memberIds, mode, true, canvasPresentation.elements)
          : commitCanvasRectangleSelection(memberIds, mode, true),
      clearCanvasSelection: () => dispatchCommand("clearCanvasSelection", { recordSelectionHistory: true }),
      movePointElementByDelta: (action) => action.commitMode === "preview"
        ? runtimeOnlyElementIds.has(action.elementId) ? false : dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : commitGeometryCommand.movePointElementByDelta(action),
      moveBezierHandleByDelta: (action) => action.commitMode === "preview"
        ? runtimeOnlyElementIds.has(action.elementId) ? false : dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : commitGeometryCommand.moveBezierHandleByDelta(action),
      applyPickedNumericReference: (numericReferenceExpression) => dispatchCommand("applyPickedNumericReference", {
        ...creationCommandContext,
        numericReferenceExpression
      }),
      applyNumericExpressionReference: (action) => dispatchCommand("applyNumericExpressionReference", action),
      applyPickedLine: (action) => dispatchCommand("applyPickedLine", {
        ...creationCommandContext,
        ...action
      }),
      applyPickedPoint: (action) => {
        const currentTarget = useCadUiStore.getState().activePointPickTarget;
        if (coordinatePointConversionSession && isCoordinatePointConversionPickTarget(currentTarget)) {
          const baseKey = coordinatePointConversionBaseKeyForPick({
            session: coordinatePointConversionSession,
            anchor: action.pickedPointAnchor,
            ...(action.pickedPointSourceReference
              ? { sourceReference: action.pickedPointSourceReference }
              : {})
          });
          if (baseKey) selectCoordinatePointConversionBase(baseKey);
          return;
        }
        return dispatchCommand("applyPickedPoint", {
          ...creationCommandContext,
          ...action
        });
      },
      dispatchCanvasPickCommand: (commandId) => coordinatePointConversionSession
        ? false
        : dispatchCommand(commandId, creationCommandContext),
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
      toggleCanvasPointNames: () => dispatchCommand("toggleCanvasPointNames"),
      toggleCanvasGeometryNames: () => dispatchCommand("toggleCanvasGeometryNames"),
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      resolveImageSourceUrl: (sourcePath) => sourcePath,
      renderHostOverlay: (viewportSize) => (
        <>
          <VSCodeCreationAssistOverlay
            canvasFocusRef={canvasFocusRef}
            commandContext={creationCommandContext}
            evaluation={canvasPresentation.renderEvaluation}
            evaluationIsCurrent={creationCommandContext.evaluationIsCurrent ?? true}
            postCanonicalSourceText={postCanonicalSourceText}
          />
          {referencePickSession ? (
            <VSCodeReferencePickOverlay
              canvasFocusRef={canvasFocusRef}
              viewportSize={viewportSize}
              canvasViewport={canvasViewport}
              canvasTheme={canvasTheme}
              elements={canvasPresentation.elements}
              evaluation={canvasPresentation.renderEvaluation}
              visibilityProfiles={canvasPresentation.visibilityProfiles}
              activeVisibilityProfileId={canvasPresentation.activeVisibilityProfileId}
              session={referencePickSession}
              onHover={setReferencePickHover}
              onSelect={selectReferencePick}
              onSelectNumericProperty={selectReferencePickNumericProperty}
              onConfirm={confirmReferencePick}
              onCancel={cancelReferencePick}
            />
          ) : null}
          {coordinatePointConversionSession ? (
            <CommandLineBar
              coordinatePointConversion={{
                session: coordinatePointConversionSession,
                onQuery: setCoordinatePointConversionQuery,
                onSelectBase: selectCoordinatePointConversionBase,
                onStartPick: startCoordinatePointConversionPick,
                onConfirm: confirmCoordinatePointConversion,
                onCancel: cancelCoordinatePointConversion
              }}
            />
          ) : null}
          <VSCodeCanvasRibbonOverlay
            canvasFocusRef={canvasFocusRef}
            canvasViewport={canvasViewport}
            canvasRibbonRibbons={canvasRibbonRibbons}
            viewportSize={viewportSize}
            ribbonCommandContext={ribbonCommandContext}
            onCommand={executeRibbonCommand}
            onPositionCommit={onCanvasRibbonPositionCommit}
          />
        </>
      )
    }), [
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      canvasPresentation,
      canvasViewport,
      commandLineSession,
      commitGeometryCommand,
      canvasTheme,
      dragPreviewScheduler,
      evaluationState,
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
      executeRibbonCommand,
      onCanvasRibbonPositionCommit,
      canvasRibbonRibbons,
      ribbonCommandContext,
      canvasFocusRef,
      creationCommandContext,
      referencePickSession,
      setReferencePickHover,
      selectReferencePick,
      selectReferencePickNumericProperty,
      confirmReferencePick,
      cancelReferencePick,
      postCanvasPointerPosition,
      postCanonicalSourceText,
      coordinatePointConversionSession,
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
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction()
    }), []);

    return (
      <DrawingCanvas
        ref={drawingCanvasRef}
        evaluation={canvasPresentation.renderEvaluation}
        evaluationState={canvasPresentation.renderEvaluationState}
        canvasFocusRef={canvasFocusRef}
        hostAdapter={hostAdapter}
        nativePointerBoundaryFallback
      />
    );
  }
);
