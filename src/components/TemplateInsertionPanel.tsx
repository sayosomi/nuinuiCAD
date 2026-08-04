import { dispatchCommand } from "../commands/commands";
import { numericValueExpression } from "../geometry/numericExpressions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, PointAnchor } from "../types/geometry";
import {
  currentTemplateInput,
  templateInputLabel,
  templateInputValueIsFilled,
  templateInputProgress,
  templateInsertionCanConfirm
} from "../templates/templateInsertionMode";

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
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);

  const input = currentTemplateInput(activeTemplateInsertion);
  const progress = activeTemplateInsertion ? templateInputProgress(activeTemplateInsertion) : null;
  if (!activeTemplateInsertion) return null;

  const currentValue = input ? activeTemplateInsertion.inputValues[input.id] : undefined;
  const canConfirm = templateInsertionCanConfirm(activeTemplateInsertion);
  const remainingCount = progress ? progress.total - progress.completed : 0;

  const valueLabel = () => {
    if (!input) return "入力なし";
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
