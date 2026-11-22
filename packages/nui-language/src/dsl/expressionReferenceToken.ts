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
// Whole-source scanning below remains the diagnostic/compiler boundary; this
// cursor matcher recognizes only the current grammar.

import { readExpressionReferenceHead } from "../scalars/expressionReferenceGrammar";
import { parseDslSourceReferenceAt, readDslReferencePath } from "./dslReferenceTokens";

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

// The head excludes `.` so the member-only replacement range stays precise.
// `@` is excluded because it introduces a choice literal, not a reference.
const HEAD_CHAR_CLASS = "[^@\\s()+*/.<>!=&|?]";
const QUERY_CHAR_CLASS = "[^\\s()+*/<>!=&|?]";

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
    const parsed = parseDslSourceReferenceAt(text, tokenStart, pos, { allowIncompleteProperty: true });
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

const headRunPattern = new RegExp(`^${HEAD_CHAR_CLASS}+`);
const queryRunPattern = new RegExp(`^${QUERY_CHAR_CLASS}*`);

/**
 * Whole-string scan for compilers/diagnostics (not cursor-anchored): every
 * reference token occurrence in `text`, with offsets shifted by `offset`.
 * A direct forward scanner mirroring numericExpressionParser.ts's tokenize()
 * shape (try `@`, then a head run, then an optional `.query`), rather than
 * repeatedly re-running the cursor-anchored matcher - this is the
 * authoritative left-to-right token boundary definition for this grammar.
 */
export const scanExpressionReferences = (
  text: string,
  offset = 0
): readonly ExpressionReferenceTokenMatch[] => {
  const results: ExpressionReferenceTokenMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const sigil = text[index] === "@";
    if (sigil) {
      const parsed = parseDslSourceReferenceAt(text, index, text.length);
      if (parsed.kind === "valid") {
        const reference = parsed.reference;
        if (reference.property && reference.propertyRange) {
          results.push({
            kind: "elementProperty",
            tokenStart: offset + reference.fullRange.start,
            tokenEnd: offset + reference.fullRange.end,
            from: offset + reference.propertyRange.start,
            to: offset + reference.propertyRange.end,
            sigil: true,
            elementToken: reference.pathText,
            elementFrom: offset + reference.pathRange.start,
            elementTo: offset + reference.pathRange.end,
            query: reference.property
          });
        } else {
          results.push({
            kind: "binding",
            tokenStart: offset + reference.fullRange.start,
            tokenEnd: offset + reference.fullRange.end,
            from: offset + reference.fullRange.start,
            to: offset + reference.fullRange.end,
            sigil: true,
            query: reference.pathText,
            ...(reference.path.segments.length > 1 || reference.path.absolute ? { qualifiedPath: true } : {})
          });
        }
        if (reference.occurrenceIndexRange) {
          const indexStart = reference.occurrenceIndexRange.start;
          const indexEnd = reference.occurrenceIndexRange.end;
          results.push(...scanExpressionReferences(
            text.slice(indexStart, indexEnd),
            offset + indexStart
          ));
        }
        if (text.slice(parsed.end, parsed.end + 2) === "?.") {
          const propertyStart = parsed.end + 2;
          let propertyEnd = propertyStart;
          while (
            propertyEnd < text.length &&
            !/\s/.test(text[propertyEnd]!) &&
            !"()+*/<>!=&|,[]{};:'\"?".includes(text[propertyEnd]!)
          ) propertyEnd += 1;
          results.push({
            kind: "elementProperty",
            tokenStart: offset + reference.fullRange.start,
            tokenEnd: offset + propertyEnd,
            from: offset + propertyStart,
            to: offset + propertyEnd,
            sigil: true,
            elementToken: reference.pathText,
            elementFrom: offset + reference.pathRange.start,
            elementTo: offset + reference.pathRange.end,
            query: text.slice(propertyStart, propertyEnd),
            optional: true
          });
          index = propertyEnd;
        } else {
          index = parsed.end;
        }
        continue;
      }
      const path = readDslReferencePath(text, index + 1, text.length);
      const optionalProperty = path.kind === "valid" && text.slice(path.end, path.end + 2) === "?.";
      if (path.kind === "valid" && (text[path.end] === "." || optionalProperty)) {
        const propertyStart = path.end + (optionalProperty ? 2 : 1);
        let propertyEnd = propertyStart;
        while (
          propertyEnd < text.length &&
          !/\s/.test(text[propertyEnd]) &&
          !"()+*/<>!=&|,[]{};:'\"".includes(text[propertyEnd])
        ) propertyEnd += 1;
        results.push({
          kind: "elementProperty",
          tokenStart: offset + index,
          tokenEnd: offset + propertyEnd,
          from: offset + propertyStart,
          to: offset + propertyEnd,
          sigil: true,
          elementToken: path.name,
          elementFrom: offset + index + 1,
          elementTo: offset + path.end,
          query: text.slice(propertyStart, propertyEnd),
          ...(optionalProperty ? { optional: true as const } : {})
        });
        index = propertyEnd;
        continue;
      }
      index += 1;
      continue;
    }
    const afterSigil = index;
    const headMatch = text.slice(afterSigil).match(headRunPattern);
    const head = headMatch?.[0] ?? "";
    if (head.length === 0) {
      index += 1;
      continue;
    }
    const headEnd = afterSigil + head.length;
    let referenceHead = head;
    const scopedHead = head.includes("::");
    if (scopedHead) {
      const parsedHead = readExpressionReferenceHead(text, afterSigil, headEnd);
      if (!parsedHead || parsedHead.kind === "invalidScoped" || parsedHead.end !== headEnd) {
        index = parsedHead?.kind === "invalidScoped" ? parsedHead.invalidAt + 1 : headEnd;
        continue;
      }
      referenceHead = parsedHead.name;
    }
    if (scopedHead && text[headEnd] !== ".") {
      index = headEnd;
      continue;
    }
    if (text[headEnd] === ".") {
      const queryMatch = text.slice(headEnd + 1).match(queryRunPattern);
      const query = queryMatch?.[0] ?? "";
      const queryEnd = headEnd + 1 + query.length;
      if (!isNumericLiteralToken(referenceHead)) {
        results.push({
          kind: "elementProperty",
          tokenStart: offset + index,
          tokenEnd: offset + queryEnd,
          from: offset + headEnd + 1,
          to: offset + queryEnd,
          sigil,
          elementToken: referenceHead,
          elementFrom: offset + afterSigil,
          elementTo: offset + headEnd,
          query
        });
      }
      index = queryEnd;
      continue;
    }
    if (sigil) {
      results.push({
        kind: "binding",
        tokenStart: offset + index,
        tokenEnd: offset + headEnd,
        from: offset + index,
        to: offset + headEnd,
        sigil: true,
        query: referenceHead
      });
    }
    index = headEnd;
  }
  return results;
};

