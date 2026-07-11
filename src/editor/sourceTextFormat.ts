import type { SourceTextFormat } from "./sourceEditorTypes";

const lineBreaks = (text: string) => text.match(/\r\n|\n|\r/g) ?? [];

export const sourceTextFormat = (text: string): SourceTextFormat => {
  const breaks = lineBreaks(text);
  if (breaks.length === 0 || breaks.every((value) => value === "\n")) {
    return { lineEnding: "lf", normalizeToLfOnEditorCommit: false };
  }
  if (breaks.every((value) => value === "\r\n")) {
    return { lineEnding: "crlf", normalizeToLfOnEditorCommit: false };
  }
  return { lineEnding: "mixed", normalizeToLfOnEditorCommit: true };
};

/** CM's Text model uses LF coordinates even when a CRLF separator is configured. */
export const normalizeSourceTextForEditor = (text: string) => text.replace(/\r\n|\r/g, "\n");

export const serializeEditorText = (text: string, format: SourceTextFormat) =>
  format.lineEnding === "crlf" ? text.replace(/\n/g, "\r\n") : text;
