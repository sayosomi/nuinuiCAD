import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { SourceEditorController } from "../editor/sourceEditorController";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";

/**
 * Phase 2a mount boundary only. AppLayout intentionally does not render this pane until Phase 2e.
 */
export const SourceEditorPane = forwardRef<SourceEditorHandle>(function SourceEditorPane(_, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SourceEditorController | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = new SourceEditorController(containerRef.current);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => controllerRef.current?.focus(),
    getText: () => controllerRef.current?.getText() ?? ""
  }), []);

  return <div className="source-editor-pane" ref={containerRef} aria-label="DSL source editor" />;
});
