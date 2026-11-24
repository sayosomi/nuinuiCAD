// Task 51 / Issue 1697: the single cursor-anchored authority for recognizing
// an ordinary bare reference or an element-property `Element.property` inside
// numeric expression surface text. Both the
// Source Editor (dslCompletionContext.ts) && CommandLineBar
// (numericVariableSuggestion.ts / elementParameterSuggestion.ts) build on
// this so the two features can never again drift into contradictory
// classifications of the same cursor position - see the Task 51 migration
// plan for the history of that drift.
//
// A leading `@` belongs to choice literals and is never a reference marker.

import { parseDslSourceReferenceAt } from "./dslReferenceTokens";

export type ExpressionReferenceTokenMatch =
  /** An unprefixed scalar or qualified source reference. */
  | {
      readonly kind: "binding";
      readonly tokenStart: number;
      readonly tokenEnd: number;
      readonly from: number;
      readonly to: number;
      readonly sigil: boolean;
      readonly query: string;
      /** Qualified paths are frontend references, not Task 2 typed bindings. */
      readonly qualifiedPath?: boolean;
    }
  /**
   * `Element.prop`. `from`/`to` cover ONLY the member run after the dot (matches
   * the existing dslElementParameterToken.ts / asElementParameterCompletions
   * replacement convention, which never touches `Element.` on apply).
   */
  | {
      readonly kind: "elementProperty";
      readonly tokenStart: number;
      readonly tokenEnd: number;
      readonly from: number;
      readonly to: number;
      readonly sigil: boolean;
      readonly elementToken: string;
      readonly elementFrom: number;
      readonly elementTo: number;
      readonly query: string;
      /** Optional indexed geometry collection occurrence. */
      readonly occurrenceIndex?: string;
      /** True when the property follows the nui1 optional member operator. */
      readonly optional?: true;
    };

const isNumericLiteralToken = (token: string) => /^\d+$/.test(token);
const isReferenceBoundary = (character: string | undefined) =>
  character === undefined || /[\s()+*/<>=!&|,-]/.test(character);

/** Finds the current unsigiled reference token ending at `pos` within `text`. */
export const expressionReferenceTokenEndingAt = (
  text: string,
  pos: number,
  options?: { boundaryStart?: number }
): ExpressionReferenceTokenMatch | null => {
  const boundaryStart = options?.boundaryStart ?? 0;
  if (pos < boundaryStart || pos > text.length) return null;

  const starts: number[] = [];
  let quote: string | null = null;
  for (let start = boundaryStart; start < pos; start += 1) {
    if (start === boundaryStart || (quote === null && isReferenceBoundary(text[start - 1]))) starts.push(start);
    const character = text[start]!;
    if (quote !== null) {
      if (character === quote) {
        let backslashes = 0;
        for (let cursor = start - 1; cursor >= boundaryStart && text[cursor] === "\\"; cursor -= 1) backslashes += 1;
        if (backslashes % 2 === 0) quote = null;
      }
    } else if (character === "\"" || character === "'") {
      quote = character;
    }
  }
  for (const tokenStart of starts.reverse()) {
    const parsed = parseDslSourceReferenceAt(text, tokenStart, pos, {
      allowIncompleteProperty: true,
      allowOptionalProperty: true
    });
    if (parsed.kind !== "valid" || parsed.end !== pos) continue;
    const reference = parsed.reference;
    if (isNumericLiteralToken(reference.pathText)) return null;
    if (reference.propertyRange) {
      return {
        kind: "elementProperty",
        tokenStart,
        tokenEnd: pos,
        from: reference.propertyRange.start,
        to: reference.propertyRange.end,
        sigil: false,
        elementToken: reference.pathText,
        elementFrom: reference.pathRange.start,
        elementTo: reference.pathRange.end,
        query: reference.property ?? "",
        ...(text.slice(reference.propertyRange.start - 2, reference.propertyRange.start) === "?." ? { optional: true as const } : {}),
        ...(reference.occurrenceIndex !== null ? { occurrenceIndex: reference.occurrenceIndex } : {})
      };
    }
    return {
      kind: "binding",
      tokenStart,
      tokenEnd: pos,
      from: tokenStart,
      to: pos,
      sigil: false,
      query: reference.pathText,
      ...(reference.path.segments.length > 1 || reference.path.absolute ? { qualifiedPath: true } : {})
    };
  }
  return null;
};
