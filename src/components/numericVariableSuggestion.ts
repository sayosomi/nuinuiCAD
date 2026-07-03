import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";

export type NumericVariableSuggestionMatch = {
  tokenStart: number;
  tokenEnd: number;
  query: string;
};

const variableQueryPattern = /(?:^|[\s()+*/<>=!&|,-])@([^\s()+*/.<>!=&|]*)$/;

export const numericVariableSuggestionMatch = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null
): NumericVariableSuggestionMatch | null => {
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return null;
  const prefix = value.slice(0, selectionStart);
  const match = prefix.match(variableQueryPattern);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    tokenStart: selectionStart - query.length - 1,
    tokenEnd: selectionStart,
    query
  };
};

export const filteredNumericVariableSuggestions = (
  options: NumericVariableReferenceOption[],
  query: string,
  limit = 8
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered =
    normalizedQuery.length === 0
      ? options
      : options.filter((option) =>
          `${option.label} ${option.expression} ${option.detail}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        );
  return filtered.slice(0, limit);
};

export const replaceNumericVariableSuggestionToken = (
  value: string,
  match: NumericVariableSuggestionMatch,
  expression: string
) => `${value.slice(0, match.tokenStart)}${expression}${value.slice(match.tokenEnd)}`;
