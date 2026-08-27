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
import { isBareDslIdentifierChar, scanDslSource, splitDslTerms } from "./dslTokens";
import { dslCompletionMetadataForType, dslStatementElementType, type DslCompletionParameter } from "./dslCompletionMetadata";
import { expressionReferenceTokenEndingAt } from "./expressionReferenceToken";
import { coordinateComponent, recordField, recordSpans, splitDslTopLevelSpans } from "./dslParameterSpanScanner";
import {
  placeCoordinateAttrKeys,
  placeNumericAttrKeys,
  layoutNumericAttrKeys,
  printNumericAttrKeys,
  svgNumericAttrKeys
} from "./dslPrintLayoutAttributes";
import { typedDeclarationInitializerCompletionContext } from "./dslTypedDeclarationCompletionContext";
import { geometryArrayDeclarationCompletionContextAt, type GeometryArrayCompletionContext } from "./dslGeometryArrayCompletionContext";
import { declaredTypeCompletionContextAt } from "./dslDeclaredTypeCompletionContext";
import { numericTypeOptionCompletionContextAt } from "./dslNumericTypeOptionsCompletionContext";
import { propertyScalarValueCompletionContext, type PropertyScalarValueCompletionContext } from "./dslPropertyScalarCompletionContext";
import { templateHoleContentSpanAt } from "./dslTemplateHoleCompletionContext";
import { setCompletionContextAt } from "./dslSetCompletionContext";
import { dslModuleCompletionContextAt, dslModuleParameterTypeCompletionContextAt } from "./dslModuleCompletionContext";
import type { TypedGeometryPropertyCompletionContext } from "./dslTypedGeometryPropertyCompletionContext";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import type { DslSpan } from "./dslTypes";
import type { ScalarType } from "../scalars/types";
import type { DslModifierCompletionContext } from "./dslModifierCompletionContext";

export type DslCompletionContext =
  | { kind: "keyword"; from: number; to: number; options: readonly string[] }
  | { kind: "construction"; from: number; to: number; category: DslConstructionCategory }
  | { kind: "argument"; from: number; to: number; spec: DslConstructionSpec; usedArgumentNames: ReadonlySet<string> }
  | { kind: "parameter"; from: number; to: number; parameter: DslCompletionParameter }
  | { kind: "elementParameter"; from: number; to: number; elementToken: string; tokenStart: number; sigil: boolean; expectedScalarType: ScalarType }
  | { kind: "declaredType"; from: number; to: number; bindingKind: "const" | "let" }
  | { kind: "typedInitializer"; from: number; to: number; declaredType: ScalarType; positionContext: ScalarExpressionCompletionContext }
  | ({ kind: "geometryArrayValue" } & GeometryArrayCompletionContext)
  | { kind: "conditionExpression"; from: number; to: number; positionContext: ScalarExpressionCompletionContext }
  | { kind: "numericTypeOption"; from: number; to: number; options: readonly ("step" | "min" | "max")[] }
  | { kind: "propertyScalarValue"; from: number; to: number; propertyContext: PropertyScalarValueCompletionContext }
  | { kind: "templateHole"; from: number; to: number; contentSpan: DslSpan }
  | { kind: "setTarget"; from: number; to: number }
  | { kind: "setRhs"; from: number; to: number; expressionSpan: DslSpan; targetName: string; geometryProperty?: TypedGeometryPropertyCompletionContext }
  | { kind: "moduleCallee"; from: number; to: number }
  | { kind: "moduleParameterType"; from: number; to: number }
  | { kind: "moduleArgumentLabel"; from: number; to: number; argumentIndex: number }
  | { kind: "moduleArgumentValue"; from: number; to: number; argumentIndex: number }
  | { kind: "moduleQualifiedMember"; from: number; to: number; qualifiedInstanceName: string; argumentIndex?: number; expectedScalarType?: ScalarType; expectedGeometryKind?: DslGeometryReferenceKind }
  | { kind: "moduleReference"; from: number; to: number }
  | DslModifierCompletionContext
  | null;

