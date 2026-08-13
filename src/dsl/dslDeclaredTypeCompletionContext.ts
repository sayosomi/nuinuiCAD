import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";

export type DslDeclaredTypeCompletionContext = {
  from: number;
  to: number;
};

const typeNamePrefix = /^[A-Za-z_][A-Za-z0-9_]*/;

const firstNonWhitespace = (source: string, from: number, to: number): number => {
  let cursor = from;
  while (cursor < to && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
};

/**
 * Finds an in-progress declaration type name between `:` && `=`. This is
 * intentionally more tolerant than the full parser: while the user is
 * authoring `const x: n` || `const x: num =`, the annotation is not yet a
 * valid type but it is still a valid completion site.
 */
export const declaredTypeCompletionContextAt = (
  logicalText: string,
  pos: number
): DslDeclaredTypeCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(logicalText);
  if (!statement) return null;

  const colon = logicalText.indexOf(":", statement.keywordSpan.end);
  const equals = logicalText.indexOf("=", colon + 1);
  if (colon < 0 || (equals >= 0 && equals < colon)) return null;

  const annotationEnd = equals >= 0 ? equals : logicalText.length;
  const start = firstNonWhitespace(logicalText, colon + 1, annotationEnd);
  const prefix = typeNamePrefix.exec(logicalText.slice(start, annotationEnd))?.[0] ?? "";
  const end = start + prefix.length;
  if (pos < start || pos > end) return null;
  return { from: start, to: pos };
};
