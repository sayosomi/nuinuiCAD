import { dslStatementKeywordCompletions } from "./dslParser";
import { dslCallCompletionContextAt } from "./dslCallCompletionContext";
import type { DslConstructionCategory, DslConstructionSpec } from "./dslConstructions";
import {
  dslLineElementStatement,
  dslLineLabeledValueSpans,
  dslLinePrintLayoutStatement,
  dslLinePrintLayoutValueSpans,
  type DslLabeledValueSpan
} from "./dslValueSpans";
import { isBareDslIdentifierChar, splitDslComment, splitDslTerms } from "./dslTokens";
import { dslCompletionMetadataForType, dslStatementElementType, type DslCompletionParameter } from "./dslCompletionMetadata";
import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";
import { coordinateComponent, recordField, recordRemainder, recordSpans, splitDslTopLevelSpans } from "./dslParameterSpanScanner";
import {
  placeCoordinateAttrKeys,
  placeNumericAttrKeys,
  printLayoutCoordinateAttrKeys,
  printLayoutNumericAttrKeys
} from "./dslPrintLayoutAttributes";
import { typedDeclarationInitializerCompletionContext } from "./dslTypedDeclarationCompletionContext";
import { declaredTypeCompletionContextAt } from "./dslDeclaredTypeCompletionContext";
import { numericTypeOptionCompletionContextAt } from "./dslNumericTypeOptionsCompletionContext";
import { propertyScalarValueCompletionContext, type PropertyScalarValueCompletionContext } from "./dslPropertyScalarCompletionContext";
import { templateHoleContentSpanAt } from "./dslTemplateHoleCompletionContext";
import { setCompletionContextAt } from "./dslSetCompletionContext";
import { dslModuleCompletionContextAt } from "./dslModuleCompletionContext";
import type { TypedGeometryPropertyCompletionContext } from "./dslTypedGeometryPropertyCompletionContext";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import type { DslSpan } from "./dslTypes";
import type { ScalarType } from "../scalars/types";

export type DslCompletionContext =
  | { kind: "keyword"; from: number; to: number; options: readonly string[] }
  | { kind: "construction"; from: number; to: number; category: DslConstructionCategory }
  | { kind: "argument"; from: number; to: number; spec: DslConstructionSpec; usedArgumentNames: ReadonlySet<string> }
  | { kind: "parameter"; from: number; to: number; parameter: DslCompletionParameter }
  | { kind: "elementParameter"; from: number; to: number; elementToken: string; tokenStart: number; sigil: boolean }
  | { kind: "declaredType"; from: number; to: number }
  | { kind: "typedInitializer"; from: number; to: number; declaredType: ScalarType; positionContext: ScalarExpressionCompletionContext }
  | { kind: "numericTypeOption"; from: number; to: number; options: readonly ("step" | "min" | "max")[] }
  | { kind: "propertyScalarValue"; from: number; to: number; propertyContext: PropertyScalarValueCompletionContext }
  | { kind: "templateHole"; from: number; to: number; contentSpan: DslSpan }
  | { kind: "setTarget"; from: number; to: number }
  | { kind: "setRhs"; from: number; to: number; expressionSpan: DslSpan; targetName: string; geometryProperty?: TypedGeometryPropertyCompletionContext }
  | { kind: "moduleCallee"; from: number; to: number }
  | { kind: "moduleArgumentLabel"; from: number; to: number; argumentIndex: number }
  | { kind: "moduleArgumentValue"; from: number; to: number; argumentIndex: number }
  | { kind: "moduleQualifiedMember"; from: number; to: number; qualifiedInstanceName: string; expectedScalarType?: ScalarType }
  | { kind: "moduleReference"; from: number; to: number }
  | null;

/**
 * Task 51: the single classifier call for every numeric-attribute completion
 * site below. `@name` narrows to `parameter` (typed binding / legacy
 * variable candidates); `@Element.property` or bare `Element.property`
 * narrows to `elementParameter` (element property candidates). These are two
 * arms of one token shape (split purely on the presence of `.`), not two
 * independently-matching grammars - see expressionReferenceToken.ts.
 *
 * `majorVersion` is optional and only ever narrows further: omitted (or 2),
 * a bare `Element.property` still narrows to `elementParameter` exactly as
 * it always has (existing v2 documents, and every caller that does not yet
 * thread a document version, keep today's behavior unchanged). Only an
 * explicit `3` suppresses it - the nui 3 bare spelling is a compile error
 * (dslPropertyReferenceSyntax.ts), so offering it as a completion target
 * would guide the user toward text that fails on commit.
 */
