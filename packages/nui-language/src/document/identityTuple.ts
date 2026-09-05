/**
 * Encodes an identity tuple without ambiguous string boundaries.
 *
 * Stable runtime namespaces use this rather than ad-hoc concatenation so a
 * path such as ["ab", "c"] cannot collide with ["a", "bc"].
 */
export const encodeIdentityTuple = (parts: readonly string[]): string =>
  parts.map((part) => `${part.length}:${part}`).join("");