export type DslGeometryReferenceKind =
  | "point"
  | "line"
  | "lineEndpointReference"
  | "lineReference"
  | "lineReferenceList";

/** Reuses the existing element parameter schema for source geometry references. */
export const dslGeometryReferenceKindForParameter = (
  parameter: DslCompletionParameter | undefined
): DslGeometryReferenceKind | null => {
  switch (parameter?.definition.kind) {
    case "lineEndpointReference":
      return "lineEndpointReference";
    case "lineReference":
    case "lineReferenceList":
      return parameter.definition.kind;
    case "reference":
      return "point";
    default:
      return null;
  }
};

/**
 * Task 51: the single classifier call for every numeric-attribute completion
 * site below. `@name` narrows to `parameter` (typed binding / variable
 * candidates); `@Element.property` narrows to `elementParameter`
 * narrows to `elementParameter` (element property candidates). These are two
 * arms of one token shape (split purely on the presence of `.`), not two
 * independently-matching grammars - see expressionReferenceToken.ts.
 *
 * Property references always use the sigilled nui4 spelling.
 */
const numberFieldCompletionContext = (
  code: string,
  pos: number,
  boundaryStart: number,
  parameter: DslCompletionParameter
): DslCompletionContext => {
  const match = expressionReferenceTokenEndingAt(code, pos, { boundaryStart });
  if (!match) return null;
  if (match.kind === "binding") {
    return { kind: "parameter", from: match.from, to: match.to, parameter };
  }
  if (!match.sigil) return null;
  return {
    kind: "elementParameter",
    from: match.from,
    to: match.to,
    elementToken: match.elementToken,
    tokenStart: match.tokenStart,
    sigil: match.sigil,
    expectedScalarType: { kind: "number" }
  };
};

/** intermediates=[...]-list marker used by the shared numeric completion path. */
export const dslIntermediatesAttributeParameterKey = "intermediates";

/**
 * A "reference" kind field may also be authored as a coordinate literal `(x, y)`
 * (the same form freePoint's own x/y already accept as plain "number" fields).
 * Returns `undefined` when `pos` isn't inside either sub-span (not a coordinate
 * literal at all, || cursor elsewhere in it) so the caller falls back to normal
 * reference-name completion; returns `null` when `pos` is inside a coordinate
 * sub-span but not right after `@` (no completion makes sense there, && falling
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
  return numberFieldCompletionContext(code, pos, subSpan.start, {
    source: parameter.source,
    key: parameter.key,
    definition: { key: parameter.definition.key, label: parameter.definition.label, kind: "number" }
  });
};

/**
 * Locates the cursor's own record inside a live `intermediates=[point:,angle:
 * ,incoming:,outgoing:id;...]` attribute && narrows to the `@`-token inside
 * fields 1-3 (angle/incoming/outgoing) specifically. Field 0 (point) is a
 * reference, not a numeric expression; field 4 (id) is a bare identifier —
 * neither ever offers @variable completion.
 */