const numberFieldCompletionContext = (
  code: string,
  pos: number,
  boundaryStart: number,
  parameter: DslCompletionParameter,
  majorVersion?: 2 | 3
): DslCompletionContext => {
  const match = expressionReferenceTokenEndingAt(code, pos, { boundaryStart });
  if (!match) return null;
  if (match.kind === "binding") {
    return { kind: "parameter", from: match.from, to: match.to, parameter };
  }
  if (majorVersion === 3 && !match.sigil) return null;
  return {
    kind: "elementParameter",
    from: match.from,
    to: match.to,
    elementToken: match.elementToken,
    tokenStart: match.tokenStart,
    sigil: match.sigil
  };
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
  parameter: DslCompletionParameter,
  majorVersion?: 2 | 3
): DslCompletionContext | undefined => {
  const xSpan = coordinateComponent(code, span, "x");
  const ySpan = coordinateComponent(code, span, "y");
  const subSpan = [xSpan, ySpan].find((candidate) => candidate && pos >= candidate.start && pos <= candidate.end);
  if (!subSpan) return undefined;
  return numberFieldCompletionContext(code, pos, subSpan.start, {
    source: parameter.source,
    key: parameter.key,
    definition: { key: parameter.definition.key, label: parameter.definition.label, kind: "number" }
  }, majorVersion);
};

/**
 * Locates the cursor's own record inside a live `vars=[name:expr;...]` attribute
 * and narrows to the `@`-token inside that record's expression field specifically
 * (never the name field). Uses parameter key `dslVarsAttributeParameterKey` so
 * cmAutocomplete.ts can route to the local-variable candidate source instead of
 * the top-level @variable source.
 */
const dslVarsFieldCompletionContext = (code: string, pos: number, span: DslLabeledValueSpan, majorVersion?: 2 | 3): DslCompletionContext => {
  const records = recordSpans(code, span);
  if (!records) return null;
  const record = records.find((item) => pos >= item.start && pos <= item.end);
  if (!record) return null;
  const expressionSpan = recordRemainder(code, record, 1);
  if (!expressionSpan || pos < expressionSpan.start || pos > expressionSpan.end) return null;
  return numberFieldCompletionContext(code, pos, expressionSpan.start, {
    source: "attr",
    key: dslVarsAttributeParameterKey,
    definition: { key: dslVarsAttributeParameterKey, label: "変数", kind: "number" }
  }, majorVersion);
};

/**
 * Locates the cursor's own record inside a live `intermediates=[point:angle:
 * incoming:outgoing:id;...]` attribute and narrows to the `@`-token inside
 * fields 1-3 (angle/incoming/outgoing) specifically. Field 0 (point) is a
 * reference, not a numeric expression; field 4 (id) is a bare identifier —
 * neither ever offers @variable completion.
 */
const dslIntermediatesFieldCompletionContext = (
  code: string,
  pos: number,
  span: DslLabeledValueSpan,
  majorVersion?: 2 | 3
): DslCompletionContext => {
  const records = recordSpans(code, span);
  if (!records) return null;
  const record = records.find((item) => pos >= item.start && pos <= item.end);
  if (!record) return null;
  for (const fieldIndex of [1, 2, 3] as const) {
    const fieldSpan = recordField(code, record, fieldIndex);
    if (!fieldSpan || pos < fieldSpan.start || pos > fieldSpan.end) continue;
    return numberFieldCompletionContext(code, pos, fieldSpan.start, {
      source: "attr",
      key: dslIntermediatesAttributeParameterKey,
      definition: { key: dslIntermediatesAttributeParameterKey, label: "中間点", kind: "number" }
    }, majorVersion);
  }
  return null;
};

/**
 * `place`/`printLayout` have no CadElement/ParameterDefinition to
 * derive metadata from (dslCompletionMetadataForType is unusable), so the
 * accepted attribute-key set comes from dslPrintLayoutAttributes.ts — the same
 * constants dslCompiler.ts's buildBlockPrintLayouts compiles against — rather
 * than a separate hand-written table that could drift from the compiler.
 * Attribute-NAME completion (autocompleting `col` -> `columns: `) is out of
 * scope: it would need dslCompletionMetadataForType's sample-round-trip
 * machinery, which cannot exist for these non-CadElement kinds. Only
 * @variable completion inside already-typed attribute VALUES is added.
 */
const dslPrintLayoutCompletionContextAt = (code: string, pos: number, lineText: string, majorVersion?: 2 | 3): DslCompletionContext => {
  const statement = dslLinePrintLayoutStatement(lineText);
  if (!statement) return null;

  const numericKeys = statement.kind === "place" ? placeNumericAttrKeys : printLayoutNumericAttrKeys;
  const coordinateKeys = statement.kind === "place" ? placeCoordinateAttrKeys : printLayoutCoordinateAttrKeys;
  const span = dslLinePrintLayoutValueSpans(lineText).find((item) => pos >= item.start && pos <= item.end);
  if (!span || span.source !== "attr") return null;

  if (numericKeys.includes(span.key)) {
    return numberFieldCompletionContext(code, pos, span.start, {
      source: "printLayoutBlock",
      key: span.key,
      definition: { key: span.key, label: span.key, kind: "number" }
    }, majorVersion);
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
    return dslCoordinateLiteralCompletionContext(code, pos, span, parameter, majorVersion) ?? null;
  }
  return null;
};

