import type { ElementId } from "../types/geometry";

type NumericTemplateInputCandidate = {
  variableElementId: ElementId;
  label: string;
};

type GroupTemplateSavePanelProps = {
  groupName: string | null;
  childCount: number;
  templateName: string;
  numericCandidates: NumericTemplateInputCandidate[];
  numericInputIds: Set<ElementId>;
  onTemplateNameChange: (templateName: string) => void;
  onNumericInputIdsChange: (numericInputIds: Set<ElementId>) => void;
  onSave: () => void;
};

export const GroupTemplateSavePanel = ({
  groupName,
  childCount,
  templateName,
  numericCandidates,
  numericInputIds,
  onTemplateNameChange,
  onNumericInputIdsChange,
  onSave
}: GroupTemplateSavePanelProps) => (
  <section className="template-save-panel" aria-label="選択グループから保存">
    <h3>選択グループから保存</h3>
    <p className="template-empty">
      {groupName ? `${groupName} と子要素 ${childCount}件を保存します。` : "グループを選択すると保存できます。"}
    </p>
    <label className="template-field">
      <span>保存名</span>
      <input
        value={templateName}
        placeholder={groupName ? `${groupName} テンプレート` : "グループを選択"}
        onChange={(event) => onTemplateNameChange(event.currentTarget.value)}
      />
    </label>
    <div className="template-variable-list">
      {numericCandidates.length === 0 ? (
        <p className="template-empty">入力化できる変数がありません。</p>
      ) : (
        numericCandidates.map((input) => (
          <label className="template-checkbox" key={input.variableElementId}>
            <input
              type="checkbox"
              checked={numericInputIds.has(input.variableElementId)}
              onChange={(event) => {
                const next = new Set(numericInputIds);
                if (event.currentTarget.checked) {
                  next.add(input.variableElementId);
                } else {
                  next.delete(input.variableElementId);
                }
                onNumericInputIdsChange(next);
              }}
            />
            <span>{input.label}</span>
          </label>
        ))
      )}
    </div>
    <button type="button" onClick={onSave} disabled={!groupName}>
      選択グループを保存
    </button>
  </section>
);
