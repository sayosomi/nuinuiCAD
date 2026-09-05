import { DSL_INDENT, scanDslSource, type DslLexedLine } from "../dsl/dslTokens";
import type { SerializedStatement } from "../dsl/dslSerializeElement";

type LineComment = { code: string; leading: string; comment: string };

const commentText = (text: string, segments: readonly DslLexedLine["comments"][number][]): string =>
  segments.map((segment) => {
    let start = segment.start;
    while (start > 0 && /\s/.test(text[start - 1]!)) start -= 1;
    return text.slice(start, segment.end);
  }).join("");

/** Projects one already-lexed physical line into the comment ownership used by
 * source mutation. A comment segment before the first real code fragment is a
 * prefix and must stay before that code; only comments after code are EOL text.
 */
const lineCommentFromLexical = (line: DslLexedLine): LineComment => {
  const firstCode = line.codeSegments.find((segment) => segment.text.trim().length > 0);
  if (!firstCode) {
    return { code: line.code, leading: commentText(line.text, line.comments), comment: "" };
  }

  const firstCodeStart = firstCode.start + (firstCode.text.length - firstCode.text.trimStart().length);
  const leadingSegments = line.comments.filter((segment) => segment.end <= firstCodeStart);
  const trailingSegments = line.comments.filter((segment) => segment.start >= firstCodeStart);
  return {
    code: line.code,
    leading: leadingSegments.length > 0
      ? line.text.slice(leadingSegments[0]!.start, firstCodeStart).trim()
      : "",
    comment: commentText(line.text, trailingSegments)
  };
};

/** Rewrites a canonical physical line without moving a full-source comment
 * prefix behind the code it closes. */
export const preserveDslLineComments = (canonicalLine: string, lexicalLine: DslLexedLine): string => {
  const comments = lineCommentFromLexical(lexicalLine);
  if (!comments.leading) return `${canonicalLine}${comments.comment}`;
  const indent = canonicalLine.match(/^\s*/)?.[0] ?? "";
  return `${indent}${comments.leading} ${canonicalLine.slice(indent.length)}${comments.comment}`;
};

const isFullLineComment = (line: LineComment): boolean =>
  line.code.trim() === "" && (line.leading !== "" || line.comment !== "");

const commentOnlyLine = (targetIndent: string, comment: string): string =>
  `${targetIndent}${comment.trim()}`;

const serializedArgumentText = (next: SerializedStatement, index: number): string => {
  const arg = next.args[index];
  return `${arg.text}${next.argumentSeparator === "comma" ? "," : ""}`;
};

const mergeToSingleLine = (
  oldLines: readonly string[],
  comments: readonly LineComment[],
  next: SerializedStatement,
  indent: string,
): string[] => {
  const leadingLines: string[] = [];
  const eolParts: string[] = [];
  let statementPrefix = "";
  for (let index = 0; index < oldLines.length; index += 1) {
    const line = comments[index];
    if (isFullLineComment(line)) {
      leadingLines.push(commentOnlyLine(indent, line.leading || line.comment));
    } else if (line.comment) {
      if (!statementPrefix && line.leading) statementPrefix = line.leading.trim();
      eolParts.push(line.comment);
    } else if (line.leading && !statementPrefix) {
      statementPrefix = line.leading.trim();
    }
  }
  return [...leadingLines, `${indent}${statementPrefix ? `${statementPrefix} ` : ""}${next.header}${eolParts.join("")}`];
};

const mergeFromSingleLineOld = (
  comments: readonly LineComment[],
  next: SerializedStatement,
  indent: string,
): string[] => {
  const line = comments[0];
  const eol = line?.comment ?? "";
  const prefix = line?.leading ? `${line.leading.trim()} ` : "";
  const argIndent = `${indent}${DSL_INDENT}`;
  return [
    `${indent}${prefix}${next.header}${eol}`,
    ...next.args.map((_, index) => `${argIndent}${serializedArgumentText(next, index)}`),
    `${indent}${next.close}`,
  ];
};

type OwnedRow = { leadingComments: string[]; leadingPrefix: string; eol: string };