/**
 * Task 39: the only entry point for text/choice/boolean-kind labeled value
 * spans that carry an opt-in `ParameterDefinition.propertyCapability` (the
 * exact same metadata Task 22's compilePropertyBindings reads - no
 * hardcoded property list here either). Tries the property-scalar shape
 * first (a whole-value `@name` reference, or a bare boolean literal on an
 * opted-in boolean field) since that is the only shape every one of the
 * three kinds can carry; only a "text"-kind value that isn't a `@name`
 * reference can additionally be a quoted string with template holes.
 * Returns `null` for every other case (a non-opted-in property, or a choice
 * literal being typed - the existing enum-literal branch in cmAutocomplete.ts
 * still owns that, unchanged).
 */
const scalarPropertyOrHoleCompletionContext = (
  code: string,
  pos: number,
  span: DslLabeledValueSpan,
  parameter: DslCompletionParameter
): DslCompletionContext => {
  const { definition } = parameter;
  if (definition.kind !== "text" && definition.kind !== "choice" && definition.kind !== "boolean") return null;

  const propertyContext = propertyScalarValueCompletionContext(code, span, pos, definition);
  if (propertyContext) return { kind: "propertyScalarValue", from: propertyContext.from, to: propertyContext.to, propertyContext };

  if (definition.kind !== "text") return null;
  const contentSpan = templateHoleContentSpanAt(code, span, pos);
  if (!contentSpan) return null;
  // rootType is irrelevant here - `from`/`to` never depend on it (only
  // `expectedType` does); the real string/number candidate generation runs
  // downstream (typedValueCandidates.ts's templateHoleScalarCandidates),
  // which tries both root types itself.
  const positionSpan = scalarExpressionCompletionContextAt(code, pos, contentSpan, null);
  return positionSpan ? { kind: "templateHole", from: positionSpan.from, to: positionSpan.to, contentSpan } : null;
};

const leadingIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * A bare mutation statement (`edge(...)`, `reverse(...)`, ...) has no
 * `<category> <name> =` head, so splitDslTerms - which only flushes a term
 * on depth-0 whitespace - collapses the entire statement into a single term
 * once its `(` opens. Matching against the leading identifier's own extent
 * (not the whole term, which can swallow the parenthesized argument list)
 * keeps keyword completion scoped to the keyword itself: once `(` is typed,
 * this falls through to dslCallCompletionContextAt's own bare-call branch.
 */
