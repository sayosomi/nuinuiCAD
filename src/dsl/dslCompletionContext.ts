import { dslStatementKeywordCompletions } from "./dslParser";
import {
  dslLineElementStatement,
  dslLineLabeledValueSpans,
  dslLinePrintLayoutStatement,
  dslLinePrintLayoutValueSpans,
  type DslLabeledValueSpan
} from "./dslValueSpans";
import { splitDslComment, splitDslTerms } from "./dslTokens";
import { dslCompletionMetadataForType, dslStatementElementType, type DslCompletionParameter } from "./dslCompletionMetadata";
import { dslVariableTokenEndingAt } from "./dslVariableToken";
import { dslElementParameterTokenEndingAt } from "./dslElementParameterToken";
import { coordinateComponent, recordField, recordRemainder, recordSpans, splitDslTopLevelSpans } from "./dslParameterSpanScanner";
import {
  placeCoordinateAttrKeys,
  placeNumericAttrKeys,
  printLayoutCoordinateAttrKeys,
  printLayoutNumericAttrKeys
} from "./dslPrintLayoutAttributes";

export type DslCompletionContext =
  | { kind: "keyword"; from: number; to: number; options: readonly string[] }
  | { kind: "attribute"; from: number; to: number; elementType: NonNullable<ReturnType<typeof dslStatementElementType>> }
  | { kind: "parameter"; from: number; to: number; parameter: DslCompletionParameter }
  | { kind: "elementParameter"; from: number; to: number; elementToken: string }
  | null;

/**
 * Shared fallback for every `@`-token boundary check below: only attempted
 * when the `@variable` check already returned null, so `@variable` detection
 * and its span are completely unchanged. The two token shapes are mutually
 * exclusive by construction (the `@` grammar's query excludes `.`, so
 * `@name.` never matches `dslVariableTokenEndingAt`; this grammar requires no
 * leading `@`), so at most one of the two ever fires for a given cursor
 * position.
 */
const elementParameterCompletionContext = (
  code: string,
  pos: number,
  boundaryStart: number
): DslCompletionContext => {
  const token = dslElementParameterTokenEndingAt(code, pos, boundaryStart);
  return token ? { kind: "elementParameter", from: token.from, to: token.to, elementToken: token.elementToken } : null;
};

/** Local-variable-list marker: cmAutocomplete.ts routes to the vars=[...] record
 * candidate source (not the top-level @variable source) whenever the returned
 * parameter has this key, regardless of element type. */
export const dslVarsAttributeParameterKey = "vars";

/** intermediates=[...]-list marker: cmAutocomplete.ts routes to the plain
 * top-level @variable source (never the current element's local vars=, which
 * dslCompiler.ts's intermediates= evaluation never sees — see
 * dslIntermediatesFieldCompletionContext below). */
export const dslIntermediatesAttributeParameterKey = "intermediates";

const termAt = (line: string, pos: number) =>
  splitDslTerms(line).find((term) => pos >= term.start && pos <= term.end) ?? null;

/**
 * A "reference" kind field may also be authored as a coordinate literal `(x, y)`
 * (the same form freePoint's own x/y already accept as plain "number" fields).
 * Returns `undefined` when `pos` isn't inside either sub-span (not a coordinate
 * literal at all, or cursor elsewhere in it) so the caller falls back to normal
 * reference-name completion; returns `null` when `pos` is inside a coordinate
 * sub-span but not right after `@` (no completion makes sense there, and falling
 * back to point/line-name completion for a numeric position would be wrong).
 */
const dslCoordinateLiteralCompletionContext = (
  code: string,
  pos: number,
  span: DslLabeledValueSpan,
  parameter: DslCompletionParameter
): DslCompletionContext | undefined => {
  const xSpan = coordinateComponent(code, span, "x");
  const ySpan = coordinateComponent(code, span, "y");
  const subSpan = [xSpan, ySpan].find((candidate) => candidate && pos >= candidate.start && pos <= candidate.end);
  if (!subSpan) return undefined;
  const token = dslVariableTokenEndingAt(code, pos, subSpan.start);
  if (!token) return elementParameterCompletionContext(code, pos, subSpan.start);
  return {
    kind: "parameter",
    from: token.from,
    to: token.to,
    parameter: {
      source: parameter.source,
      key: parameter.key,
      definition: { key: parameter.definition.key, label: parameter.definition.label, kind: "number" }
    }
  };
};

