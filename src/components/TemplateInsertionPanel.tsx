import { useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { numericValueExpression, makeNumericExpression } from "../geometry/numericExpressions";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, NumericValue, PointAnchor } from "../types/geometry";
import { ExpressionInsertTray } from "./ExpressionInsertTray";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import {
  currentTemplateInput,
  TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
  templateInputLabel,
  templateInputValueIsFilled,
  templateInputProgress,
  templateInsertionCanConfirm
} from "../templates/templateInsertionMode";

const syntheticNumericElement = (value: NumericValue): CadElement => ({
  id: TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
  name: "テンプレート入力",
  type: "variable",
  visible: true,
  enabled: true,
  scope: "global",
  valueMode: "expression",
  expression: value,
  point1: { mode: "coordinate", x: 0, y: 0 },
  point2: { mode: "coordinate", x: 0, y: 0 },
  point: { mode: "coordinate", x: 0, y: 0 },
  lineId: ""
});

const pointAnchorLabel = (anchor: PointAnchor, elements: CadElement[]) => {
  if (anchor.mode === "reference") {
    return elements.find((element) => element.id === anchor.pointId)?.name ?? anchor.pointId;
  }
  if (anchor.mode === "derived") {
    const elementName = elements.find((element) => element.id === anchor.elementId)?.name ?? anchor.elementId;
    if (anchor.pointKey === "start") return `${elementName}.始点`;
    if (anchor.pointKey === "end") return `${elementName}.終点`;
    if (anchor.pointKey === "center") return `${elementName}.中心点`;
    return `${elementName}.${anchor.pointKey}`;
  }
  return `座標(${numericValueExpression(anchor.x)}, ${numericValueExpression(anchor.y)})`;
};

