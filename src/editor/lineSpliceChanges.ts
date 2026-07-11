import type { LineSplice } from "../document/textPatch";
import type { SourceTextChange } from "./sourceEditorTypes";
import { normalizeSourceTextForEditor } from "./sourceTextFormat";

const lineStarts = (text: string) => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const assertSplices = (lineCount: number, splices: readonly LineSplice[]) => {
  let previousEnd = 0;
  let previousStart = 0;
  for (const splice of splices) {
    if (splice.endLine < splice.startLine - 1) throw new Error("LineSplice has an invalid range.");
    if (splice.startLine < previousStart || splice.startLine <= previousEnd) {
      throw new Error("LineSplice values must be sorted and non-overlapping.");
    }
    if (splice.startLine < 1 || splice.endLine > lineCount) throw new Error("LineSplice is outside the document.");
    previousStart = splice.startLine;
    previousEnd = Math.max(previousEnd, splice.endLine);
  }
};

export const lineSplicesToSourceTextChanges = (
  sourceText: string,
  splices: readonly LineSplice[]
): SourceTextChange[] => {
  const text = normalizeSourceTextForEditor(sourceText);
  const starts = lineStarts(text);
  const lineCount = starts.length;
  assertSplices(lineCount, splices);

  return splices.map((splice) => {
    const startIndex = splice.startLine - 1;
    const deletesLines = splice.endLine >= splice.startLine;
    const replacement = splice.replacementLines.join("\n");

    if (!deletesLines) {
      if (startIndex < lineCount) {
        return {
          from: starts[startIndex],
          to: starts[startIndex],
          insert: splice.replacementLines.length > 0 ? `${replacement}\n` : ""
        };
      }
      return {
        from: text.length,
        to: text.length,
        insert: splice.replacementLines.length > 0 ? `${lineCount > 0 ? "\n" : ""}${replacement}` : ""
      };
    }

    const suffixStart = splice.endLine;
    if (suffixStart < lineCount) {
      return {
        from: starts[startIndex],
        to: starts[suffixStart],
        insert: splice.replacementLines.length > 0 ? `${replacement}\n` : ""
      };
    }
    if (startIndex === 0) return { from: 0, to: text.length, insert: replacement };
    return {
      from: starts[startIndex] - 1,
      to: text.length,
      insert: splice.replacementLines.length > 0 ? `\n${replacement}` : ""
    };
  });
};

/** Test helper for applying an adapter DTO with old-document coordinates. */
export const applySourceTextChanges = (text: string, changes: readonly SourceTextChange[]) => {
  let result = normalizeSourceTextForEditor(text);
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    result = `${result.slice(0, change.from)}${change.insert}${result.slice(change.to)}`;
  }
  return result;
};
