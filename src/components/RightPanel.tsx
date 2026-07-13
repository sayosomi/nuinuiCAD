import { useRef } from "react";
import type { RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import {
  effectiveElements,
  useCadDocumentStore,
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { InspectorPanel } from "./InspectorPanel";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";

type RightPanelProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
};

const evaluationEngineLabel = (state: EvaluationEngineState | undefined) => {
  if (!state || state.mode === "reference") return null;
  if (state.mode === "parity" || state.mode === "shadow") {
    if (state.status === "evaluating") return "parity / Rust評価中";
    if (state.status === "failed") return "parity / Rust失敗";
    return "parity";
  }
  if (state.source === "fallback") return "TS fallback";
  if (state.status === "evaluating")
    return state.isStale ? "Rust評価中 / stale" : "Rust評価中";
  if (state.source === "rust") return "Rust評価";
  return null;
};

export const RightPanel = ({
  evaluation,
  evaluationState,
  sourceEditorRef,
}: RightPanelProps) => {
  const rightPanelRef = useRef<HTMLElement | null>(null);
  const elements = useCadDocumentStore(effectiveElements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedElement =
    elements.find((element) => element.id === selectedElementId) ?? null;

  return (
    <aside className="right-panel" ref={rightPanelRef}>
      <div className="right-panel-scroll">
        <InspectorPanel
          element={selectedElement}
          elements={elements}
          evaluation={evaluation}
          evaluationEngineLabel={evaluationEngineLabel(evaluationState)}
          isEvaluationFallback={evaluationState?.source === "fallback"}
          isEvaluationStale={evaluationState?.isStale}
          sourceEditorRef={sourceEditorRef}
        />
      </div>
      <footer className="panel-section right-panel-footer">
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
        <p className="empty-state">? でショートカット</p>
      </footer>
    </aside>
  );
};
