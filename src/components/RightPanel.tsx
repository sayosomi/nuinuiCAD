import { dispatchCommand } from "../commands/commands";
import { useCadStore } from "../state/useCadStore";
import type { EvaluationResult } from "../types/geometry";
import { ElementEditor } from "./ElementEditor";
import { ElementInfoPanel } from "./ElementInfoPanel";

type RightPanelProps = {
  evaluation: EvaluationResult;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

export const RightPanel = ({
  evaluation,
  isParameterEditMode,
  isDependencyJumpMode,
  registerParameterControl
}: RightPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedDependencyJumpIndex = useCadStore((state) => state.selectedDependencyJumpIndex);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcutHint = isParameterEditMode || isDependencyJumpMode
    ? "Esc で終了 / ? でショートカット"
    : "? でショートカット";

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
        setSelectedElementId={setSelectedElementId}
      />

      <section className="panel-section">
        <div className="section-header">
          <h2>バリデーション</h2>
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
