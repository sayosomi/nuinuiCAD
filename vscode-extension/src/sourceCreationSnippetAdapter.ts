import * as vscode from "vscode";
import type { SourceCreationTemplateMaterialization } from "../../src/commands/sourceCreationTemplateMaterializer";
import type { SourceGeometryValueTemplateMaterialization } from "../../src/commands/sourceGeometryValueTemplateMaterializer";
import type { SourceCalculationMeasurementTemplateMaterialization } from "../../src/commands/sourceCalculationMeasurementTemplateMaterializer";
import type { SourceOutputTemplateSnippet } from "../../src/commands/sourceOutputTemplateCatalog";
import type { SourceControlFlowTemplateMaterialization } from "../../src/commands/sourceControlFlowTemplateMaterializer";

export type SourceCreationSnippetOptions = {
  /** Text inserted at a statement-safe line boundary before the declaration. */
  prefixText?: string;
  /** Keeps a statement-safe line boundary after a creation-flow snippet. */
  appendNewline?: boolean;
};

export const createSourceCreationSnippet = (
  materialization: SourceCreationTemplateMaterialization,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  let tabstopIndex = 1;

  if (options.prefixText) snippet.appendText(options.prefixText);

  for (const part of materialization.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
      continue;
    }

    snippet.appendTabstop(tabstopIndex);
    tabstopIndex += 1;
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

export const createSourceGeometryValueSnippet = (
  materialization: SourceGeometryValueTemplateMaterialization,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  let tabstopIndex = 1;

  if (options.prefixText) snippet.appendText(options.prefixText);

  for (const part of materialization.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
      continue;
    }

    snippet.appendTabstop(tabstopIndex);
    tabstopIndex += 1;
  }

  if (options.appendNewline) snippet.appendText("\n");

  return snippet;
};

export const insertSourceGeometryValueSnippet = (
  editor: vscode.TextEditor,
  materialization: SourceGeometryValueTemplateMaterialization,
  position: vscode.Position,
  options?: SourceCreationSnippetOptions
): Thenable<boolean> => editor.insertSnippet(createSourceGeometryValueSnippet(materialization, options), position);

export const createSourceCalculationMeasurementSnippet = (
  materialization: SourceCalculationMeasurementTemplateMaterialization,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  let tabstopIndex = 1;

  if (options.prefixText) snippet.appendText(options.prefixText);

  for (const part of materialization.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
      continue;
    }

    snippet.appendTabstop(tabstopIndex);
    tabstopIndex += 1;
  }

  if (options.appendNewline) snippet.appendText("\n");

  return snippet;
};

export const insertSourceCalculationMeasurementSnippet = (
  editor: vscode.TextEditor,
  materialization: SourceCalculationMeasurementTemplateMaterialization,
  position: vscode.Position,
  options?: SourceCreationSnippetOptions
): Thenable<boolean> => editor.insertSnippet(
  createSourceCalculationMeasurementSnippet(materialization, options),
  position
);

export const createSourceControlFlowSnippet = (
  materialization: SourceControlFlowTemplateMaterialization,
  options: SourceCreationSnippetOptions = {}
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  const tabstopIndexForField = new Map<string, number>();
  let nextTabstopIndex = 1;

  if (options.prefixText) snippet.appendText(options.prefixText);

  for (const part of materialization.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
      continue;
    }

    let tabstopIndex = tabstopIndexForField.get(part.field);
    if (tabstopIndex === undefined) {
      tabstopIndex = nextTabstopIndex;
      nextTabstopIndex += 1;
      tabstopIndexForField.set(part.field, tabstopIndex);
    }
    snippet.appendTabstop(tabstopIndex);
  }

  if (options.appendNewline) snippet.appendText("\n");

  return snippet;
};

export const insertSourceControlFlowSnippet = (
  editor: vscode.TextEditor,
  materialization: SourceControlFlowTemplateMaterialization,
  position: vscode.Position,
  options?: SourceCreationSnippetOptions
): Thenable<boolean> => editor.insertSnippet(createSourceControlFlowSnippet(materialization, options), position);

export const createSourceOutputTemplateSnippet = (
  template: SourceOutputTemplateSnippet
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  for (const part of template.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
    } else if (part.kind === "tabstop") {
      snippet.appendTabstop(part.index);
    } else {
      snippet.appendChoice(part.choices, part.index);
    }
  }
  return snippet;
};

export const insertSourceOutputTemplateSnippet = (
  editor: vscode.TextEditor,
  template: SourceOutputTemplateSnippet,
  position: vscode.Position
): Thenable<boolean> => editor.insertSnippet(createSourceOutputTemplateSnippet(template), position);
