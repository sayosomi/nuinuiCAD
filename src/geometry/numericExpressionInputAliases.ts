/**
 * Japanese spellings that remain accepted at the authored numeric-property
 * input boundary. Presentation labels are intentionally not consulted here:
 * changed angle concepts are English-only in nui1 source.
 */
export const NUMERIC_GEOMETRY_PROPERTY_INPUT_ALIASES = {
  "長さ": "length",
  "始点ハンドル長": "startHandleLength",
  "終点ハンドル長": "endHandleLength"
} as const;

export type NumericGeometryPropertyInputAlias = keyof typeof NUMERIC_GEOMETRY_PROPERTY_INPUT_ALIASES;

export const numericGeometryPropertyInputAlias = (property: string) =>
  NUMERIC_GEOMETRY_PROPERTY_INPUT_ALIASES[property as NumericGeometryPropertyInputAlias] ?? property;