/**
 * Locates the cursor's own record inside a live `vars=[name:expr;...]` attribute
 * and narrows to the `@`-token inside that record's expression field specifically
 * (never the name field). Uses parameter key `dslVarsAttributeParameterKey` so
 * cmAutocomplete.ts can route to the local-variable candidate source instead of
 * the top-level @variable source.
 */
const dslVarsFieldCompletionContext = (code: string, pos: number, span: DslLabeledValueSpan): DslCompletionContext => {
  const records = recordSpans(code, span);
  if (!records) return null;
  const record = records.find((item) => pos >= item.start && pos <= item.end);
  if (!record) return null;
  const expressionSpan = recordRemainder(code, record, 1);
  if (!expressionSpan || pos < expressionSpan.start || pos > expressionSpan.end) return null;
  const token = dslVariableTokenEndingAt(code, pos, expressionSpan.start);
  if (!token) return elementParameterCompletionContext(code, pos, expressionSpan.start);
  return {
    kind: "parameter",
    from: token.from,
    to: token.to,
    parameter: {
      source: "attr",
      key: dslVarsAttributeParameterKey,
      definition: { key: dslVarsAttributeParameterKey, label: "変数", kind: "number" }
    }
  };
};

/**
 * Locates the cursor's own record inside a live `intermediates=[point:angle:
 * incoming:outgoing:id;...]` attribute and narrows to the `@`-token inside
 * fields 1-3 (angle/incoming/outgoing) specifically. Field 0 (point) is a
 * reference, not a numeric expression; field 4 (id) is a bare identifier —
 * neither ever offers @variable completion.
 */
const dslIntermediatesFieldCompletionContext = (code: string, pos: number, span: DslLabeledValueSpan): DslCompletionContext => {
  const records = recordSpans(code, span);
  if (!records) return null;
  const record = records.find((item) => pos >= item.start && pos <= item.end);
  if (!record) return null;
  for (const fieldIndex of [1, 2, 3] as const) {
    const fieldSpan = recordField(code, record, fieldIndex);
    if (!fieldSpan || pos < fieldSpan.start || pos > fieldSpan.end) continue;
    const token = dslVariableTokenEndingAt(code, pos, fieldSpan.start);
    if (!token) return elementParameterCompletionContext(code, pos, fieldSpan.start);
    return {
      kind: "parameter",
      from: token.from,
      to: token.to,
      parameter: {
        source: "attr",
        key: dslIntermediatesAttributeParameterKey,
        definition: { key: dslIntermediatesAttributeParameterKey, label: "中間点", kind: "number" }
      }
    };
  }
  return null;
};

/**
 * `place`/`layoutVar`/`printLayout` have no CadElement/ParameterDefinition to
 * derive metadata from (dslCompletionMetadataForType is unusable), so the
 * accepted attribute-key set comes from dslPrintLayoutAttributes.ts — the same
 * constants dslCompiler.ts's buildBlockPrintLayouts compiles against — rather
 * than a separate hand-written table that could drift from the compiler.
 * Attribute-NAME completion (autocompleting `col` -> `columns=`) is out of
 * scope: it would need dslCompletionMetadataForType's sample-round-trip
 * machinery, which cannot exist for these non-CadElement kinds. Only
 * @variable completion inside already-typed attribute VALUES is added.
 */
const dslPrintLayoutCompletionContextAt = (code: string, pos: number, lineText: string): DslCompletionContext => {
  const statement = dslLinePrintLayoutStatement(lineText);
  if (!statement) return null;

  if (statement.kind === "layoutVar") {
    const span = dslLinePrintLayoutValueSpans(lineText)
      .find((item) => item.source === "payload" && item.key === "expression" && pos >= item.start && pos <= item.end);
    if (!span) return null;
    const token = dslVariableTokenEndingAt(code, pos, span.start);
    return token
      ? {
        kind: "parameter",
        from: token.from,
        to: token.to,
        parameter: { source: "printLayoutBlock", key: "expression", definition: { key: "expression", label: "式", kind: "number" } }
      }
      : elementParameterCompletionContext(code, pos, span.start);
  }

  const numericKeys = statement.kind === "place" ? placeNumericAttrKeys : printLayoutNumericAttrKeys;
  const coordinateKeys = statement.kind === "place" ? placeCoordinateAttrKeys : printLayoutCoordinateAttrKeys;
  const span = dslLinePrintLayoutValueSpans(lineText).find((item) => pos >= item.start && pos <= item.end);
  if (!span || span.source !== "attr") return null;

  if (numericKeys.includes(span.key)) {
    const token = dslVariableTokenEndingAt(code, pos, span.start);
    return token
      ? {
        kind: "parameter",
        from: token.from,
        to: token.to,
        parameter: { source: "printLayoutBlock", key: span.key, definition: { key: span.key, label: span.key, kind: "number" } }
      }
      : elementParameterCompletionContext(code, pos, span.start);
  }
  if (coordinateKeys.includes(span.key)) {
    const parameter: DslCompletionParameter = {
      source: "printLayoutBlock",
      key: span.key,
      definition: { key: span.key, label: span.key, kind: "reference" }
    };
    // at=/canvas= are always coordinate pairs (dslCompiler.ts rejects any other
    // form with a diagnostic), so unlike element "reference"-kind fields there
    // is no non-coordinate fallback to offer — undefined collapses to null.
    return dslCoordinateLiteralCompletionContext(code, pos, span, parameter) ?? null;
  }
  return null;
};

