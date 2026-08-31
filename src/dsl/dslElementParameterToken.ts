import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";

export type DslElementParameterTokenMatch = { from: number; to: number; elementToken: string; query: string };

/**
 * Finds the `ElementName.query` (or nui 1 `@ElementName.query`) token ending
 * exactly at `pos` within `text`, restricted to [boundaryStart, pos).
 * `elementToken` never includes a leading `@` - the sigil is stripped by the
 * shared classifier, fixing the pre-Task-51 bug where `@AB.` reached this
 * function with `elementToken === "@AB"` && silently produced zero
 * candidates (see expressionReferenceToken.ts && the Task 51 migration
 * plan).
 *
 * `from`/`to` deliberately span only the query (member-token) run, right
 * after the dot - never the `ElementName.` prefix (or its `@`) - so callers
 * replace only the member token on pick && leave the element reference &&
 * the surrounding expression untouched.
 *
 * Thin adapter over the shared expressionReferenceToken.ts classifier (Task
 * 51) - kept only for its existing call sites' signature; new call sites
 * should use expressionReferenceTokenEndingAt directly.
 */
export const dslElementParameterTokenEndingAt = (
  text: string,
  pos: number,
  boundaryStart = 0
): DslElementParameterTokenMatch | null => {
  const match = expressionReferenceTokenEndingAt(text, pos, { boundaryStart });
  return match?.kind === "elementProperty"
    ? { from: match.from, to: match.to, elementToken: match.elementToken, query: match.query }
    : null;
};
