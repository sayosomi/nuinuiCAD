import { useEffect, useMemo, useState } from "react";
import { Download, Search, Upload } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { creationPlacementForEvaluationLimit } from "../model/elementCreationPlacement";
import { isGroupElement, subtreeIdsForElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  candidateNumericTemplateInputs,
  createTemplateFromGroup,
  type GroupTemplate,
  type GroupTemplateLibrary
} from "../templates/groupTemplate";
import {
  deleteGroupTemplate,
  exportGroupTemplateToFile,
  importGroupTemplateFromFile,
  loadGroupTemplateLibrary,
  saveGroupTemplateLibrary,
  upsertGroupTemplate
} from "../templates/groupTemplateStorage";
import type { CadElement, ElementId } from "../types/geometry";
import { GroupTemplateDetailPanel } from "./GroupTemplateDetailPanel";
import { GroupTemplateSavePanel } from "./GroupTemplateSavePanel";

const selectedGroup = (elements: CadElement[], selectedElementId: ElementId | null) => {
  const element = selectedElementId
    ? elements.find((item) => item.id === selectedElementId)
    : null;
  return element && isGroupElement(element) ? element : null;
};

const templateSummary = (template: GroupTemplate) => {
  const points = template.inputs.filter((input) => input.kind === "point").length;
  const lines = template.inputs.filter((input) => input.kind === "line").length;
  const numbers = template.inputs.filter((input) => input.kind === "numeric").length;
  return `${template.elements.length}要素 / 点${points} / 線${lines} / 数値${numbers}`;
};

const normalizedSearchText = (template: GroupTemplate) =>
  [template.name, templateSummary(template), ...template.inputs.map((input) => input.label)]
    .join(" ")
    .toLowerCase();

