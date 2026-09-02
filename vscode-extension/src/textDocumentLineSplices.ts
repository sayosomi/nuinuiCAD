import * as vscode from "vscode";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";

const sourceNewline = (sourceText: string): string => {
  const separators = [...sourceText.matchAll(/\r?\n/g)].map((match) => match[0]);
  return separators.length > 0 && separators.every((value) => value === "\r\n") ? "\r\n" : "\n";
};

const lineStartsFor = (sourceText: string): {
  starts: number[];
  separatorLengths: number[];
  lineCount: number;
} => {
  const starts = [0];
  const separatorLengths: number[] = [];
  for (const match of sourceText.matchAll(/\r?\n/g)) {
    starts.push((match.index ?? 0) + match[0].length);
    separatorLengths.push(match[0].length);
  }
  return { starts, separatorLengths, lineCount: sourceText.split(/\r?\n/).length };
};

export const textEditForLineSplice = (
  document: vscode.TextDocument,
  sourceText: string,
  splice: LineSplice
): { range: vscode.Range; replacement: string } => {
  const { starts, separatorLengths, lineCount } = lineStartsFor(sourceText);
  const startIndex = splice.startLine - 1;
  const deletesLines = splice.endLine >= splice.startLine;
  const newline = sourceNewline(sourceText);
  const replacement = splice.replacementLines.join(newline);
  let from: number;
  let to: number;
  let insert: string;

  if (!deletesLines) {
    from = startIndex < lineCount ? starts[startIndex] : sourceText.length;
    to = from;
    insert = splice.replacementLines.length > 0
      ? startIndex < lineCount
        ? `${replacement}${newline}`
        : `${lineCount > 0 ? newline : ""}${replacement}`
      : "";
  } else if (splice.endLine < lineCount) {
    from = starts[startIndex];
    to = starts[splice.endLine];
    insert = splice.replacementLines.length > 0 ? `${replacement}${newline}` : "";
  } else if (startIndex === 0) {
    from = 0;
    to = sourceText.length;
    insert = replacement;
  } else {
    from = starts[startIndex] - separatorLengths[startIndex - 1];
    to = sourceText.length;
    insert = splice.replacementLines.length > 0 ? `${newline}${replacement}` : "";
  }

  return {
    range: new vscode.Range(document.positionAt(from), document.positionAt(to)),
    replacement: insert
  };
};

/** Apply old-coordinate line splices as one native VS Code transaction. */
export const applySourceLineSplices = async (
  editor: vscode.TextEditor,
  expectedDocumentVersion: number,
  expectedSourceText: string,
  splices: readonly LineSplice[],
  expectedPatchedSource?: string
): Promise<boolean> => {
  const document = editor.document;
  const sourceText = document.getText();
  if (document.version !== expectedDocumentVersion || sourceText !== expectedSourceText) return false;
  let edits: Array<{ range: vscode.Range; replacement: string }>;
  try {
    const patchedSource = applyLineSplices(sourceText, splices);
    if (expectedPatchedSource !== undefined && patchedSource !== expectedPatchedSource) return false;
    edits = splices.map((splice) => textEditForLineSplice(document, sourceText, splice));
  } catch {
    return false;
  }
  try {
    return await editor.edit((editBuilder) => {
      for (const edit of edits) editBuilder.replace(edit.range, edit.replacement);
    }, { undoStopBefore: true, undoStopAfter: true });
  } catch {
    return false;
  }
};
