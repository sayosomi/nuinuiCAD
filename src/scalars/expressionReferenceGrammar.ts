// Shared reference-head grammar for typed scalar tokenization and the DSL
// completion/reference scanners. A scoped element name is one or more normal
// identifier segments joined by `::`; semantic resolution remains owned by
// model/elementNames.ts.

const IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*/u;

export type ExpressionReferenceHead =
  | { readonly kind: "simple" | "scoped"; readonly name: string; readonly end: number }
  | { readonly kind: "invalidScoped"; readonly end: number; readonly invalidAt: number };

const identifierAt = (source: string, start: number, end: number) => {
  const match = IDENTIFIER_PATTERN.exec(source.slice(start, end));
  return match ? { text: match[0], end: start + match[0].length } : null;
};

/** Reads a complete `identifier(::identifier)*` head within `[start, end)`. */
export const readExpressionReferenceHead = (
  source: string,
  start: number,
  end = source.length
): ExpressionReferenceHead | null => {
  const first = identifierAt(source, start, end);
  if (!first) return null;

  let cursor = first.end;
  let scoped = false;
  while (source.slice(cursor, cursor + 2) === "::") {
    scoped = true;
    const separatorStart = cursor;
    const next = identifierAt(source, cursor + 2, end);
    if (!next) return { kind: "invalidScoped", end: cursor, invalidAt: separatorStart };
    cursor = next.end;
  }

  return {
    kind: scoped ? "scoped" : "simple",
    name: source.slice(start, cursor),
    end: cursor
  };
};
