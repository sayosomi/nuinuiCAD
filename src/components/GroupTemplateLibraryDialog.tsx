import { useEffect, useMemo, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { isGroupElement, subtreeIdsForElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  candidateNumericTemplateInputs,
  createTemplateFromGroup,
  insertionIndexAfterSelection,
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
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import type { CadElement, ElementId } from "../types/geometry";

const selectedGroup = (elements: CadElement[], selectedElementId: ElementId | null) => {
  const element = selectedElementId
    ? elements.find((item) => item.id === selectedElementId)
    : null;
  return element && isGroupElement(element) ? element : null;
};

export const GroupTemplateLibraryDialog = () => {
  const showGroupTemplateLibrary = useCadUiStore((state) => state.showGroupTemplateLibrary);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadDocumentStore((state) => state.selectedElementId);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
  const [library, setLibrary] = useState<GroupTemplateLibrary>({ version: 1, templates: [] });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [numericInputIds, setNumericInputIds] = useState<Set<ElementId>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const group = selectedGroup(elements, selectedElementId);
  const selectedTemplate = library.templates.find((template) => template.id === selectedTemplateId)
    ?? library.templates[0]
    ?? null;
  const saveTemplateName = templateName.trim() || (group?.name ? `${group.name} テンプレート` : "");

  const templateElements = useMemo(
    () => group ? elements.filter((element) => subtreeIdsForElement(elements, group.id).includes(element.id)) : [],
    [elements, group]
  );
  const numericCandidates = useMemo(
    () => candidateNumericTemplateInputs(templateElements),
    [templateElements]
  );
  useEffect(() => {
    if (!showGroupTemplateLibrary) return;
    let cancelled = false;
    void loadGroupTemplateLibrary()
      .then((nextLibrary) => {
        if (cancelled) return;
        setLibrary(nextLibrary);
        const nextSelectedTemplate = nextLibrary.templates[0] ?? null;
        setSelectedTemplateId(nextSelectedTemplate?.id ?? null);
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
      setStatus("テンプレートを保存しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "テンプレートを保存できません。");
    }
  };

  const insertTemplate = () => {
    if (!selectedTemplate) return;
    dispatchCommand("startTemplateInsertion", {
      groupTemplate: selectedTemplate,
      insertionIndex: insertionIndexAfterSelection(elements, selectedElementIds)
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
            <h2>グループテンプレート</h2>
            <p>{library.templates.length}件</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>
        <div className="template-library-grid">
          <section className="template-panel">
            <h3>保存</h3>
            <label className="template-field">
              <span>名前</span>
              <input
                value={templateName}
                placeholder={group?.name ? `${group.name} テンプレート` : "グループを選択"}
                onChange={(event) => setTemplateName(event.currentTarget.value)}
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
                        setNumericInputIds((current) => {
                          const next = new Set(current);
                          if (event.currentTarget.checked) {
                            next.add(input.variableElementId);
                          } else {
                            next.delete(input.variableElementId);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>{input.label}</span>
                  </label>
                ))
              )}
            </div>
            <button type="button" onClick={saveSelectedGroup} disabled={!group}>
              選択グループを保存
            </button>
          </section>

          <section className="template-panel">
            <h3>ライブラリ</h3>
            <div className="template-list">
              {library.templates.length === 0 ? (
                <p className="template-empty">保存済みテンプレートはありません。</p>
              ) : (
                library.templates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={selectedTemplate?.id === template.id ? "active-template" : ""}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                    }}
                  >
                    <strong>{template.name}</strong>
                    <small>{template.elements.length}要素 / {template.inputs.length}入力</small>
                  </button>
                ))
              )}
            </div>
            <div className="button-row">
              <button type="button" onClick={importTemplate}>読み込み</button>
              {selectedTemplate ? (
                <button type="button" onClick={() => exportTemplate(selectedTemplate)}>書き出し</button>
              ) : null}
            </div>
          </section>

          <section className="template-panel">
            <h3>挿入</h3>
            {selectedTemplate ? (
              <>
                <label className="template-field">
                  <span>テンプレート名</span>
                  <input
                    defaultValue={selectedTemplate.name}
                    onBlur={(event) => renameTemplate(selectedTemplate, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
                <p className="template-empty">
                  挿入を開始すると、点・線・式入力を順番に指定します。
                </p>
                <div className="button-row">
                  <button type="button" onClick={insertTemplate}>挿入</button>
                  <button type="button" onClick={() => removeTemplate(selectedTemplate)}>削除</button>
                </div>
              </>
            ) : (
              <p className="template-empty">テンプレートを選択してください。</p>
            )}
          </section>
        </div>
        {status ? <p className="template-status">{status}</p> : null}
      </section>
    </div>
  );
};
