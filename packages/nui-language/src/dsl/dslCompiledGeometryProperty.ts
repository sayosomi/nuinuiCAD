import type { CompiledDslDocument } from "./dslDocument";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import type { DslSpan } from "./dslTypes";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { geometryPropertiesIn } from "../scalars/typedDependencyGraph";
import type { TypedScalarExpression, TypedScalarGeometryPropertyReferenceNode } from "../scalars/typedExpressionAst";

export type RootCompiledGeometryPropertyOccurrence = {
  statementIndex: number;
  span: DslSpan;
  elementNameSpan: DslSpan;
  propertySpan: DslSpan;
  elementName: string;
  elementId: string;
  property: string;
  targetSourceOrder: number;
  type: NonNullable<TypedScalarGeometryPropertyReferenceNode["type"]>;
};

/** Returns the compiler-owned logical value span for one numeric binding. */
export const numericValueSpan = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  parameterKey: string
): DslSpan | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;

  if (statement.kind === "element" || statement.kind === "group") {
    const elementId = compiled.statementMap?.elementIdByStatementIndex.get(statementIndex);
    const element = elementId
      ? compiled.document?.elements.find((candidate) => candidate.id === elementId)
      : undefined;
    return element ? resolveParameterValueSpan(logical.logicalText, element, parameterKey) : null;
  }

  if (statement.kind !== "layout" && statement.kind !== "print" && statement.kind !== "svg" && statement.kind !== "place") return null;
  const coordinate = parameterKey.match(/^(.+):(x|y)$/);
  const attributeKey = coordinate?.[1] ?? parameterKey;
  const outer = statement.payloadSpans[attributeKey];
  if (!outer) return null;
  return coordinate
    ? coordinateComponent(logical.logicalText, outer, coordinate[2] as "x" | "y")
    : outer;
};

const offsetSpan = (span: DslSpan, offset: number): DslSpan => ({
  start: span.start + offset,
  end: span.end + offset
});

const resolvedOccurrence = (
  statementIndex: number,
  reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>,
  offset: number
): RootCompiledGeometryPropertyOccurrence | null => {
  if (reference.elementId === null || reference.targetSourceOrder === null || reference.type === null) return null;
  return {
    statementIndex,
    span: offsetSpan(reference.span, offset),
    elementNameSpan: offsetSpan(reference.elementNameSpan, offset),
    propertySpan: offsetSpan(reference.propertySpan, offset),
    elementName: reference.elementName,
    elementId: reference.elementId,
    property: reference.property,
    targetSourceOrder: reference.targetSourceOrder,
    type: reference.type
  };
};

/**
 * Extracts valid geometry-property nodes from root scalar compiler carriers.
 * The typed nodes already contain resolved element identity, source order, and
 * type; this helper only translates their carrier-relative spans into the
 * statement-relative logical coordinate space used by exactPhysicalSpan.
 */
export const rootCompiledGeometryPropertyOccurrences = (
  compiled: CompiledDslDocument
): readonly RootCompiledGeometryPropertyOccurrence[] => {
  const result: RootCompiledGeometryPropertyOccurrence[] = [];
  const addExpression = (statementIndex: number, expression: TypedScalarExpression, offset: number) => {
    for (const reference of geometryPropertiesIn(expression)) {
      const occurrence = resolvedOccurrence(statementIndex, reference, offset);
      if (occurrence) result.push(occurrence);
    }
  };

  for (const [occurrenceKey, numeric] of compiled.numericBindings ?? []) {
    if (!numeric.typedExpression) continue;
    const occurrence = parsePropertyBindingOccurrenceKey(occurrenceKey);
    if (!occurrence) continue;
    const valueSpan = numericValueSpan(compiled, occurrence.statementIndex, numeric.parameterKey);
    if (valueSpan) addExpression(occurrence.statementIndex, numeric.typedExpression, valueSpan.start);
  }
  for (const [occurrenceKey, source] of compiled.propertyBindings ?? []) {
    const occurrence = parsePropertyBindingOccurrenceKey(occurrenceKey);
    if (occurrence && source.kind === "expression") addExpression(occurrence.statementIndex, source.expression, 0);
  }
  for (const [statementIndex, set] of compiled.setStatements ?? []) {
    addExpression(statementIndex, set.expression, 0);
  }

  return result;
};
