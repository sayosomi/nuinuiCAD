import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";

export type DslVariableTokenMatch = { from: number; to: number; query: string };

/**
 * Finds the `@query` token ending exactly at `pos` within `text`, restricted to
 * [boundaryStart, pos). Shared by the CM completion context and the plain
 * <input> suggestion popover so both surfaces replace exactly the same span for
 * exactly the same `@name`/`@id` syntax numericExpressionParser accepts.
 *
 * Thin adapter over the shared expressionReferenceToken.ts classifier (Task
 * 51) - kept only for its existing call sites' signature; new call sites
 * should use expressionReferenceTokenEndingAt directly.
 */
export const dslVariableTokenEndingAt = (
  text: string,
  pos: number,
  boundaryStart = 0
): DslVariableTokenMatch | null => {
  const match = expressionReferenceTokenEndingAt(text, pos, { boundaryStart });
  return match?.kind === "binding" ? { from: match.from, to: match.to, query: match.query } : null;
};
