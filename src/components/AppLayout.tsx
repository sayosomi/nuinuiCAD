import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { evaluateElements } from "../geometry/evaluate";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";

export const AppLayout = () => {
  const elements = useCadDocumentStore((state) => state.elements);
  const isParameterEditMode = useCadUiStore((state) => state.isParameterEditMode);
  const isDependencyJumpMode = useCadUiStore((state) => state.isDependencyJumpMode);
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
  const evaluation = useMemo(() => evaluateElements(elements), [elements]);
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
    const onKeyDown = (event: KeyboardEvent) => {
      const keyboardCommand = keyboardCommandForEvent(event, {
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
  }, [commandContext]);

  return (
    <main className="app-shell">
      <LeftPanel
        evaluation={evaluation}
        elementListFocusRef={elementListFocusRef}
        elementSearchInputRef={elementSearchInputRef}
      />
      <DrawingCanvas
        evaluation={evaluation}
        canvasFocusRef={canvasFocusRef}
      />
      <RightPanel
        evaluation={evaluation}
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
    </main>
  );
};
