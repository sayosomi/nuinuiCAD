import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import { dslCompletionContextAt } from "./dslCompletionContext";
import {
  createLogicalStatementSourceMap,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
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

const isEscaped = (source: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const lastOpenParenOutsideQuotes = (source: string) => {
  let quote: string | null = null;
  let open = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      open = index;
    }
  }
  return open;
};

const matchingCloseParen = (source: string, open: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
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

const topLevelCommas = (source: string, from: number, to: number) => {
  const commas: number[] = [];
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !isEscaped(source, index)) {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      commas.push(index);
    }
  }
  return commas;
};

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
  scanned: readonly ScannedArg[],
  kind: DslCallAuthoringContext["kind"]
): DslCallAuthoringArgument => {
  const commas = topLevelCommas(source, open + 1, end);
  const previousComma = [...commas].reverse().find((comma) => comma < position);
  const nextComma = commas.find((comma) => comma >= position);
  const segmentFrom = (previousComma ?? open) + 1;
  const segmentTo = nextComma ?? end;
  const segment = { from: segmentFrom, to: segmentTo };
  const containingIndex = scanned.findIndex((argument) => {
    const keyEnd = argument.keySpan?.end ?? -1;
    const value = argument.valueSpan.start === argument.valueSpan.end && argument.rawValueSpan
      ? argument.rawValueSpan
      : argument.valueSpan;
    return (
      (argument.keySpan && position >= argument.keySpan.start && position <= keyEnd) ||
      (position >= value.start && position <= value.end)
    );
  });
  const index = containingIndex >= 0 ? containingIndex : scanned.length;
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
  return /^(?:nui|module|instance|const|let|set|point|line|curve|arc|text|image|group|if|for|edge|extend|move|mirrorMove|reverse|place|layout|print|svg)(?:\s|$)/.test(trimmed);
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
  const openLogical = lastOpenParenOutsideQuotes(statement.logicalText);
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

  const closePhysical = matchingCloseParen(codeSource, openPhysical);
  if (closePhysical >= 0 && position > closePhysical) return null;

  const currentFragment = codeSource.slice(starts[lineIndex]!, position);
  if (isUnsafeCurrentFragment(currentFragment)) return null;

  const closeLine = closePhysical >= 0 ? lineIndexAt(starts, closePhysical) : -1;
  if (closeLine >= 0) {
    for (let index = lineIndex + 1; index < closeLine; index += 1) {
      const candidateLine = map.lexicalLines[index];
      if (candidateLine?.codeText.trim() || candidateLine?.text.trim()) return null;
    }
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
  const argument = currentArgumentFrom(codeSource, openPhysical, contentEnd, position, scanned.args, kind);

  return {
    kind,
    callee: { name: calleeName, span: calleePhysical, openParen: openPhysical },
    call: { from: calleePhysical.from, to: closePhysical >= 0 ? closePhysical + 1 : Math.max(position, openPhysical + 1), closeParen: closePhysical >= 0 ? closePhysical : null },
    argument: {
      ...argument,
      segment: { from: argument.segment.from, to: argument.segment.to }
    },
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
