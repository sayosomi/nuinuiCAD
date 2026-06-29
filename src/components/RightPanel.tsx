import { dispatchCommand } from "../commands/commands";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { ElementEditor } from "./ElementEditor";
import { ElementInfoPanel } from "./ElementInfoPanel";

type RightPanelProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

const evaluationEngineLabel = (state: EvaluationEngineState) => {
  if (state.mode === "shadow") {
    if (state.status === "evaluating") return "shadow / Rust評価中";
    if (state.status === "failed") return "shadow / Rust失敗";
    return "shadow";
  }
  if (state.source === "fallback") return "TS fallback";
  if (state.status === "evaluating") return state.isStale ? "Rust評価中 / stale" : "Rust評価中";
  if (state.source === "rust") return "Rust評価";
  return null;
};

export const RightPanel = ({
  evaluation,
  evaluationState,
  isParameterEditMode,
  isDependencyJumpMode,
  registerParameterControl
}: RightPanelProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadDocumentStore((state) => state.selectedElementId);
  const selectedDependencyJumpIndex = useCadUiStore((state) => state.selectedDependencyJumpIndex);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcutHint = isParameterEditMode || isDependencyJumpMode
    ? "Esc で終了 / ? でショートカット"
    : "? でショートカット";
  const engineLabel = evaluationState && evaluationState.mode !== "reference"
    ? evaluationEngineLabel(evaluationState)
    : null;

  return (
    <aside className="right-panel">
      {selectedElement ? (
        <ElementEditor
          element={selectedElement}
          elements={elements}
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

      <ElementInfoPanel
        element={selectedElement}
        elements={elements}
        evaluation={evaluation}
        isDependencyJumpMode={isDependencyJumpMode}
        selectedDependencyJumpIndex={selectedDependencyJumpIndex}
        setSelectedElementId={(id) => {
          if (id) dispatchCommand("selectElement", { elementId: id });
        }}
      />

      <section className="panel-section">
        <div className="section-header">
          <h2>バリデーション</h2>
          {engineLabel ? (
            <small
              className={`evaluation-engine-status ${
                evaluationState?.isStale ? "stale" : ""
              } ${evaluationState?.source === "fallback" ? "fallback" : ""}`}
            >
              {engineLabel}
            </small>
          ) : null}
        </div>
        {evaluation.errors.length === 0 && evaluation.warnings.length === 0 ? (
          <p className="empty-state">エラーや警告はありません。</p>
        ) : (
          <ul className="error-list">
            {evaluation.errors.map((error) => (
              <li key={`${error.elementId}-${error.missingDependencyId}`}>
                <strong>{error.elementName}</strong>
                <span>{error.message}</span>
              </li>
            ))}
            {evaluation.warnings.map((warning, index) => (
              <li key={`${warning.elementId}-warning-${index}`} className="warning-item">
                <strong>{warning.elementName}</strong>
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
