import { formatDslName, quoteDslString, unquoteDslString } from "./dslTokens";

export type DslReferencePath = {
  absolute: boolean;
  segments: string[];
};

export type DslReferenceRange = {
  start: number;
  end: number;
};

export type DslSourceReference = {
  /** The source token without surrounding whitespace. */
  source: string;
  /** `@` is deliberately not part of the path text || path span. */
  path: DslReferencePath;
  pathText: string;
  property: string | null;
  fullRange: DslReferenceRange;
  pathRange: DslReferenceRange;
  propertyRange: DslReferenceRange | null;
};

export type DslSourceReferenceParseError = {
  kind: "invalid";
  code: "missing-sigil" | "missing-path" | "malformed-path" | "missing-property" | "trailing-junk";
  range: DslReferenceRange;
  message: string;
};

export type DslSourceReferenceParseResult =
  | { kind: "valid"; reference: DslSourceReference }
  | DslSourceReferenceParseError;

export type DslReferencePathReadResult =
  | { kind: "valid"; path: DslReferencePath; name: string; end: number }
  | { kind: "invalid"; end: number; invalidAt: number };

export type DslReferencePathSegment = {
  name: string;
  start: number;
  end: number;
};

export type DslReferencePathSegmentsReadResult =
  | { kind: "valid"; absolute: boolean; segments: readonly DslReferencePathSegment[]; end: number }
  | { kind: "invalid"; end: number; invalidAt: number };

const isEscaped = (source: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const isPathSegmentChar = (value: string) =>
  value.length > 0 && !/\s/.test(value) && !"'\"#=()[]{},;:.".includes(value);

/**
 * Reads a path without deciding whether it is a source reference. The path
 * reader is shared by the path-only namespace API, source references, && the
 * typed scalar adapter. It stops before an unquoted `.` so the caller can
 * parse property access without maintaining another `::` grammar.
 */
export const readDslReferencePath = (
  source: string,
  start = 0,
  end = source.length
): DslReferencePathReadResult => {
  const absolute = source.slice(start, start + 2) === "::";
  let cursor = absolute ? start + 2 : start;
  const segments: string[] = [];
  const pathStart = start;

  if (absolute && cursor >= end) return { kind: "invalid", end: cursor, invalidAt: start };
  for (;;) {
    const segmentStart = cursor;
    if (cursor >= end || source[cursor] === ".") {
      return { kind: "invalid", end: cursor, invalidAt: Math.max(pathStart, cursor - 2) };
    }

    let segmentEnd: number;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor];
      cursor += 1;
      let closed = false;
      while (cursor < end) {
        if (source[cursor] === quote && !isEscaped(source, cursor)) {
          cursor += 1;
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) return { kind: "invalid", end: cursor, invalidAt: segmentStart };
      segmentEnd = cursor;
    } else {
      while (cursor < end && isPathSegmentChar(source[cursor])) cursor += 1;
      segmentEnd = cursor;
      if (segmentEnd === segmentStart) return { kind: "invalid", end: cursor, invalidAt: cursor };
    }

    segments.push(unquoteDslString(source.slice(segmentStart, segmentEnd)));
    if (source.slice(cursor, cursor + 2) !== "::") break;
    const separatorStart = cursor;
    cursor += 2;
    if (
      cursor >= end ||
      source[cursor] === "." ||
      (source[cursor] !== '"' && source[cursor] !== "'" && !isPathSegmentChar(source[cursor]))
    ) {
      return { kind: "invalid", end: cursor, invalidAt: separatorStart };
    }
  }

  return {
    kind: "valid",
    path: { absolute, segments },
    name: source.slice(pathStart, cursor),
    end: cursor
  };
};

/**
 * Projects the already-parsed qualified path into its source segments. This
 * deliberately shares the path reader's character and quote rules; callers
 * use the returned ranges only after semantic resolution has identified the
 * declaration represented by each segment.
 */
