import { Check, FileInput, Play, X } from "lucide-react";
import { useMemo, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { compileDslToElements } from "../dsl/dslCompiler";
import { serializeElementsToDsl } from "../dsl/dslSerializer";
import type { DslDiagnostic } from "../dsl/dslTypes";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

const defaultSource = [
  "# nuinuiCAD DSL",
  "var bust = 840",
  "point A = (0, 0)",
  "point B = offset A dx=0 dy=-(bust / 4)",
  "line AB = A -> B"
].join("\n");

const diagnosticText = (diagnostic: DslDiagnostic) =>
  `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;

export const DslPanel = () => {
  const showDslPanel = useCadUiStore((state) => state.showDslPanel);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const commitDocumentChange = useCadDocumentStore((state) => state.commitDocumentChange);
  const [source, setSource] = useState(defaultSource);
  const [diagnostics, setDiagnostics] = useState<DslDiagnostic[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const selectedElements = useMemo(
    () => elements.filter((element) => selectedElementIds.includes(element.id)),
    [elements, selectedElementIds]
  );

  if (!showDslPanel) return null;

  const insertionIndex = selectedElementIds.length > 0
    ? Math.max(
        ...elements
          .map((element, index) => (selectedElementIds.includes(element.id) ? index : -1))
          .filter((index) => index >= 0)
      ) + 1
    : elements.length;

  const validate = () => {
    const result = compileDslToElements(source, {
      elements,
      insertionIndex,
      selectedElementIds
    });
    setDiagnostics(result.diagnostics);
    const errorCount = result.diagnostics.filter((item) => item.severity === "error").length;
    setStatus(errorCount === 0 ? `${result.changedCount}件の要素を適用できます。` : `${errorCount}件のエラーがあります。`);
    return result;
  };

  const apply = () => {
    const result = validate();
    if (result.diagnostics.some((item) => item.severity === "error")) return;
    const insertedCount = Math.max(result.elements.length - elements.length, 0);
    commitDocumentChange({
      elements: result.elements,
      selectedElementId: result.selectedElementId,
      selectedElementIds: result.selectedElementIds,
      selectionAnchorElementId: result.selectedElementId,
      evaluationLimitIndex: insertedCount > 0
        ? adjustEvaluationLimitForInsertion({
            elements,
            evaluationLimitIndex,
            insertionIndex,
            insertedCount
          })
        : evaluationLimitIndex
    });
    setStatus(`${result.changedCount}件の要素を適用しました。`);
  };

  const exportSelection = () => {
    const targets = selectedElements.length > 0 ? selectedElements : elements;
    setSource(serializeElementsToDsl(targets));
    setDiagnostics([]);
    setStatus(selectedElements.length > 0 ? "選択要素をDSLへ書き出しました。" : "全要素をDSLへ書き出しました。");
  };

  return (
    <aside className="dsl-panel" aria-label="DSLパネル">
      <div className="dsl-panel-header">
        <div>
          <span>DSL</span>
          <h2>テキスト作図</h2>
        </div>
        <button type="button" onClick={() => dispatchCommand("closeDslPanel")} aria-label="DSLパネルを閉じる">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="dsl-panel-toolbar">
        <button type="button" onClick={exportSelection}>
          <FileInput size={15} aria-hidden="true" />
          選択を書き出し
        </button>
        <button type="button" onClick={validate}>
          <Check size={15} aria-hidden="true" />
          検証
        </button>
        <button type="button" className="primary-action" onClick={apply}>
          <Play size={15} aria-hidden="true" />
          適用
        </button>
      </div>

      <textarea
        className="dsl-editor"
        value={source}
        spellCheck={false}
        onChange={(event) => {
          setSource(event.currentTarget.value);
          setStatus(null);
        }}
        aria-label="DSLソース"
      />

      {status ? <p className="dsl-status">{status}</p> : null}
      {diagnostics.length > 0 ? (
        <div className="dsl-diagnostics" aria-label="DSL診断">
          {diagnostics.map((item, index) => (
            <p key={`${item.line}-${item.column}-${index}`} className={item.severity}>
              {diagnosticText(item)}
            </p>
          ))}
        </div>
      ) : null}
    </aside>
  );
};