const lineHeadContext = (code: string, pos: number): DslCompletionContext | null => {
  const terms = splitDslTerms(code);
  if (terms.length === 0) return { kind: "keyword", from: pos, to: pos, options: dslStatementKeywordCompletions };
  const first = terms[0];
  if (terms.length !== 1) return null;
  const identifierLength = first.text.match(leadingIdentifierPattern)?.[0].length ?? first.text.length;
  const identifierEnd = first.start + identifierLength;
  if (pos >= first.start && pos <= identifierEnd) {
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
  // An empty value has no already-typed prefix to replace - `span.start` is
  // only the trimmed (possibly collapsed-past-`pos`) span's edge here, not a
  // real prefix boundary. Insert at the cursor instead.
  if (span.start === span.end) return { from: pos, to: pos };
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
 *
 * `majorVersion` is optional (Task 51): omitted, a bare `Element.property`
 * numeric-attribute reference still narrows to `elementParameter` exactly as
 * before this migration - only an explicit `3` suppresses it, since that
 * spelling is a compile error in nui 3. See numberFieldCompletionContext.
 */
export const dslCompletionContextAt = (lineText: string, pos: number, majorVersion?: 2 | 3): DslCompletionContext => {
  const { code, comment } = splitDslComment(lineText);
  if (comment && pos >= code.length) return null;
  const head = lineHeadContext(code, pos);
  if (head) return head;

  const moduleContext = dslModuleCompletionContextAt(code, pos);
  if (moduleContext) return moduleContext;

  const qualified = code.slice(0, pos).match(new RegExp(`[^\\s"'#=()[\\]{},;:.]+::[^\\s"'#=()[\\]{},;:.]*$`));
  if (qualified) {
    const typedDeclarationContext = typedDeclarationInitializerCompletionContext(code, pos);
    return {
      kind: "moduleQualifiedMember",
      from: pos - qualified[0].length + qualified[0].indexOf("::") + 2,
      to: pos,
      qualifiedInstanceName: qualified[0].slice(0, qualified[0].indexOf("::")).replace(/^@/, ""),
      ...(typedDeclarationContext ? { expectedScalarType: typedDeclarationContext.declaredType } : {})
    };
  }

  const callContext = dslCallCompletionContextAt(code, pos);
  if (callContext) return callContext;

  const numericTypeOptionContext = numericTypeOptionCompletionContextAt(code, pos);
  if (numericTypeOptionContext) return { kind: "numericTypeOption", ...numericTypeOptionContext };

  const declaredTypeContext = declaredTypeCompletionContextAt(code, pos);
  if (declaredTypeContext) return { kind: "declaredType", ...declaredTypeContext };

  const typedDeclarationContext = typedDeclarationInitializerCompletionContext(code, pos);
  if (typedDeclarationContext) {
    if (typedDeclarationContext.geometryProperty) {
      return {
        kind: "elementParameter",
        from: typedDeclarationContext.geometryProperty.from,
        to: typedDeclarationContext.geometryProperty.to,
        elementToken: typedDeclarationContext.geometryProperty.elementToken,
        tokenStart: typedDeclarationContext.geometryProperty.tokenStart,
        sigil: true
      };
    }
    return {
      kind: "typedInitializer",
      from: typedDeclarationContext.positionContext.from,
      to: typedDeclarationContext.positionContext.to,
      declaredType: typedDeclarationContext.declaredType,
      positionContext: typedDeclarationContext.positionContext
    };
  }

  const setContext = setCompletionContextAt(code, pos);
  if (setContext) {
    return setContext.kind === "target"
      ? { kind: "setTarget", from: setContext.from, to: setContext.to }
      : {
        kind: "setRhs",
        from: setContext.from,
        to: setContext.to,
        expressionSpan: setContext.expressionSpan,
        targetName: setContext.targetName,
        ...(setContext.geometryProperty ? { geometryProperty: setContext.geometryProperty } : {})
      };
  }

  const statement = dslLineElementStatement(lineText);
  const elementType = statement ? dslStatementElementType(statement) : null;
  if (!statement || !elementType) return dslPrintLayoutCompletionContextAt(code, pos, lineText, majorVersion);
  const metadata = dslCompletionMetadataForType(elementType);
  // Same rawValueSpan fallback as dslCallCompletionContextAt's own
  // containment check (dslCallCompletionContext.ts): an empty value's
  // trimmed span can collapse past `pos`, so a zero-length span is matched
  // via its untrimmed raw gap instead.
  const span = dslLineLabeledValueSpans(lineText).find((item) => {
    const bounds = item.start === item.end && item.rawValueSpan ? item.rawValueSpan : item;
    return pos >= bounds.start && pos <= bounds.end;
  });
  if (span) {
    if (span.source === "attr" && span.key === dslVarsAttributeParameterKey) {
      return dslVarsFieldCompletionContext(code, pos, span, majorVersion);
    }
    if (span.source === "attr" && span.key === dslIntermediatesAttributeParameterKey) {
      return dslIntermediatesFieldCompletionContext(code, pos, span, majorVersion);
    }
    const parameters = metadata.parameters.filter((parameter) =>
      parameter.source === span.source && parameter.key === span.key
    );
    if (parameters.length !== 1) return null;
    const parameter = parameters[0];
    if (parameter.definition.kind === "number") {
      return numberFieldCompletionContext(code, pos, span.start, parameter, majorVersion);
    }
    if (parameter.definition.kind === "reference") {
      const coordinateContext = dslCoordinateLiteralCompletionContext(code, pos, span, parameter, majorVersion);
      if (coordinateContext !== undefined) return coordinateContext;
      // See referenceCompletionSpan's matching comment: an empty value has
      // no typed prefix at `span.start` to replace.
      return { kind: "parameter", from: span.start === span.end ? pos : span.start, to: pos, parameter };
    }
    const scalarContext = scalarPropertyOrHoleCompletionContext(code, pos, span, parameter);
    if (scalarContext) return scalarContext;
    return {
      kind: "parameter",
      ...referenceCompletionSpan(code, pos, span, parameter.definition.kind),
      parameter
    };
  }
  let moduleReferenceStart = pos;
  while (moduleReferenceStart > 0 && isBareDslIdentifierChar(code[moduleReferenceStart - 1]) && code[moduleReferenceStart - 1] !== "@") moduleReferenceStart -= 1;
  if (moduleReferenceStart > 0 && code[moduleReferenceStart - 1] === "@") {
    return { kind: "moduleReference", from: moduleReferenceStart - 1, to: pos };
  }
  return null;
};
