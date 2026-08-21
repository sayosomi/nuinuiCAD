import {
  matchingDslDelimiter,
  scanCallArgs,
  scanDslNesting
} from "./dslArgScanner";
import { dslCompletionContextAt } from "./dslCompletionContext";
import {
  createLogicalStatementSourceMap,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { dslStatementKeywordCompletions } from "./dslParser";
import { getBuiltinFunctionDefinition } from "../scalars/builtinFunctions";
import { isBareDslIdentifierChar } from "./dslTokens";

export type DslCallAuthoringRange = { from: number; to: number };

export type DslCallAuthoringSourceSegment = {
  logicalFrom: number;
  logicalTo: number;
  physicalFrom: number;
  physicalTo: number;
};

export type DslCallAuthoringArgument = {
  index: number;
  segment: DslCallAuthoringRange;
  label: DslCallAuthoringRange | null;
  value: DslCallAuthoringRange | null;
};

export type DslCallAuthoringContext = {
  kind: "construction" | "module" | "builtin";
  callee: {
    name: string;
    span: DslCallAuthoringRange;
    openParen: number;
  };
  call: {
    from: number;
    to: number;
    closeParen: number | null;
  };
  argument: DslCallAuthoringArgument;
  /** Named arguments anywhere inside the proven call envelope. */
  usedArgumentNames: ReadonlySet<string>;
  /** The strict statement which owns the incomplete call. This is the only
   * source-order anchor accepted by the tolerant projection. */
  sourceOrderAnchor: {
    statementIndex: number;
    statementRange: Pick<LogicalStatement["range"], "from" | "to" | "startLine" | "endLine">;
  };
  /** Logical source used by the existing completion classifiers. */
  logicalText: string;
  logicalCursorPosition: number;
  logicalSourceSegments: readonly DslCallAuthoringSourceSegment[];
  sourcePosition: number;
  sourceRevision: number;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const lineIndexAt = (starts: readonly number[], position: number) => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= position) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
};

const calleeSpanAt = (source: string, open: number): DslCallAuthoringRange | null => {
  let end = open;
  while (end > 0 && /\s/.test(source[end - 1]!)) end -= 1;
  let from = end;
  while (from > 0 && isBareDslIdentifierChar(source[from - 1]!)) from -= 1;
  return from < end ? { from, to: end } : null;
};

const codeSourceFor = (lexicalLines: readonly { code: string }[]) =>
  lexicalLines.map((line) => line.code).join("\n");

const trimmedRange = (source: string, from: number, to: number): DslCallAuthoringRange => {
  while (from < to && /\s/.test(source[from]!)) from += 1;
  while (to > from && /\s/.test(source[to - 1]!)) to -= 1;
  return { from, to };
};

