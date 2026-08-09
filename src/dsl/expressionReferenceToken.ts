// Task 51: the single shared authority for scanning a reference token (either
// a typed-binding `@name`, or an element-property
// `Element.property`) inside numeric expression *surface* text. Both the
// Source Editor (dslCompletionContext.ts) and CommandLineBar
// (numericVariableSuggestion.ts / elementParameterSuggestion.ts) build on
// this so the two features can never again drift into contradictory
// classifications of the same cursor position - see the Task 51 migration
// plan for the history of that drift.
//
// Disambiguation is purely the presence of `.`: `@AB` is a binding
// reference, `@AB.` is an element-property reference. `AB.length` (no
// leading `@`) is an invalid nui 3 element-property reference and is kept
// recognizable only to report the precise repair diagnostic.

import { readExpressionReferenceHead } from "../scalars/expressionReferenceGrammar";

export type ExpressionReferenceTokenMatch =
  /**
   * `@name` - typed binding reference. `from` INCLUDES
   * the leading `@` and `to` is the end of the identifier; apply text is
   * `"@" + query` (matches the existing dslVariableToken.ts / asScalarCompletions
   * replacement convention).
   */
  | {
      readonly kind: "binding";
      readonly tokenStart: number;
      readonly tokenEnd: number;
      readonly from: number;
      readonly to: number;
      readonly sigil: true;
      readonly query: string;
    }
  /**
   * `@Element.prop` or an invalid bare `Element.prop`. `from`/`to` cover ONLY the member run after the dot (matches
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
    };

// Boundary characters identical to the two patterns this module replaces, so
// no existing boundary behavior changes.
const BOUNDARY_PREFIX = "(?:^|[\\s()+*/<>=!&|,-])";

// Character classes mirror numericExpressionParser.ts's tokenizer exactly:
// the element/binding head excludes `.`, the member/query run allows further
// `.` (so a nested path like `startPoint.` still matches as one query).
const HEAD_CHAR_CLASS = "[^\\s()+*/.<>!=&|]";
const QUERY_CHAR_CLASS = "[^\\s()+*/<>!=&|]";

const referenceTokenPattern = new RegExp(
  // The head group is `*` (not `+`) so a bare `@` with nothing typed after it
  // yet still matches as a binding token with an empty query - mirroring
  // dslVariableToken.ts's own `*`-quantified query group. A genuinely empty,
  // non-`@` run never reaches the caller as a match (see the `!sigil` guard
  // below), so this does not admit a false match for plain non-reference text.
  `${BOUNDARY_PREFIX}(@)?(${HEAD_CHAR_CLASS}*)(?:(\\.)(${QUERY_CHAR_CLASS}*))?$`
);

const isNumericLiteralToken = (token: string) => /^\d+$/.test(token);

/**
 * Finds the reference token ending exactly at `pos` within `text`, restricted
 * to [boundaryStart, pos). Returns null when there is no token at all (a bare
 * identifier with neither `@` nor `.` is not a reference token - matches the
 * pre-migration behavior of both dslVariableToken.ts and
 * dslElementParameterToken.ts).
 */
export const expressionReferenceTokenEndingAt = (
  text: string,
  pos: number,
  options?: { boundaryStart?: number }
): ExpressionReferenceTokenMatch | null => {
  const boundaryStart = options?.boundaryStart ?? 0;
  if (pos < boundaryStart || pos > text.length) return null;
  const scoped = text.slice(boundaryStart, pos);
  const match = scoped.match(referenceTokenPattern);
  if (!match) return null;

  const sigil = match[1] === "@";
  const head = match[2];
  const hasDot = match[3] === ".";
  const query = match[4] ?? "";

  if (head.includes("::")) {
    const headEnd = hasDot ? pos - query.length - 1 : pos;
    const headStart = headEnd - head.length;
    const parsedHead = readExpressionReferenceHead(text, headStart, headEnd);
    if (!parsedHead || parsedHead.kind === "invalidScoped" || parsedHead.end !== headEnd) return null;
    if (!hasDot) return null;
  }

  if (!hasDot) {
    // No dot: only a `@name` binding token is a reference. A bare
    // identifier with no sigil and no dot is not a reference token at all.
    if (!sigil) return null;
    const tokenStart = pos - head.length - 1;
    return {
      kind: "binding",
      tokenStart,
      tokenEnd: pos,
      from: tokenStart,
      to: pos,
      sigil: true,
      query: head
    };
  }

  if (head.length === 0 || isNumericLiteralToken(head)) return null;

  const dotIndex = pos - query.length - 1;
  const elementFrom = dotIndex - head.length;
  const tokenStart = sigil ? elementFrom - 1 : elementFrom;
  return {
    kind: "elementProperty",
    tokenStart,
    tokenEnd: pos,
    from: dotIndex + 1,
    to: pos,
    sigil,
    elementToken: head,
    elementFrom,
    elementTo: dotIndex,
    query
  };
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
    const afterSigil = sigil ? index + 1 : index;
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
      message: `要素プロパティ参照は「@${match.elementToken}.${match.query}」と書いてください(nui 3)。`
    }));

/**
 * Convenience guard for non-document commit paths (CommandLineBar, pick
 * commands, template insertion) that mutate the model directly without going
 * through compileDslDocument. Returns the diagnostic message when `input`
 * contains a nui-3-illegal bare property reference, or null when acceptable.
 */
export const rejectBarePropertyReference = (input: string): string | null => {
  const issues = barePropertyReferenceIssues(input);
  return issues.length > 0 ? issues[0].message : null;
};

/**
 * Strips the `@` sigil from every `@Element.property` occurrence in `text`,
 * leaving a plain `@name` binding reference (no dot) and ordinary text
 * completely untouched. For pre-normalize *name*-form source text (element
 * names, not yet resolved to ids) that some consumer needs to hand to a
 * tokenizer which only understands the pre-migration bare
 * `Element.property` spelling - e.g. dependency-graph extraction over a
 * legacy text-template hole's raw source, which has no element-name context
 * available to run the full normalizeNumericExpressionInput lowering. Not a
 * general-purpose normalizer: it only removes the sigil, it does not resolve
 * names to ids or apply Rule R's `@Self.localVar` precedence.
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
