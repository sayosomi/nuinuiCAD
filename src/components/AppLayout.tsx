import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { evaluateElements } from "../geometry/evaluate";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import { useCadStore } from "../state/useCadStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";

export const AppLayout = () => {
  const elements = useCadStore((state) => state.elements);
  const isParameterEditMode = useCadStore((state) => state.isParameterEditMode);
  const isDependencyJumpMode = useCadStore((state) => state.isDependencyJumpMode);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const elementListFocusRef = useRef<HTMLDivElement>(null);
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
    getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
    focusSelectedParameterInput: () => {
      const selectedKey = useCadStore.getState().selectedParameterKey;
      if (!selectedKey) return;
      parameterInputRefs.current.get(selectedKey)?.focus();
    }
  }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keyboardCommand = keyboardCommandForEvent(event, {
        isParameterEditMode: useCadStore.getState().isParameterEditMode,
        isDependencyJumpMode: useCadStore.getState().isDependencyJumpMode
      });
      if (!keyboardCommand) return;
      if (
        useCadStore.getState().showShortcutHelp &&
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
      />
    </main>
  );
};
