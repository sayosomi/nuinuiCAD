// Thin typed-scalar adapter over the DSL reference path reader. The source
// reference grammar owns `@`, path quoting, && `::`; this module retains the
// historical head result shape used by the scalar tokenizer.
import { readDslReferencePath } from "../dsl/dslReferenceTokens";

export type ExpressionReferenceHead =
  | { readonly kind: "simple" | "scoped"; readonly name: string; readonly end: number }
  | { readonly kind: "invalidScoped"; readonly end: number; readonly invalidAt: number };

/** Reads a complete qualified reference path within `[start, end)`. */
export const readExpressionReferenceHead = (
  source: string,
  start: number,
  end = source.length
): ExpressionReferenceHead | null => {
  const path = readDslReferencePath(source, start, end);
  if (path.kind === "invalid") {
    return { kind: "invalidScoped", end: path.end, invalidAt: path.invalidAt };
  }
  return {
    kind: path.path.segments.length > 1 || path.path.absolute ? "scoped" : "simple",
    name: path.name,
    end: path.end
  };
};
