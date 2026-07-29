import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DslDiagnostic, DslDiagnosticNavigationTarget } from "../dsl/dslTypes";
import { useCadDocumentStore } from "../state/cadDocumentStore";

export type DocumentDiagnosticsProps = {
  /** Task 48: fresh TS/Rust runtime diagnostics, supplied by the caller (see
   * SourceEditorPane.tsx) - never read from the store directly, since these
   * are derived live from the Source Editor controller, not persisted state. */
  runtimeDiagnostics?: readonly DslDiagnostic[];
  /** Called for a diagnostic whose own navigationTarget resolved at build
   * time. Absent entirely (default no-op) renders every row as plain text. */
  onNavigate?: (target: DslDiagnosticNavigationTarget) => void;
};

export const DocumentDiagnostics = ({ runtimeDiagnostics = [], onNavigate }: DocumentDiagnosticsProps) => {
  const compileDiagnostics = useCadDocumentStore((state) => state.diagnostics);
  const bindingIssueDiagnostics = useCadDocumentStore((state) => state.bindingIssueDiagnostics);
  // Task 48: one fixed, stable order for display - compile-time diagnostics
  // (already in compileDslDocument's own deterministic order), then
  // BindingIssue-derived diagnostics (bindingAnalysis.issues' own
  // deterministic order), then fresh runtime diagnostics last. Never
  // re-sorted here.
  const diagnostics = [...compileDiagnostics, ...bindingIssueDiagnostics, ...runtimeDiagnostics];
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
          {diagnostics.map((diagnostic, index) => {
            const target = diagnostic.navigationTarget;
            const text = `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
            if (!target || !onNavigate) {
              return (
                <p key={`${diagnostic.line}-${diagnostic.column}-${index}`} className={diagnostic.severity}>
                  {text}
                </p>
              );
            }
            return (
              <button
                key={`${diagnostic.line}-${diagnostic.column}-${index}`}
                type="button"
                className={`document-diagnostics-row ${diagnostic.severity}`}
                onClick={() => onNavigate(target)}
              >
                {text}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