export const readDslReferencePathSegments = (
  source: string,
  start = 0,
  end = source.length
): DslReferencePathSegmentsReadResult => {
  const parsed = readDslReferencePath(source, start, end);
  if (parsed.kind === "invalid") return parsed;

  const absolute = source.slice(start, start + 2) === "::";
  let cursor = absolute ? start + 2 : start;
  const segments: DslReferencePathSegment[] = [];
  for (const name of parsed.path.segments) {
    const segmentStart = cursor;
    if (source[cursor] === "\"" || source[cursor] === "'") {
      const quote = source[cursor];
      cursor += 1;
      while (cursor < parsed.end) {
        if (source[cursor] === quote && !isEscaped(source, cursor)) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
    } else {
      while (cursor < parsed.end && isPathSegmentChar(source[cursor])) cursor += 1;
    }
    segments.push({ name, start: segmentStart, end: cursor });
    if (source.slice(cursor, cursor + 2) === "::") cursor += 2;
  }
  return { kind: "valid", absolute, segments, end: parsed.end };
};

// `::` is structural only outside quoted segments. Keeping this split in one
// helper prevents serializers from quoting a qualified reference as one name.
export const parseDslReferenceToken = (token: string): DslReferencePath => {
  const value = token.trim();
  const result = readDslReferencePath(value);
  if (result.kind === "valid" && result.end === value.length) return result.path;
  // Keep the path-only API total for dangling/internal model IDs. Strict
  // source parsing is provided by parseDslSourceReference && is the only
  // parser used at source-reference boundaries.
  return { absolute: value.startsWith("::"), segments: [unquoteDslString(value.replace(/^::/, ""))] };
};

const formatDslReferenceSegment = (segment: string) =>
  segment.includes(".") ? quoteDslString(segment) : formatDslName(segment);

export const formatDslReferencePath = ({ absolute, segments }: DslReferencePath) =>
  `${absolute ? "::" : ""}${segments.map(formatDslReferenceSegment).join("::")}`;

// Canonicalizes both parser tokens (`Outer::"Inner name"`) && raw dangling
// model IDs (`Inner name`) without losing namespace segment boundaries.
export const formatDslReferenceToken = (token: string) =>
  formatDslReferencePath(parseDslReferenceToken(token));

const propertyBoundary = (value: string) =>
  /\s/.test(value) || "()+*/<>!=&|,[]{};:'\"".includes(value);

const readProperty = (source: string, start: number, end: number) => {
  let cursor = start;
  let segmentStart = start;
  while (cursor < end) {
    const char = source[cursor];
    if (char === ".") {
      if (cursor === segmentStart) return { end: cursor, invalidAt: cursor, value: "" };
      cursor += 1;
      segmentStart = cursor;
      continue;
    }
    if (propertyBoundary(char)) break;
    cursor += 1;
  }
  if (cursor === segmentStart) return { end: cursor, invalidAt: start, value: "" };
  return { end: cursor, invalidAt: -1, value: source.slice(start, cursor) };
};

const sourceReferenceError = (
  code: DslSourceReferenceParseError["code"],
  range: DslReferenceRange,
  message: string
): DslSourceReferenceParseError => ({ kind: "invalid", code, range, message });

/** Parses one complete `@qualifiedName[.property]` source token. */
export const parseDslSourceReference = (source: string): DslSourceReferenceParseResult => {
  let start = 0;
  while (start < source.length && /\s/.test(source[start])) start += 1;
  let end = source.length;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  if (start === end) return sourceReferenceError("missing-path", { start, end }, "参照先のqualified nameが必要です。");
  if (source[start] !== "@") {
    return sourceReferenceError("missing-sigil", { start, end: Math.min(start + 1, end) }, "参照には先頭の「@」が必要です。");
  }
  const parsed = parseDslSourceReferenceAt(source, start, end);
  if (parsed.kind === "valid" && parsed.end === end) {
    return { kind: "valid", reference: parsed.reference };
  }
  if (parsed.kind === "invalid") return parsed.error;
  return sourceReferenceError("trailing-junk", { start: parsed.end, end }, "参照の末尾に余分な文字があります。");
};

/** Reads a source reference at an absolute source position, stopping at the
 * next expression/argument boundary. Returned ranges are absolute. */
export const parseDslSourceReferenceAt = (
  source: string,
  start: number,
  end = source.length
): { kind: "valid"; reference: DslSourceReference; end: number } | { kind: "invalid"; error: DslSourceReferenceParseError; end: number } => {
  if (source[start] !== "@") {
    return { kind: "invalid", end: start + 1, error: sourceReferenceError("missing-sigil", { start, end: start + 1 }, "参照には先頭の「@」が必要です。") };
  }
  const pathStart = start + 1;
  const path = readDslReferencePath(source, pathStart, end);
  if (path.kind === "invalid") {
    const missing = path.invalidAt === start || (
      path.invalidAt === pathStart && source[pathStart] !== '"' && source[pathStart] !== "'"
    );
    return {
      kind: "invalid",
      end: Math.max(path.end, start + 1),
      error: sourceReferenceError(
        missing ? "missing-path" : "malformed-path",
        missing
          ? { start, end: Math.min(start + 1, end) }
          : { start: path.invalidAt, end: Math.min(path.invalidAt + 1, end) },
        missing ? "「@」の後にqualified nameが必要です。" : "qualified nameのpathが不正です。"
      )
    };
  }
  let cursor = path.end;
  let property: string | null = null;
  let propertyRange: DslReferenceRange | null = null;
  if (source[cursor] === ".") {
    const propertyStart = cursor + 1;
    const parsedProperty = readProperty(source, propertyStart, end);
    if (!parsedProperty.value) {
      return {
        kind: "invalid",
        end: Math.max(propertyStart, cursor + 1),
        error: sourceReferenceError("missing-property", { start: cursor, end: Math.min(cursor + 1, end) }, "「.」の後にプロパティ名が必要です。")
      };
    }
    property = parsedProperty.value;
    propertyRange = { start: propertyStart, end: parsedProperty.end };
    cursor = parsedProperty.end;
  }
  const reference: DslSourceReference = {
    source: source.slice(start, cursor),
    path: path.path,
    pathText: source.slice(pathStart, path.end),
    property,
    fullRange: { start, end: cursor },
    pathRange: { start: pathStart, end: path.end },
    propertyRange
  };
  return { kind: "valid", reference, end: cursor };
};

/** Formats the canonical source spelling while keeping semantic candidate
 * tokens free of the source-only `@` marker. */
export const formatDslSourceReference = (reference: Pick<DslSourceReference, "path" | "property">) =>
  `@${formatDslReferencePath(reference.path)}${reference.property ? `.${reference.property}` : ""}`;
