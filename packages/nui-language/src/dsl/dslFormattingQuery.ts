import { scanCallArgs, scanDslNesting, type DslNestingDelimiter } from "./dslArgScanner";
import {
  createLogicalStatementSourceMap,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { isUnsafeDslContinuationFragment } from "./dslStatementKeywords";
import { scanDslSource, type DslLexedLine } from "./dslTokens";

export type DslFormattingOptions = {
  tabSize: number;
  insertSpaces: boolean;
};

export type DslFormattingSourceRange = { from: number; to: number };

export type DslFormattingTextEdit = {
  range: DslFormattingSourceRange;
  newText: string;
};

export type DslFormattingQueryInput = {
  normalizedSource: string;
  options: DslFormattingOptions;
  selectionRange?: DslFormattingSourceRange;
};

type SourceLine = DslLexedLine & { start: number; end: number };
type LocalTextEdit = { from: number; to: number; text: string };
type DelimiterPair = {
  open: number;
  close: number;
  delimiter: DslNestingDelimiter;
  openLine: number;
  closeLine: number;
};
type ActiveDelimiter = {
  delimiter: DslNestingDelimiter;
  multiline: boolean;
  indent: number;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const sourceLinesFor = (source: string): SourceLine[] => {
  const starts = lineStartsFor(source);
  return scanDslSource(source).lines.map((line, index) => ({
    ...line,
    start: starts[index]!,
    end: starts[index]! + line.text.length
  }));
};

const lineIndexAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
};

const indentationAtLineStart = (line: string): number => /^[ \t]*/.exec(line)![0].length;

const matchingCloser = (delimiter: DslNestingDelimiter): ")" | "]" =>
  delimiter === "(" ? ")" : "]";

const delimiterPairsFor = (code: string, starts: readonly number[]): DelimiterPair[] => {
  const nesting = scanDslNesting(code);
  return nesting.matchedDelimiters.map(({ open, close }) => ({
    open: open.index,
    close: close.index,
    delimiter: open.delimiter,
    openLine: lineIndexAt(starts, open.index),
    closeLine: lineIndexAt(starts, close.index)
  }));
};

const containsComment = (lines: readonly DslLexedLine[], starts: readonly number[], from: number, to: number) =>
  lines.some((line, lineIndex) => line.comments.some((comment) => {
    const commentFrom = starts[lineIndex]! + comment.start;
    const commentTo = starts[lineIndex]! + comment.end;
    return commentFrom < to && commentTo > from;
  }));

const containsBlankLine = (lines: readonly DslLexedLine[], starts: readonly number[], from: number, to: number) =>
  lines.some((line, lineIndex) =>
    starts[lineIndex]! >= from && starts[lineIndex]! < to && line.text.trim() === ""
  );

const precedingIdentifierEnd = (code: string, open: number): number | null => {
  let cursor = open - 1;
  while (cursor >= 0 && /\s/.test(code[cursor]!)) cursor -= 1;
  if (cursor < 0 || !/[\p{ID_Continue}_]/u.test(code[cursor]!)) return null;
  let start = cursor;
  while (start > 0 && /[\p{ID_Continue}_]/u.test(code[start - 1]!)) start -= 1;
  if (start > 0 && code[start - 1] === "@") {
    const callPrefix = code.slice(0, open);
    return /\b(?:move|mirrorMove)\s+@[A-Za-z_][A-Za-z0-9_:]*\s*$/.test(callPrefix)
      ? cursor + 1
      : null;
  }
  return cursor + 1;
};

const applyLocalEdits = (source: string, edits: readonly LocalTextEdit[]): string => {
  let result = source;
  for (const edit of [...edits].sort((left, right) => right.from - left.from || right.to - left.to)) {
    result = `${result.slice(0, edit.from)}${edit.text}${result.slice(edit.to)}`;
  }
  return result;
};

const canonicalCallEdits = (
  source: string,
  options: DslFormattingOptions,
  baseIndent: number
): LocalTextEdit[] => {
  const lines = scanDslSource(source).lines;
  const starts = lineStartsFor(source);
  const code = lines.map((line) => line.code).join("\n");
  const pairs = delimiterPairsFor(code, starts);
  const indentUnit = options.insertSpaces ? " ".repeat(Math.max(1, Math.floor(options.tabSize) || 2)) : "\t";
  const edits: LocalTextEdit[] = [];

  for (const pair of pairs) {
    if (pair.delimiter !== "(" || precedingIdentifierEnd(code, pair.open) === null) continue;
    if (containsComment(lines, starts, pair.open + 1, pair.close)) continue;
    if (containsBlankLine(lines, starts, pair.open + 1, pair.close)) continue;

    const scanned = scanCallArgs(code, { start: pair.open + 1, end: pair.close }, { allowOptionalKeys: true });
    if (scanned.errors.length > 0 || scanned.args.length < 2 || scanned.args.some((arg) => arg.keySpan === null)) continue;

    const commas = scanDslNesting(code, { start: pair.open + 1, end: pair.close }).topLevelCommas;
    if (commas.length !== scanned.args.length - 1 && commas.length !== scanned.args.length) continue;

    let parentMultilineDepth = 0;
    for (const parent of pairs) {
      if (parent.open >= pair.open || parent.close <= pair.close) continue;
      if (parent.closeLine > parent.openLine) parentMultilineDepth += 1;
    }
    const argumentIndent = baseIndent + parentMultilineDepth + 1;
    const closeIndent = baseIndent + parentMultilineDepth;
    const argumentPrefix = `${indentUnit.repeat(argumentIndent)}`;
    const closingPrefix = `${indentUnit.repeat(closeIndent)}`;
    const first = scanned.args[0]!;
    const firstStart = first.keySpan!.start;
    if (code.slice(pair.open + 1, firstStart).trim() !== "") continue;
    edits.push({ from: pair.open + 1, to: firstStart, text: `\n${argumentPrefix}` });

    for (let index = 0; index < scanned.args.length - 1; index += 1) {
      const comma = commas[index]!;
      const valueEnd = scanned.args[index]!.valueSpan.end;
      const nextStart = scanned.args[index + 1]!.keySpan!.start;
      if (code.slice(valueEnd, comma).trim() === "") edits.push({ from: valueEnd, to: comma, text: "" });
      if (code.slice(comma + 1, nextStart).trim() !== "") continue;
      edits.push({ from: comma + 1, to: nextStart, text: `\n${argumentPrefix}` });
    }

    const last = scanned.args.at(-1)!;
    const lastValueEnd = last.valueSpan.end;
    if (commas.length === scanned.args.length) {
      const trailingComma = commas.at(-1)!;
      if (trailingComma < lastValueEnd || code.slice(trailingComma + 1, pair.close).trim() !== "") continue;
      if (code.slice(lastValueEnd, trailingComma).trim() === "") edits.push({ from: lastValueEnd, to: trailingComma, text: "" });
      edits.push({ from: trailingComma + 1, to: pair.close, text: `\n${closingPrefix}` });
    } else {
      if (code.slice(lastValueEnd, pair.close).trim() !== "") continue;
      edits.push({ from: lastValueEnd, to: pair.close, text: `,\n${closingPrefix}` });
    }

    for (const arg of scanned.args) {
      const colon = arg.optionalSpan?.end ?? arg.keySpan!.end;
      if (arg.valueSpan.start < colon + 1) continue;
      if (lineIndexAt(starts, colon) !== lineIndexAt(starts, arg.valueSpan.start)) continue;
      if (code.slice(colon + 1, arg.valueSpan.start).trim() === "") {
        edits.push({ from: colon + 1, to: arg.valueSpan.start, text: " " });
      }
    }
  }

  return edits;
};

const isSafeStatement = (
  statement: LogicalStatement,
  statementText: string,
  invalidContinuationLines: ReadonlySet<number>
): boolean => {
  if (statement.structural) return true;
  if (Array.from({ length: statement.range.endLine - statement.range.startLine + 1 }, (_, index) =>
    invalidContinuationLines.has(statement.range.startLine + index)
  ).some(Boolean)) return false;

  const logicalNesting = scanDslNesting(statement.logicalText);
  if (logicalNesting.unmatchedOpeners.length > 0 || logicalNesting.unmatchedClosers.length > 0) return false;

  const lines = scanDslSource(statementText).lines;
  const code = lines.map((line) => line.code).join("\n");
  const nesting = scanDslNesting(code);
  if (nesting.unmatchedOpeners.length > 0 || nesting.unmatchedClosers.length > 0) return false;
  for (const pair of nesting.matchedDelimiters) {
    if (pair.open.delimiter !== "(") continue;
    const args = scanCallArgs(code, { start: pair.open.index + 1, end: pair.close.index }, { allowOptionalKeys: true });
    if (args.errors.length > 0) return false;
  }
  return true;
};

const bracesOnLine = (code: string): { opens: number; closes: number } => {
  let opens = 0;
  let closes = 0;
  let quote: string | null = null;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index]!;
    if (quote) {
      if (character === quote) {
        let backslashes = 0;
        for (let previous = index - 1; previous >= 0 && code[previous] === "\\"; previous -= 1) backslashes += 1;
        if (backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") opens += 1;
    else if (character === "}") closes += 1;
  }
  return { opens, closes };
};

const blockDepthBeforeLines = (lines: readonly DslLexedLine[]): number[] => {
  const depths: number[] = [];
  let depth = 0;
  for (const line of lines) {
    depths.push(depth);
    const { opens, closes } = bracesOnLine(line.code);
    depth = Math.max(0, depth + opens - closes);
  }
  return depths;
};

const formatStatementIndentation = (
  source: string,
  initialBlockDepth: number,
  options: DslFormattingOptions,
  continuationLines: ReadonlySet<number>
): string => {
  const lines = scanDslSource(source).lines;
  const starts = lineStartsFor(source);
  const code = lines.map((line) => line.code).join("\n");
  const pairs = delimiterPairsFor(code, starts);
  const pairAtOpen = new Map(pairs.map((pair) => [pair.open, pair]));
  const pairAtClose = new Map(pairs.map((pair) => [pair.close, pair]));
  const indentUnit = options.insertSpaces ? " ".repeat(Math.max(1, Math.floor(options.tabSize) || 2)) : "\t";
  const delimiterStack: ActiveDelimiter[] = [];
  const braceIndents = Array.from({ length: initialBlockDepth }, (_, index) => index);
  const output: string[] = [];
  let globalOffset = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const lineCode = line.code;
    const firstCodeIndex = lineCode.search(/\S/);
    const lookaheadDelimiters = [...delimiterStack];
    const lookaheadBraces = [...braceIndents];
    let indent = lookaheadDelimiters.at(-1)?.multiline
      ? lookaheadDelimiters.at(-1)!.indent + 1
      : lookaheadBraces.length;
    let cursor = firstCodeIndex;
    let consumedCloser = false;
    while (cursor >= 0 && cursor < lineCode.length) {
      const character = lineCode[cursor]!;
      if (character === ")" || character === "]") {
        const active = lookaheadDelimiters.at(-1);
        if (!active || matchingCloser(active.delimiter) !== character) break;
        lookaheadDelimiters.pop();
        if (active.multiline) indent = active.indent;
        consumedCloser = true;
        cursor += 1;
        while (cursor < lineCode.length && /\s/.test(lineCode[cursor]!)) cursor += 1;
        continue;
      }
      if (character === "}") {
        const blockIndent = lookaheadBraces.pop();
        indent = blockIndent ?? Math.max(0, lookaheadBraces.length);
        consumedCloser = true;
        cursor += 1;
        while (cursor < lineCode.length && /\s/.test(lineCode[cursor]!)) cursor += 1;
        continue;
      }
      break;
    }
    if (!consumedCloser && delimiterStack.at(-1)?.multiline) indent = delimiterStack.at(-1)!.indent + 1;
    else if (!consumedCloser && continuationLines.has(lineIndex)) indent = lookaheadBraces.length + 1;

    const leadingLength = indentationAtLineStart(line.text);
    const shouldPreserveBlockCommentText = line.startsInBlockComment;
    const replacement = shouldPreserveBlockCommentText || line.text.trim() === ""
      ? line.text
      : `${indentUnit.repeat(Math.max(0, indent))}${line.text.slice(leadingLength)}`;
    output.push(replacement);

    for (let column = 0; column < lineCode.length; column += 1) {
      const position = globalOffset + column;
      const character = lineCode[column]!;
      if (character === "(" || character === "[") {
        const pair = pairAtOpen.get(position);
        if (pair) delimiterStack.push({
          delimiter: character,
          multiline: pair.closeLine > pair.openLine,
          indent
        });
      } else if (character === ")" || character === "]") {
        if (pairAtClose.has(position) && delimiterStack.length > 0) delimiterStack.pop();
      }
    }

    let quote: string | null = null;
    let opens = 0;
    let closes = 0;
    for (let column = 0; column < lineCode.length; column += 1) {
      const character = lineCode[column]!;
      if (quote) {
        if (character === quote) {
          let backslashes = 0;
          for (let previous = column - 1; previous >= 0 && lineCode[previous] === "\\"; previous -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = null;
        }
      } else if (character === "\"" || character === "'") quote = character;
      else if (character === "{") opens += 1;
      else if (character === "}") closes += 1;
    }
    for (let index = 0; index < closes; index += 1) braceIndents.pop();
    for (let index = 0; index < opens; index += 1) braceIndents.push(indent);
    globalOffset += line.text.length + (lineIndex < lines.length - 1 ? 1 : 0);
  }

  return output.join("\n");
};

const applyStatementFormatting = (
  source: string,
  statement: LogicalStatement,
  initialBlockDepth: number,
  options: DslFormattingOptions,
  invalidContinuationLines: ReadonlySet<number>
): string | null => {
  const statementText = source.slice(statement.range.from, statement.range.to);
  if (!isSafeStatement(statement, statementText, invalidContinuationLines)) return null;
  const canonical = applyLocalEdits(statementText, canonicalCallEdits(statementText, options, initialBlockDepth));
  const canonicalLines = scanDslSource(canonical).lines;
  const canonicalCode = canonicalLines.map((line) => line.code).join("\n");
  const canonicalStarts = lineStartsFor(canonical);
  const canonicalPairs = delimiterPairsFor(canonicalCode, canonicalStarts);
  const containsBlock = canonicalLines.some((line) => {
    const braces = bracesOnLine(line.code);
    return braces.opens > 0 || braces.closes > 0;
  });
  const continuationLines = new Set<number>();
  if (!containsBlock) {
    for (let lineIndex = 1; lineIndex < canonicalLines.length; lineIndex += 1) {
      const line = canonicalLines[lineIndex]!;
      if (!line.text.trim()) continue;
      const insideMultilineDelimiter = canonicalPairs.some((pair) =>
        pair.openLine < lineIndex && pair.closeLine >= lineIndex
      );
      if (!insideMultilineDelimiter) continuationLines.add(lineIndex);
    }
  }
  const formatted = formatStatementIndentation(canonical, initialBlockDepth, options, continuationLines);
  return formatted === statementText ? null : formatted;
};

const isNamedArgumentFragment = (code: string): boolean => {
  const args = scanCallArgs(code, { start: 0, end: code.length }, { allowOptionalKeys: true });
  return args.errors.length === 0 && args.args.length > 0 && args.args.every((arg) => arg.key !== null);
};

const recoveryBoundaryIn = (
  statement: LogicalStatement,
  lines: readonly SourceLine[]
): number | null => {
  const logicalNesting = scanDslNesting(statement.logicalText);
  if (logicalNesting.unmatchedOpeners.length === 0) return null;
  let braceDepth = 0;
  const firstLine = statement.range.startLine - 1;
  const lastLine = statement.range.endLine - 1;
  for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const code = line.codeText.trim();
    if (
      lineIndex > firstLine &&
      braceDepth === 0 &&
      code.length > 0 &&
      !isNamedArgumentFragment(code) &&
      isUnsafeDslContinuationFragment(code)
    ) return lineIndex;
    const braces = bracesOnLine(line.code);
    braceDepth = Math.max(0, braceDepth + braces.opens - braces.closes);
  }
  return null;
};

const shiftedLogicalStatement = (
  statement: LogicalStatement,
  offset: number,
  lineOffset: number
): LogicalStatement => ({
  ...statement,
  range: {
    ...statement.range,
    from: statement.range.from + offset,
    to: statement.range.to + offset,
    startLine: statement.range.startLine + lineOffset,
    endLine: statement.range.endLine + lineOffset
  },
  segments: statement.segments.map((segment) => ({
    from: segment.from + offset,
    to: segment.to + offset
  })),
  continuationLines: statement.continuationLines.map((line) => line + lineOffset)
});

/**
 * Returns source-preserving edits for a normalized nui1 document. Only
 * indentation whitespace and safe multi-argument layout separators can change;
 * comments, values, identifiers, declarations, and source order remain authored.
 */
export const queryDslFormatting = ({
  normalizedSource,
  options,
  selectionRange
}: DslFormattingQueryInput): DslFormattingTextEdit[] => {
  if (normalizedSource.includes("\r")) return [];
  if (selectionRange && (
    selectionRange.from < 0 || selectionRange.to < selectionRange.from || selectionRange.to > normalizedSource.length
  )) return [];

  const indentOptions = {
    tabSize: Math.max(1, Math.floor(options.tabSize) || 2),
    insertSpaces: options.insertSpaces
  };
  const lines = sourceLinesFor(normalizedSource);
  const blockDepths = blockDepthBeforeLines(lines);
  const edits: DslFormattingTextEdit[] = [];
  const coveredLines = new Set<number>();
  const processSegment = (sourceOffset: number, lineOffset: number): void => {
    const segmentSource = normalizedSource.slice(sourceOffset);
    const snapshot: SourceSnapshot = { normalizedSource: segmentSource, sourceRevision: 0 };
    const sourceMap = createLogicalStatementSourceMap(snapshot);
    const segmentLines = sourceLinesFor(segmentSource);
    const invalidContinuationLines = new Set(sourceMap.invalidContinuationLines.map((line) => line + lineOffset));

    for (const localStatement of sourceMap.statements) {
      const statement = shiftedLogicalStatement(localStatement, sourceOffset, lineOffset);
      const boundary = recoveryBoundaryIn(localStatement, segmentLines);
      if (boundary !== null) {
        for (let line = statement.range.startLine; line < lineOffset + boundary + 1; line += 1) {
          coveredLines.add(line - 1);
        }
        const boundaryOffset = sourceOffset + segmentLines[boundary]!.start;
        processSegment(boundaryOffset, lineOffset + boundary);
        return;
      }

      const from = statement.range.from;
      const to = statement.range.to;
      if (selectionRange && (from < selectionRange.from || to > selectionRange.to)) continue;
      for (let line = statement.range.startLine; line <= statement.range.endLine; line += 1) coveredLines.add(line - 1);
      const newText = applyStatementFormatting(
        normalizedSource,
        statement,
        blockDepths[statement.range.startLine - 1] ?? 0,
        indentOptions,
        invalidContinuationLines
      );
      if (newText !== null) edits.push({ range: { from, to }, newText });

    }
  };
  processSegment(0, 0);

  const indentUnit = indentOptions.insertSpaces ? " ".repeat(indentOptions.tabSize) : "\t";
  for (const [lineIndex, line] of lines.entries()) {
    if (coveredLines.has(lineIndex) || line.startsInBlockComment || line.text.trim() === "" || line.codeText.trim() !== "") continue;
    const from = line.start;
    const to = line.end;
    if (selectionRange && (from < selectionRange.from || to > selectionRange.to)) continue;
    const indent = indentUnit.repeat(blockDepths[lineIndex] ?? 0);
    const current = line.text.slice(0, indentationAtLineStart(line.text));
    if (current !== indent) edits.push({ range: { from, to: from + current.length }, newText: indent });
  }

  return edits.sort((left, right) => left.range.from - right.range.from || left.range.to - right.range.to);
};