const groupCommentsByOwner = (
  oldLines: readonly string[],
  comments: readonly LineComment[],
  oldArgLineByKey: ReadonlyMap<string, number>,
): { header: OwnedRow; close: OwnedRow; byKey: Map<string, OwnedRow> } => {
  const headerIndex = 0;
  const closeIndex = oldLines.length - 1;
  const ownerByIndex = new Map<number, string>([[headerIndex, "header"], [closeIndex, "close"]]);
  for (const [key, index] of oldArgLineByKey) {
    if (index !== headerIndex && index !== closeIndex) ownerByIndex.set(index, key);
  }

  const rows = new Map<string, OwnedRow>();
  const rowFor = (owner: string): OwnedRow => {
    const existing = rows.get(owner);
    if (existing) return existing;
    const created: OwnedRow = { leadingComments: [], leadingPrefix: "", eol: "" };
    rows.set(owner, created);
    return created;
  };

  let pending: string[] = [];
  for (let index = 0; index < oldLines.length; index += 1) {
    const line = comments[index];
    if (isFullLineComment(line)) {
      // Stored indent-free; callers re-indent to their own target level.
      pending.push((line.leading || line.comment).trim());
      continue;
    }
    const owner = ownerByIndex.get(index);
    if (owner === undefined) continue;
    const row = rowFor(owner);
    row.leadingComments = pending;
    row.leadingPrefix = line.leading;
    row.eol = line.comment;
    pending = [];
  }
  // Comments trailing the last owned row (directly before `)`, attached to no
  // key) belong to `close`'s own leading group so they stay closest to `)`.
  if (pending.length) {
    const closeRow = rowFor("close");
    closeRow.leadingComments = [...closeRow.leadingComments, ...pending];
  }

  return {
    header: rowFor("header"),
    close: rowFor("close"),
    byKey: rows,
  };
};

const deletedKeyOrphanLines = (
  oldArgLineByKey: ReadonlyMap<string, number>,
  nextKeys: ReadonlySet<string>,
  byKey: ReadonlyMap<string, OwnedRow>,
  argIndent: string,
): string[] => {
  const deletedKeys = [...oldArgLineByKey.entries()]
    .filter(([key]) => !nextKeys.has(key))
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key);

  const lines: string[] = [];
  for (const key of deletedKeys) {
    const row = byKey.get(key);
    if (!row) continue;
    for (const comment of row.leadingComments) lines.push(`${argIndent}${comment.trim()}`);
    if (row.eol) lines.push(commentOnlyLine(argIndent, row.eol));
  }
  return lines;
};

const mergeCallToCall = (
  oldLines: readonly string[],
  comments: readonly LineComment[],
  oldArgLineByKey: ReadonlyMap<string, number>,
  next: SerializedStatement,
  indent: string,
): string[] => {
  const argIndent = `${indent}${DSL_INDENT}`;
  const { header, close, byKey } = groupCommentsByOwner(oldLines, comments, oldArgLineByKey);
  const nextKeys = new Set(next.args.map((arg) => arg.key));

  const prefix = header.leadingPrefix ? `${header.leadingPrefix.trim()} ` : "";
  const lines: string[] = [`${indent}${prefix}${next.header}${header.eol}`];
  for (const [index, arg] of next.args.entries()) {
    const row = oldArgLineByKey.has(arg.key) ? byKey.get(arg.key) : undefined;
    for (const comment of row?.leadingComments ?? []) lines.push(`${argIndent}${comment.trim()}`);
    const rowPrefix = row?.leadingPrefix ? `${row.leadingPrefix.trim()} ` : "";
    lines.push(`${argIndent}${rowPrefix}${serializedArgumentText(next, index)}${row?.eol ?? ""}`);
  }
  lines.push(...deletedKeyOrphanLines(oldArgLineByKey, nextKeys, byKey, argIndent));
  for (const comment of close.leadingComments) lines.push(`${argIndent}${comment.trim()}`);
  const closePrefix = close.leadingPrefix ? `${close.leadingPrefix.trim()} ` : "";
  lines.push(`${indent}${closePrefix}${next.close}${close.eol}`);
  return lines;
};

export const mergeStatementComments = (input: {
  oldLines: readonly string[];
  oldArgLineByKey: ReadonlyMap<string, number>;
  next: SerializedStatement;
  indent: string;
  /** Full-source lexical lines from the compiled document. */
  lexicalLines?: readonly DslLexedLine[];
}): string[] => {
  const { oldLines, oldArgLineByKey, next, indent } = input;
  const lexicalLines = input.lexicalLines ?? scanDslSource(oldLines.join("\n")).lines;
  const comments = lexicalLines.map(lineCommentFromLexical);

  if (next.close === null) return mergeToSingleLine(oldLines, comments, next, indent);
  if (oldLines.length <= 1) return mergeFromSingleLineOld(comments, next, indent);
  return mergeCallToCall(oldLines, comments, oldArgLineByKey, next, indent);
};
