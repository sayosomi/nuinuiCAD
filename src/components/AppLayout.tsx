import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import { loadCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { registerUnsavedChangesGuard } from "../document/unsavedChangesGuard";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { loadShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  clampLeftPanelWidth,
  loadLayoutSettings,
  saveLayoutSettings
} from "../layout/layoutSettingsStorage";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { registerTauriMenuCommandListener } from "../commands/tauriMenuEvents";
import { selectTextInputValue } from "./textInputSelection";

const DslPanel = lazy(() =>
  import("./DslPanel").then((module) => ({ default: module.DslPanel }))
);
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
  const elements = useCadDocumentStore((state) => state.elements);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const isParameterEditMode = useCadUiStore((state) => state.isParameterEditMode);
  const isDependencyJumpMode = useCadUiStore((state) => state.isDependencyJumpMode);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const showPrintLayout = useCadUiStore((state) => state.showPrintLayout);
  const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
  const showDslPanel = useCadUiStore((state) => state.showDslPanel);
  const showPaletteSettings = useCadUiStore((state) => state.showPaletteSettings);
  const showVisibilityProfileSettings = useCadUiStore(
    (state) => state.showVisibilityProfileSettings
  );
  const showGroupTemplateLibrary = useCadUiStore((state) => state.showGroupTemplateLibrary);
  const showShortcutSettings = useCadUiStore((state) => state.showShortcutSettings);
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const showSelectionColorPicker = useCadUiStore((state) => state.showSelectionColorPicker);
  const pendingImageImport = useCadUiStore((state) => state.pendingImageImport);
  const imageImportError = useCadUiStore((state) => state.imageImportError);
  const setPrintPreviewWindow = useCadUiStore((state) => state.setPrintPreviewWindow);
  const setDslPanelWindow = useCadUiStore((state) => state.setDslPanelWindow);
  const activeTemplateInsertion = useCadUiStore((state) => state.activeTemplateInsertion);
  const isPickMode = useCadUiStore(
    (state) =>
      Boolean(state.activePointPickTarget) ||
      Boolean(state.activeNumericReferencePickTarget) ||
      Boolean(state.activeLinePickTarget) ||
      Boolean(state.activeTemplateInsertion)
  );
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);
  const commandRibbonDockRef = useRef<HTMLDivElement>(null);
  const elementListFocusRef = useRef<HTMLDivElement>(null);
  const elementSearchInputRef = useRef<HTMLInputElement>(null);
  const parameterInputRefs = useRef(new Map<string, HTMLElement>());
  const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_LEFT_PANEL_WIDTH);
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);
  const leftPanelResizeStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const evaluationOptions = useMemo(() => ({ evaluationLimitIndex }), [evaluationLimitIndex]);
  const evaluationState = useEvaluationEngine(elements, evaluationOptions);
  const { evaluation } = evaluationState;
  const registerParameterControl = (key: string, element: HTMLElement | null) => {
    if (element) {
      parameterInputRefs.current.set(key, element);
    } else {
      parameterInputRefs.current.delete(key);
    }
  };
  const commandContext = useMemo(() => ({
    focusCanvas: () => canvasFocusRef.current?.focus(),
    focusElementList: () => elementListFocusRef.current?.focus(),
    focusElementSearch: () => {
      requestAnimationFrame(() => {
        elementSearchInputRef.current?.focus();
        elementSearchInputRef.current?.select();
      });
    },
    getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
    focusSelectedParameterInput: () => {
      const selectedKey = useCadDocumentStore.getState().selectedParameterKey;
      if (!selectedKey) return;
      const input = parameterInputRefs.current.get(selectedKey);
      input?.focus();
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.select();
      }
    },
    evaluation
  }), [evaluation]);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutSettings()
      .then((settings) => {
        if (!cancelled) {
          setLeftPanelWidth(settings.leftPanelWidth);
          setPrintPreviewWindow(settings.printPreviewWindow);
          setDslPanelWindow(settings.dslPanelWindow);
        }
      })
      .catch((error: unknown) => {
        console.error("failed to load layout settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [setDslPanelWindow, setPrintPreviewWindow]);

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
      if (useCadUiStore.getState().showShortcutSettings) return;
      if (useCadUiStore.getState().showPaletteSettings) return;
      if (useCadUiStore.getState().showGroupTemplateLibrary) return;
      if (useCadUiStore.getState().showDslPanel) return;
      if (useCadUiStore.getState().showCommandRibbonSettings) return;
      if (useCadUiStore.getState().showSelectionColorPicker) return;
      if (useCadUiStore.getState().pendingImageImport || useCadUiStore.getState().imageImportError) return;
      const keyboardCommand = keyboardCommandForEvent(event, {
        settings: useCadUiStore.getState().shortcutSettings,
        isParameterEditMode: useCadUiStore.getState().isParameterEditMode,
        isDependencyJumpMode: useCadUiStore.getState().isDependencyJumpMode,
        isPickMode: Boolean(
          useCadUiStore.getState().activePointPickTarget ||
            useCadUiStore.getState().activeNumericReferencePickTarget ||
            useCadUiStore.getState().activeLinePickTarget ||
            useCadUiStore.getState().activeTemplateInsertion
        )
      });
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
      className={`app-shell ${isResizingLeftPanel ? "is-resizing-left-panel" : ""}`}
      style={{ "--left-panel-width": `${leftPanelWidth}px` } as CSSProperties}
      onFocusCapture={(event) => selectTextInputValue(event.target)}
    >
      <LeftPanel
        canvasFocusRef={canvasFocusRef}
        commandContext={commandContext}
        commandRibbonDockRef={commandRibbonDockRef}
        evaluation={evaluation}
        elementListFocusRef={elementListFocusRef}
        elementSearchInputRef={elementSearchInputRef}
      />
      <div
        className="left-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="左パネル幅を変更"
        title="ドラッグで左パネル幅を変更 / ダブルクリックでリセット"
        tabIndex={0}
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
              evaluation={evaluation}
              evaluationState={evaluationState}
              canvasFocusRef={canvasFocusRef}
              commandContext={commandContext}
              leftPanelDockRef={commandRibbonDockRef}
            />
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
            isParameterEditMode={isParameterEditMode}
            isDependencyJumpMode={isDependencyJumpMode}
            registerParameterControl={registerParameterControl}
          />
        </>
      )}
      <CommandPalette commandContext={commandContext} />
      {activeTemplateInsertion ? (
        <Suspense fallback={null}>
          <TemplateInsertionPanel />
        </Suspense>
      ) : null}
      {showDslPanel ? (
        <Suspense fallback={null}>
          <DslPanel commandContext={commandContext} evaluation={evaluation} />
        </Suspense>
      ) : null}
      <ShortcutHelpOverlay
        isParameterEditMode={isParameterEditMode}
        isDependencyJumpMode={isDependencyJumpMode}
        isPickMode={isPickMode}
        isDslPanelMode={showDslPanel}
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
