import * as vscode from "vscode";

/** The shared writable, file-backed `.nui` Source editor boundary. */
export const isWritableNuiSourceEditor = (
  editor: vscode.TextEditor | undefined
): editor is vscode.TextEditor => Boolean(
  editor &&
  editor.document.languageId === "nui" &&
  editor.document.uri.scheme === "file" &&
  editor.document.fileName.endsWith(".nui") &&
  vscode.workspace.fs.isWritableFileSystem(editor.document.uri.scheme) !== false
);
