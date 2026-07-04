import { Play, Trash2 } from "lucide-react";
import type { GroupTemplate, GroupTemplateInput } from "../templates/groupTemplate";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";

const inputKindLabel = (kind: GroupTemplateInput["kind"]) => {
  if (kind === "point") return "点";
  if (kind === "line") return "線";
  return "数値";
};

type GroupTemplateDetailPanelProps = {
  template: GroupTemplate | null;
  insertionIndex: number;
  onInsert: () => void;
  onRename: (template: GroupTemplate, name: string) => void;
  onRemove: (template: GroupTemplate) => void;
};

export const GroupTemplateDetailPanel = ({
  template,
  insertionIndex,
  onInsert,
  onRename,
  onRemove
}: GroupTemplateDetailPanelProps) => (
  <section className="template-detail-panel" aria-label="テンプレート詳細">
    {template ? (
      <>
        <div className="template-detail-heading">
          <label className="template-field">
            <span>テンプレート名</span>
            <input
              key={template.id}
              defaultValue={template.name}
              onBlur={(event) => onRename(template, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <button
            type="button"
            className="template-primary-action"
            onClick={onInsert}
          >
            <Play size={15} aria-hidden="true" />挿入を開始
          </button>
        </div>

        <div className="template-insert-summary">
          <strong>挿入位置 {insertionIndex + 1}</strong>
          <span>開始後、必要な点・線・数値を順番に指定してから確定します。</span>
        </div>

        <div className="template-metadata-grid">
          <span>{template.elements.length}要素</span>
          <span>{template.inputs.length}入力</span>
          <span>作成 {new Date(template.createdAt).toLocaleDateString()}</span>
        </div>

        <div className="template-input-list" aria-label="必要な入力">
          {template.inputs.length === 0 ? (
            <p className="template-empty">追加指定なしで挿入できます。</p>
          ) : (
            template.inputs.map((input) => (
              <div className="template-input-row" key={input.id}>
                <span>{inputKindLabel(input.kind)}</span>
                <strong>{input.label}</strong>
              </div>
            ))
          )}
        </div>

        <div className="template-danger-actions">
          <button type="button" onClick={() => onRemove(template)}>
            <Trash2 size={14} aria-hidden="true" />削除
          </button>
        </div>
      </>
    ) : (
      <p className="template-empty">テンプレートを選択してください。</p>
    )}
  </section>
);
