export type DslElementParameterTokenMatch = { from: number; to: number; elementToken: string; query: string };

const elementParameterTokenPattern =
  /(?:^|[\s()+*/<>=!&|,-])([^\s()+*/.<>!=&|]+)\.([^\s()+*/<>!=&|]*)$/;

const isNumericLiteralToken = (token: string) => /^\d+$/.test(token);

/**
 * Finds the `ElementName.query` token ending exactly at `pos` within `text`,
 * restricted to [boundaryStart, pos). Mirrors numericExpressionParser.ts's
 * `referenceMatch` character classes exactly (elementToken excludes `.`,
 * query allows further `.` so a nested path like `startPoint.` still
 * matches), so this boundary agrees with what the evaluator will later
 * accept. Excludes a purely-numeric elementToken (e.g. `10.5`) since the
 * tokenizer's numberMatch consumes that as a decimal literal before the
 * reference grammar ever runs - never a reference in this codebase.
 *
 * `from`/`to` deliberately span only the query (member-token) run, right
 * after the dot - never the `ElementName.` prefix - so callers replace only
 * the member token on pick and leave `ElementName.` and the surrounding
 * expression untouched.
 */
export const dslElementParameterTokenEndingAt = (
  text: string,
  pos: number,
  boundaryStart = 0
): DslElementParameterTokenMatch | null => {
  if (pos < boundaryStart || pos > text.length) return null;
  const scoped = text.slice(boundaryStart, pos);
  const match = scoped.match(elementParameterTokenPattern);
  if (!match) return null;
  const elementToken = match[1];
  if (isNumericLiteralToken(elementToken)) return null;
  const query = match[2] ?? "";
  const to = pos;
  const from = to - query.length;
  return { from, to, elementToken, query };
};
