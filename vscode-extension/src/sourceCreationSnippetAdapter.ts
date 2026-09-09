import * as vscode from "vscode";
import type { SourceCreationTemplateMaterialization } from "../../src/commands/sourceCreationTemplateMaterializer";

export const createSourceCreationSnippet = (
  materialization: SourceCreationTemplateMaterialization
): vscode.SnippetString => {
  const snippet = new vscode.SnippetString();
  let tabstopIndex = 1;

  for (const part of materialization.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.text);
      continue;
    }

    snippet.appendTabstop(tabstopIndex);
    tabstopIndex += 1;
  }

  return snippet;
};

export const insertSourceCreationSnippet = (
  editor: vscode.TextEditor,
  materialization: SourceCreationTemplateMaterialization,
  position: vscode.Position
): Thenable<boolean> => editor.insertSnippet(createSourceCreationSnippet(materialization), position);
