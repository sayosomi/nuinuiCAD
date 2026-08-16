import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { dispatchCommand } from "../commands/commands";
import { loadCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { registerUnsavedChangesGuard } from "../document/unsavedChangesGuard";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluationStateIsCurrentFor, useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { loadShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import {
  isSourceEditorDslKeyboardTarget,
  isSourceEditorKeyboardTarget,
  isSourceEditorSearchKeyboardTarget,
  keyboardCommandForEvent
} from "../keyboard/shortcuts";
import { loadLayoutSettings, saveLayoutSettings } from "../layout/layoutSettingsStorage";
import { MIN_LEFT_PANEL_WIDTH, useLeftPanelResize } from "../layout/leftPanelWidth";
import {
  effectiveCompiledDocument,
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { TauriDrawingCanvas } from "./TauriDrawingCanvas";
import { CommandLineBar } from "./CommandLineBar";
import { RightPanel } from "./RightPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { SourceEditorPane } from "./SourceEditorPane";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { registerTauriMenuCommandListener } from "../commands/tauriMenuEvents";
import { selectTextInputValue } from "./textInputSelection";
import { PickModeStatus } from "./PickModeStatus";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { DrawingCanvasHandle } from "./DrawingCanvas";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { isCommandLineInputComposing } from "../commands/commandLineInputComposition";
import { cancelCommandLineEscape } from "../commands/commandLineSessionCommands";
import { currentStep } from "../commands/commandLineSession";
import { creationRecipeForLegacyCommand, legacyCreationCommandIds } from "../commands/legacyCreationRecipes";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ElementId } from "../types/geometry";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";
import { TauriBenchmarkCaptureRunner } from "../performance/TauriBenchmarkCaptureRunner";

const commandLineCreationCommandIds = new Set(legacyCreationCommandIds);

const ImageImportDialog = lazy(() =>
  import("./ImageImportDialog").then((module) => ({ default: module.ImageImportDialog }))
);
const PaletteSettingsDialog = lazy(() =>
  import("./PalettePanel").then((module) => ({ default: module.PaletteSettingsDialog }))
);
const VisibilityProfileSettingsDialog = lazy(() =>
  import("./VisibilityProfilePanel").then((module) => ({
    default: module.VisibilityProfileSettingsDialog
  }))
);
const PrintLayoutCanvas = lazy(() =>
  import("./PrintLayoutView").then((module) => ({ default: module.PrintLayoutCanvas }))
);
const PrintLayoutPanel = lazy(() =>
  import("./PrintLayoutView").then((module) => ({ default: module.PrintLayoutPanel }))
);
const PrintLayoutPreviewWindow = lazy(() =>
  import("./PrintLayoutPreviewWindow").then((module) => ({
    default: module.PrintLayoutPreviewWindow
  }))
);
const ShortcutSettingsDialog = lazy(() =>
  import("./ShortcutSettingsDialog").then((module) => ({
    default: module.ShortcutSettingsDialog
  }))
);
const CommandRibbonSettingsDialog = lazy(() =>
  import("./CommandRibbonSettingsDialog").then((module) => ({
    default: module.CommandRibbonSettingsDialog
  }))
);
const SelectionColorPickerDialog = lazy(() =>
  import("./SelectionColorPickerDialog").then((module) => ({
    default: module.SelectionColorPickerDialog
  }))
);
const RenameElementDialog = lazy(() =>
  import("./RenameElementDialog").then((module) => ({ default: module.RenameElementDialog }))
);
const RenameTypedBindingDialog = lazy(() =>
  import("./RenameTypedBindingDialog").then((module) => ({ default: module.RenameTypedBindingDialog }))
);
const RenameModuleSemanticDialog = lazy(() =>
  import("./RenameModuleSemanticDialog").then((module) => ({ default: module.RenameModuleSemanticDialog }))
);

const saveLeftPanelWidth = (leftPanelWidth: number) => {
  void loadLayoutSettings()
    .then((settings) => saveLayoutSettings({ ...settings, leftPanelWidth }))
    .catch((error: unknown) => {
      console.error("failed to save layout settings", error);
    });
};

export const AppLayout = () => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  // A source-editor preview may replace runtime elements. Its scalar metadata
  // must come from the same compile, otherwise Module control owners cannot
  // join their materialized conditionalGroup element IDs at the Rust boundary.
  const evaluationDocument = useCadDocumentStore(effectiveCompiledDocument);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const showPrintLayout = useCadUiStore((state) => state.showPrintLayout);
  const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
  const showPaletteSettings = useCadUiStore((state) => state.showPaletteSettings);
  const showVisibilityProfileSettings = useCadUiStore(
    (state) => state.showVisibilityProfileSettings
  );
  const showShortcutSettings = useCadUiStore((state) => state.showShortcutSettings);
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const showSelectionColorPicker = useCadUiStore((state) => state.showSelectionColorPicker);
  const renameElementPromptTargetId = useCadUiStore((state) => state.renameElementPromptTargetId);
  const renameTypedBindingPromptTargetId = useCadUiStore((state) => state.renameTypedBindingPromptTargetId);
  const renameModuleSemanticPromptTarget = useCadUiStore((state) => state.renameModuleSemanticPromptTarget);
  const pendingImageImport = useCadUiStore((state) => state.pendingImageImport);
  const imageImportError = useCadUiStore((state) => state.imageImportError);
  const setPrintPreviewWindow = useCadUiStore((state) => state.setPrintPreviewWindow);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const commandLineSession = useCadUiStore((state) => state.commandLineSession);
  const isPickMode = useCadUiStore(
    (state) =>
      Boolean(state.activePointPickTarget) ||
      Boolean(state.activeNumericReferencePickTarget) ||
      Boolean(state.activeLinePickTarget)
  );
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLElement>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);
  const commandRibbonDockRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const {
    isResizing: isResizingLeftPanel,
    leftPanelWidth,
    maximumLeftPanelWidth,
    setSavedWidth: setSavedLeftPanelWidth,
    startResize: startLeftPanelResize,
    decreaseWidth: decreaseLeftPanelWidth,
    increaseWidth: increaseLeftPanelWidth,
    resetWidth: resetLeftPanelWidth
  } = useLeftPanelResize({ onWidthCommitted: saveLeftPanelWidth });
  const evaluationOptions = useMemo(
    () => buildEvaluationOptions({ compiledDocument: evaluationDocument, evaluationLimitIndex }),
    [evaluationDocument, evaluationLimitIndex]
  );
  const evaluationState = useEvaluationEngine(elements, evaluationOptions, compiledDocumentRevision);
  const { evaluation, evaluationRevision, evaluationRequestRevision } = evaluationState;
  // Element-property completion (CommandLineBar, Source Editor) must never
  // treat a not-yet-current evaluation as a confirmed empty/candidate
  // result - Rust evaluation is asynchronous && can lag a freshly compiled
  // element by a render || two (see elementParameterCandidateState). Reuse
  // the engine's own currency check rather than re-deriving it ad hoc.
  const evaluationIsCurrent = evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision);
  const commandLineStep = currentStep(commandLineSession);
  const isMultiLinePicking = Boolean(activeLinePickTarget && (
    (activeLinePickTarget.elementId === COMMAND_LINE_PICK_TARGET_ID &&
      commandLineStep?.kind === "lineList" &&
      commandLineStep.key === activeLinePickTarget.parameterKey) ||
    (() => {
      const target = elements.find((element) => element.id === activeLinePickTarget.elementId);
      return target && findParameterDefinition(target, activeLinePickTarget.parameterKey)?.kind === "lineReferenceList";
    })()
  ));

  useEffect(() => {
    if (isMultiLinePicking) canvasFocusRef.current?.focus();
  }, [isMultiLinePicking]);

  useEffect(() => {
    // Publish with the revisions the engine captured when this evaluation request
    // started. Never substitute the store's current compiledDocumentRevision here:
    // async Rust results may arrive after the document advanced, && stamping the
    // current revision would mislabel a stale result as fresh.
    sourceEditorRef.current?.setEvaluation({
      evaluation,
      compiledDocumentRevision: evaluationRevision,
      evaluationRequestRevision,
      evaluationIsCurrent
    });
  }, [evaluation, evaluationRevision, evaluationRequestRevision, evaluationIsCurrent]);
  const commandContext = useMemo(() => ({
    focusCanvas: () => canvasFocusRef.current?.focus(),
    focusSourceEditor: () => sourceEditorRef.current?.focus(),
    focusElementSearch: () => sourceEditorRef.current?.focusSearch(),
    currentCursorElementId: () => sourceEditorRef.current?.currentCursorElementId?.() ?? null,
    currentSourceCursor: () => sourceEditorRef.current?.currentSourceCursor?.() ?? null,
    currentCursorTypedRenameTargetBindingId: () => sourceEditorRef.current?.currentCursorTypedRenameTargetBindingId?.() ?? null,
    currentCursorModuleSemanticTarget: () => sourceEditorRef.current?.currentCursorModuleSemanticTarget?.() ?? null,
    currentCursorModuleSemanticResolution: () => sourceEditorRef.current?.currentCursorModuleSemanticResolution?.() ?? { kind: "none" },
    goToSourceDefinitionAtCursor: () => sourceEditorRef.current?.goToSourceDefinitionAtCursor?.() ?? false,
    focusSourceEditorAtElementEnd: (elementId: ElementId) => sourceEditorRef.current?.jumpToElementEnd(elementId),
    focusSourceEditorAtLineEnd: (line: number) => sourceEditorRef.current?.jumpToLineEnd(line),
    clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
    clearSourceEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
    getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
    evaluation
  }), [evaluation]);
  const handleRenameElementConfirmed = useCallback((elementId: ElementId) => {
    sourceEditorRef.current?.jumpToElement(elementId);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);
  const handleRenameTypedBindingConfirmed = useCallback((bindingId: BindingId) => {
    sourceEditorRef.current?.jumpToBindingDeclaration(bindingId);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);
  const handleRenameModuleSemanticConfirmed = useCallback((target: ModuleSemanticTarget) => {
    sourceEditorRef.current?.jumpToModuleSemanticTarget?.(target);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutSettings()
      .then((settings) => {
        if (!cancelled) {
          setSavedLeftPanelWidth(settings.leftPanelWidth);
          setPrintPreviewWindow(settings.printPreviewWindow);
        }
      })
      .catch((error: unknown) => {
        console.error("failed to load layout settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [setPrintPreviewWindow, setSavedLeftPanelWidth]);

  useEffect(() => {
    return registerUnsavedChangesGuard();
  }, []);

  useEffect(() => registerTauriMenuCommandListener(commandContext), [commandContext]);

  useEffect(() => {
    let cancelled = false;
    useCadUiStore.getState().setShortcutSettingsLoading(true);
    void loadShortcutSettings()
      .then((settings) => {
        if (cancelled) return;
        useCadUiStore.getState().setShortcutSettings(settings);
        useCadUiStore.getState().setShortcutSettingsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        useCadUiStore
          .getState()
          .setShortcutSettingsError(
            error instanceof Error ? error.message : "ショートカット設定を読み込めません。"
          );
      })
      .finally(() => {
        if (!cancelled) useCadUiStore.getState().setShortcutSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    useCadUiStore.getState().setCommandRibbonSettingsLoading(true);
    void loadCommandRibbonSettings()
      .then((settings) => {
        if (cancelled) return;
        useCadUiStore.getState().setCommandRibbonSettings(settings);
        useCadUiStore.getState().setCommandRibbonSettingsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        useCadUiStore
          .getState()
          .setCommandRibbonSettingsError(
            error instanceof Error ? error.message : "コマンドリボン設定を読み込めません。"
          );
      })
      .finally(() => {
        if (!cancelled) useCadUiStore.getState().setCommandRibbonSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The bar owns every Escape from itself. This capture listener otherwise
      // runs before the bar's bubble handler && would cancel an edit twice.
      if (
        event.key === "Escape" &&
        event.target instanceof Element &&
        event.target.closest(".command-line-bar")
      ) {
        return;
      }
      const isSourceEditorTarget = isSourceEditorKeyboardTarget(event);
      // DSL && the lens are handled by CodeMirror. The React element-search field
      // admits only cross-focus commands; menus/docks keep their own keyboard UI.
      if (isSourceEditorTarget && isSourceEditorDslKeyboardTarget(event)) return;
      if (isSourceEditorTarget && !isSourceEditorSearchKeyboardTarget(event)) return;
      if (isImeComposingKeyEvent(event) || isCommandLineInputComposing()) return;
      if (useCadUiStore.getState().showShortcutSettings) return;
      if (useCadUiStore.getState().showPaletteSettings) return;
      if (useCadUiStore.getState().showCommandRibbonSettings) return;
      if (useCadUiStore.getState().showSelectionColorPicker) return;
      if (useCadUiStore.getState().renameElementPromptTargetId) return;
      if (useCadUiStore.getState().renameTypedBindingPromptTargetId) return;
      if (useCadUiStore.getState().renameModuleSemanticPromptTarget) return;
      if (useCadUiStore.getState().pendingImageImport || useCadUiStore.getState().imageImportError) return;
      const commandLineSession = useCadUiStore.getState().commandLineSession;
      const keyboardOptions = {
        settings: useCadUiStore.getState().shortcutSettings,
        isPickMode: Boolean(
          useCadUiStore.getState().activePointPickTarget ||
          useCadUiStore.getState().activeNumericReferencePickTarget ||
          useCadUiStore.getState().activeLinePickTarget
        ),
        allowModifiedEditableCommandIds: commandLineSession
          ? commandLineCreationCommandIds
          : undefined,
        scopes: isSourceEditorTarget ? (["crossFocus"] as const) : undefined
      };
      const keyboardCommand = keyboardCommandForEvent(event, keyboardOptions) ??
        (commandLineSession
          ? (() => {
              const normalCommand = keyboardCommandForEvent(event, {
                ...keyboardOptions,
                isPickMode: false
              });
              return normalCommand && creationRecipeForLegacyCommand(normalCommand.commandId)
                ? normalCommand
                : null;
            })()
          : null);
      if (useCadUiStore.getState().commandLineSession && event.key === "Escape") {
        event.preventDefault();
        cancelCommandLineEscape();
        return;
      }
      if (useCadUiStore.getState().activePointPickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelPointPick");
        return;
      }
      if (useCadUiStore.getState().activeNumericReferencePickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelNumericReferencePick");
        return;
      }
      if (useCadUiStore.getState().activeLinePickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelLinePick");
        return;
      }
      if (!keyboardCommand) return;
      if (
        useCadUiStore.getState().showShortcutHelp &&
        keyboardCommand.commandId !== "toggleShortcutHelp"
      ) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      dispatchCommand(keyboardCommand.commandId, {
        ...commandContext,
        ...keyboardCommand.context
      });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [commandContext, shortcutSettings]);

  return (
    <main
      ref={appShellRef}
      className={`app-shell ${isResizingLeftPanel ? "is-resizing-left-panel" : ""} ${isPickMode ? "is-pick-mode" : ""} ${isMultiLinePicking ? "is-multi-line-picking" : ""}`}
      style={{ "--left-panel-width": `${leftPanelWidth}px` } as CSSProperties}
      onFocusCapture={(event) => selectTextInputValue(event.target)}
      onKeyDownCapture={(event) => {
        if (
          isMultiLinePicking &&
          event.target instanceof HTMLElement &&
          !event.target.closest(".canvas-workspace, .pick-mode-status, .command-line-bar")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <SourceEditorPane
        ref={sourceEditorRef}
        canvasFocusRef={canvasFocusRef}
        commandContext={commandContext}
        commandRibbonDockRef={commandRibbonDockRef}
        inert={isMultiLinePicking}
      />
      <div
        className="left-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="左パネル幅を変更"
        aria-valuemin={MIN_LEFT_PANEL_WIDTH}
        aria-valuemax={maximumLeftPanelWidth}
        aria-valuenow={leftPanelWidth}
        title="ドラッグで左パネル幅を変更 / ダブルクリックでリセット"
        tabIndex={0}
        inert={isMultiLinePicking || undefined}
        onPointerDown={startLeftPanelResize}
        onDoubleClick={resetLeftPanelWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            decreaseLeftPanelWidth(event.shiftKey ? 40 : 10);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            increaseLeftPanelWidth(event.shiftKey ? 40 : 10);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            resetLeftPanelWidth();
          }
        }}
      />
      {showPrintLayout ? (
        <Suspense fallback={null}>
          <PrintLayoutCanvas evaluation={evaluation} canvasFocusRef={canvasFocusRef} />
          <PrintLayoutPanel evaluation={evaluation} />
        </Suspense>
      ) : (
        <>
          <div className="canvas-workspace" ref={canvasWorkspaceRef}>
            <TauriDrawingCanvas
              ref={drawingCanvasRef}
              evaluation={evaluation}
              evaluationState={evaluationState}
              canvasFocusRef={canvasFocusRef}
              commandContext={commandContext}
              leftPanelDockRef={commandRibbonDockRef}
            />
            <CommandLineBar commandContext={commandContext} evaluation={evaluation} evaluationIsCurrent={evaluationIsCurrent} />
            {showPrintPreviewWindow ? (
              <Suspense fallback={null}>
                <PrintLayoutPreviewWindow
                  evaluation={evaluation}
                  workspaceRef={canvasWorkspaceRef}
                />
              </Suspense>
            ) : null}
          </div>
          <RightPanel
            evaluation={evaluation}
            evaluationState={evaluationState}
            sourceEditorRef={sourceEditorRef}
            inert={isMultiLinePicking}
          />
        </>
      )}
      <CommandPalette commandContext={commandContext} />
      <PickModeStatus />
      <ShortcutHelpOverlay isPickMode={isPickMode} />
      <TauriBenchmarkCaptureRunner
        evaluation={evaluation}
        evaluationState={evaluationState}
        compiledDocumentRevision={compiledDocumentRevision}
        canvasFocusRef={canvasFocusRef}
      />
      {showPaletteSettings ? (
        <Suspense fallback={null}>
          <PaletteSettingsDialog />
        </Suspense>
      ) : null}
      {showVisibilityProfileSettings ? (
        <Suspense fallback={null}>
          <VisibilityProfileSettingsDialog />
        </Suspense>
      ) : null}
      {showSelectionColorPicker ? (
        <Suspense fallback={null}>
          <SelectionColorPickerDialog />
        </Suspense>
      ) : null}
      {renameElementPromptTargetId ? (
        <Suspense fallback={null}>
          <RenameElementDialog onConfirmed={handleRenameElementConfirmed} />
        </Suspense>
      ) : null}
      {renameTypedBindingPromptTargetId ? (
        <Suspense fallback={null}>
          <RenameTypedBindingDialog onConfirmed={handleRenameTypedBindingConfirmed} />
        </Suspense>
      ) : null}
      {renameModuleSemanticPromptTarget ? (
        <Suspense fallback={null}>
          <RenameModuleSemanticDialog onConfirmed={handleRenameModuleSemanticConfirmed} />
        </Suspense>
      ) : null}
      {pendingImageImport || imageImportError ? (
        <Suspense fallback={null}>
          <ImageImportDialog />
        </Suspense>
      ) : null}
      {showShortcutSettings ? (
        <Suspense fallback={null}>
          <ShortcutSettingsDialog />
        </Suspense>
      ) : null}
      {showCommandRibbonSettings ? (
        <Suspense fallback={null}>
          <CommandRibbonSettingsDialog />
        </Suspense>
      ) : null}
    </main>
  );
};