export const BARE_PROPERTY_REFERENCE_CODE = "property-reference-requires-sigil";

/**
 * Every nui-3-illegal bare `Element.prop` occurrence in `text` (an
 * `elementProperty` match with `sigil: false`), spans offset by `offset`.
 * Does not attempt to resolve whether the element token actually exists -
 * that is the dependency/dangling-reference diagnostic's job; this only
 * flags the *spelling*.
 */
export const barePropertyReferenceIssues = (
  text: string,
  offset = 0
): readonly { start: number; end: number; elementToken: string; query: string; code: string; message: string }[] =>
  scanExpressionReferences(text)
    .filter((match): match is Extract<ExpressionReferenceTokenMatch, { kind: "elementProperty" }> =>
      match.kind === "elementProperty" && !match.sigil
    )
    .map((match) => ({
      start: match.elementFrom + offset,
      end: match.tokenEnd + offset,
      elementToken: match.elementToken,
      query: match.query,
      code: BARE_PROPERTY_REFERENCE_CODE,
      message: `要素プロパティ参照は「@${match.elementToken}.${match.query}」と書いてください(nui 1)。`
    }));

/**
 * Convenience guard for non-document commit paths (CommandLineBar, pick
 * commands, template insertion) that mutate the model directly without going
 * through compileDslDocument. Returns the diagnostic message when `input`
 * contains a nui-3-illegal bare property reference, || null when acceptable.
 */
export const rejectBarePropertyReference = (input: string): string | null => {
  const issues = barePropertyReferenceIssues(input);
  return issues.length > 0 ? issues[0].message : null;
};

/**
 * Strips the `@` sigil from every `@Element.property` occurrence in `text`,
 * leaving a plain `@name` binding reference (no dot) && ordinary text
 * completely untouched. For pre-normalize *name*-form source text (element
 * names, not yet resolved to ids) that some consumer needs to hand to a
 * tokenizer which only understands the pre-migration bare
 * `Element.property` spelling - e.g. dependency-graph extraction over a
 * legacy text-template hole's raw source, which has no element-name context
 * available to run the full normalizeNumericExpressionInput lowering. Not a
 * general-purpose normalizer: it only removes the sigil, it does not resolve
 * names to ids || apply Rule R's `@Self.localVar` precedence.
 */
export const stripElementPropertySigils = (text: string): string => {
  const sigilOffsets = scanExpressionReferences(text)
    .filter((match): match is Extract<ExpressionReferenceTokenMatch, { kind: "elementProperty" }> =>
      match.kind === "elementProperty" && match.sigil
    )
    .map((match) => match.elementFrom - 1);
  if (sigilOffsets.length === 0) return text;
  const offsets = new Set(sigilOffsets);
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    if (!offsets.has(index)) result += text[index];
  }
  return result;
};
