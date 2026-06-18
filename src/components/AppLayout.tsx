import { useEffect, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { evaluateElements } from "../geometry/evaluate";
import { commandIdForKeyboardEvent } from "../keyboard/shortcuts";
import { useCadStore } from "../state/useCadStore";
import { DrawingCanvas } from "./DrawingCanvas";
import { LeftPanel } from "./LeftPanel";

export const AppLayout = () => {
  const elements = useCadStore((state) => state.elements);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const elementListFocusRef = useRef<HTMLDivElement>(null);
  const evaluation = useMemo(() => evaluateElements(elements), [elements]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandId = commandIdForKeyboardEvent(event);
      if (!commandId) return;
      event.preventDefault();
      dispatchCommand(commandId, {
        focusCanvas: () => canvasFocusRef.current?.focus(),
        focusElementList: () => elementListFocusRef.current?.focus()
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
      />
      <DrawingCanvas
        evaluation={evaluation}
        canvasFocusRef={canvasFocusRef}
      />
    </main>
  );
};
