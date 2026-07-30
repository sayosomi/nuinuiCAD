import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import { dslVariableTokenEndingAt } from "../dsl/dslVariableToken";

export type NumericVariableSuggestionMatch = {
  tokenStart: number;
  tokenEnd: number;
  query: string;
};

export const numericVariableSuggestionMatch = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null
): NumericVariableSuggestionMatch | null => {
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return null;
  const match = dslVariableTokenEndingAt(value, selectionStart);
  return match ? { tokenStart: match.from, tokenEnd: match.to, query: match.query } : null;
};

export const filteredNumericVariableSuggestions = (
  options: NumericVariableReferenceOption[],
  query: string,
  limit: number | null = 8
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered =
    normalizedQuery.length === 0
      ? options
      : options.filter((option) =>
          `${option.label} ${option.displayExpression} ${option.expression} ${option.detail}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        );
  return limit === null ? filtered : filtered.slice(0, limit);
};

export const replaceNumericVariableSuggestionToken = (
  value: string,
  match: NumericVariableSuggestionMatch,
  expression: string
) => `${value.slice(0, match.tokenStart)}${expression}${value.slice(match.tokenEnd)}`;
