export type NumericExpressionInsertionInput = {
  currentExpression: string;
  snippet: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

const hasSelection = (start: number | null | undefined, end: number | null | undefined) =>
  typeof start === "number" && typeof end === "number";

export const insertNumericExpressionSnippet = ({
  currentExpression,
  snippet,
  selectionStart,
  selectionEnd
}: NumericExpressionInsertionInput) => {
  if (snippet.trim().length === 0) return currentExpression;

  if (hasSelection(selectionStart, selectionEnd)) {
    const start = Math.max(0, Math.min(selectionStart!, currentExpression.length));
    const end = Math.max(start, Math.min(selectionEnd!, currentExpression.length));
    return `${currentExpression.slice(0, start)}${snippet}${currentExpression.slice(end)}`;
  }

  if (currentExpression.trim() === "0") return snippet;
  if (currentExpression.trim().length === 0) return snippet;
  return `${currentExpression} + ${snippet}`;
};