const dslIntermediatesFieldCompletionContext = (
  code: string,
  pos: number,
  span: DslLabeledValueSpan
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
    });
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
const dslPrintLayoutCompletionContextAt = (code: string, pos: number, lineText: string): DslCompletionContext => {
  const statement = dslLinePrintLayoutStatement(lineText);
  if (!statement) return null;

  const numericKeys = statement.kind === "place"
    ? placeNumericAttrKeys
    : statement.kind === "layout"
      ? layoutNumericAttrKeys
      : statement.kind === "print"
        ? printNumericAttrKeys
        : svgNumericAttrKeys;
  const coordinateKeys = statement.kind === "place" ? placeCoordinateAttrKeys : [];
  const span = dslLinePrintLayoutValueSpans(lineText).find((item) => pos >= item.start && pos <= item.end);
  if (!span || span.source !== "attr") return null;

  if (numericKeys.includes(span.key)) {
    return numberFieldCompletionContext(code, pos, span.start, {
      source: "printLayoutBlock",
      key: span.key,
      definition: { key: span.key, label: span.key, kind: "number" }
    });
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

/**
 * Entry point for text/choice/boolean-kind labeled value spans. Eligibility
 * comes from the parameter schema.
 * Tries the property-scalar shape
 * first (a whole-value `@name` reference, || a bare boolean literal on an
 * opted-in boolean field) since that is the only shape every one of the
 * three kinds can carry; only a "text"-kind value that isn't a `@name`
 * reference can additionally be a quoted string with template holes.
 * Returns `null` for every other case (a non-opted-in property, || a choice
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
  if (propertyContext?.kind === "geometryProperty") {
    return {
      kind: "elementParameter",
      from: propertyContext.geometryProperty.from,
      to: propertyContext.geometryProperty.to,
      elementToken: propertyContext.geometryProperty.elementToken,
      tokenStart: propertyContext.geometryProperty.tokenStart,
      sigil: true,
      expectedScalarType: propertyContext.expectedType
    };
  }
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

/** The condition after an `if (` is a typed boolean expression, including
 * nested builtin calls. The ordinary construction-argument detector only
 * owns the outer argument slot and intentionally declines nested depth, so
 * this narrow adapter keeps the shared scalar expression classifier in charge
 * of the condition's inner position. */
const conditionalExpressionCompletionContextAt = (
  code: string,
  pos: number
): DslCompletionContext => {
  const head = /^\s*if\s*\(/.exec(code);
  if (!head) return null;
  const open = head[0].lastIndexOf("(");
  let depth = 0;
  let close = code.length;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "(") depth += 1;
    if (code[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (pos < open + 1 || pos > close) return null;
  const positionContext = scalarExpressionCompletionContextAt(code, pos, { start: open + 1, end: close }, { kind: "boolean" });
  return positionContext
    ? { kind: "conditionExpression", from: positionContext.from, to: positionContext.to, positionContext }
    : null;
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

const dslQualifiedGeometryKindAt = (
  lineText: string,
  pos: number
): DslGeometryReferenceKind | null => {
  const statement = dslLineElementStatement(lineText);
  const elementType = statement ? dslStatementElementType(statement) : null;
  if (!statement || !elementType) return null;
  const metadata = dslCompletionMetadataForType(elementType);
  const span = dslLineLabeledValueSpans(lineText).find((item) => {
    const bounds = item.start === item.end && item.rawValueSpan ? item.rawValueSpan : item;
    return pos >= bounds.start && pos <= bounds.end;
  });
  if (!span) return null;
  const parameters = metadata.parameters.filter((parameter) =>
    parameter.source === span.source && parameter.key === span.key
  );
  return parameters.length === 1 ? dslGeometryReferenceKindForParameter(parameters[0]) : null;
};

/**
 * Resolves only from freshly reparsed text: `lineText` is a statement's logical
 * projection (physical lines joined at continuation points) when the caller
 * could resolve one, || a single physical line otherwise — this function has
 * no opinion on which, it just scans the string it's given. Erroring
 * statements deliberately receive at most line-head keyword completion; no
 * partial DSL parser exists alongside the document parser.
 *
 * Property references use the final `@Element.property` spelling.
 */
export const dslCompletionContextAt = (
  lineText: string,
  pos: number,
  startsInBlockComment = false
): DslCompletionContext => {
  const lexedLine = scanDslSource(lineText, { startsInBlockComment }).lines[0]!;
  if (lexedLine.comments.some((comment) => (
    pos >= comment.start && (
      pos < comment.end ||
      (pos === comment.end && lineText.slice(comment.end).trim().length === 0)
    )
  ))) return null;
  const code = lexedLine.code;
  const head = lineHeadContext(code, pos);
  if (head) return head;

  const moduleParameterTypeContext = dslModuleParameterTypeCompletionContextAt(code, pos);
  if (moduleParameterTypeContext) return moduleParameterTypeContext;

  const moduleContext = dslModuleCompletionContextAt(code, pos);
  if (moduleContext) return moduleContext;

  const qualified = code.slice(0, pos).match(new RegExp(`[^\\s"'#=()[\\]{},;:.]+::[^\\s"'#=()[\\]{},;:.]*$`));
  if (qualified) {
    const typedDeclarationContext = typedDeclarationInitializerCompletionContext(code, pos);
    const expectedGeometryKind = dslQualifiedGeometryKindAt(lineText, pos);
    return {
      kind: "moduleQualifiedMember",
      from: pos - qualified[0].length + qualified[0].indexOf("::") + 2,
      to: pos,
      qualifiedInstanceName: qualified[0].slice(0, qualified[0].indexOf("::")).replace(/^@/, ""),
      ...(typedDeclarationContext ? { expectedScalarType: typedDeclarationContext.declaredType } : {}),
      ...(expectedGeometryKind ? { expectedGeometryKind } : {})
    };
  }

  const conditionContext = conditionalExpressionCompletionContextAt(code, pos);
  if (conditionContext) return conditionContext;

  const callContext = dslCallCompletionContextAt(code, pos);
  if (callContext) return callContext;

  const numericTypeOptionContext = numericTypeOptionCompletionContextAt(code, pos);
  if (numericTypeOptionContext) return { kind: "numericTypeOption", ...numericTypeOptionContext };

  const declaredTypeContext = declaredTypeCompletionContextAt(code, pos);
  if (declaredTypeContext) return { kind: "declaredType", ...declaredTypeContext };

  const geometryArrayContext = geometryArrayDeclarationCompletionContextAt(code, pos);
  if (geometryArrayContext) return { kind: "geometryArrayValue", ...geometryArrayContext };

  const typedDeclarationContext = typedDeclarationInitializerCompletionContext(code, pos);
  if (typedDeclarationContext) {
    if (typedDeclarationContext.geometryProperty) {
      return {
        kind: "elementParameter",
        from: typedDeclarationContext.geometryProperty.from,
        to: typedDeclarationContext.geometryProperty.to,
        elementToken: typedDeclarationContext.geometryProperty.elementToken,
        tokenStart: typedDeclarationContext.geometryProperty.tokenStart,
        sigil: true,
        expectedScalarType: typedDeclarationContext.declaredType
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
  if (!statement || !elementType) return dslPrintLayoutCompletionContextAt(code, pos, lineText);
  const metadata = dslCompletionMetadataForType(elementType);
  // Same rawValueSpan fallback as dslCallCompletionContextAt's own
  // containment check (dslCallCompletionContext.ts): an empty value's
  // trimmed span can collapse past `pos`, so a zero-length span is matched
  // via its untrimmed raw gap instead.
  const labeledSpans = dslLineLabeledValueSpans(lineText);
  const emptyValueSpan = labeledSpans.find((item, index) => {
    if (item.start !== item.end || !item.rawValueSpan) return false;
    if (pos >= item.rawValueSpan.start && pos <= item.rawValueSpan.end) return true;
    const next = labeledSpans[index + 1];
    if (!next) return false;
    const nextKeyStart = lineText.lastIndexOf(`${next.key}:`, next.start);
    return nextKeyStart >= 0 && pos > item.rawValueSpan.end && pos <= nextKeyStart;
  });
  const span = labeledSpans.find((item) => {
    const bounds = item.start === item.end && item.rawValueSpan ? item.rawValueSpan : item;
    return pos >= bounds.start && pos <= bounds.end;
  });
  if (emptyValueSpan) {
    const parameter = metadata.parameters.find((candidate) =>
      candidate.source === emptyValueSpan.source && candidate.key === emptyValueSpan.key
    );
    if (parameter) return { kind: "parameter", from: pos, to: pos, parameter };
  }
  if (span) {
    if (span.source === "attr" && span.key === dslIntermediatesAttributeParameterKey) {
      return dslIntermediatesFieldCompletionContext(code, pos, span);
    }
    const parameters = metadata.parameters.filter((parameter) =>
      parameter.source === span.source && parameter.key === span.key
    );
    if (parameters.length !== 1) return null;
    const parameter = parameters[0];
    if (parameter.definition.kind === "number") {
      return numberFieldCompletionContext(code, pos, span.start, parameter);
    }
    if (parameter.definition.kind === "reference") {
      const coordinateContext = dslCoordinateLiteralCompletionContext(code, pos, span, parameter);
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
