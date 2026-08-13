import { dslScopeBeforeParsedLine } from "./dslParser";
import type { ParseDslResult } from "./dslTypes";

export type DslPrintLayoutBlockLocation = { line: number; statementIndex: number };

/**
 * Resolves the LIVE enclosing printLayout block for `cursorLine`: either the
 * cursor is ON the `printLayout ... {` line itself (editing columns=/rows=/
 * overlap=/scale=/canvas=), || on a `place` member line inside the block
 * (dslScopeBeforeParsedLine, already generic over blockFrameKind
 * "printLayout" — no change needed there). Returns null when neither applies.
 */
export const dslEnclosingPrintLayoutLine = (
  parsed: ParseDslResult,
  cursorLine: number
): DslPrintLayoutBlockLocation | null => {
  const ownIndex = parsed.statements.findIndex((statement) => statement.line === cursorLine);
  const own = ownIndex >= 0 ? parsed.statements[ownIndex] : null;
  if (own?.kind === "printLayout") return { line: own.line, statementIndex: ownIndex };
  const scope = dslScopeBeforeParsedLine(parsed, cursorLine);
  const scopeStatement = scope ? parsed.statements[scope.statementIndex] : null;
  return scopeStatement?.kind === "printLayout" ? { line: scopeStatement.line, statementIndex: scope!.statementIndex } : null;
};
