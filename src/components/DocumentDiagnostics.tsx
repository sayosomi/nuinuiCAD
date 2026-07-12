import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCadDocumentStore } from "../state/cadDocumentStore";

export const DocumentDiagnostics = () => {
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="document-diagnostics" ref={rootRef}>
      <button
        type="button"
        className={`document-diagnostics-toggle ${errors > 0 ? "has-error" : warnings > 0 ? "has-warning" : ""}`}
        aria-label={diagnostics.length > 0 ? `文書診断: エラー ${errors} 件、警告 ${warnings} 件` : "文書診断なし"}
        aria-expanded={isOpen}
        aria-controls="document-diagnostics-popover"
        onClick={() => setIsOpen((open) => !open)}
      >
        <AlertTriangle size={14} aria-hidden="true" />
        {diagnostics.length > 0 ? <span>{errors + warnings}</span> : <span>✓</span>}
      </button>
      {isOpen && diagnostics.length > 0 ? (
        <div className="document-diagnostics-popover" id="document-diagnostics-popover" role="region" aria-label="文書診断">
          {diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic.line}-${diagnostic.column}-${index}`} className={diagnostic.severity}>
              {diagnostic.line}:{diagnostic.column} {diagnostic.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
};
