export type DslVariableTokenMatch = { from: number; to: number; query: string };

const variableTokenPattern = /(?:^|[\s()+*/<>=!&|,-])@([^\s()+*/.<>!=&|]*)$/;

/**
 * Finds the `@query` token ending exactly at `pos` within `text`, restricted to
 * [boundaryStart, pos). Shared by the CM completion context and the plain
 * <input> suggestion popover so both surfaces replace exactly the same span for
 * exactly the same `@name`/`@id` syntax numericExpressionParser accepts.
 */
export const dslVariableTokenEndingAt = (
  text: string,
  pos: number,
  boundaryStart = 0
): DslVariableTokenMatch | null => {
  if (pos < boundaryStart || pos > text.length) return null;
  const scoped = text.slice(boundaryStart, pos);
  const match = scoped.match(variableTokenPattern);
  if (!match) return null;
  const query = match[1] ?? "";
  return { from: pos - query.length - 1, to: pos, query };
};
