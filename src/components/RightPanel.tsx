import { useEffect, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import { numericValueExpression } from "../geometry/numericExpressions";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { NumericValue } from "../types/geometry";
import type { EvaluationResult } from "../types/geometry";
import { ElementEditor } from "./ElementEditor";
import { ElementInfoPanel } from "./ElementInfoPanel";
import { ExpressionInsertTray } from "./ExpressionInsertTray";

type RightPanelProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

const evaluationEngineLabel = (state: EvaluationEngineState) => {
  if (state.mode === "parity" || state.mode === "shadow") {
    if (state.status === "evaluating") return "parity / Rust評価中";
    if (state.status === "failed") return "parity / Rust失敗";
    return "parity";
  }
  if (state.source === "fallback") return "TS fallback";
  if (state.status === "evaluating") return state.isStale ? "Rust評価中 / stale" : "Rust評価中";
  if (state.source === "rust") return "Rust評価";
  return null;
};

const isNumericValue = (value: unknown): value is NumericValue =>
  typeof value === "number" ||
  (typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "expression");

export const RightPanel = ({
  evaluation,
  evaluationState,
  isParameterEditMode,
  isDependencyJumpMode,
  registerParameterControl
}: RightPanelProps) => {
  const rightPanelRef = useRef<HTMLElement | null>(null);
  const elements = useCadDocumentStore(effectiveElements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedParameterKey = useCadUiStore((state) => state.selectedParameterKey);
  const selectedDependencyJumpIndex = useCadUiStore((state) => state.selectedDependencyJumpIndex);
  const activeExpressionInsertTarget = useCadUiStore((state) => state.activeExpressionInsertTarget);
  const expressionInsertInputTarget = useCadUiStore((state) => state.expressionInsertInputTarget);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const expressionInsertElement = activeExpressionInsertTarget
    ? elements.find((element) => element.id === activeExpressionInsertTarget.elementId) ?? null
    : null;
  const expressionInsertParameter = expressionInsertElement && activeExpressionInsertTarget
    ? findParameterDefinition(expressionInsertElement, activeExpressionInsertTarget.parameterKey)
    : null;
  const expressionInsertValue = expressionInsertElement && expressionInsertParameter
    ? getParameterValue(expressionInsertElement, expressionInsertParameter.key)
    : null;
  const currentInputTarget =
    expressionInsertInputTarget?.elementId === activeExpressionInsertTarget?.elementId &&
    expressionInsertInputTarget?.parameterKey === activeExpressionInsertTarget?.parameterKey
      ? expressionInsertInputTarget
      : null;
  const displayedExpression = currentInputTarget
    ? currentInputTarget.displayedExpression
    : isNumericValue(expressionInsertValue)
      ? numericValueExpression(expressionInsertValue)
      : typeof expressionInsertValue === "string"
        ? expressionInsertValue
      : "";
  const shortcutHint = isParameterEditMode || isDependencyJumpMode
    ? "Esc で終了 / ? でショートカット"
    : "? でショートカット";
  const engineLabel = evaluationState && evaluationState.mode !== "reference"
    ? evaluationEngineLabel(evaluationState)
    : null;

  useEffect(() => {
    if (!isParameterEditMode || !selectedElementId || !selectedParameterKey) return undefined;

    const animationFrameId = requestAnimationFrame(() => {
      const selectedParameter = rightPanelRef.current?.querySelector<HTMLElement>(
        ".selected-parameter"
      );
      if (!selectedParameter?.scrollIntoView) return;
      selectedParameter.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, [isParameterEditMode, selectedElementId, selectedParameterKey]);

  return (
    <aside className="right-panel" ref={rightPanelRef}>
      {selectedElement ? (
        <ElementEditor
          element={selectedElement}
          elements={elements}
          evaluation={evaluation}
          isParameterEditMode={isParameterEditMode}
          registerParameterControl={registerParameterControl}
        />
      ) : (
        <section className="panel-section">
          <div className="section-header">
            <h2>要素設定</h2>
          </div>
          <p className="empty-state">要素を選択してください。</p>
        </section>
      )}

      {expressionInsertElement && activeExpressionInsertTarget && (
        expressionInsertParameter?.kind === "number" ||
        (expressionInsertElement.type === "text" && expressionInsertParameter?.key === "text")
      ) ? (
        <ExpressionInsertTray
          element={expressionInsertElement}
          elements={elements}
          evaluation={evaluation}
          parameterKey={expressionInsertParameter.key}
          focusInput={() => {
            const selector = activeExpressionInsertTarget.parameterKey === "text"
              ? `textarea[data-text-element-id="${activeExpressionInsertTarget.elementId}"][data-text-parameter-key="${activeExpressionInsertTarget.parameterKey}"]`
              : `input[data-numeric-element-id="${activeExpressionInsertTarget.elementId}"][data-numeric-parameter-key="${activeExpressionInsertTarget.parameterKey}"]`;
            document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.focus();
          }}
          getInputTarget={() => ({
            displayedExpression,
            selectionStart:
              expressionInsertInputTarget?.elementId === activeExpressionInsertTarget.elementId &&
              expressionInsertInputTarget.parameterKey === activeExpressionInsertTarget.parameterKey
                ? expressionInsertInputTarget.selectionStart
                : null,
            selectionEnd:
              expressionInsertInputTarget?.elementId === activeExpressionInsertTarget.elementId &&
              expressionInsertInputTarget.parameterKey === activeExpressionInsertTarget.parameterKey
                ? expressionInsertInputTarget.selectionEnd
                : null
          })}
        />
      ) : null}

      <ElementInfoPanel
        element={selectedElement}
        elements={elements}
        evaluation={evaluation}
        evaluationEngineLabel={engineLabel}
        isEvaluationFallback={evaluationState?.source === "fallback"}
        isEvaluationStale={evaluationState?.isStale}
        isDependencyJumpMode={isDependencyJumpMode}
        selectedDependencyJumpIndex={selectedDependencyJumpIndex}
        setSelectedElementId={(id) => {
          if (id) dispatchCommand("selectElement", { elementId: id });
        }}
      />

      <section className="panel-section">
        <div className="section-header">
          <h2>ショートカット</h2>
          <button
            type="button"
            aria-label="ショートカット一覧を表示"
            onClick={() => dispatchCommand("toggleShortcutHelp")}
          >
            ?
          </button>
        </div>
        <p className="empty-state">{shortcutHint}</p>
      </section>
    </aside>
  );
};
