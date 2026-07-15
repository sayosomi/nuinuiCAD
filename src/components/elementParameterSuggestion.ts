import type { ElementParameterReferenceOption } from "../geometry/elementParameterReferenceOptions";
import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import { dslElementParameterTokenEndingAt } from "../dsl/dslElementParameterToken";

export type ElementParameterSuggestionMatch = {
  tokenStart: number;
  tokenEnd: number;
  elementToken: string;
  query: string;
};

/** Plain-<input> analogue of numericVariableSuggestionMatch, sharing the same
 * "no selection range" precondition. Mutually exclusive with an @-token match
 * by construction (see dslElementParameterToken.ts). */
export const elementParameterSuggestionMatch = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null
): ElementParameterSuggestionMatch | null => {
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return null;
  const match = dslElementParameterTokenEndingAt(value, selectionStart);
  return match
    ? { tokenStart: match.from, tokenEnd: match.to, elementToken: match.elementToken, query: match.query }
    : null;
};

/** Prefix match on the parameter path, per spec (unlike @variable's plain-input
 * substring match) - typing `直線AB.st` narrows to paths starting with `st`. */
export const filteredElementParameterSuggestions = (
  options: readonly ElementParameterReferenceOption[],
  query: string,
  limit = 8
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery.length === 0
    ? options
    : options.filter((option) => option.path.toLocaleLowerCase().startsWith(normalizedQuery));
  return filtered.slice(0, limit);
};

/**
 * Local conversion for the existing NumericVariableSuggestPopover/@variable
 * plain-input UI attach points only - the pure elementParameterReferenceOptions
 * layer itself never depends on NumericVariableReferenceOption. `source` is a
 * placeholder value: neither NumericVariableSuggestPopover nor the callers'
 * own apply logic ever branch on it.
 */
export const asNumericVariableReferenceOptions = (
  options: readonly ElementParameterReferenceOption[]
): NumericVariableReferenceOption[] =>
  options.map((option) => ({
    expression: option.path,
    displayExpression: option.label,
    label: option.label,
    detail: option.detail,
    source: "local",
    elementId: option.elementId
  }));