export const GroupTemplateLibraryDialog = () => {
  const showGroupTemplateLibrary = useCadUiStore((state) => state.showGroupTemplateLibrary);
  const groupTemplateLibraryMode = useCadUiStore((state) => state.groupTemplateLibraryMode);
  const elements = useCadDocumentStore((state) => state.elements);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const templateInsertionSourceInsertion = useCadUiStore((state) => state.templateInsertionSourceInsertion);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const [library, setLibrary] = useState<GroupTemplateLibrary>({ version: 1, templates: [] });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [numericInputIds, setNumericInputIds] = useState<Set<ElementId>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const group = selectedGroup(elements, selectedElementId);
  const saveTemplateName = templateName.trim() || (group?.name ? `${group.name} テンプレート` : "");
  const insertionIndex = templateInsertionSourceInsertion?.insertionTarget.insertionIndex
    ?? creationPlacementForEvaluationLimit(elements, evaluationLimitIndex).insertionIndex;

  const templateElements = useMemo(
    () => group ? elements.filter((element) => subtreeIdsForElement(elements, group.id).includes(element.id)) : [],
    [elements, group]
  );
  const numericCandidates = useMemo(
    () => candidateNumericTemplateInputs(templateElements),
    [templateElements]
  );
  const filteredTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return library.templates;
    return library.templates.filter((template) =>
      normalizedSearchText(template).includes(normalizedQuery)
    );
  }, [library.templates, query]);
  const selectedTemplate =
    filteredTemplates.find((template) => template.id === selectedTemplateId)
    ?? filteredTemplates[0]
    ?? library.templates.find((template) => template.id === selectedTemplateId)
    ?? null;

  useEffect(() => {
    if (!showGroupTemplateLibrary) return;
    let cancelled = false;
    void loadGroupTemplateLibrary()
      .then((nextLibrary) => {
        if (cancelled) return;
        setLibrary(nextLibrary);
        const nextSelectedTemplate = nextLibrary.templates[0] ?? null;
        setSelectedTemplateId(nextSelectedTemplate?.id ?? null);
        setStatus(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "テンプレートを読み込めません。");
      });
    return () => {
      cancelled = true;
    };
  }, [showGroupTemplateLibrary]);

  if (!showGroupTemplateLibrary) return null;

  const close = () => dispatchCommand("closeGroupTemplateLibrary");

  const saveSelectedGroup = async () => {
    if (!group) {
      setStatus("テンプレート化するグループを選択してください。");
      return;
    }
    try {
      const template = createTemplateFromGroup({
        elements,
        groupId: group.id,
        name: saveTemplateName,
        numericVariableElementIds: [...numericInputIds]
      });
      const nextLibrary = await upsertGroupTemplate(template);
      setLibrary(nextLibrary);
      setSelectedTemplateId(template.id);
      setTemplateName("");
      setStatus("テンプレートを保存しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを保存できません。");
    }
  };

  const insertTemplate = () => {
    if (!selectedTemplate) return;
    dispatchCommand("startTemplateInsertion", {
      groupTemplate: selectedTemplate,
      insertionIndex
    });
  };

  const removeTemplate = async (template: GroupTemplate) => {
    try {
      const nextLibrary = await deleteGroupTemplate(template.id);
      setLibrary(nextLibrary);
      setSelectedTemplateId(nextLibrary.templates[0]?.id ?? null);
      setStatus("テンプレートを削除しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを削除できません。");
    }
  };

  const importTemplate = async () => {
    try {
      const template = await importGroupTemplateFromFile();
      if (!template) return;
      const nextLibrary = await upsertGroupTemplate(template);
      setLibrary(nextLibrary);
      setSelectedTemplateId(template.id);
      setStatus("テンプレートを読み込みました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを読み込めません。");
    }
  };

  const exportTemplate = async (template: GroupTemplate) => {
    try {
      const path = await exportGroupTemplateToFile(template);
      if (path) setStatus("テンプレートを書き出しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを書き出せません。");
    }
  };

  const renameTemplate = async (template: GroupTemplate, name: string) => {
    const renamed = { ...template, name: name.trim() || template.name, updatedAt: new Date().toISOString() };
    const nextLibrary = {
      version: 1 as const,
      templates: library.templates.map((item) => item.id === renamed.id ? renamed : item)
    };
    setLibrary(nextLibrary);
    setSelectedTemplateId(renamed.id);
    await saveGroupTemplateLibrary(nextLibrary);
  };

  return (
    <div
      className="template-library-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="template-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="グループテンプレート"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>{groupTemplateLibraryMode === "insert" ? "テンプレートを挿入" : "グループテンプレート"}</h2>
            <p>{library.templates.length}件 / 挿入位置 {insertionIndex + 1}</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>

        <div className="template-library-workspace">
          <section className="template-library-sidebar" aria-label="テンプレート一覧">
            <label className="template-search-field">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                placeholder="テンプレートを検索"
                aria-label="テンプレートを検索"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <div className="template-list">
              {filteredTemplates.length === 0 ? (
                <p className="template-empty">
                  {library.templates.length === 0 ? "保存済みテンプレートはありません。" : "一致するテンプレートはありません。"}
                </p>
              ) : (
                filteredTemplates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={selectedTemplate?.id === template.id ? "active-template" : ""}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <small>{templateSummary(template)}</small>
                  </button>
                ))
              )}
            </div>
            <div className="button-row">
              <button type="button" onClick={importTemplate}>
                <Upload size={14} aria-hidden="true" />読み込み
              </button>
              {selectedTemplate ? (
                <button type="button" onClick={() => exportTemplate(selectedTemplate)}>
                  <Download size={14} aria-hidden="true" />書き出し
                </button>
              ) : null}
            </div>
          </section>

          <GroupTemplateDetailPanel
            template={selectedTemplate}
            insertionIndex={insertionIndex}
            onInsert={insertTemplate}
            onRename={renameTemplate}
            onRemove={removeTemplate}
          />

          <GroupTemplateSavePanel
            groupName={group?.name ?? null}
            childCount={Math.max(templateElements.length - 1, 0)}
            templateName={templateName}
            numericCandidates={numericCandidates}
            numericInputIds={numericInputIds}
            onTemplateNameChange={setTemplateName}
            onNumericInputIdsChange={setNumericInputIds}
            onSave={saveSelectedGroup}
          />
        </div>

        {status ? <p className="template-status">{status}</p> : null}
      </section>
    </div>
  );
};
