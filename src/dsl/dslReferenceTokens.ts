import { formatDslName, quoteDslString, unquoteDslString } from "./dslTokens";

export type DslReferencePath = {
  absolute: boolean;
  segments: string[];
};

// `::` is structural only outside quoted segments. Keeping this split in one
// helper prevents serializers from quoting a qualified reference as one name.
export const parseDslReferenceToken = (token: string): DslReferencePath => {
  const value = token.trim();
  const absolute = value.startsWith("::");
  const start = absolute ? 2 : 0;
  const rawSegments: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote && char === ":" && value[index + 1] === ":") {
      rawSegments.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }
  rawSegments.push(current);

  return {
    absolute,
    segments: rawSegments.map((segment) => unquoteDslString(segment.trim()))
  };
};

const formatDslReferenceSegment = (segment: string) =>
  segment.includes(".") ? quoteDslString(segment) : formatDslName(segment);

export const formatDslReferencePath = ({ absolute, segments }: DslReferencePath) =>
  `${absolute ? "::" : ""}${segments.map(formatDslReferenceSegment).join("::")}`;

// Canonicalizes both parser tokens (`Outer::"Inner name"`) and raw dangling
// model IDs (`Inner name`) without losing namespace segment boundaries.
export const formatDslReferenceToken = (token: string) =>
  formatDslReferencePath(parseDslReferenceToken(token));
