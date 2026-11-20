import * as vscode from "vscode";

export type NormalizedSourceRange = { from: number; to: number };

export const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const lineStartsFor = (sourceText: string): number[] => {
  const starts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

export const normalizedOffsetAt = (normalizedSource: string, position: vscode.Position): number => {
  const starts = lineStartsFor(normalizedSource);
  const line = Math.min(Math.max(position.line, 0), starts.length - 1);
  const lineStart = starts[line]!;
  const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : normalizedSource.length;
  const character = Math.min(Math.max(position.character, 0), lineEnd - lineStart);
  return lineStart + character;
};

export const normalizedOffsetFromRaw = (rawSource: string, rawOffset: number): number => {
  let removedCarriageReturns = 0;
  for (let index = 0; index < rawOffset; index += 1) {
    if (rawSource[index] === "\r" && rawSource[index + 1] === "\n") removedCarriageReturns += 1;
  }
  return rawOffset - removedCarriageReturns;
};

export const rawOffsetFromNormalized = (rawSource: string, normalizedOffset: number): number => {
  let rawOffset = 0;
  let normalizedPosition = 0;
  while (rawOffset < rawSource.length && normalizedPosition < normalizedOffset) {
    if (rawSource[rawOffset] === "\r" && rawSource[rawOffset + 1] === "\n") rawOffset += 1;
    rawOffset += 1;
    normalizedPosition += 1;
  }
  return rawOffset;
};

export const vscodeRangeForNormalized = (
  document: vscode.TextDocument,
  rawSource: string,
  range: NormalizedSourceRange
): vscode.Range => new vscode.Range(
  document.positionAt(rawOffsetFromNormalized(rawSource, range.from)),
  document.positionAt(rawOffsetFromNormalized(rawSource, range.to))
);

// Match the single-offset scan: advance to the next integer boundary and stop at EOF.
const normalizedBoundary = (offset: number, length: number): number =>
  offset > 0 ? Math.min(Math.ceil(offset), length) : 0;

const createRawOffsetForNormalized = (rawSource: string): ((normalizedOffset: number) => number) => {
  const firstCrlf = rawSource.indexOf("\r\n");
  if (firstCrlf === -1) {
    return (normalizedOffset) => normalizedBoundary(normalizedOffset, rawSource.length);
  }

  const crlfEnds: number[] = [];
  for (let rawOffset = firstCrlf; rawOffset !== -1; rawOffset = rawSource.indexOf("\r\n", rawOffset + 2)) {
    // At this normalized boundary the CRLF has been consumed, adding one raw code unit.
    crlfEnds.push(rawOffset - crlfEnds.length + 1);
  }
  const normalizedLength = rawSource.length - crlfEnds.length;
  return (normalizedOffset) => {
    const offset = normalizedBoundary(normalizedOffset, normalizedLength);
    let low = 0;
    let high = crlfEnds.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (crlfEnds[mid]! <= offset) low = mid + 1;
      else high = mid;
    }
    return offset + low;
  };
};

export const createVscodeRangeForNormalized = (
  document: vscode.TextDocument,
  rawSource: string
): ((range: NormalizedSourceRange) => vscode.Range) => {
  const rawOffsetFor = createRawOffsetForNormalized(rawSource);
  return ({ from, to }) => new vscode.Range(
    document.positionAt(rawOffsetFor(from)),
    document.positionAt(rawOffsetFor(to))
  );
};