const currentArgumentFrom = (
  source: string,
  open: number,
  end: number,
  position: number,
  kind: DslCallAuthoringContext["kind"]
): DslCallAuthoringArgument => {
  const commas = scanDslNesting(source, { start: open + 1, end }).topLevelCommas;
  const previousComma = [...commas].reverse().find((comma) => comma < position);
  const nextComma = commas.find((comma) => comma >= position);
  const segmentFrom = (previousComma ?? open) + 1;
  const segmentTo = nextComma ?? end;
  const segment = { from: segmentFrom, to: segmentTo };
  const index = commas.filter((comma) => comma < position).length;
  const prefixEnd = Math.min(position, segmentTo);
  const prefix = source.slice(segmentFrom, prefixEnd);
  const named = /^\s*([^\s"'#=()[\]{},;:]+)\s*:/.exec(prefix);
  if (named) {
    const keyFrom = segmentFrom + (named[0].length - named[1]!.length - 1);
    const colon = segmentFrom + (named.index ?? 0) + named[0].lastIndexOf(":");
    const key = { from: keyFrom, to: keyFrom + named[1]!.length };
    const valueFrom = colon + 1;
    const value = trimmedRange(source, Math.min(valueFrom, position), position);
    return { index, segment, label: key, value: position > colon ? value : null };
  }
  const partial = trimmedRange(source, segmentFrom, prefixEnd);
  const hasPartialIdentifier = partial.from < partial.to && [...source.slice(partial.from, partial.to)].every((character) => isBareDslIdentifierChar(character));
  return {
    index,
    segment,
    label: kind === "module" || kind === "construction"
      ? hasPartialIdentifier ? partial : null
      : null,
    value: kind === "builtin" && hasPartialIdentifier ? partial : null
  };
};

const isUnsafeCurrentFragment = (fragment: string) => {
  const trimmed = fragment.trim();
  if (!trimmed) return false;
  if (/[{};]/.test(trimmed) || /(^|[^=!<>])=([^=]|$)/.test(trimmed)) return true;
  const leadingKeyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed)?.[0];
  return leadingKeyword !== undefined && dslStatementKeywordCompletions.some((keyword) => keyword === leadingKeyword);
};

const appendPhysicalSegment = (
  parts: string[],
  segments: DslCallAuthoringSourceSegment[],
  source: string,
  physicalFrom: number,
  physicalTo: number
) => {
  let from = physicalFrom;
  let to = physicalTo;
  while (from < to && /\s/.test(source[from]!)) from += 1;
  while (to > from && /\s/.test(source[to - 1]!)) to -= 1;
  if (from >= to) return;
  const logicalFrom = parts.join(" ").length + (parts.length > 0 ? 1 : 0);
  parts.push(source.slice(from, to));
  segments.push({
    logicalFrom,
    logicalTo: logicalFrom + (to - from),
    physicalFrom: from,
    physicalTo: to
  });
};

const physicalRangeForLogical = (
  context: DslCallAuthoringContext,
  range: DslCallAuthoringRange
): DslCallAuthoringRange | null => {
  if (range.from === range.to && range.from === context.logicalCursorPosition) {
    return { from: context.sourcePosition, to: context.sourcePosition };
  }
  const segment = context.logicalSourceSegments.find((candidate) =>
    range.from >= candidate.logicalFrom && range.to <= candidate.logicalTo
  );
  if (!segment) return null;
  return {
    from: segment.physicalFrom + range.from - segment.logicalFrom,
    to: segment.physicalFrom + range.to - segment.logicalFrom
  };
};

export const projectDslCallAuthoringRange = physicalRangeForLogical;

/**
 * Projects an incomplete call across the one blank line where strict logical
 * statement containment deliberately stops. The projection is only accepted
 * when the strict source map identifies the originating incomplete statement
 * and no unrelated code crosses the recovery window.
 */
export const dslCallAuthoringContextAt = (
  snapshot: SourceSnapshot,
  position: number
): DslCallAuthoringContext | null => {
  if (snapshot.normalizedSource.includes("\r") || position < 0 || position > snapshot.normalizedSource.length) return null;
  const map = createLogicalStatementSourceMap(snapshot);
  const starts = lineStartsFor(map.source);
  const lineIndex = lineIndexAt(starts, position);
  const line = map.lexicalLines[lineIndex];
  if (!line) return null;
  if (line.comments.some((comment) => position >= starts[lineIndex]! + comment.start && position <= starts[lineIndex]! + comment.end)) return null;

  const statement = [...map.statements].reverse().find((candidate) =>
    candidate.range.endLine <= lineIndex &&
    candidate.range.startLine <= candidate.range.endLine &&
    map.invalidContinuationLines.includes(candidate.range.endLine) &&
    position >= starts[lineIndex]!
  );
  if (!statement) return null;

  const strictBoundaryLine = statement.range.endLine;
  if (lineIndex < strictBoundaryLine) return null;
  for (let index = strictBoundaryLine; index < lineIndex; index += 1) {
    const candidateLine = map.lexicalLines[index];
    if (candidateLine?.codeText.trim() || candidateLine?.text.trim()) return null;
  }

  const codeSource = codeSourceFor(map.lexicalLines);
  const statementNesting = scanDslNesting(statement.logicalText);
  const openLogical = [...statementNesting.unmatchedOpeners]
    .reverse()
    .find((opener) => opener.delimiter === "(")?.index ?? -1;
  if (openLogical < 0) return null;
  const openPhysical = statement.segments.length > 0
    ? (() => {
        let logicalStart = 0;
        for (const segment of statement.segments) {
          const length = segment.to - segment.from;
          if (openLogical >= logicalStart && openLogical <= logicalStart + length) {
            return segment.from + openLogical - logicalStart;
          }
          logicalStart += length + 1;
        }
        return null;
      })()
    : null;
  if (openPhysical === null) return null;

  const closePhysical = matchingDslDelimiter(codeSource, openPhysical);
  if (closePhysical >= 0 && position > closePhysical) return null;

  const currentFragment = codeSource.slice(starts[lineIndex]!, position);
  if (isUnsafeCurrentFragment(currentFragment)) return null;

  const closeLine = closePhysical >= 0 ? lineIndexAt(starts, closePhysical) : -1;
  if (closeLine >= 0) {
    for (let index = lineIndex + 1; index <= closeLine; index += 1) {
      const lineStart = starts[index]!;
      const lineEnd = starts[index + 1] ?? map.source.length;
      const codeBeforeClose = index === closeLine
        ? codeSource.slice(lineStart, closePhysical)
        : codeSource.slice(lineStart, lineEnd);
      if (isUnsafeCurrentFragment(codeBeforeClose)) return null;
    }
    const closeLineEnd = starts[closeLine + 1] ?? map.source.length;
    if (isUnsafeCurrentFragment(codeSource.slice(closePhysical + 1, closeLineEnd))) return null;
  } else {
    for (let index = lineIndex + 1; index < map.lexicalLines.length; index += 1) {
      const candidateLine = map.lexicalLines[index];
      if (candidateLine?.codeText.trim() || candidateLine?.text.trim()) return null;
    }
  }

  const calleeLogical = calleeSpanAt(statement.logicalText, openLogical);
  if (!calleeLogical) return null;
  const calleePhysical = (() => {
    let logicalStart = 0;
    for (const segment of statement.segments) {
      const length = segment.to - segment.from;
      if (calleeLogical.from >= logicalStart && calleeLogical.to <= logicalStart + length) {
        return {
          from: segment.from + calleeLogical.from - logicalStart,
          to: segment.from + calleeLogical.to - logicalStart
        };
      }
      logicalStart += length + 1;
    }
    return null;
  })();
  if (!calleePhysical) return null;

  const strictContext = dslCompletionContextAt(statement.logicalText, statement.logicalText.length);
  if (!strictContext) return null;
  const calleeName = statement.logicalText.slice(calleeLogical.from, calleeLogical.to);
  const candidateKind: DslCallAuthoringContext["kind"] | null =
    strictContext.kind === "argument"
      ? "construction"
      : strictContext.kind === "moduleArgumentLabel" || strictContext.kind === "moduleArgumentValue"
        ? "module"
        : strictContext.kind === "typedInitializer" && getBuiltinFunctionDefinition(calleeName)
          ? "builtin"
          : null;
  if (!candidateKind) return null;
  const kind = candidateKind;

  const logicalParts = [statement.logicalText];
  const logicalSourceSegments: DslCallAuthoringSourceSegment[] = statement.segments.map((segment, index) => {
    let logicalFrom = 0;
    for (let prior = 0; prior < index; prior += 1) logicalFrom += statement.segments[prior]!.to - statement.segments[prior]!.from + 1;
    return {
      logicalFrom,
      logicalTo: logicalFrom + segment.to - segment.from,
      physicalFrom: segment.from,
      physicalTo: segment.to
    };
  });
  const currentLineCodeStart = starts[lineIndex]!;
  const currentCodeSegments = line.codeSegments;
  for (const segment of currentCodeSegments) {
    const from = currentLineCodeStart + segment.start;
    const to = Math.min(currentLineCodeStart + segment.end, position);
    if (to > from) appendPhysicalSegment(logicalParts, logicalSourceSegments, map.source, from, to);
  }
  const logicalText = logicalParts.join(" ");
  const logicalCursorPosition = logicalText.length;
  const contentEnd = closePhysical >= 0 ? closePhysical : Math.max(position, openPhysical + 1);
  const scanned = scanCallArgs(codeSource, { start: openPhysical + 1, end: contentEnd });
  const argument = currentArgumentFrom(codeSource, openPhysical, contentEnd, position, kind);
  const usedArgumentNames = new Set(
    scanned.args
      .map((candidate) => candidate.key)
      .filter((key): key is string => Boolean(key))
  );

  return {
    kind,
    callee: { name: calleeName, span: calleePhysical, openParen: openPhysical },
    call: { from: calleePhysical.from, to: closePhysical >= 0 ? closePhysical + 1 : Math.max(position, openPhysical + 1), closeParen: closePhysical >= 0 ? closePhysical : null },
    argument: {
      ...argument,
      segment: { from: argument.segment.from, to: argument.segment.to }
    },
    usedArgumentNames,
    sourceOrderAnchor: {
      statementIndex: map.statements.indexOf(statement),
      statementRange: {
        from: statement.range.from,
        to: statement.range.to,
        startLine: statement.range.startLine,
        endLine: statement.range.endLine
      }
    },
    logicalText,
    logicalCursorPosition,
    logicalSourceSegments,
    sourcePosition: position,
    sourceRevision: snapshot.sourceRevision
  };
};
