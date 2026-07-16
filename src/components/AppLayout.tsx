import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import { loadCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { registerUnsavedChangesGuard } from "../document/unsavedChangesGuard";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { loadShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import {
  isSourceEditorDslKeyboardTarget,
  isSourceEditorKeyboardTarget,
  isSourceEditorSearchKeyboardTarget,
  keyboardCommandForEvent
} from "../keyboard/shortcuts";
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  clampLeftPanelWidth,
  loadLayoutSettings,
  saveLayoutSettings
} from "../layout/layoutSettingsStorage";
import {
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
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
import { currentStep } from "../commands/commandLineSession";
import { creationRecipeForLegacyCommand, legacyCreationCommandIds } from "../commands/legacyCreationRecipes";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import type { ElementId } from "../types/geometry";

const commandLineCreationCommandIds = new Set(legacyCreationCommandIds);

const GroupTemplateLibraryDialog = lazy(() =>
  import("./GroupTemplateLibraryDialog").then((module) => ({
    default: module.GroupTemplateLibraryDialog
  }))
);
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
const TemplateInsertionPanel = lazy(() =>
  import("./TemplateInsertionPanel").then((module) => ({
    default: module.TemplateInsertionPanel
  }))
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
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const showPrintLayout = useCadUiStore((state) => state.showPrintLayout);
  const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
  const showPaletteSettings = useCadUiStore((state) => state.showPaletteSettings);
  const showVisibilityProfileSettings = useCadUiStore(
    (state) => state.showVisibilityProfileSettings
  );
  const showGroupTemplateLibrary = useCadUiStore((state) => state.showGroupTemplateLibrary);
  const showShortcutSettings = useCadUiStore((state) => state.showShortcutSettings);
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const showSelectionColorPicker = useCadUiStore((state) => state.showSelectionColorPicker);
  const renameElementPromptTargetId = useCadUiStore((state) => state.renameElementPromptTargetId);
  const pendingImageImport = useCadUiStore((state) => state.pendingImageImport);
  const imageImportError = useCadUiStore((state) => state.imageImportError);
  const setPrintPreviewWindow = useCadUiStore((state) => state.setPrintPreviewWindow);
  const activeTemplateInsertion = useCadUiStore((state) => state.activeTemplateInsertion);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const commandLineSession = useCadUiStore((state) => state.commandLineSession);
  const isPickMode = useCadUiStore(
    (state) =>
      Boolean(state.activePointPickTarget) ||
      Boolean(state.activeNumericReferencePickTarget) ||
      Boolean(state.activeLinePickTarget) ||
      Boolean(state.activeTemplateInsertion)
  );
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLElement>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);
  const commandRibbonDockRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_LEFT_PANEL_WIDTH);
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);
  const leftPanelResizeStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const evaluationOptions = useMemo(() => ({ evaluationLimitIndex }), [evaluationLimitIndex]);
  const evaluationState = useEvaluationEngine(elements, evaluationOptions, compiledDocumentRevision);
  const { evaluation, evaluationRevision, evaluationRequestRevision } = evaluationState;
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
    // async Rust results may arrive after the document advanced, and stamping the
    // current revision would mislabel a stale result as fresh.
    sourceEditorRef.current?.setEvaluation({
      evaluation,
      compiledDocumentRevision: evaluationRevision,
      evaluationRequestRevision
    });
  }, [evaluation, evaluationRevision, evaluationRequestRevision]);
  const commandContext = useMemo(() => ({
    focusCanvas: () => canvasFocusRef.current?.focus(),
    focusSourceEditor: () => sourceEditorRef.current?.focus(),
    focusElementSearch: () => sourceEditorRef.current?.focusSearch(),
    currentCursorElementId: () => sourceEditorRef.current?.currentCursorElementId?.() ?? null,
    focusSourceEditorParameter: (elementId: ElementId, parameterKey: string) => {
      sourceEditorRef.current?.jumpToParameterValue(elementId, parameterKey);
    },
    clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
    clearSourceEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
    getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
    evaluation
  }), [evaluation]);
  const handleRenameElementConfirmed = useCallback((elementId: ElementId) => {
    sourceEditorRef.current?.jumpToElement(elementId);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutSettings()
      .then((settings) => {
        if (!cancelled) {
          setLeftPanelWidth(settings.leftPanelWidth);
          setPrintPreviewWindow(settings.printPreviewWindow);
        }
      })
      .catch((error: unknown) => {
        console.error("failed to load layout settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [setPrintPreviewWindow]);

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
    if (!isResizingLeftPanel) return;

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const start = leftPanelResizeStartRef.current;
      if (!start) return;
      event.preventDefault();
      setLeftPanelWidth(clampLeftPanelWidth(start.width + event.clientX - start.clientX));
    };
    const stopResize = (event: globalThis.PointerEvent) => {
      const start = leftPanelResizeStartRef.current;
      if (!start) return;
      event.preventDefault();
      const nextWidth = clampLeftPanelWidth(start.width + event.clientX - start.clientX);
      setLeftPanelWidth(nextWidth);
      saveLeftPanelWidth(nextWidth);
      leftPanelResizeStartRef.current = null;
      setIsResizingLeftPanel(false);
    };
    const cancelResize = () => {
      leftPanelResizeStartRef.current = null;
      setIsResizingLeftPanel(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelResize();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", cancelResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelResize);
    };
  }, [isResizingLeftPanel]);

  const startLeftPanelResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    leftPanelResizeStartRef.current = {
      clientX: event.clientX,
      width: leftPanelWidth
    };
    setIsResizingLeftPanel(true);
  };

  const resetLeftPanelWidth = () => {
    setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH);
    saveLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSourceEditorTarget = isSourceEditorKeyboardTarget(event);
      // DSL and the lens are handled by CodeMirror. The React element-search field
      // admits only cross-focus commands; menus/docks keep their own keyboard UI.
      if (isSourceEditorTarget && isSourceEditorDslKeyboardTarget(event)) return;
      if (isSourceEditorTarget && !isSourceEditorSearchKeyboardTarget(event)) return;
      if (isImeComposingKeyEvent(event) || isCommandLineInputComposing()) return;
      if (useCadUiStore.getState().showShortcutSettings) return;
      if (useCadUiStore.getState().showPaletteSettings) return;
      if (useCadUiStore.getState().showGroupTemplateLibrary) return;
      if (useCadUiStore.getState().showCommandRibbonSettings) return;
      if (useCadUiStore.getState().showSelectionColorPicker) return;
      if (useCadUiStore.getState().renameElementPromptTargetId) return;
      if (useCadUiStore.getState().pendingImageImport || useCadUiStore.getState().imageImportError) return;
      const commandLineSession = useCadUiStore.getState().commandLineSession;
      const keyboardOptions = {
        settings: useCadUiStore.getState().shortcutSettings,
        isPickMode: Boolean(
          useCadUiStore.getState().activePointPickTarget ||
            useCadUiStore.getState().activeNumericReferencePickTarget ||
            useCadUiStore.getState().activeLinePickTarget ||
            useCadUiStore.getState().activeTemplateInsertion
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
        dispatchCommand("cancelCommandLineSession");
        return;
      }
      if (useCadUiStore.getState().activeTemplateInsertion && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelTemplateInsertion");
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
          !event.target.closest(".canvas-workspace, .pick-mode-status")
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
        title="ドラッグで左パネル幅を変更 / ダブルクリックでリセット"
        tabIndex={0}
        inert={isMultiLinePicking || undefined}
        onPointerDown={startLeftPanelResize}
        onDoubleClick={resetLeftPanelWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            const nextWidth = clampLeftPanelWidth(leftPanelWidth - (event.shiftKey ? 40 : 10));
            setLeftPanelWidth(nextWidth);
            saveLeftPanelWidth(nextWidth);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            const nextWidth = clampLeftPanelWidth(leftPanelWidth + (event.shiftKey ? 40 : 10));
            setLeftPanelWidth(nextWidth);
            saveLeftPanelWidth(nextWidth);
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
            <DrawingCanvas
              ref={drawingCanvasRef}
              evaluation={evaluation}
              evaluationState={evaluationState}
              canvasFocusRef={canvasFocusRef}
              commandContext={commandContext}
              leftPanelDockRef={commandRibbonDockRef}
            />
            <CommandLineBar commandContext={commandContext} evaluation={evaluation} />
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
      {activeTemplateInsertion ? (
        <Suspense fallback={null}>
          <TemplateInsertionPanel />
        </Suspense>
      ) : null}
      <ShortcutHelpOverlay isPickMode={isPickMode} />
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
      {showGroupTemplateLibrary ? (
        <Suspense fallback={null}>
          <GroupTemplateLibraryDialog />
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
