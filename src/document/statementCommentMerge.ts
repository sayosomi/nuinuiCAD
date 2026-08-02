import { DSL_INDENT, splitDslComment } from "../dsl/dslTokens";
import type { SerializedStatement } from "../dsl/dslSerializeElement";

type LineComment = { code: string; comment: string };

const isFullLineComment = (line: LineComment): boolean =>
  line.code.trim() === "" && line.comment !== "";

const commentOnlyLine = (targetIndent: string, comment: string): string =>
  `${targetIndent}${comment.trim()}`;

const serializedArgumentText = (next: SerializedStatement, index: number): string => {
  const arg = next.args[index];
  return `${arg.text}${next.argumentSeparator === "comma" && index < next.args.length - 1 ? "," : ""}`;
};

const mergeToSingleLine = (
  oldLines: readonly string[],
  comments: readonly LineComment[],
  next: SerializedStatement,
  indent: string,
): string[] => {
  const leadingLines: string[] = [];
  const eolParts: string[] = [];
  for (let index = 0; index < oldLines.length; index += 1) {
    const line = comments[index];
    if (isFullLineComment(line)) {
      leadingLines.push(commentOnlyLine(indent, line.comment));
    } else if (line.comment) {
      eolParts.push(line.comment);
    }
  }
  return [...leadingLines, `${indent}${next.header}${eolParts.join("")}`];
};

const mergeFromSingleLineOld = (
  comments: readonly LineComment[],
  next: SerializedStatement,
  indent: string,
): string[] => {
  const eol = comments[0]?.comment ?? "";
  const argIndent = `${indent}${DSL_INDENT}`;
  return [
    `${indent}${next.header}${eol}`,
    ...next.args.map((_, index) => `${argIndent}${serializedArgumentText(next, index)}`),
    `${indent}${next.close}`,
  ];
};

type OwnedRow = { leadingComments: string[]; eol: string };

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
    const created: OwnedRow = { leadingComments: [], eol: "" };
    rows.set(owner, created);
    return created;
  };

  let pending: string[] = [];
  for (let index = 0; index < oldLines.length; index += 1) {
    const line = comments[index];
    if (isFullLineComment(line)) {
      // Stored indent-free; callers re-indent to their own target level.
      pending.push(line.comment.trim());
      continue;
    }
    const owner = ownerByIndex.get(index);
    if (owner === undefined) continue;
    const row = rowFor(owner);
    row.leadingComments = pending;
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

  const lines: string[] = [`${indent}${next.header}${header.eol}`];
  for (const [index, arg] of next.args.entries()) {
    const row = oldArgLineByKey.has(arg.key) ? byKey.get(arg.key) : undefined;
    for (const comment of row?.leadingComments ?? []) lines.push(`${argIndent}${comment.trim()}`);
    lines.push(`${argIndent}${serializedArgumentText(next, index)}${row?.eol ?? ""}`);
  }
  lines.push(...deletedKeyOrphanLines(oldArgLineByKey, nextKeys, byKey, argIndent));
  for (const comment of close.leadingComments) lines.push(`${argIndent}${comment.trim()}`);
  lines.push(`${indent}${next.close}${close.eol}`);
  return lines;
};

export const mergeStatementComments = (input: {
  oldLines: readonly string[];
  oldArgLineByKey: ReadonlyMap<string, number>;
  next: SerializedStatement;
  indent: string;
}): string[] => {
  const { oldLines, oldArgLineByKey, next, indent } = input;
  const comments = oldLines.map(splitDslComment);

  if (next.close === null) return mergeToSingleLine(oldLines, comments, next, indent);
  if (oldLines.length <= 1) return mergeFromSingleLineOld(comments, next, indent);
  return mergeCallToCall(oldLines, comments, oldArgLineByKey, next, indent);
};
