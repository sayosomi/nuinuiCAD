import { tokenize, type Token } from "./numericExpressionParser";

export type NumericExpressionLiteralSpan = {
  start: number;
  end: number;
};

const numericLiteral = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

const canPrecedeUnaryOperator = (token: Token | undefined) =>
  token === undefined ||
  token.type === "leftParen" ||
  token.type === "comma" ||
  token.type === "comparisonOperator" ||
  token.type === "logicalOperator" ||
  (token.type === "operator");

const signedLiteralStart = (tokens: readonly Token[], numberIndex: number) => {
  const sign = tokens[numberIndex - 1];
  if (!sign || sign.type !== "operator" || (sign.value !== "+" && sign.value !== "-")) return null;
  if (sign.end !== tokens[numberIndex].start || !canPrecedeUnaryOperator(tokens[numberIndex - 2])) return null;
  return sign.start;
};

const canPrecedeNumber = (token: Token | undefined) =>
  token === undefined ||
  token.type === "leftParen" ||
  token.type === "comma" ||
  token.type === "comparisonOperator" ||
  token.type === "logicalOperator" ||
  token.type === "operator";

const canFollowNumber = (token: Token | undefined) =>
  token === undefined ||
  token.type === "rightParen" ||
  token.type === "comma" ||
  token.type === "comparisonOperator" ||
  token.type === "logicalOperator" ||
  token.type === "operator";

const isNotNumericExpressionTerm = (tokens: readonly Token[], numberIndex: number) => {
  const token = tokens[numberIndex];
  const previous = tokens[numberIndex - 1];
  const next = tokens[numberIndex + 1];
  const start = signedLiteralStart(tokens, numberIndex) ?? token.start;
  const beforeLiteral = start === token.start ? previous : tokens[numberIndex - 2];
  return !canPrecedeNumber(beforeLiteral) || !canFollowNumber(next);
};

/** Finds one lexer-proven numeric literal without interpreting DSL parameter structure. */
export const findNumericExpressionLiteralSpanAt = (
  expression: string,
  selection: NumericExpressionLiteralSpan
): NumericExpressionLiteralSpan | null => {
  let tokens: Token[];
  try {
    tokens = tokenize(expression);
  } catch {
    return null;
  }
  const candidates = tokens.flatMap((token, index) => {
    if (token.type !== "number" || isNotNumericExpressionTerm(tokens, index)) return [];
    const start = signedLiteralStart(tokens, index) ?? token.start;
    const end = token.end;
    return numericLiteral.test(expression.slice(start, end)) ? [{ start, end }] : [];
  });
  const collapsed = selection.start === selection.end;
  const tokenAtCaret = collapsed
    ? tokens.some((token) => token.start <= selection.start && selection.start < token.end)
    : false;
  const matches = candidates.filter((candidate) =>
    collapsed
      ? (candidate.start <= selection.start && selection.start < candidate.end) ||
        (!tokenAtCaret && candidate.end === selection.start)
      : candidate.start === selection.start && candidate.end === selection.end
  );
  return matches.length === 1 ? matches[0] : null;
};