const lineHeadContext = (code: string, pos: number): DslCompletionContext | null => {
  const terms = splitDslTerms(code);
  if (terms.length === 0) return { kind: "keyword", from: pos, to: pos, options: dslStatementKeywordCompletions };
  const first = terms[0];
  if (terms.length === 1 && pos >= first.start && pos <= first.end) {
    return { kind: "keyword", from: first.start, to: pos, options: dslStatementKeywordCompletions };
  }
  return null;
};

const referenceCompletionSpan = (
  code: string,
  pos: number,
  span: DslLabeledValueSpan,
  kind: DslCompletionParameter["definition"]["kind"]
) => {
  if (kind !== "lineReferenceList" || code[span.start] !== "[" || code[span.end - 1] !== "]") {
    return { from: span.start, to: pos };
  }
  const item = splitDslTopLevelSpans(
    code,
    { start: span.start + 1, end: span.end - 1 },
    ","
  ).find((candidate) => pos >= candidate.start && pos <= candidate.end);
  return item ? { from: item.start, to: pos } : { from: pos, to: pos };
};

/**
 * Resolves only from freshly reparsed text: `lineText` is a statement's logical
 * projection (physical lines joined at continuation points) when the caller
 * could resolve one, or a single physical line otherwise — this function has
 * no opinion on which, it just scans the string it's given. Erroring
 * statements deliberately receive at most line-head keyword completion; no
 * partial DSL parser exists alongside the document parser.
 */
export const dslCompletionContextAt = (lineText: string, pos: number): DslCompletionContext => {
  const { code, comment } = splitDslComment(lineText);
  if (comment && pos >= code.length) return null;
  const head = lineHeadContext(code, pos);
  if (head) return head;

  const statement = dslLineElementStatement(lineText);
  const elementType = statement ? dslStatementElementType(statement) : null;
  if (!statement || !elementType) return dslPrintLayoutCompletionContextAt(code, pos, lineText);
  const metadata = dslCompletionMetadataForType(elementType);
  const span = dslLineLabeledValueSpans(lineText).find((item) => pos >= item.start && pos <= item.end);
  if (span) {
    if (span.source === "attr" && span.key === dslVarsAttributeParameterKey) {
      return dslVarsFieldCompletionContext(code, pos, span);
    }
    if (span.source === "attr" && span.key === dslIntermediatesAttributeParameterKey) {
      return dslIntermediatesFieldCompletionContext(code, pos, span);
    }
    const parameters = metadata.parameters.filter((parameter) => parameter.source === span.source && parameter.key === span.key);
    if (parameters.length !== 1) return null;
    const parameter = parameters[0];
    if (parameter.definition.kind === "number") {
      const token = dslVariableTokenEndingAt(code, pos, span.start);
      return token
        ? { kind: "parameter", from: token.from, to: token.to, parameter }
        : elementParameterCompletionContext(code, pos, span.start);
    }
    if (parameter.definition.kind === "reference") {
      const coordinateContext = dslCoordinateLiteralCompletionContext(code, pos, span, parameter);
      return coordinateContext !== undefined ? coordinateContext : { kind: "parameter", from: span.start, to: pos, parameter };
    }
    return {
      kind: "parameter",
      ...referenceCompletionSpan(code, pos, span, parameter.definition.kind),
      parameter
    };
  }

  const term = termAt(code, pos);
  const lastValueEnd = Math.max(statement.keywordSpan.end, ...dslLineLabeledValueSpans(lineText).map((item) => item.end));
  if (term && !term.text.includes("=") && term.start >= lastValueEnd) {
    return { kind: "attribute", from: term.start, to: pos, elementType };
  }
  if (!term && pos >= lastValueEnd) return { kind: "attribute", from: pos, to: pos, elementType };
  return null;
};
