/** Canonical finite numeric literal for the local numeric-expression grammar.
 * Starts from the runtime's shortest round-trip representation, then expands
 * exponent text without parsing || rounding its mantissa. */
export const numericLiteralForExpression = (value: number): string | null => {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return "-0";
  const source = String(value);
  const match = source.match(/^(-?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!match) return source;
  const [, sign, whole, fraction = "", exponentText] = match;
  const digits = `${whole}${fraction}`;
  const decimal = whole.length + Number(exponentText);
  if (decimal <= 0) return `${sign}0.${"0".repeat(-decimal)}${digits}`;
  if (decimal >= digits.length) return `${sign}${digits}${"0".repeat(decimal - digits.length)}`;
  return `${sign}${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
};
