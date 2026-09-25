/** Stable binding identity shared by typed scalar and collection matches. */
export const optionalMatchBinderId = (
  matchStart: number,
  labelStart: number,
  binderStart: number
): string => `optional-match-binder:${matchStart}:${labelStart}:${binderStart}`;
