import * as vscode from "vscode";
import type { SourceExtractTemplate } from "../../src/commands/sourceExtractTemplate";
import type { SourceCreationTemplateMaterialization } from "../../src/commands/sourceCreationTemplateMaterializer";
import type { SourceOutputTemplateSnippet } from "../../src/commands/sourceOutputTemplateCatalog";

export type SourceCreationSnippetOptions = {
  /** Text inserted at a statement-safe line boundary before the declaration. */
  prefixText?: string;
  /** Keeps a statement-safe line boundary after a creation-flow snippet. */
  appendNewline?: boolean;
};

export const insertSourceExtractSnippet = (
  editor: vscode.TextEditor,
  template: SourceExtractTemplate,
  position: vscode.Position,
  options: SourceCreationSnippetOptions = {}
): Thenable<boolean> => {
  const snippet = new vscode.SnippetString();
  if (options.prefixText) snippet.appendText(options.prefixText);
  for (const part of template.parts) {
    if (part.kind === "text") snippet.appendText(part.text);
    else snippet.appendPlaceholder(part.defaultText, part.index);
  }
  if (options.appendNewline) snippet.appendText("\n");
  return editor.insertSnippet(snippet, position);
};

export const createSourceCreationSnippet = (
  materialization: SourceCreationTemplateMaterialization,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  let tabstopIndex = 1;

  if (options.prefixText) snippet.appendText(options.prefixText);
  for (const part of materialization.parts) {
    if (part.kind === "text") snippet.appendText(part.text);
    else snippet.appendTabstop(tabstopIndex++);
  }
  if (options.appendNewline) snippet.appendText("\n");
  return snippet;
};

export const insertSourceCreationSnippet = (
  editor: vscode.TextEditor,
  materialization: SourceCreationTemplateMaterialization,
  position: vscode.Position,
  options?: SourceCreationSnippetOptions
): Thenable<boolean> => editor.insertSnippet(createSourceCreationSnippet(materialization, options), position);

export const createSourceOutputTemplateSnippet = (
  template: SourceOutputTemplateSnippet,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  if (options.prefixText) snippet.appendText(options.prefixText);
  for (const part of template.parts) {
    if (part.kind === "text") snippet.appendText(part.text);
    else if (part.kind === "tabstop") snippet.appendTabstop(part.index);
    else snippet.appendChoice(part.choices, part.index);
  }
  if (options.appendNewline) snippet.appendText("\n");
  return snippet;
};

export const insertSourceOutputTemplateSnippet = (
  editor: vscode.TextEditor,
  template: SourceOutputTemplateSnippet,
  position: vscode.Position,
  options?: SourceCreationSnippetOptions
): Thenable<boolean> => editor.insertSnippet(createSourceOutputTemplateSnippet(template, options), position);

/** Opens VS Code's language-scoped picker so contributed and workspace snippets share one insertion path. */
export const openNativeSourceSnippetPicker = async (
  editor: vscode.TextEditor,
  expectedDocumentVersion: number
): Promise<void> => {
  const document = editor.document;
  if (document.version !== expectedDocumentVersion) return;

  const targetSelections = editor.selections.map((selection) => ({
    anchor: { line: selection.anchor.line, character: selection.anchor.character },
    active: { line: selection.active.line, character: selection.active.character }
  }));
  const selectionMatchesTarget = (selections: readonly vscode.Selection[]): boolean =>
    selections.length === targetSelections.length && selections.every((selection, index) => {
      const target = targetSelections[index];
      return target !== undefined &&
        selection.anchor.line === target.anchor.line &&
        selection.anchor.character === target.anchor.character &&
        selection.active.line === target.active.line &&
        selection.active.character === target.active.character;
    });

  let targetChanged = false;
  const closePicker = (): void => {
    if (targetChanged) return;
    targetChanged = true;
    void vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  };
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((activeEditor) => {
    if (activeEditor !== editor) closePicker();
  });
  const documentListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === document && document.version !== expectedDocumentVersion) closePicker();
  });
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === editor && !selectionMatchesTarget(event.selections)) closePicker();
  });

  try {
    await vscode.commands.executeCommand("editor.action.insertSnippet", { langId: "nui" });
  } finally {
    activeEditorListener.dispose();
    documentListener.dispose();
    selectionListener.dispose();
  }
};
