import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { evaluateElements } from "../geometry/evaluate";
import { keyboardCommandForEvent } from "../keyboard/shortcuts";
import { useCadStore } from "../state/useCadStore";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel } from "./LeftPanel";

export const AppLayout = () => {
  const elements = useCadStore((state) => state.elements);
  const isParameterEditMode = useCadStore((state) => state.isParameterEditMode);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const elementListFocusRef = useRef<HTMLDivElement>(null);
  const parameterInputRefs = useRef(new Map<string, HTMLElement>());
  const evaluation = useMemo(() => evaluateElements(elements), [elements]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keyboardCommand = keyboardCommandForEvent(event, {
        isParameterEditMode: useCadStore.getState().isParameterEditMode
      });
      if (!keyboardCommand) return;
      event.preventDefault();
      dispatchCommand(keyboardCommand.commandId, {
        focusCanvas: () => canvasFocusRef.current?.focus(),
        focusElementList: () => elementListFocusRef.current?.focus(),
        focusSelectedParameterInput: () => {
          const selectedKey = useCadStore.getState().selectedParameterKey;
          if (!selectedKey) return;
          parameterInputRefs.current.get(selectedKey)?.focus();
        },
        ...keyboardCommand.context
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="app-shell">
      <LeftPanel
        evaluation={evaluation}
        elementListFocusRef={elementListFocusRef}
        isParameterEditMode={isParameterEditMode}
        registerParameterControl={(key, element) => {
          if (element) {
            parameterInputRefs.current.set(key, element);
          } else {
            parameterInputRefs.current.delete(key);
          }
        }}
      />
      <DrawingCanvas
        evaluation={evaluation}
        canvasFocusRef={canvasFocusRef}
      />
    </main>
  );
};
