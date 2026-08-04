import { dslScopeBeforeParsedLine } from "./dslParser";
import type { DslStatement, ParseDslResult } from "./dslTypes";
import { numericExpressionSyntaxIsValid } from "../geometry/numericExpressionParser";
import type { NumericReferenceOption } from "../geometry/numericReferenceOptions";
import type { PrintLayout } from "../types/geometry";

type DslLayoutVarStatement = Extract<DslStatement, { kind: "layoutVar" }>;

export type DslPrintLayoutBlockLocation = { line: number; statementIndex: number };

/**
 * Resolves the LIVE enclosing printLayout block for `cursorLine`: either the
 * cursor is ON the `printLayout ... {` line itself (editing columns=/rows=/
 * overlap=/scale=/canvas=), or on a `place`/`layoutVar` member line inside the
 * block (dslScopeBeforeParsedLine, already generic over blockFrameKind
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

/**
 * Live-buffer candidates for a printLayout block's own `layoutVar` pool
 * (block-scoped: distinct from document bindings and element-local
 * `vars=`). `cutoffLine` encodes the two visibility patterns verified against
 * dslCompiler.ts's buildBlockPrintLayouts: a `layoutVar`'s own expression or a
 * `place`'s at=/angle= only see strictly-earlier `layoutVar`s in the same
 * block (cutoffLine = that statement's own line); the `printLayout` block's
 * own columns=/rows=/overlap=/scale=/canvas= are evaluated after the full
 * members loop completes and so see every `layoutVar` in the block
 * (cutoffLine = Infinity).
 *
 * `PrintLayout.numericVariables[].id` is reassigned positionally
 * (`print-variable-N`) on every compile — a live, uncommitted record has no
 * id until correlated by name against the committed pool, the same
 * limitation dslLocalVariableCompletionCandidates.ts already accepts for
 * element-local `vars=`.
 *
 * Insertion text is always the human-readable `@name` (never `@id`) — BUT
 * only when that name is unambiguous. `normalizeNumericExpressionInput`'s
 * duplicate-name guard (`if (currentElement && ...) continue`) is itself
 * gated on `currentElement`, which printLayout's own `numeric()` closure
 * never supplies (verified in dslCompiler.ts/buildBlockPrintLayouts) — so a
 * duplicate `layoutVar` name is NEVER rejected by the compiler and silently
 * resolves to whichever declaration happens to be processed first. There is
 * therefore no safe way to guess which committed id a duplicate-named live
 * record corresponds to: candidates for any name that is not unique across
 * the WHOLE committed pool (not just the entries visible before cutoffLine —
 * the compiler's own resolution isn't cutoff-aware either) are suppressed
 * entirely rather than falling back to an arbitrarily-chosen `@id`.
 */
export const dslPrintLayoutVariableCompletionOptions = ({
  parsed,
  block,
  cutoffLine,
  printLayoutIdsByLiveLine,
  printLayouts
}: {
  parsed: ParseDslResult;
  block: DslPrintLayoutBlockLocation;
  cutoffLine: number;
  printLayoutIdsByLiveLine: ReadonlyMap<number, string>;
  printLayouts: readonly PrintLayout[];
}): NumericReferenceOption[] => {
  const printLayoutId = printLayoutIdsByLiveLine.get(block.line);
  if (!printLayoutId) return []; // never-compiled block: no stable ids yet (documented limitation)
  const committedVariables = printLayouts.find((layout) => layout.id === printLayoutId)?.numericVariables ?? [];

  const committedNameCounts = new Map<string, number>();
  for (const variable of committedVariables) {
    committedNameCounts.set(variable.name, (committedNameCounts.get(variable.name) ?? 0) + 1);
  }

  const members = parsed.statements.filter(
    (statement): statement is DslLayoutVarStatement =>
      statement.kind === "layoutVar" &&
      statement.enclosing?.statementIndex === block.statementIndex &&
      statement.line < cutoffLine &&
      statement.name.trim().length > 0 &&
      numericExpressionSyntaxIsValid(statement.expression)
  );

  const options = new Map<string, NumericReferenceOption>();
  for (const member of members) {
    if ((committedNameCounts.get(member.name) ?? 0) !== 1) continue; // ambiguous — suppress, never guess an id
    const variable = committedVariables.find((item) => item.name === member.name)!;
    options.set(member.name, {
      expression: `@${member.name}`,
      displayExpression: `@${member.name}`,
      label: `@${member.name}`,
      detail: "レイアウト変数",
      source: "local",
      variableId: variable.id
    });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, "ja"));
};
