export type DslTypoCandidateMatch = {
  candidate: string;
  distance: number;
  sourceIndex: number;
  caseOnly: boolean;
};

const codePoints = (value: string): string[] => Array.from(value);

/**
 * Optimal-string-alignment Damerau-Levenshtein distance over Unicode code
 * points. One adjacent transposition counts as one edit.
 */
export const damerauLevenshteinDistance = (left: string, right: string): number => {
  const a = codePoints(left);
  const b = codePoints(right);
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0]![column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      let distance = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + substitutionCost
      );
      if (
        row > 1 &&
        column > 1 &&
        a[row - 1] === b[column - 2] &&
        a[row - 2] === b[column - 1]
      ) {
        distance = Math.min(distance, matrix[row - 2]![column - 2]! + 1);
      }
      matrix[row]![column] = distance;
    }
  }

  return matrix[a.length]![b.length]!;
};

export const dslTypoDistanceLimit = (typedText: string, candidate: string): number => {
  const length = Math.max(codePoints(typedText).length, codePoints(candidate).length);
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
};

const isCaseOnlyCanonicalization = (typedText: string, candidate: string) =>
  typedText !== candidate && typedText.toLowerCase() === candidate.toLowerCase();

export const matchDslTypoCandidate = (
  typedText: string,
  candidate: string,
  sourceIndex = 0
): DslTypoCandidateMatch | null => {
  if (typedText === candidate) return null;
  const caseOnly = isCaseOnlyCanonicalization(typedText, candidate);
  const distance = damerauLevenshteinDistance(typedText, candidate);
  if (!caseOnly && distance > dslTypoDistanceLimit(typedText, candidate)) return null;
  return { candidate, distance, sourceIndex, caseOnly };
};

/**
 * Return every eligible canonical candidate. Ordering is deterministic:
 * edit distance first, then the authority's original stable order.
 */
export const rankDslTypoCandidates = (
  typedText: string,
  candidates: readonly string[]
): readonly DslTypoCandidateMatch[] =>
  candidates
    .map((candidate, sourceIndex) => matchDslTypoCandidate(typedText, candidate, sourceIndex))
    .filter((match): match is DslTypoCandidateMatch => match !== null)
    .sort((left, right) => left.distance - right.distance || left.sourceIndex - right.sourceIndex);
