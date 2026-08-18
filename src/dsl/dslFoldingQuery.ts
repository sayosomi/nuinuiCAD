import type { DslStatement } from "./dslTypes";
import {
  type LogicalStatementSourceMap,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { splitDslComment } from "./dslTokens";

export type DslFoldingRangeKind = "syntax" | "comment";

export type DslFoldingRange = {
  kind: DslFoldingRangeKind;
  startLine: number;
  endLine: number;
};

export type DslFoldingQueryInput = {
  source: SourceSnapshot;
  statements: readonly DslStatement[];
  sourceMap: LogicalStatementSourceMap;
};

type Delimiter = "(" | "[";

type DelimiterFrame = {
  delimiter: Delimiter;
  line: number;
};

const matchingCloserFor = (delimiter: Delimiter): ")" | "]" =>
  delimiter === "(" ? ")" : "]";

const isBlockOpener = (statement: DslStatement): boolean =>
  statement.kind !== "blockEnd" &&
  statement.kind !== "blockElse" &&
  statement.opensBlock;

const isConditionalBlockOpener = (statement: DslStatement): boolean =>
  statement.kind === "element" && statement.type === "conditionalGroup";

const braceRangesFor = (
  statements: readonly DslStatement[]
): DslFoldingRange[] => {
  const openers = new Map<number, DslStatement>();
  for (const [index, statement] of statements.entries()) {
    if (isBlockOpener(statement)) openers.set(index, statement);
  }

  const elseByOpener = new Map<number, DslStatement>();
  const closeByOpener = new Map<number, DslStatement>();
  const malformedOpeners = new Set<number>();
  for (const statement of statements) {
    const enclosing = statement.enclosing;
    if (!enclosing || !openers.has(enclosing.statementIndex)) continue;
    const opener = openers.get(enclosing.statementIndex)!;
    if (statement.kind === "blockElse") {
      const isValidElse = enclosing.branch === "then" && isConditionalBlockOpener(opener);
      if (isValidElse) {
        elseByOpener.set(enclosing.statementIndex, statement);
      } else {
        malformedOpeners.add(enclosing.statementIndex);
      }
    }
    if (statement.kind === "blockEnd") closeByOpener.set(enclosing.statementIndex, statement);
  }

  const ranges: DslFoldingRange[] = [];
  for (const [index, opener] of openers.entries()) {
    if (malformedOpeners.has(index)) continue;
    const close = closeByOpener.get(index);
    if (!close) continue;

    const startLine = opener.openBraceLine ?? opener.endLine;
    const elseStatement = elseByOpener.get(index);
    const thenEndLine = elseStatement ? elseStatement.line - 1 : close.line;
    if (startLine < thenEndLine) {
      ranges.push({ kind: "syntax", startLine, endLine: thenEndLine });
    }

    if (elseStatement && close.enclosing?.branch === "else" && elseStatement.line < close.line) {
      ranges.push({ kind: "syntax", startLine: elseStatement.line, endLine: close.line });
    }
  }
  return ranges;
};

const delimiterRangesForStatement = (
  sourceLines: readonly string[],
  statement: {
    range: { startLine: number; endLine: number };
    structural: "open" | "close" | "else" | null;
  }
): DslFoldingRange[] => {
  if (statement.structural !== null) return [];

  const stack: DelimiterFrame[] = [];
  const ranges: DslFoldingRange[] = [];

  for (let line = statement.range.startLine; line <= statement.range.endLine; line += 1) {
    const code = splitDslComment(sourceLines[line - 1] ?? "").code;
    let quote: string | null = null;
    for (let index = 0; index < code.length; index += 1) {
      const char = code[index]!;
      if ((char === "\"" || char === "'") && code[index - 1] !== "\\") {
        quote = quote === char ? null : quote ?? char;
        continue;
      }
      if (quote) continue;

      if (char === "(" || char === "[") {
        stack.push({ delimiter: char, line });
        continue;
      }
      if (char !== ")" && char !== "]") continue;

      const frame = stack.at(-1);
      if (!frame || matchingCloserFor(frame.delimiter) !== char) return [];
      stack.pop();
      if (frame.line < line) ranges.push({ kind: "syntax", startLine: frame.line, endLine: line });
    }
  }

  return stack.length === 0 ? ranges : [];
};

const commentRangesFor = (source: string): DslFoldingRange[] => {
  const lines = source.split("\n");
  const ranges: DslFoldingRange[] = [];
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    if (!lines[lineIndex]!.trimStart().startsWith("#")) {
      lineIndex += 1;
      continue;
    }
    const start = lineIndex;
    while (lineIndex < lines.length && lines[lineIndex]!.trimStart().startsWith("#")) lineIndex += 1;
    if (lineIndex - start >= 2) {
      ranges.push({ kind: "comment", startLine: start + 1, endLine: lineIndex });
    }
  }
  return ranges;
};

const sortRanges = (ranges: DslFoldingRange[]): DslFoldingRange[] =>
  ranges.sort((left, right) =>
    left.startLine - right.startLine ||
    right.endLine - left.endLine ||
    (left.kind === right.kind ? 0 : left.kind === "syntax" ? -1 : 1)
  );

export const queryDslFolding = ({
  source,
  statements,
  sourceMap
}: DslFoldingQueryInput): DslFoldingRange[] => {
  if (sourceMap.source !== source.normalizedSource || sourceMap.sourceRevision !== source.sourceRevision) return [];

  const sourceLines = source.normalizedSource.split("\n");
  const invalidContinuationLines = new Set(sourceMap.invalidContinuationLines);
  const delimiterRanges = sourceMap.statements.flatMap((statement) =>
    invalidContinuationLines.has(statement.range.endLine)
      ? []
      : delimiterRangesForStatement(sourceLines, statement)
  );

  return sortRanges([
    ...braceRangesFor(statements),
    ...delimiterRanges,
    ...commentRangesFor(source.normalizedSource)
  ]);
};
