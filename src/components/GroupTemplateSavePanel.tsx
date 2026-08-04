type GroupTemplateSavePanelProps = {
  groupName: string | null;
  childCount: number;
  templateName: string;
  onTemplateNameChange: (templateName: string) => void;
  onSave: () => void;
};

export const GroupTemplateSavePanel = ({
  groupName,
  childCount,
  templateName,
  onTemplateNameChange,
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
    <button type="button" onClick={onSave} disabled={!groupName}>
      選択グループを保存
    </button>
  </section>
);