export const TemplateInsertionPanel = () => {
  const elements = useCadDocumentStore((state) => state.elements);
  const activeTemplateInsertion = useCadUiStore((state) => state.activeTemplateInsertion);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputSelectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null
  });
  const [showExpressionTray, setShowExpressionTray] = useState(true);

  const input = currentTemplateInput(activeTemplateInsertion);
  const progress = activeTemplateInsertion ? templateInputProgress(activeTemplateInsertion) : null;
  const numericValue = input?.kind === "numeric" && activeTemplateInsertion
    ? (activeTemplateInsertion.inputValues[input.id] ?? input.defaultValue) as NumericValue
    : 0;
  const syntheticElement = syntheticNumericElement(numericValue);

  if (!activeTemplateInsertion) return null;

  const currentValue = input ? activeTemplateInsertion.inputValues[input.id] : undefined;
  const canConfirm = templateInsertionCanConfirm(activeTemplateInsertion);
  const isNumericReferencePicking =
    activeNumericReferencePickTarget?.elementId === TEMPLATE_INSERTION_NUMERIC_TARGET_ID &&
    activeNumericReferencePickTarget.parameterKey === input?.id;
  const remainingCount = progress ? progress.total - progress.completed : 0;

  const valueLabel = () => {
    if (!input) return "入力なし";
    if (input.kind === "numeric") return numericValueExpression((currentValue ?? input.defaultValue) as NumericValue);
    if (input.kind === "point") {
      if (typeof currentValue === "string") {
        return elements.find((element) => element.id === currentValue)?.name ?? currentValue;
      }
      if (currentValue && typeof currentValue === "object" && "mode" in currentValue) {
        return pointAnchorLabel(currentValue as PointAnchor, elements);
      }
      return "未選択";
    }
    if (typeof currentValue === "string" && currentValue.length > 0) {
      return elements.find((element) => element.id === currentValue)?.name ?? currentValue;
    }
    return "未選択";
  };

  const updateNumericValue = (value: string) => {
    if (!input || input.kind !== "numeric") return;
    dispatchCommand("setTemplateNumericInput", {
      templateInputId: input.id,
      numericValue: makeNumericExpression(value)
    });
  };

  return (
    <aside className="template-insertion-panel" aria-label="テンプレート挿入">
      <div className="template-insertion-header">
        <div>
          <span>テンプレート挿入</span>
          <h2>{activeTemplateInsertion.template.name}</h2>
          <p>{progress ? `${progress.completed} / ${progress.total} 入力済み` : "入力なし"}</p>
        </div>
        <button type="button" onClick={() => dispatchCommand("cancelTemplateInsertion")}>
          キャンセル
        </button>
      </div>

      <div className="template-insertion-current">
        <span>現在の指定</span>
        <strong>{templateInputLabel(input)}</strong>
        <small>{valueLabel()}</small>
      </div>

      {input?.kind === "numeric" ? (
        <div className="template-insertion-numeric">
          <input
            ref={inputRef}
            value={numericValueExpression(numericValue)}
            aria-label={`${input.label} の式`}
            onChange={(event) => updateNumericValue(event.currentTarget.value)}
            onSelect={(event) => {
              inputSelectionRef.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd
              };
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                dispatchCommand("selectNextTemplateInsertionInput");
              }
            }}
          />
          <button
            type="button"
            className={showExpressionTray ? "active-toggle" : ""}
            onClick={() => setShowExpressionTray((current) => !current)}
          >
            参照を挿入
          </button>
          {isNumericReferencePicking ? (
            <p className="template-insertion-hint">
              {lineMeasurementLabel(activeNumericReferencePickTarget.property)}を持つ線・曲線を選択
            </p>
          ) : null}
          {showExpressionTray ? (
            <ExpressionInsertTray
              element={syntheticElement}
              elements={[...elements, syntheticElement]}
              parameterKey={input.id}
              focusInput={() => inputRef.current?.focus()}
              getInputTarget={() => ({
                displayedExpression: inputRef.current?.value ?? "",
                selectionStart: inputSelectionRef.current.start,
                selectionEnd: inputSelectionRef.current.end
              })}
              onClose={() => {
                setShowExpressionTray(false);
                useCadUiStore.setState({
                  activeMeasurementInsertTarget: null,
                  activePointPickTarget: null,
                  activeNumericReferencePickTarget: null,
                  activeLinePickTarget: null,
                  activePickCursor: null
                });
              }}
            />
          ) : null}
        </div>
      ) : null}

      {input?.kind === "point" ? (
        <p className="template-insertion-hint">
          {activePointPickTarget ? "キャンバスまたは構成リストから点を選択します。" : "入力一覧から点入力を選択してください。"}
        </p>
      ) : null}
      {input?.kind === "line" ? (
        <p className="template-insertion-hint">
          {activeLinePickTarget ? "キャンバスまたは構成リストから線・曲線を選択します。" : "入力一覧から線入力を選択してください。"}
        </p>
      ) : null}

      {activeTemplateInsertion.error ? (
        <p className="template-insertion-error">{activeTemplateInsertion.error}</p>
      ) : null}

      <div className="template-insertion-list">
        {activeTemplateInsertion.template.inputs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === input?.id ? "active-template-input" : ""}
            onClick={() => dispatchCommand("selectTemplateInsertionInput", { templateInputId: item.id })}
          >
            <span>{templateInputLabel(item)}</span>
            <small>
              {item.id === input?.id
                ? "編集中"
                : templateInputValueIsFilled(item, activeTemplateInsertion.inputValues[item.id])
                  ? "入力済み"
                  : "未入力"}
            </small>
          </button>
        ))}
      </div>

      <div className="template-insertion-actions">
        <button type="button" onClick={() => dispatchCommand("selectPreviousTemplateInsertionInput")}>
          前へ
        </button>
        <button type="button" onClick={() => dispatchCommand("selectNextTemplateInsertionInput")}>
          次へ
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={!canConfirm}
          onClick={() => dispatchCommand("confirmTemplateInsertion")}
        >
          {canConfirm ? "挿入を確定" : `残り${remainingCount}件`}
        </button>
      </div>
    </aside>
  );
};
