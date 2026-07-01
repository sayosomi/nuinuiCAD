import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { registerUnsavedChangesGuard } from "../document/unsavedChangesGuard";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { loadShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { PaletteSettingsDialog } from "./PalettePanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { ShortcutSettingsDialog } from "./ShortcutSettingsDialog";
import { registerTauriMenuCommandListener } from "../commands/tauriMenuEvents";

export const AppLayout = () => {
  const elements = useCadDocumentStore((state) => state.elements);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const isParameterEditMode = useCadUiStore((state) => state.isParameterEditMode);
  const isDependencyJumpMode = useCadUiStore((state) => state.isDependencyJumpMode);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const isPickMode = useCadUiStore(
    (state) =>
      Boolean(state.activePointPickTarget) ||
      Boolean(state.activeNumericReferencePickTarget) ||
      Boolean(state.activeLinePickTarget)
  );
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const elementListFocusRef = useRef<HTMLDivElement>(null);
  const elementSearchInputRef = useRef<HTMLInputElement>(null);
  const parameterInputRefs = useRef(new Map<string, HTMLElement>());
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
      parameterInputRefs.current.get(selectedKey)?.focus();
    }
  }), []);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (useCadUiStore.getState().showShortcutSettings) return;
      if (useCadUiStore.getState().showPaletteSettings) return;
      const keyboardCommand = keyboardCommandForEvent(event, {
        settings: useCadUiStore.getState().shortcutSettings,
        isParameterEditMode: useCadUiStore.getState().isParameterEditMode,
        isDependencyJumpMode: useCadUiStore.getState().isDependencyJumpMode,
        isPickMode: Boolean(
          useCadUiStore.getState().activePointPickTarget ||
            useCadUiStore.getState().activeNumericReferencePickTarget ||
            useCadUiStore.getState().activeLinePickTarget
        )
      });
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
    <main className="app-shell">
      <LeftPanel
        evaluation={evaluation}
        elementListFocusRef={elementListFocusRef}
        elementSearchInputRef={elementSearchInputRef}
      />
      <DrawingCanvas
        evaluation={evaluation}
        evaluationState={evaluationState}
        canvasFocusRef={canvasFocusRef}
      />
      <RightPanel
        evaluation={evaluation}
        evaluationState={evaluationState}
        isParameterEditMode={isParameterEditMode}
        isDependencyJumpMode={isDependencyJumpMode}
        registerParameterControl={registerParameterControl}
      />
      <CommandPalette commandContext={commandContext} />
      <ShortcutHelpOverlay
        isParameterEditMode={isParameterEditMode}
        isDependencyJumpMode={isDependencyJumpMode}
        isPickMode={isPickMode}
      />
      <PaletteSettingsDialog />
      <ShortcutSettingsDialog />
    </main>
  );
};
