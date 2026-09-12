import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createModuleSemanticRangeIndex,
  moduleSemanticTargetKey,
  type ModuleSemanticTarget
} from "./moduleSemanticEditor";
import {
  parseDslReferenceToken,
  parseDslSourceReference,
  parseDslSourceReferenceAt,
  readDslReferencePathSegments
} from "./dslReferenceTokens";
import { parseGeometryArrayDeferredModuleExportId } from "./geometryArraySemanticAnalysis";
import {
  resolveSourceLexicalPathSegments,
  resolveSourceLexicalDeclaration,
  type SourceLexicalDeclaration
} from "./sourceLexicalNamespaceIndex";
import type {
  RecordFieldIdentity,
  RecordDefinitionSemantic,
  RecordValueExpressionSemantic
} from "./recordSemanticAnalysis";
import type {
  ModuleGeometryReferenceSemantic,
  ModuleGeometryValueExpressionSemantic,
  ModuleRecordReferenceSemantic,
  ModuleRecordFieldValueExpressionSemantic,
  ModuleRecordFieldSourceTarget,
  ModuleRecordValueExpressionSemantic,
  ModuleRecordSourceTarget,
  ModuleOptionalMemberReference,
  ModuleScalarExpressionSemantic,
  ModuleSourceTarget,
  ResolvedModuleRecordExport
} from "./moduleSemanticTypes";
import type { DslArraySemanticValue, GeometryArraySemanticValue } from "./geometryArraySemantics";
import type { GeometryArrayValueSemantic } from "./geometryArraySemanticAnalysis";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { isDslArrayValueType, isDslGeometryValueType, scalarExpressionTypeOfDslValueType } from "./dslValueTypes";
import { geometryPropertiesIn, referencesIn } from "../scalars/typedDependencyGraph";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { ElementId } from "../types/geometry";
import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";
import { numericValueSpan } from "./dslCompiledGeometryProperty";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";

export type DslSemanticIdentity =
  | { kind: "typed"; bindingId: BindingId }
  | { kind: "recordType"; statementId: string }
  | { kind: "recordValue"; statementId: string }
  | { kind: "recordField"; field: RecordFieldIdentity }
  | { kind: "module"; target: ModuleSemanticTarget }
  | { kind: "element"; elementId: ElementId }
  | { kind: "modifier"; name: string }
  | { kind: "transformationStage"; recipeId: string }
  | { kind: "source"; statementId: string };

export type DslSemanticOccurrence = {
  from: number;
  to: number;
  kind: "declaration" | "reference";
  identity: DslSemanticIdentity;
};

export type DslSemanticRange = { from: number; to: number };

export type DslSemanticOccurrenceIndex = {
  occurrences: readonly DslSemanticOccurrence[];
  declarationsByIdentity: ReadonlyMap<string, readonly DslSemanticRange[]>;
};

const physicalRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
): DslSemanticRange | null => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] ?? null : null;
};

export const dslSemanticIdentityKey = (identity: DslSemanticIdentity): string => {
  if (identity.kind === "typed") return `typed:${identity.bindingId}`;
  if (identity.kind === "recordType") return `recordType:${identity.statementId}`;
  if (identity.kind === "recordValue") return `recordValue:${identity.statementId}`;
  if (identity.kind === "recordField") return `recordField:${identity.field.recordStatementId}:${identity.field.fieldIndex}`;
  if (identity.kind === "element") return `element:${identity.elementId}`;
  if (identity.kind === "modifier") return `modifier:${identity.name}`;
  if (identity.kind === "transformationStage") return `transformationStage:${identity.recipeId}`;
  if (identity.kind === "source") return `source:${identity.statementId}`;
  return `module:${moduleSemanticTargetKey(identity.target)}`;
};

const statementIndexForId = (compiled: CompiledDslDocument, statementId: string) =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const elementIdForStatementIndex = (compiled: CompiledDslDocument, statementIndex: number): ElementId | null => {
  const elementId = compiled.statementMap?.elementIdByStatementIndex.get(statementIndex);
  return elementId && compiled.document?.elements.some((element) => element.id === elementId) ? elementId : null;
};

/** Map a compiler-owned Module target to the identity used by source editors. */
export const semanticIdentityForModuleTarget = (
  compiled: CompiledDslDocument,
  target: ModuleSemanticTarget
): DslSemanticIdentity | null => {
  if (target.kind === "documentBinding") return { kind: "typed", bindingId: target.bindingId };
  if (target.kind === "moduleSource") {
    const statementIndex = statementIndexForId(compiled, target.statementId);
    const elementId = statementIndex === undefined ? null : elementIdForStatementIndex(compiled, statementIndex);
    if (elementId) return { kind: "element", elementId };
  }
  return { kind: "module", target };
};

const elementIdentity = (compiled: CompiledDslDocument, elementId: string | null): DslSemanticIdentity | null =>
  elementId && compiled.document?.elements.some((element) => element.id === elementId)
    ? { kind: "element", elementId }
    : null;

const declarationIdentity = (
  compiled: CompiledDslDocument,
  declaration: SourceLexicalDeclaration
): DslSemanticIdentity | null => {
  const elementId = elementIdForStatementIndex(compiled, declaration.statementIndex);
  if (elementId) return { kind: "element", elementId };
  if (declaration.kind === "recordDefinition") return { kind: "recordType", statementId: declaration.statementId };
  if (declaration.kind === "recordValue") return { kind: "recordValue", statementId: declaration.statementId };
  if (
    declaration.kind === "group" ||
    declaration.kind === "geometry" ||
    declaration.kind === "conditionalGroup" ||
    declaration.kind === "forGroup" ||
    declaration.kind === "typedDeclaration"
  ) {
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    return statementId ? { kind: "module", target: { kind: "moduleSource", statementId } } : null;
  }
  if (
    declaration.kind === "profile" ||
    declaration.kind === "layout" ||
    declaration.kind === "print" ||
    declaration.kind === "svg"
  ) {
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    return statementId ? { kind: "source", statementId } : null;
  }
  return null;
};

type AddOccurrence = (
  kind: DslSemanticOccurrence["kind"],
  from: number,
  to: number,
  identity: DslSemanticIdentity | null
) => void;

const addPhysicalOccurrence = (
  add: AddOccurrence,
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number },
  identity: DslSemanticIdentity | null,
  kind: DslSemanticOccurrence["kind"]
) => {
  const physical = physicalRange(compiled, statementIndex, span);
  if (physical) add(kind, physical.from, physical.to, identity);
};

const addNumericGeometryPropertyOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  numeric: CompiledNumericBinding,
  addQualifiedPathOccurrences: (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => void
) => {
  if (!numeric.typedExpression) return;
  const valueSpan = numericValueSpan(compiled, statementIndex, numeric.parameterKey);
  if (!valueSpan) return;
  for (const reference of geometryPropertiesIn(numeric.typedExpression)) {
    const identity = elementIdentity(compiled, reference.elementId);
    if (!identity) continue;
    addQualifiedPathOccurrences(
      statementIndex,
      {
        start: valueSpan.start + reference.elementNameSpan.start,
        end: valueSpan.start + reference.elementNameSpan.end
      },
      identity
    );
  }
};

const addTypedGeometryPropertyOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  expression: TypedScalarExpression,
  addQualifiedPathOccurrences: (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => void
) => {
  for (const reference of geometryPropertiesIn(expression)) {
    const identity = elementIdentity(compiled, reference.elementId);
    if (identity) addQualifiedPathOccurrences(statementIndex, reference.elementNameSpan, identity);
  }
};

/** Record fields are source-semantic names, not hidden scalar bindings created
 * by record lowering. Keep those implementation bindings out of navigation
 * and rename candidates; the record occurrence pass below supplies the
 * nominal identities instead. */
const isSyntheticRecordBinding = (bindingId: string) =>
  bindingId.startsWith("record-field-binding:") || bindingId.startsWith("module-record-binding:");

const addTypedOccurrences = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis | undefined,
  add: AddOccurrence,
  addQualifiedPathOccurrences: (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => void
) => {
  const analysis = bindingAnalysis;
  if (!analysis) return;
  for (const binding of analysis.catalog.bindings) {
    const isNonGeometryArray = isDslArrayValueType(binding.declaredType) && !isDslGeometryValueType(binding.declaredType.elementType);
    if (binding.kind !== "typed" || !binding.nameSpan ||
        (scalarExpressionTypeOfDslValueType(binding.declaredType) === null && !isNonGeometryArray)) continue;
    addPhysicalOccurrence(add, compiled, binding.statementIndex, binding.nameSpan, { kind: "typed", bindingId: binding.id }, "declaration");
  }
  const addExpression = (statementIndex: number, expression: TypedScalarExpression) => {
    for (const reference of referencesIn(expression)) {
      if (!reference.bindingId) continue;
      if (isSyntheticRecordBinding(reference.bindingId)) continue;
      addPhysicalOccurrence(add, compiled, statementIndex, reference.nameSpan, {
        kind: "typed",
        bindingId: reference.bindingId
      }, "reference");
    }
    addTypedGeometryPropertyOccurrences(compiled, add, statementIndex, expression, addQualifiedPathOccurrences);
  };
  for (const statement of compiled.scalarProgram?.statements ?? []) {
    const statementIndex = analysis.catalog.bindingsById.get(statement.bindingId)?.statementIndex;
    if (statementIndex !== undefined) {
      addExpression(statementIndex, statement.declaration.initializer);
    }
  }
  for (const value of compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.genericValues ?? []) {
    if (value.value?.kind !== "map") continue;
    const binderIdentity: DslSemanticIdentity = { kind: "typed", bindingId: value.value.binderId };
    addPhysicalOccurrence(add, compiled, value.statementIndex, value.value.binderSpan, binderIdentity, "declaration");
    if (value.value.body) addExpression(value.statementIndex, value.value.body);
    const statement = compiled.statements[value.statementIndex];
    const logical = statement
      ? compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from)
      : undefined;
    const sourceText = logical?.logicalText.slice(value.value.sourceSpan.start, value.value.sourceSpan.end) ?? "";
    const sourceReference = parseDslSourceReference(sourceText);
    if (sourceReference.kind === "valid") {
      const path = parseDslReferenceToken(sourceReference.reference.pathText);
      const lookup = compiled.sourceLexicalNamespace
        ? resolveSourceLexicalPathSegments(compiled.sourceLexicalNamespace, value.statementIndex, path)
        : null;
      const sourceDeclaration = lookup?.lookup.kind === "resolved" ? lookup.lookup.declaration : null;
      const sourceBinding = sourceDeclaration?.kind === "typedDeclaration"
        ? compiled.bindingAnalysis?.catalog.bindings.find((candidate) =>
            candidate.kind === "typed" && candidate.statementIndex === sourceDeclaration.statementIndex && !isSyntheticRecordBinding(candidate.id)
          )
        : undefined;
      const sourceIdentity = sourceBinding
        ? { kind: "typed" as const, bindingId: sourceBinding.id }
        : sourceDeclaration
          ? declarationIdentity(compiled, sourceDeclaration)
          : null;
      addPhysicalOccurrence(add, compiled, value.statementIndex, {
        start: value.value.sourceSpan.start + 1,
        end: value.value.sourceSpan.end
      }, sourceIdentity, "reference");
    }
  }
  for (const reference of analysis.initializerReferences) {
    if (reference.resolution.kind !== "resolved" || !reference.span) continue;
    if (isSyntheticRecordBinding(reference.resolution.binding.id)) continue;
    const statementIndex = analysis.catalog.bindingsById.get(reference.fromBindingId)?.statementIndex;
    if (statementIndex === undefined) continue;
    addPhysicalOccurrence(add, compiled, statementIndex, {
      start: reference.span.start + 1,
      end: reference.span.end
    }, { kind: "typed", bindingId: reference.resolution.binding.id }, "reference");
  }
  for (const [occurrenceKey, source] of compiled.propertyBindings ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    if (source.kind === "binding") {
      if (isSyntheticRecordBinding(source.bindingId)) continue;
      addPhysicalOccurrence(add, compiled, statementIndex, source.nameSpan, { kind: "typed", bindingId: source.bindingId }, "reference");
    } else if (source.kind === "expression") {
      addExpression(statementIndex, source.expression);
    }
  }
  for (const [occurrenceKey, expression] of compiled.conditionalGroupConditions ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (Number.isInteger(statementIndex)) addExpression(statementIndex, expression);
  }
  for (const [statementIndex, analysisForSet] of compiled.setStatements ?? []) {
    if (analysisForSet.targetBindingId) {
      addPhysicalOccurrence(add, compiled, statementIndex, analysisForSet.targetSpan, {
        kind: "typed",
        bindingId: analysisForSet.targetBindingId
      }, "reference");
    }
    addExpression(statementIndex, analysisForSet.expression);
  }
  for (const [occurrenceKey, template] of compiled.textTemplates ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    for (const segment of template.segments) {
      if (segment.kind !== "hole" || segment.holeKind === "numeric") continue;
      addExpression(statementIndex, segment.expression);
    }
  }
  for (const [occurrenceKey, numeric] of compiled.numericBindings ?? []) {
    const occurrence = parsePropertyBindingOccurrenceKey(occurrenceKey);
    if (occurrence) addNumericGeometryPropertyOccurrences(compiled, add, occurrence.statementIndex, numeric, addQualifiedPathOccurrences);
    for (const reference of numeric.references) {
      const physical = reference.physicalNameSpan?.segments.length === 1
        ? reference.physicalNameSpan.segments[0]
        : null;
      if (physical && !isSyntheticRecordBinding(reference.bindingId)) add("reference", physical.from, physical.to, { kind: "typed", bindingId: reference.bindingId });
    }
  }
};

const addQualifiedPathOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  nameSpan: { start: number; end: number },
  finalTarget: DslSemanticIdentity | null
) => {
  const physical = physicalRange(compiled, statementIndex, nameSpan);
  const namespace = compiled.sourceLexicalNamespace;
  if (!physical || !namespace) return;
  const source = compiled.spans.sourceMap.source;
  const pathText = source.slice(physical.from, physical.to);
  const path = parseDslReferenceToken(pathText);
  const resolved = resolveSourceLexicalPathSegments(namespace, statementIndex, path);
  if (resolved.segments.length !== path.segments.length) return;
  const ranges = readDslReferencePathSegments(source, physical.from, physical.to);
  if (ranges.kind !== "valid" || ranges.segments.length !== resolved.segments.length) return;
  resolved.segments.forEach((declaration, index) => {
    const identity = declarationIdentity(compiled, declaration) ?? (index === resolved.segments.length - 1 ? finalTarget : null);
    const range = ranges.segments[index];
    if (range) add("reference", range.start, range.end, identity);
  });
};

const recordTypeIdentityOccurrence = (identity: string): DslSemanticIdentity => ({ kind: "recordType", statementId: identity });
const recordValueIdentityOccurrence = (identity: string): DslSemanticIdentity => ({ kind: "recordValue", statementId: identity });
const recordFieldIdentityOccurrence = (identity: RecordFieldIdentity): DslSemanticIdentity => ({ kind: "recordField", field: identity });

const isModuleBodyStatement = (compiled: CompiledDslDocument, statementIndex: number) => {
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  return statementId ? Boolean(analysis?.definitions.some((definition) => definition.bodyStatementIds.includes(statementId))) : false;
};

const addRecordConstructorOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  constructor: { nameSpan: { start: number; end: number }; targetTypeIdentity: string | null; fields: readonly { field: RecordFieldIdentity; labelSpan: { start: number; end: number } }[] }
) => {
  if (constructor.targetTypeIdentity) addPhysicalOccurrence(add, compiled, statementIndex, constructor.nameSpan, recordTypeIdentityOccurrence(constructor.targetTypeIdentity), "reference");
  for (const field of constructor.fields) {
    addPhysicalOccurrence(add, compiled, statementIndex, field.labelSpan, recordFieldIdentityOccurrence(field.field), "reference");
  }
};

const addNestedModuleRecordFieldOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  field: {
    expression?: ModuleScalarExpressionSemantic | null;
    valueExpression?: ModuleRecordFieldValueExpressionSemantic | null;
  }
) => {
  for (const nested of field.expression?.geometryProperties ?? []) {
    if (nested.target?.kind === "recordField") {
      addModuleRecordTarget(compiled, add, statementIndex, nested.target.record, nested.elementNameSpan);
      addPhysicalOccurrence(add, compiled, statementIndex, nested.propertySpan, recordFieldIdentityOccurrence(nested.target.field), "reference");
    }
  }
  const value = field.valueExpression;
  if (value?.kind !== "record" || value.expression?.kind !== "constructor") return;
  for (const nested of value.expression.constructor.fields) {
    addNestedModuleRecordFieldOccurrences(compiled, add, statementIndex, nested);
  }
};

const addRootRecordReferenceOccurrence = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  reference: { name: string; span: { start: number; end: number } },
  expectedTypeIdentity: string | null
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || isModuleBodyStatement(compiled, statementIndex)) return;
  const lookup = resolveSourceLexicalDeclaration(namespace, statementIndex, reference.name);
  if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
    addPhysicalOccurrence(add, compiled, statementIndex, {
      start: reference.span.start + 1,
      end: reference.span.end
    }, recordValueIdentityOccurrence(lookup.declaration.statementId), "reference");
    return;
  }
  const referenceRange = physicalRange(compiled, statementIndex, reference.span);
  if (!referenceRange) return;
  const source = compiled.spans.sourceMap.source;
  const parsed = parseDslSourceReference(source.slice(referenceRange.from, referenceRange.to));
  if (parsed.kind !== "valid" || parsed.reference.property !== null) return;
  const qualified = qualifiedModuleRecordExportAt(compiled, statementIndex, {
    from: referenceRange.from + parsed.reference.pathRange.start,
    to: referenceRange.from + parsed.reference.pathRange.end
  }, expectedTypeIdentity);
  if (!qualified) return;
  add("reference", qualified.instanceRange.from, qualified.instanceRange.to, {
    kind: "module",
    target: { kind: "moduleInstance", statementId: qualified.instanceStatementId }
  });
  add("reference", qualified.memberRange.from, qualified.memberRange.to, {
    kind: "module",
    target: { kind: "moduleSource", statementId: qualified.exportedStatementId }
  });
};

const addRootRecordCollectionIndexOccurrence = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  expression: Extract<ScalarExpressionAst, { kind: "collectionIndex" }>
) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  const lookup = resolveSourceLexicalDeclaration(namespace, statementIndex, expression.name);
  if (lookup.kind !== "resolved") return;
  if (lookup.declaration.kind !== "typedDeclaration") return;
  const binding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) =>
    candidate.kind === "typed" && candidate.statementIndex === lookup.declaration.statementIndex && !isSyntheticRecordBinding(candidate.id)
  );
  addPhysicalOccurrence(add, compiled, statementIndex, expression.nameSpan,
    binding
      ? { kind: "typed", bindingId: binding.id }
      : declarationIdentity(compiled, lookup.declaration),
    "reference");
};

const addRootRecordValueExpressionOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  expression: RecordValueExpressionSemantic,
  expectedTypeIdentity: string | null
) => {
  if (expression.kind === "constructor") {
    addRecordConstructorOccurrences(compiled, add, statementIndex, expression.constructor);
    return;
  }
  if (expression.kind === "reference") {
    addRootRecordReferenceOccurrence(compiled, add, statementIndex, expression.reference, expectedTypeIdentity);
    return;
  }
  if (expression.kind === "collectionIndex") {
    addRootRecordCollectionIndexOccurrence(compiled, add, statementIndex, expression.expression);
    return;
  }
  if (expression.kind === "if") {
    if (expression.thenBranch) addRootRecordValueExpressionOccurrences(compiled, add, statementIndex, expression.thenBranch, expectedTypeIdentity);
    if (expression.elseBranch) addRootRecordValueExpressionOccurrences(compiled, add, statementIndex, expression.elseBranch, expectedTypeIdentity);
    return;
  }
  if (expression.kind === "none") return;
  if (expression.kind === "coalesce") {
    if (expression.left) addRootRecordValueExpressionOccurrences(compiled, add, statementIndex, expression.left, expectedTypeIdentity);
    if (expression.right) addRootRecordValueExpressionOccurrences(compiled, add, statementIndex, expression.right, expectedTypeIdentity);
    return;
  }
  for (const arm of expression.arms) {
    if (arm.expression) addRootRecordValueExpressionOccurrences(compiled, add, statementIndex, arm.expression, expectedTypeIdentity);
  }
};

const addRecordOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  const records = namespace?.recordSemanticAnalysis;
  if (!namespace || !records) return;
  for (const definition of records.definitionsByStatementId.values()) {
    const statement = compiled.statements[definition.statementIndex];
    if (!statement) continue;
    if (statement.nameSpan) addPhysicalOccurrence(add, compiled, definition.statementIndex, statement.nameSpan, recordTypeIdentityOccurrence(definition.statementId), "declaration");
    for (const field of definition.fields) {
      addPhysicalOccurrence(add, compiled, definition.statementIndex, field.nameSpan, recordFieldIdentityOccurrence(field.identity), "declaration");
    }
  }

  for (const value of records.valuesByStatementId.values()) {
    const statement = compiled.statements[value.statementIndex];
    if (!statement) continue;
    if (statement.nameSpan) addPhysicalOccurrence(add, compiled, value.statementIndex, statement.nameSpan, recordValueIdentityOccurrence(value.statementId), "declaration");
    if (value.typeReference.typeIdentity) {
      addPhysicalOccurrence(add, compiled, value.statementIndex, value.typeReference.span, recordTypeIdentityOccurrence(value.typeReference.typeIdentity), "reference");
    }
    if (value.constructor) addRecordConstructorOccurrences(compiled, add, value.statementIndex, value.constructor);
    if (value.valueExpression) addRootRecordValueExpressionOccurrences(compiled, add, value.statementIndex, value.valueExpression, value.typeIdentity);
    if (value.reference && !isModuleBodyStatement(compiled, value.statementIndex)) {
      addRootRecordReferenceOccurrence(compiled, add, value.statementIndex, value.reference, value.typeIdentity);
    }
  }

  for (const parameter of records.moduleParameters) {
    if (parameter.typeReference.typeIdentity) {
      const statementIndex = statementIndexForId(compiled, parameter.definitionStatementId);
      if (statementIndex !== undefined) {
        addPhysicalOccurrence(add, compiled, statementIndex, parameter.typeReference.span, recordTypeIdentityOccurrence(parameter.typeReference.typeIdentity), "reference");
      }
    }
  }
};

const moduleParameterIdentity = (target: { definitionStatementId: string; parameterIndex: number }): DslSemanticIdentity => ({
  kind: "module",
  target: {
    kind: "moduleParameter",
    slot: {
      definitionStatementId: target.definitionStatementId,
      parameterIndex: target.parameterIndex
    }
  }
});

const addModuleRecordTarget = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  target: ModuleRecordSourceTarget,
  nameSpan?: { start: number; end: number }
) => {
  if (target.kind === "recordValue") {
    if (nameSpan) addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, recordValueIdentityOccurrence(target.statementId), "reference");
    return;
  }
  if (target.kind === "recordValueForBinder") {
    if (nameSpan) addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, {
      kind: "typed",
      bindingId: target.binderId
    }, "reference");
    return;
  }
  if (target.kind === "recordParameter") {
    if (nameSpan) addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, moduleParameterIdentity(target), "reference");
    return;
  }
  if (target.kind === "recordCollectionIndex") {
    const collection = target.collectionTarget;
    if (collection.kind === "deferredModuleCollectionExport") {
      addPhysicalOccurrence(add, compiled, statementIndex, collection.instanceSpan, {
        kind: "module",
        target: { kind: "moduleInstance", statementId: collection.instanceStatementId }
      }, "reference");
      addPhysicalOccurrence(add, compiled, statementIndex, collection.memberSpan, {
        kind: "module",
        target: { kind: "moduleSource", statementId: collection.exportedStatementId }
      }, "reference");
    } else if (collection.kind === "collectionParameter") {
      addPhysicalOccurrence(add, compiled, statementIndex, target.nameSpan, semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: { definitionStatementId: collection.definitionStatementId, parameterIndex: collection.parameterIndex }
      }), "reference");
    } else if (collection.kind === "collectionValue") {
      const declarationIndex = statementIndexForId(compiled, collection.statementId);
      const binding = declarationIndex === undefined
        ? undefined
        : compiled.bindingAnalysis?.catalog.bindings.find((candidate) =>
            candidate.kind === "typed" && candidate.statementIndex === declarationIndex && !isSyntheticRecordBinding(candidate.id)
          );
      addPhysicalOccurrence(add, compiled, statementIndex, target.nameSpan, binding
        ? { kind: "typed", bindingId: binding.id }
        : semanticIdentityForModuleTarget(compiled, {
            kind: "moduleSource",
            statementId: collection.statementId
          }), "reference");
    }
    return;
  }
  addPhysicalOccurrence(add, compiled, statementIndex, target.instanceSpan, {
    kind: "module",
    target: { kind: "moduleInstance", statementId: target.instanceStatementId }
  }, "reference");
  addPhysicalOccurrence(add, compiled, statementIndex, target.memberSpan, {
    kind: "module",
    target: { kind: "moduleSource", statementId: target.exportedStatementId }
  }, "reference");
};

type QualifiedModuleRecordExportOccurrence = {
  instanceRange: DslSemanticRange;
  memberRange: DslSemanticRange;
  instanceStatementId: string;
  exportedStatementId: string;
  exported: ResolvedModuleRecordExport;
};

/** Reuse Module semantic export ownership when a root record alias keeps a
 * qualified whole-record source reference outside the Module body path. */
const qualifiedModuleRecordExportAt = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  pathRange: DslSemanticRange,
  expectedTypeIdentity: string | null
): QualifiedModuleRecordExportOccurrence | null => {
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!namespace || !analysis) return null;
  const source = compiled.spans.sourceMap.source;
  const ranges = readDslReferencePathSegments(source, pathRange.from, pathRange.to);
  if (ranges.kind !== "valid" || ranges.segments.length !== 2) return null;
  const instanceSegment = ranges.segments[0];
  const memberSegment = ranges.segments[1];
  if (!instanceSegment || !memberSegment) return null;
  const instanceLookup = resolveSourceLexicalDeclaration(namespace, statementIndex, instanceSegment.name);
  if (instanceLookup.kind !== "resolved" || instanceLookup.declaration.kind !== "moduleInstance") return null;
  const instance = analysis.instancesByStatementId.get(instanceLookup.declaration.statementId);
  const definition = instance?.callee && analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const exported = definition?.exports.find((entry) => entry.kind === "record" && entry.name === memberSegment.name);
  if (!instance || !exported || exported.kind !== "record" || (expectedTypeIdentity !== null && exported.typeIdentity !== expectedTypeIdentity)) return null;
  return {
    instanceRange: { from: instanceSegment.start, to: instanceSegment.end },
    memberRange: { from: memberSegment.start, to: memberSegment.end },
    instanceStatementId: instance.statementId,
    exportedStatementId: exported.exportedStatementId,
    exported
  };
};

  const addModuleRecordReferenceOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  reference: ModuleRecordReferenceSemantic
) => {
  if (reference.target) {
    const nameSpan = reference.span.start < reference.span.end
      ? { start: reference.span.start + 1, end: reference.span.end }
      : reference.span;
    addModuleRecordTarget(compiled, add, statementIndex, reference.target, nameSpan);
  }
  if (reference.constructor) addRecordConstructorOccurrences(compiled, add, statementIndex, reference.constructor);
  for (const field of reference.constructor?.fields ?? []) {
    addNestedModuleRecordFieldOccurrences(compiled, add, statementIndex, field);
  }
};

/** The scalar compiler intentionally lowers record fields to hidden typed
 * bindings. Project only their authored source spans back to nominal record
 * identities; the hidden binding names themselves never become editor
 * occurrences. */
const addSyntheticRecordFieldOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  const records = namespace?.recordSemanticAnalysis;
  const catalog = compiled.bindingAnalysis?.catalog;
  if (!namespace || !records || !catalog) return;
  const source = compiled.spans.sourceMap.source;
  const addRecordFieldPathOccurrences = (
    definition: RecordDefinitionSemantic | null | undefined,
    start: number,
    fieldName: string
  ) => {
    let current = definition;
    let cursor = start;
    const parts = fieldName.split(".");
    for (const [index, part] of parts.entries()) {
      const field = current?.fields.find((candidate) => candidate.name === part);
      if (!field) return;
      add("reference", cursor, cursor + part.length, recordFieldIdentityOccurrence(field.identity));
      if (index === parts.length - 1) return;
      current = records.definitionsByStatementId.get(field.type.kind === "record" ? field.type.identity ?? "" : "") ?? null;
      cursor += part.length + 1;
    }
  };
  for (const statement of compiled.scalarProgram?.statements ?? []) {
    const statementIndex = catalog.bindingsById.get(statement.bindingId)?.statementIndex;
    if (statementIndex === undefined) continue;
    const moduleBody = isModuleBodyStatement(compiled, statementIndex);
    for (const reference of referencesIn(statement.declaration.initializer)) {
      if (!reference.bindingId || !isSyntheticRecordBinding(reference.bindingId)) continue;
      if (moduleBody) continue;
      const physical = physicalRange(compiled, statementIndex, reference.nameSpan);
      if (!physical) continue;
      const dot = source.indexOf(".", physical.from);
      if (dot < physical.from || dot >= physical.to) continue;
      const baseRange = { start: physical.from, end: dot };
      const fieldRange = { start: dot + 1, end: physical.to };
      const baseName = source.slice(baseRange.start, baseRange.end);
      const fieldName = source.slice(fieldRange.start, fieldRange.end);
      const lookup = resolveSourceLexicalDeclaration(namespace, statementIndex, baseName);
      if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
        const value = records.valuesByStatementId.get(lookup.declaration.statementId);
        const definition = value?.typeIdentity ? records.definitionsByStatementId.get(value.typeIdentity) : null;
        if (!value || !definition) continue;
        add("reference", baseRange.start, baseRange.end, recordValueIdentityOccurrence(value.statementId));
        addRecordFieldPathOccurrences(definition, fieldRange.start, fieldName);
        continue;
      }

      // A qualified Module record export is not part of the source lexical
      // namespace path, so resolve its instance/export through the existing
      // Module semantic owner while keeping the field nominal identity.
      const qualified = qualifiedModuleRecordExportAt(compiled, statementIndex, {
        from: baseRange.start,
        to: baseRange.end
      }, null);
      if (!qualified) continue;
      add("reference", qualified.instanceRange.from, qualified.instanceRange.to, {
        kind: "module",
        target: { kind: "moduleInstance", statementId: qualified.instanceStatementId }
      });
      add("reference", qualified.memberRange.from, qualified.memberRange.to, {
        kind: "module",
        target: { kind: "moduleSource", statementId: qualified.exportedStatementId }
      });
      addRecordFieldPathOccurrences(qualified.exported.definition, fieldRange.start, fieldName);
    }
  }
};

const geometryArrayValueIdentity = (
  compiled: CompiledDslDocument,
  statementId: string
): DslSemanticIdentity | null => semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId });

const geometryArrayParameterIdentity = (
  definitionStatementId: string,
  parameterIndex: number
): DslSemanticIdentity => ({
  kind: "module",
  target: {
    kind: "moduleParameter",
    slot: { definitionStatementId, parameterIndex }
  }
});

type ModuleGeometryOccurrenceInput = {
  span?: { start: number; end: number };
  nameSpan?: { start: number; end: number };
  elementNameSpan?: { start: number; end: number };
  propertySpan?: { start: number; end: number };
  target: unknown;
};

const addModuleGeometryValueExpressionOccurrences = (
  expression: ModuleGeometryValueExpressionSemantic,
  addGeometry: (reference: ModuleGeometryOccurrenceInput) => void
) => {
  const addScalar = (scalar: ModuleScalarExpressionSemantic | null) => {
    for (const property of scalar?.geometryProperties ?? []) addGeometry(property);
    for (const argument of scalar?.geometryBuiltinArguments ?? []) addGeometry(argument.reference);
  };
  const visitConstruction = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visitConstruction(child);
      return;
    }
    if ("expectedGeometryKind" in value && "resolution" in value && "span" in value) {
      addGeometry(value as ModuleGeometryReferenceSemantic);
      return;
    }
    if ("ast" in value && "geometryProperties" in value) {
      addScalar(value as ModuleScalarExpressionSemantic);
      return;
    }
    for (const child of Object.values(value)) visitConstruction(child);
  };
  const visit = (current: ModuleGeometryValueExpressionSemantic): void => {
    if (current.kind === "reference") {
      addGeometry(current.reference);
      return;
    }
    if (current.kind === "construction") {
      visitConstruction(current.construction);
      return;
    }
    if (current.kind === "if") {
      addScalar(current.condition);
      if (current.thenBranch) visit(current.thenBranch);
      if (current.elseBranch) visit(current.elseBranch);
      return;
    }
    if (current.kind === "none") return;
    if (current.kind === "coalesce") {
      visit(current.left);
      visit(current.right);
      return;
    }
    addScalar(current.scrutinee);
    for (const arm of current.arms) if (arm.expression) visit(arm.expression);
  };
  visit(expression);
};

const addGeometryArrayOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const analysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  if (!analysis) return;

  const parsedReferenceAt = (statementIndex: number, span: { start: number; end: number }) => {
    const statement = compiled.statements[statementIndex];
    const logical = statement
      ? compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from)
      : undefined;
    if (!logical) return null;
    const parsed = parseDslSourceReference(logical.logicalText.slice(span.start, span.end));
    if (parsed.kind !== "valid") return null;
    return {
      reference: parsed.reference,
      pathSpan: {
        start: span.start + parsed.reference.pathRange.start,
        end: span.start + parsed.reference.pathRange.end
      }
    };
  };

  const addReference = (
    statementIndex: number,
    span: { start: number; end: number },
    identity: DslSemanticIdentity | null,
    direct = false
  ) => {
    const parsed = parsedReferenceAt(statementIndex, span);
    if (!parsed || !identity) return;
    if (direct) {
      addPhysicalOccurrence(add, compiled, statementIndex, parsed.pathSpan, identity, "reference");
      return;
    }
    addQualifiedPathOccurrences(compiled, add, statementIndex, parsed.pathSpan, identity);
  };

  const parameterForValueId = (valueId: string) => analysis.moduleParameters.find((parameter) =>
    valueId === `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`
  ) ?? null;

  const addDeferredExportReference = (
    statementIndex: number,
    span: { start: number; end: number },
    instanceStatementId: string,
    exportName: string
  ) => {
    const parsed = parsedReferenceAt(statementIndex, span);
    if (!parsed) return;
    const physical = physicalRange(compiled, statementIndex, parsed.pathSpan);
    if (!physical) return;
    const source = compiled.spans.sourceMap.source;
    const ranges = readDslReferencePathSegments(source, physical.from, physical.to);
    if (ranges.kind !== "valid" || ranges.segments.length !== 2) return;
    const instanceRange = ranges.segments[0];
    if (instanceRange) add("reference", instanceRange.start, instanceRange.end, {
      kind: "module",
      target: { kind: "moduleInstance", statementId: instanceStatementId }
    });
    const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(instanceStatementId);
    const definitionIndex = instance?.callee?.definitionStatementIndex;
    const exported = definitionIndex === undefined
      ? null
      : analysis.values.find((value) =>
          value.ownerModuleDefinitionStatementIndex === definitionIndex &&
          value.exported &&
          value.name === exportName
        ) ?? null;
    const exportRange = ranges.segments[1];
    if (exportRange && exported) {
      add("reference", exportRange.start, exportRange.end, geometryArrayValueIdentity(compiled, exported.statementId));
    }
  };

  const visitNestedGeometryArrayValue = (
    statementIndex: number,
    value: NonNullable<GeometryArrayValueSemantic["value"]>
  ): void => {
    if (value.kind === "if") {
      visitNestedGeometryArrayValue(statementIndex, value.thenValue);
      visitNestedGeometryArrayValue(statementIndex, value.elseValue);
      return;
    }
    if (value.kind === "match") {
      for (const arm of value.arms) visitNestedGeometryArrayValue(statementIndex, arm.value);
      return;
    }
    if (value.kind === "coalesce") {
      visitNestedGeometryArrayValue(statementIndex, value.left);
      visitNestedGeometryArrayValue(statementIndex, value.right);
      return;
    }
    if (value.kind === "none") return;
    if (value.kind === "literal") {
      for (const member of value.members) {
        if (member.target.kind === "coordinate") continue;
        if (member.target.kind === "moduleParameter") {
          addReference(
            statementIndex,
            member.sourceSpan,
            geometryArrayParameterIdentity(member.target.definitionStatementId, member.target.parameterIndex),
            true
          );
          continue;
        }
        const elementId = elementIdForStatementIndex(compiled, member.target.statementIndex);
        const identity = elementIdentity(compiled, elementId) ?? geometryArrayValueIdentity(compiled, member.target.statementId);
        addReference(statementIndex, member.sourceSpan, identity);
      }
      return;
    }
    if (value.kind === "map") {
      const sourceValue = analysis.valuesByStatementId.get(value.sourceValueId);
      if (sourceValue) {
        addReference(statementIndex, value.sourceSpan, geometryArrayValueIdentity(compiled, sourceValue.statementId));
      } else {
        const parameter = parameterForValueId(value.sourceValueId);
        if (parameter) {
          addReference(statementIndex, value.sourceSpan, geometryArrayParameterIdentity(parameter.definitionStatementId, parameter.parameterIndex), true);
        } else {
          const deferred = parseGeometryArrayDeferredModuleExportId(value.sourceValueId);
          if (deferred) addDeferredExportReference(statementIndex, value.sourceSpan, deferred.instanceStatementId, deferred.exportName);
        }
      }
      const binderIdentity: DslSemanticIdentity = { kind: "typed", bindingId: value.binderId };
      addPhysicalOccurrence(add, compiled, statementIndex, value.binderSpan, binderIdentity, "declaration");
      if (value.body) {
        addModuleGeometryValueExpressionOccurrences(value.body, (reference) => {
          const target = reference.target as ModuleSourceTarget | null;
          const nameSpan = reference.nameSpan ?? reference.elementNameSpan;
          if (!nameSpan || !target || !reference.span) return;
          if (target.kind === "geometryValueForBinder") {
            const physical = physicalRange(compiled, statementIndex, nameSpan);
            if (!physical) return;
            const from = compiled.spans.sourceMap.source[physical.from] === "@" ? physical.from + 1 : physical.from;
            add("reference", from, physical.to, binderIdentity);
          } else if (target.kind === "sourceGeometry" || target.kind === "geometryValue") {
            addReference(statementIndex, reference.span, geometryArrayValueIdentity(compiled, target.statementId));
          } else if (target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty") {
            addQualifiedPathOccurrences(compiled, add, statementIndex, nameSpan, geometryArrayValueIdentity(compiled, target.statementId));
          }
        });
      }
      return;
    }
    const targetValue = analysis.valuesByStatementId.get(value.targetValueId);
    if (targetValue) {
      addReference(statementIndex, value.sourceSpan, geometryArrayValueIdentity(compiled, targetValue.statementId));
      return;
    }
    const parameter = parameterForValueId(value.targetValueId);
    if (parameter) {
      addReference(statementIndex, value.sourceSpan, geometryArrayParameterIdentity(parameter.definitionStatementId, parameter.parameterIndex), true);
      return;
    }
    const deferred = parseGeometryArrayDeferredModuleExportId(value.targetValueId);
    if (deferred) addDeferredExportReference(statementIndex, value.sourceSpan, deferred.instanceStatementId, deferred.exportName);
  };

  for (const value of analysis.values) {
    const statement = compiled.statements[value.statementIndex];
    if (!statement?.nameSpan) continue;
    const valueIdentity = geometryArrayValueIdentity(compiled, value.statementId);
    addPhysicalOccurrence(add, compiled, value.statementIndex, statement.nameSpan, valueIdentity, "declaration");
    if (!value.value) continue;

    if (value.value.kind === "literal") {
      for (const member of value.value.members) {
        if (member.target.kind === "coordinate") continue;
        if (member.target.kind === "moduleParameter") {
          addReference(
            value.statementIndex,
            member.sourceSpan,
            geometryArrayParameterIdentity(member.target.definitionStatementId, member.target.parameterIndex),
            true
          );
          continue;
        }
        const elementId = elementIdForStatementIndex(compiled, member.target.statementIndex);
        const identity = elementIdentity(compiled, elementId) ?? geometryArrayValueIdentity(compiled, member.target.statementId);
        addReference(value.statementIndex, member.sourceSpan, identity);
      }
      continue;
    }

    if (value.value.kind === "map") {
      const sourceValue = analysis.valuesByStatementId.get(value.value.sourceValueId);
      if (sourceValue) {
        addReference(value.statementIndex, value.value.sourceSpan, geometryArrayValueIdentity(compiled, sourceValue.statementId));
      } else {
        const parameter = parameterForValueId(value.value.sourceValueId);
        if (parameter) {
          addReference(
            value.statementIndex,
            value.value.sourceSpan,
            geometryArrayParameterIdentity(parameter.definitionStatementId, parameter.parameterIndex),
            true
          );
        } else {
          const deferred = parseGeometryArrayDeferredModuleExportId(value.value.sourceValueId);
          if (deferred) addDeferredExportReference(value.statementIndex, value.value.sourceSpan, deferred.instanceStatementId, deferred.exportName);
        }
      }
      const binderIdentity: DslSemanticIdentity = { kind: "typed", bindingId: value.value.binderId };
      addPhysicalOccurrence(add, compiled, value.statementIndex, value.value.binderSpan, binderIdentity, "declaration");
      if (value.value.body) {
        addModuleGeometryValueExpressionOccurrences(value.value.body, (reference) => {
          const target = reference.target as ModuleSourceTarget | null;
          if (target?.kind === "geometryValueForBinder") {
            const nameSpan = reference.nameSpan ?? reference.elementNameSpan;
            if (!nameSpan) return;
            const physical = physicalRange(compiled, value.statementIndex, nameSpan);
            if (!physical) return;
            const from = compiled.spans.sourceMap.source[physical.from] === "@" ? physical.from + 1 : physical.from;
            add("reference", from, physical.to, binderIdentity);
            return;
          }
          const nameSpan = reference.nameSpan ?? reference.elementNameSpan;
          if (!nameSpan || !target || !reference.span) return;
          if (target.kind === "sourceGeometry" || target.kind === "geometryValue") {
            addReference(value.statementIndex, reference.span, geometryArrayValueIdentity(compiled, target.statementId));
            return;
          }
          if (target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty") {
            addQualifiedPathOccurrences(compiled, add, value.statementIndex, nameSpan, geometryArrayValueIdentity(compiled, target.statementId));
          }
        });
      }
      continue;
    }
    if (value.value.kind === "if" || value.value.kind === "match") {
      visitNestedGeometryArrayValue(value.statementIndex, value.value);
      continue;
    }
    if (value.value.kind === "coalesce") {
      visitNestedGeometryArrayValue(value.statementIndex, value.value.left);
      visitNestedGeometryArrayValue(value.statementIndex, value.value.right);
      continue;
    }
    if (value.value.kind === "none") continue;
    const targetValue = analysis.valuesByStatementId.get(value.value.targetValueId);
    if (targetValue) {
      addReference(value.statementIndex, value.value.sourceSpan, geometryArrayValueIdentity(compiled, targetValue.statementId));
      continue;
    }
    const parameter = parameterForValueId(value.value.targetValueId);
    if (parameter) {
      addReference(
        value.statementIndex,
        value.value.sourceSpan,
        geometryArrayParameterIdentity(parameter.definitionStatementId, parameter.parameterIndex),
        true
      );
      continue;
    }
    const deferred = parseGeometryArrayDeferredModuleExportId(value.value.targetValueId);
    if (deferred) {
      addDeferredExportReference(value.statementIndex, value.value.sourceSpan, deferred.instanceStatementId, deferred.exportName);
    }
  }
};

const addGeometryArrayConsumerOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = namespace?.geometryArraySemanticAnalysis;
  const document = compiled.document;
  if (!namespace || !analysis || !document) return;

  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "element") continue;
    const elementId = elementIdForStatementIndex(compiled, statementIndex);
    const element = elementId ? document.elements.find((candidate) => candidate.id === elementId) : undefined;
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!element || element.type !== "joinedPath" || !logical) continue;

    for (const definition of getParameterDefinitions(element)) {
      if (definition.kind !== "lineReferenceList") continue;
      const valueSpan = resolveParameterValueSpan(logical.logicalText, element, definition.key);
      if (!valueSpan) continue;
      const parsed = parseDslSourceReference(logical.logicalText.slice(valueSpan.start, valueSpan.end));
      if (parsed.kind !== "valid" || parsed.reference.property) continue;
      const path = parseDslReferenceToken(parsed.reference.pathText);
      const resolved = resolveSourceLexicalPathSegments(namespace, statementIndex, path);
      if (resolved.segments.length !== path.segments.length) continue;
      const declaration = resolved.segments[resolved.segments.length - 1];
      if (!declaration || declaration.kind !== "typedDeclaration") continue;
      if (!analysis.valuesByStatementIndex.has(declaration.statementIndex)) continue;
      addQualifiedPathOccurrences(compiled, add, statementIndex, {
        start: valueSpan.start + parsed.reference.pathRange.start,
        end: valueSpan.start + parsed.reference.pathRange.end
      }, null);
    }
  }
};

const addModuleSemanticPathOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return;
  const addGeometry = (statementIndex: number, reference: { nameSpan?: { start: number; end: number }; elementNameSpan?: { start: number; end: number }; propertySpan?: { start: number; end: number }; target: unknown }) => {
    const nameSpan = reference.nameSpan ?? reference.elementNameSpan;
    if (!nameSpan || !reference.target) return;
    const target = reference.target as ModuleSourceTarget;
    if (target.kind === "recordField") {
      const recordTarget = reference.target as Extract<ModuleScalarExpressionSemantic["geometryProperties"][number]["target"], { kind: "recordField" }>;
      const property = reference as ModuleScalarExpressionSemantic["geometryProperties"][number];
      if (recordTarget.fieldPath && recordTarget.fieldPath.length > 1 && property.propertySpan) {
        addRecordFieldReference(statementIndex, {
          nameSpan: { start: nameSpan.start, end: property.propertySpan.end },
          target: recordTarget
        });
        return;
      }
      const baseSpan = property.propertySpan
        ? { start: nameSpan.start, end: Math.max(nameSpan.start, property.propertySpan.start - 1) }
        : nameSpan;
      addModuleRecordTarget(compiled, add, statementIndex, recordTarget.record, baseSpan);
      if (property.propertySpan) addPhysicalOccurrence(add, compiled, statementIndex, property.propertySpan, recordFieldIdentityOccurrence(recordTarget.field), "reference");
      return;
    }
    if (target.kind === "parameter" || target.kind === "parameterProperty") {
      const parameterTarget = target as { definitionStatementId: string; parameterIndex: number };
      const identity = semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: parameterTarget.definitionStatementId,
          parameterIndex: parameterTarget.parameterIndex
        }
      });
      if (identity) addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, identity, "reference");
      return;
    }
    if (target.kind === "collectionValueLength") {
      const identity = semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId });
      addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, identity, "reference");
      return;
    }
    if (target.kind === "collectionParameterLength") {
      const identity = semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: { definitionStatementId: target.definitionStatementId, parameterIndex: target.parameterIndex }
      });
      addPhysicalOccurrence(add, compiled, statementIndex, nameSpan, identity, "reference");
      return;
    }
    if (target.kind === "deferredModuleCollectionExportLength") {
      const physical = physicalRange(compiled, statementIndex, nameSpan);
      const source = compiled.spans.sourceMap.source;
      const ranges = physical ? readDslReferencePathSegments(source, physical.from, physical.to) : null;
      if (physical && ranges?.kind === "valid" && ranges.segments.length === 2) {
        const instanceRange = ranges.segments[0];
        const memberRange = ranges.segments[1];
        if (instanceRange) add("reference", instanceRange.start, instanceRange.end, {
          kind: "module",
          target: { kind: "moduleInstance", statementId: target.instanceStatementId }
        });
        if (memberRange) add("reference", memberRange.start, memberRange.end, {
          kind: "module",
          target: { kind: "moduleSource", statementId: target.exportedStatementId }
        });
      }
      return;
    }
    if (target.kind === "geometryValueForBinder") {
      const physical = physicalRange(compiled, statementIndex, nameSpan);
      if (!physical) return;
      const from = compiled.spans.sourceMap.source[physical.from] === "@" ? physical.from + 1 : physical.from;
      add("reference", from, physical.to, { kind: "typed", bindingId: target.binderId });
      return;
    }
    let finalTarget: DslSemanticIdentity | null = null;
    if (
      target.kind === "geometryValue" ||
      target.kind === "sourceGeometry" ||
      target.kind === "sourceGeometryProperty" ||
      target.kind === "forGroupOccurrence" ||
      target.kind === "forGroupOccurrenceProperty"
    ) {
      finalTarget = target.statementId
        ? semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
        : null;
    }
    addQualifiedPathOccurrences(compiled, add, statementIndex, nameSpan, finalTarget);
  };
  const addRecordFieldReference = (
    statementIndex: number,
    reference: { nameSpan: { start: number; end: number }; target: ModuleRecordFieldSourceTarget }
  ) => {
    const physical = physicalRange(compiled, statementIndex, reference.nameSpan);
    if (!physical) return;
    const source = compiled.spans.sourceMap.source;
    const firstDot = source.indexOf(".", physical.from);
    if (firstDot < physical.from || firstDot >= physical.to) return;
    const baseRange = { start: physical.from, end: firstDot };
    addModuleRecordTarget(compiled, add, statementIndex, reference.target.record, baseRange);
    const fieldPath = reference.target.fieldPath ?? [reference.target.field];
    const fieldRanges: { start: number; end: number }[] = [];
    let cursor = firstDot + 1;
    while (cursor < physical.to && fieldRanges.length < fieldPath.length) {
      const nextDot = source.indexOf(".", cursor);
      const end = nextDot >= cursor && nextDot < physical.to ? nextDot : physical.to;
      fieldRanges.push({ start: cursor, end });
      cursor = end + 1;
    }
    for (const [index, identity] of fieldPath.entries()) {
      const range = fieldRanges[index];
      if (!range) return;
      add("reference", range.start, range.end, recordFieldIdentityOccurrence(identity));
    }
  };
  const addOptionalMember = (statementIndex: number, reference: ModuleOptionalMemberReference) => {
    const target = reference.target;
    if (!target) return;
    const receiverNameSpan = {
      start: reference.receiverSpan.start + 1,
      end: reference.receiverSpan.end
    };
    if (target.kind === "recordField") {
      addModuleRecordTarget(compiled, add, statementIndex, target.record, receiverNameSpan ?? undefined);
      addPhysicalOccurrence(add, compiled, statementIndex, reference.memberSpan, recordFieldIdentityOccurrence(target.field), "reference");
      return;
    }
    if (target.kind === "deferredModuleCollectionExportLength") {
      addPhysicalOccurrence(add, compiled, statementIndex, target.instanceSpan, {
        kind: "module",
        target: { kind: "moduleInstance", statementId: target.instanceStatementId }
      }, "reference");
      addPhysicalOccurrence(add, compiled, statementIndex, target.memberSpan, {
        kind: "module",
        target: { kind: "moduleSource", statementId: target.exportedStatementId }
      }, "reference");
      return;
    }
    if (target.kind === "deferredModuleExportProperty") {
      addPhysicalOccurrence(add, compiled, statementIndex, target.instanceSpan, {
        kind: "module",
        target: { kind: "moduleInstance", statementId: target.instanceStatementId }
      }, "reference");
      return;
    }
    let identity: DslSemanticIdentity | null = null;
    if (target.kind === "geometryValueForBinder") {
      identity = { kind: "typed", bindingId: target.binderId };
    } else if (target.kind === "collectionParameterLength" || target.kind === "parameterProperty") {
      identity = moduleParameterIdentity(target);
    } else if ("statementId" in target) {
      identity = semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId });
    }
    if (identity && receiverNameSpan) addPhysicalOccurrence(add, compiled, statementIndex, receiverNameSpan, identity, "reference");
  };
  const addRecordMapScalarExpression = (statementIndex: number, expression: ModuleScalarExpressionSemantic) => {
    for (const reference of expression.references) {
      const target = reference.target;
      if (target?.kind === "recordField") {
        addRecordFieldReference(statementIndex, { nameSpan: reference.nameSpan, target });
        continue;
      }
      const recordTarget = target as ModuleRecordSourceTarget | null;
      if (recordTarget?.kind === "recordValue" || recordTarget?.kind === "recordValueForBinder" ||
          recordTarget?.kind === "recordParameter" || recordTarget?.kind === "recordCollectionIndex") {
        addModuleRecordTarget(compiled, add, statementIndex, recordTarget, reference.nameSpan);
      } else {
        addCollectionIndexBase(statementIndex, reference);
        addRootScalarReference(statementIndex, reference);
      }
    }
    for (const reference of expression.geometryProperties) addGeometry(statementIndex, reference);
    for (const reference of expression.optionalMembers ?? []) addOptionalMember(statementIndex, reference);
  };
  const addCollectionIndexBase = (statementIndex: number, reference: ModuleScalarExpressionSemantic["references"][number]) => {
    const target = reference.target;
    if (!target) return;
    if (target.kind === "collectionValue") {
      const declarationIndex = statementIndexForId(compiled, target.statementId);
      const binding = declarationIndex === undefined
        ? undefined
        : compiled.bindingAnalysis?.catalog.bindings.find((candidate) =>
            candidate.kind === "typed" && candidate.statementIndex === declarationIndex && !isSyntheticRecordBinding(candidate.id)
          );
      addPhysicalOccurrence(add, compiled, statementIndex, reference.nameSpan, binding
        ? { kind: "typed", bindingId: binding.id }
        : semanticIdentityForModuleTarget(compiled, {
            kind: "moduleSource",
            statementId: target.statementId
          }), "reference");
      return;
    }
    if (target.kind === "collectionParameter") {
      addPhysicalOccurrence(add, compiled, statementIndex, reference.nameSpan, semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: { definitionStatementId: target.definitionStatementId, parameterIndex: target.parameterIndex }
      }), "reference");
      return;
    }
    if (target.kind === "deferredModuleCollectionExport") {
      addPhysicalOccurrence(add, compiled, statementIndex, target.instanceSpan, {
        kind: "module",
        target: { kind: "moduleInstance", statementId: target.instanceStatementId }
      }, "reference");
      addPhysicalOccurrence(add, compiled, statementIndex, target.memberSpan, {
        kind: "module",
        target: { kind: "moduleSource", statementId: target.exportedStatementId }
      }, "reference");
    }
  };
  const addRecordValueExpression = (statementIndex: number, expression: ModuleRecordValueExpressionSemantic): void => {
    if (expression.kind === "constructor") {
      addRecordConstructorOccurrences(compiled, add, statementIndex, expression.constructor);
      for (const field of expression.constructor.fields) {
        for (const reference of field.expression?.references ?? []) {
          if (reference.target?.kind === "recordField") {
            addRecordFieldReference(statementIndex, { nameSpan: reference.nameSpan, target: reference.target });
            continue;
          }
          addCollectionIndexBase(statementIndex, reference);
        }
        for (const reference of field.expression?.geometryProperties ?? []) addGeometry(statementIndex, reference);
        if (field.valueExpression?.kind !== "scalar") {
          addRecordFieldValueExpressionOccurrences(statementIndex, field.valueExpression);
        }
      }
      return;
    }
    if (expression.kind === "reference" || expression.kind === "collectionIndex") {
      addModuleRecordReferenceOccurrences(compiled, add, statementIndex, expression.reference);
      return;
    }
    if (expression.kind === "if") {
      for (const reference of expression.condition?.references ?? []) addCollectionIndexBase(statementIndex, reference);
      for (const reference of expression.condition?.geometryProperties ?? []) addGeometry(statementIndex, reference);
      if (expression.thenBranch) addRecordValueExpression(statementIndex, expression.thenBranch);
      if (expression.elseBranch) addRecordValueExpression(statementIndex, expression.elseBranch);
      return;
    }
    if (expression.kind === "none") return;
    if (expression.kind === "coalesce") {
      if (expression.left) addRecordValueExpression(statementIndex, expression.left);
      if (expression.right) addRecordValueExpression(statementIndex, expression.right);
      return;
    }
    for (const reference of expression.scrutinee?.references ?? []) addCollectionIndexBase(statementIndex, reference);
    for (const reference of expression.scrutinee?.geometryProperties ?? []) addGeometry(statementIndex, reference);
    for (const arm of expression.arms) if (arm.expression) addRecordValueExpression(statementIndex, arm.expression);
  };
  const addRootScalarReference = (statementIndex: number, reference: ModuleScalarExpressionSemantic["references"][number]) => {
    const target = reference.target;
    if (target?.kind !== "documentBinding") return;
    addPhysicalOccurrence(add, compiled, statementIndex, reference.nameSpan, semanticIdentityForModuleTarget(compiled, {
      kind: "documentBinding",
      bindingId: target.bindingId
    }), "reference");
  };
  const addCollectionControlFlowOccurrences = (
    statementIndex: number,
    value: DslArraySemanticValue<unknown> | GeometryArraySemanticValue<unknown>
  ): void => {
    const addScalar = (expression: ModuleScalarExpressionSemantic | undefined) => {
      for (const reference of expression?.references ?? []) {
        addCollectionIndexBase(statementIndex, reference);
        addRootScalarReference(statementIndex, reference);
      }
      for (const property of expression?.geometryProperties ?? []) addGeometry(statementIndex, property);
    };
    const addCollectionSource = (sourceSpan: { start: number; end: number }, targetValueId: string) => {
      const sourceValue = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.genericValuesByStatementId.get(targetValueId)
        ?? compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementId.get(targetValueId);
      if (!sourceValue) return;
      const declarationIndex = statementIndexForId(compiled, sourceValue.statementId);
      const binding = declarationIndex === undefined
        ? undefined
        : compiled.bindingAnalysis?.catalog.bindings.find((candidate) =>
            candidate.kind === "typed" && candidate.statementIndex === declarationIndex && !isSyntheticRecordBinding(candidate.id)
          );
      addPhysicalOccurrence(add, compiled, statementIndex, { start: sourceSpan.start + 1, end: sourceSpan.end },
        binding
          ? { kind: "typed", bindingId: binding.id }
          : semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: sourceValue.statementId }),
        "reference");
    };
    if (value.kind === "literal") {
      for (const member of value.members) {
        const target = member.target as {
          kind: string;
          statementId?: string;
          definitionStatementId?: string;
          parameterIndex?: number;
        };
        if (target.kind === "scalarValue" || target.kind === "recordValue") {
          if (target.statementId) addCollectionSource(member.sourceSpan, target.statementId);
        } else if (target.kind === "moduleParameterValue" && target.definitionStatementId !== undefined && target.parameterIndex !== undefined) {
          addPhysicalOccurrence(add, compiled, statementIndex, { start: member.sourceSpan.start + 1, end: member.sourceSpan.end }, {
            kind: "module",
            target: {
              kind: "moduleParameter",
              slot: { definitionStatementId: target.definitionStatementId, parameterIndex: target.parameterIndex }
            }
          }, "reference");
        }
      }
      return;
    }
    if (value.kind === "alias") {
      addCollectionSource(value.sourceSpan, value.targetValueId);
      return;
    }
    if (value.kind === "if") {
      addScalar(value.condition);
      addCollectionControlFlowOccurrences(statementIndex, value.thenValue);
      addCollectionControlFlowOccurrences(statementIndex, value.elseValue);
      return;
    }
    if (value.kind === "match") {
      addScalar(value.scrutinee);
      for (const arm of value.arms) addCollectionControlFlowOccurrences(statementIndex, arm.value);
    }
  };
  const addRecordFieldValueExpressionOccurrences = (
    statementIndex: number,
    expression: ModuleRecordFieldValueExpressionSemantic | null | undefined
  ): void => {
    if (!expression) return;
    if (expression.kind === "scalar") {
      addRecordMapScalarExpression(statementIndex, expression.expression);
      return;
    }
    if (expression.kind === "geometry") {
      if (expression.expression) {
        addModuleGeometryValueExpressionOccurrences(expression.expression, (reference) => addGeometry(statementIndex, reference));
      }
      return;
    }
    if (expression.kind === "record") {
      if (expression.expression) addRecordValueExpression(statementIndex, expression.expression);
      return;
    }
    const value = expression.value;
    if (value && typeof value === "object") {
      const kind = (value as { kind?: string }).kind;
      if (kind === "if" || kind === "match") {
        addCollectionControlFlowOccurrences(statementIndex, value as DslArraySemanticValue<unknown> | GeometryArraySemanticValue<unknown>);
      }
    }
  };
  const collectionAnalysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  for (const value of collectionAnalysis?.genericValues ?? []) {
    if (value.value?.kind === "if" || value.value?.kind === "match") {
      addCollectionControlFlowOccurrences(value.statementIndex, value.value);
    }
  }
  for (const value of collectionAnalysis?.values ?? []) {
    if (value.value?.kind === "if" || value.value?.kind === "match") {
      addCollectionControlFlowOccurrences(value.statementIndex, value.value);
    }
  }
  for (const mapped of analysis.mappedRecordCollectionBodies) {
    for (const field of mapped.fields) addRecordMapScalarExpression(mapped.statementIndex, field.body);
  }
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of references) addGeometry(statementIndex, reference.reference);
  }
  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of site.expression.references) {
      if (reference.target?.kind === "recordField") {
        addRecordFieldReference(statementIndex, { nameSpan: reference.nameSpan, target: reference.target });
        continue;
      }
      addCollectionIndexBase(statementIndex, reference);
      const statement = compiled.statements[statementIndex];
      if (statement?.kind === "typedDeclaration" && isDslGeometryValueType(statement.valueType)) {
        addRootScalarReference(statementIndex, reference);
      }
    }
    for (const reference of site.expression.geometryProperties) addGeometry(statementIndex, reference);
    for (const reference of site.expression.optionalMembers ?? []) addOptionalMember(statementIndex, reference);
  }
  for (const recordValue of analysis.rootRecordValuesByStatementId.values()) {
    if (recordValue.valueExpression) addRecordValueExpression(recordValue.value.statementIndex, recordValue.valueExpression);
  }
  for (const [statementId, site] of analysis.rootParentReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined || !site.reference.nameSpan || !site.reference.target) continue;
    const target = site.reference.target;
    const finalTarget = target.kind === "sourceContainer"
      ? semanticIdentityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
      : null;
    addQualifiedPathOccurrences(compiled, add, statementIndex, site.reference.nameSpan, finalTarget);
  }
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const reference of body.geometryReferences) addGeometry(body.statementIndex, reference.reference);
      for (const site of body.scalarExpressions) {
        for (const reference of site.expression.references) addCollectionIndexBase(body.statementIndex, reference);
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
        for (const reference of site.expression.optionalMembers ?? []) addOptionalMember(body.statementIndex, reference);
      }
      for (const site of body.textTemplateHoles) {
        for (const reference of site.expression.references) addCollectionIndexBase(body.statementIndex, reference);
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
        for (const reference of site.expression.optionalMembers ?? []) addOptionalMember(body.statementIndex, reference);
      }
    }
    for (const mapped of definition.mappedGeometryCollectionBodies ?? []) {
      addModuleGeometryValueExpressionOccurrences(mapped.body, (reference) => addGeometry(mapped.statementIndex, reference));
    }
    for (const mapped of definition.mappedRecordCollectionBodies ?? []) {
      for (const field of mapped.fields) addRecordMapScalarExpression(mapped.statementIndex, field.body);
    }
    for (const recordValue of definition.recordValues) {
      if (recordValue.target && recordValue.value.reference) {
        addModuleRecordTarget(compiled, add, recordValue.value.statementIndex, recordValue.target, {
          start: recordValue.value.reference.span.start + 1,
          end: recordValue.value.reference.span.end
        });
      }
      if (recordValue.value.constructor) addRecordConstructorOccurrences(compiled, add, recordValue.value.statementIndex, recordValue.value.constructor);
      if (recordValue.valueExpression) addRecordValueExpression(recordValue.value.statementIndex, recordValue.valueExpression);
      for (const field of recordValue.fields) {
        for (const reference of field.expression?.geometryProperties ?? []) addGeometry(recordValue.value.statementIndex, reference);
        for (const reference of field.expression?.optionalMembers ?? []) addOptionalMember(recordValue.value.statementIndex, reference);
      }
      for (const field of recordValue.fieldExpressions) {
        for (const reference of field.expression?.references ?? []) {
          if (reference.target?.kind === "recordField") {
            addRecordFieldReference(recordValue.value.statementIndex, { nameSpan: reference.nameSpan, target: reference.target });
            continue;
          }
          addCollectionIndexBase(recordValue.value.statementIndex, reference);
        }
        for (const reference of field.expression?.geometryProperties ?? []) addGeometry(recordValue.value.statementIndex, reference);
        for (const reference of field.expression?.optionalMembers ?? []) addOptionalMember(recordValue.value.statementIndex, reference);
      }
    }
  }

  for (const instance of analysis.instances) {
    for (const binding of instance.parameterBindings) {
      if (binding.value?.kind === "record") {
        addModuleRecordReferenceOccurrences(compiled, add, instance.statementIndex, binding.value.reference);
      }
    }
  }
};

const addModuleOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const semanticCompiled = compiled.moduleSemanticAnalysis || !compiled.sourceSemanticAnalysis
    ? compiled
    : { ...compiled, moduleSemanticAnalysis: compiled.sourceSemanticAnalysis };
  const index = createModuleSemanticRangeIndex(semanticCompiled);
  const source = compiled.spans.sourceMap.source;
  const recordValueStatementIds = new Set(
    compiled.sourceLexicalNamespace?.allDeclarations
      .filter((declaration) => declaration.kind === "recordValue")
      .map((declaration) => declaration.statementId)
  );
  for (const token of index.tokens) {
    if (token.target.kind === "moduleSource" && recordValueStatementIds.has(token.target.statementId)) continue;
    const identity = semanticIdentityForModuleTarget(compiled, token.target);
    if (!identity) continue;
    const declaration = index.declarationByTarget.get(moduleSemanticTargetKey(token.target));
    const isDeclaration = declaration?.from === token.from && declaration.to === token.to;
    const pathRanges = readDslReferencePathSegments(source, token.from, token.to);
    if (!isDeclaration && pathRanges.kind === "valid" && pathRanges.segments.length > 1) {
      // Qualified Module callees are represented by the existing Module
      // semantic editor as one resolved path token. The generic occurrence
      // owner must expose the authored callee member, not the whole path,
      // so a document-qualified Module identity can be projected without
      // turning the import alias into a Module reference.
      if (token.target.kind === "moduleDefinition") {
        const member = pathRanges.segments.at(-1);
        if (member) add("reference", member.start, member.end, identity);
      }
      continue;
    }
    add(isDeclaration ? "declaration" : "reference", token.from, token.to, identity);
  }
  addModuleSemanticPathOccurrences(compiled, add);
};

const addRootDeclarations = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  const isRootGeometryValue = (declaration: SourceLexicalDeclaration) => {
    const statement = compiled.statements[declaration.statementIndex];
    return declaration.kind === "typedDeclaration" && statement?.kind === "typedDeclaration" && isDslGeometryValueType(statement.valueType);
  };
  for (const declaration of namespace.allDeclarations) {
    if (
      declaration.kind !== "profile" &&
      declaration.kind !== "group" &&
      declaration.kind !== "geometry" &&
      declaration.kind !== "conditionalGroup" &&
      declaration.kind !== "forGroup" &&
      declaration.kind !== "layout" &&
      declaration.kind !== "print" &&
      declaration.kind !== "svg" &&
      !isRootGeometryValue(declaration)
    ) continue;
    const identity = declarationIdentity(compiled, declaration);
    if (!identity || !declaration.nameSpan) continue;
    addPhysicalOccurrence(add, compiled, declaration.statementIndex, declaration.nameSpan, identity, "declaration");
  }
};

const addDrawingProfileOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "modifierProfileBlock") continue;
    addQualifiedPathOccurrences(compiled, add, statementIndex, statement.profileNameSpan, null);
  }
};

/** Document-global style names deliberately stay outside lexical namespaces. */
const addDrawingModifierOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const index = createModifierAuthoringIndex(compiled);
  for (const definition of index.definitions) {
    add("declaration", definition.range.from, definition.range.to, { kind: "modifier", name: definition.name });
  }
  for (const reference of index.references) {
    add("reference", reference.range.from, reference.range.to, { kind: "modifier", name: reference.name });
  }
};

const addSourceOutputOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "layout" && statement.kind !== "print" && statement.kind !== "svg" && statement.kind !== "place") continue;
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) continue;
    for (const key of ["group", "origin", "layout", "profile"]) {
      const valueSpan = statement.payloadSpans[key];
      if (!valueSpan) continue;
      const parsed = parseDslSourceReference(logical.logicalText.slice(valueSpan.start, valueSpan.end));
      if (parsed.kind !== "valid" || parsed.reference.property) continue;
      addQualifiedPathOccurrences(compiled, add, statementIndex, {
        start: valueSpan.start + parsed.reference.pathRange.start,
        end: valueSpan.start + parsed.reference.pathRange.end
      }, null);
    }
  }
};

const transformationRecipesBefore = (compiled: CompiledDslDocument, statementIndex: number) =>
  (compiled.transformationRecipes ?? compiled.document?.transformationRecipes ?? []).filter((recipe) => recipe.sourceStatementIndex < statementIndex);

const transformationStageIdentityFor = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  ownerId: ElementId,
  occurrenceIndex: string | undefined,
  stagePath: readonly string[]
): DslSemanticIdentity | null => {
  if (stagePath.length === 0 || stagePath[0] === "base" || stagePath[0] === "final") return null;
  const occurrenceKey = occurrenceIndex ?? "*";
  for (const recipe of [...transformationRecipesBefore(compiled, statementIndex)].reverse()) {
    if (!recipe.stageName) continue;
    for (const target of recipe.targets) {
      const targetOccurrenceKey = target.occurrenceIndex ?? "*";
      if (target.ownerId !== ownerId ||
          (targetOccurrenceKey !== occurrenceKey && targetOccurrenceKey !== "*" && occurrenceKey !== "*")) continue;
      const declaredPath = [...target.stagePath, recipe.stageName];
      if (declaredPath.length === stagePath.length && declaredPath.every((part, index) => part === stagePath[index])) {
        return { kind: "transformationStage", recipeId: recipe.id };
      }
    }
  }
  return null;
};

const addTransformationPropertyOccurrences = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  span: { start: number; end: number },
  ownerId: ElementId,
  occurrenceIndex: string | undefined,
  stagePath: readonly string[]
) => {
  if (stagePath.length === 0) return;
  const statement = compiled.statements[statementIndex];
  const physical = physicalRange(compiled, statementIndex, span);
  if (!statement || !physical) return;
  const raw = compiled.spans.sourceMap.source.slice(physical.from, physical.to);
  const parsed = parseDslSourceReference(raw.startsWith("@") ? raw : `@${raw}`);
  if (parsed.kind !== "valid" || parsed.reference.propertyRange === null) return;
  const propertyOffset = raw.startsWith("@") ? 0 : -1;
  const propertyStart = span.start + parsed.reference.propertyRange.start + propertyOffset;
  const logicalStatement = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logicalStatement) return;
  const propertyText = logicalStatement.logicalText.slice(propertyStart, span.end);
  const parts = propertyText.split(".");
  const stageCount = Math.min(stagePath.length, parts.length);
  let cursor = propertyStart;
  for (let index = 0; index < stageCount; index += 1) {
    const part = parts[index]!;
    const partSpan = { start: cursor, end: cursor + part.length };
    const identity = transformationStageIdentityFor(
      compiled,
      statementIndex,
      ownerId,
      occurrenceIndex,
      stagePath.slice(0, index + 1)
    );
    if (identity) addPhysicalOccurrence(add, compiled, statementIndex, partSpan, identity, "reference");
    cursor += part.length + 1;
  }
};

const addTransformationReference = (
  compiled: CompiledDslDocument,
  add: AddOccurrence,
  statementIndex: number,
  span: { start: number; end: number }
) => {
  const statement = compiled.statements[statementIndex];
  const namespace = compiled.sourceLexicalNamespace;
  if (!statement || !namespace) return;
  const logicalStatement = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logicalStatement) return;
  const logical = logicalStatement.logicalText.slice(span.start, span.end);
  const parsed = parseDslSourceReference(logical);
  if (parsed.kind !== "valid") return;
  if (parsed.reference.path.segments.length === 2) {
    const instanceLookup = resolveSourceLexicalDeclaration(namespace, statementIndex, parsed.reference.path.segments[0]!);
    if (instanceLookup.kind === "resolved" && instanceLookup.declaration.kind === "moduleInstance") {
      const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(instanceLookup.declaration.statementId);
      const definition = instance?.callee
        ? compiled.moduleRuntimeContext?.definitionFor(instance.callee.definitionIdentity)
          ?? compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(instance.callee.definitionStatementId)
        : undefined;
      const exported = definition?.exports.find((candidate) => candidate.kind === "geometry" && candidate.name === parsed.reference.path.segments[1]);
      const physical = physicalRange(compiled, statementIndex, span);
      const ranges = physical
        ? readDslReferencePathSegments(compiled.spans.sourceMap.source, physical.from, physical.to)
        : null;
      if (instance && exported && ranges?.kind === "valid" && ranges.segments.length === 2) {
        const instanceRange = ranges.segments[0];
        const memberRange = ranges.segments[1];
        if (instanceRange) add("reference", instanceRange.start, instanceRange.end, {
          kind: "module",
          target: { kind: "moduleInstance", statementId: instance.statementId }
        });
        const identity = semanticIdentityForModuleTarget(compiled, {
          kind: "moduleSource",
          statementId: exported.exportedStatementId
        });
        if (memberRange) add("reference", memberRange.start, memberRange.end, identity);
        const stagePath = parsed.reference.property?.split(".").filter((part) => part !== "start" && part !== "end") ?? [];
        addTransformationPropertyOccurrences(
          compiled,
          add,
          statementIndex,
          span,
          exported.exportedStatementId,
          parsed.reference.occurrenceIndex ?? undefined,
          stagePath
        );
        return;
      }
    }
  }
  const lookup = resolveSourceLexicalPathSegments(namespace, statementIndex, parsed.reference.path);
  if (lookup.lookup.kind !== "resolved" || lookup.lookup.declaration.kind !== "geometry") return;
  const identity = declarationIdentity(compiled, lookup.lookup.declaration);
  const pathSpan = {
    start: span.start + parsed.reference.pathRange.start,
    end: span.start + parsed.reference.pathRange.end
  };
  addQualifiedPathOccurrences(compiled, add, statementIndex, pathSpan, identity);
  if (identity?.kind === "element") {
    const property = parsed.reference.property;
    const stagePath = property?.split(".").filter((part) => part !== "start" && part !== "end") ?? [];
    addTransformationPropertyOccurrences(
      compiled,
      add,
      statementIndex,
      span,
      identity.elementId,
      parsed.reference.occurrenceIndex ?? undefined,
      stagePath
    );
  }
};

const addTransformationOccurrences = (compiled: CompiledDslDocument, add: AddOccurrence) => {
  const recipes = compiled.transformationRecipes ?? compiled.document?.transformationRecipes ?? [];
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "transformation") continue;
    const recipe = recipes.find((candidate) => candidate.sourceStatementIndex === statementIndex);
    if (!recipe) continue;
    if (statement.stageNameSpan && statement.stageName) {
      const identity: DslSemanticIdentity = { kind: "transformationStage", recipeId: recipe.id };
      addPhysicalOccurrence(add, compiled, statementIndex, statement.stageNameSpan, identity, "declaration");
    }
    let recipeTargetCursor = 0;
    for (const targetSyntax of statement.targets) {
      const targetIndex = recipe.targets.findIndex((candidate, index) => index >= recipeTargetCursor && candidate.source === targetSyntax.source);
      const target = targetIndex >= 0 ? recipe.targets[targetIndex] : undefined;
      if (!target) continue;
      recipeTargetCursor = targetIndex + 1;
      const ownerIdentity = elementIdentity(compiled, target.ownerId) ?? semanticIdentityForModuleTarget(compiled, {
        kind: "moduleSource",
        statementId: target.ownerId
      });
      const parsed = parseDslSourceReference(`@${targetSyntax.source}`);
      if (parsed.kind === "valid") {
        const moduleInstanceLookup = parsed.reference.path.segments.length === 2 && compiled.sourceLexicalNamespace
          ? resolveSourceLexicalDeclaration(compiled.sourceLexicalNamespace, statementIndex, parsed.reference.path.segments[0]!)
          : null;
        const moduleInstance = moduleInstanceLookup?.kind === "resolved" && moduleInstanceLookup.declaration.kind === "moduleInstance"
          ? compiled.moduleSemanticAnalysis?.instancesByStatementId.get(moduleInstanceLookup.declaration.statementId)
          : undefined;
        const definition = moduleInstance?.callee
          ? compiled.moduleRuntimeContext?.definitionFor(moduleInstance.callee.definitionIdentity)
            ?? compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(moduleInstance.callee.definitionStatementId)
          : undefined;
        const exported = definition?.exports.find((candidate) => candidate.kind === "geometry" && candidate.name === parsed.reference.path.segments[1]);
        const physical = physicalRange(compiled, statementIndex, targetSyntax.span);
        const ranges = physical
          ? readDslReferencePathSegments(compiled.spans.sourceMap.source, physical.from, physical.to)
          : null;
        if (moduleInstance && exported && ranges?.kind === "valid" && ranges.segments.length === 2) {
          const instanceRange = ranges.segments[0];
          const memberRange = ranges.segments[1];
          if (instanceRange) add("reference", instanceRange.start, instanceRange.end, {
            kind: "module",
            target: { kind: "moduleInstance", statementId: moduleInstance.statementId }
          });
          if (memberRange) add("reference", memberRange.start, memberRange.end, semanticIdentityForModuleTarget(compiled, {
            kind: "moduleSource",
            statementId: exported.exportedStatementId
          }));
        } else {
          addQualifiedPathOccurrences(
            compiled,
            add,
            statementIndex,
            {
              start: targetSyntax.span.start + parsed.reference.pathRange.start - 1,
              end: targetSyntax.span.start + parsed.reference.pathRange.end - 1
            },
            ownerIdentity
          );
        }
        addTransformationPropertyOccurrences(
          compiled,
          add,
          statementIndex,
          targetSyntax.span,
          target.ownerId,
          target.occurrenceIndex,
          target.stagePath
        );
      }
    }
    for (const attr of statement.attrs) {
      if (!attr.value.includes("@")) continue;
      const valueStart = attr.valueStart;
      for (let cursor = attr.value.indexOf("@"); cursor >= 0; cursor = attr.value.indexOf("@", cursor + 1)) {
        const logicalStatement = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
        if (!logicalStatement) continue;
        const parsed = parseDslSourceReferenceAt(logicalStatement.logicalText, valueStart + cursor, attr.valueEnd);
        if (parsed.kind !== "valid") continue;
        addTransformationReference(compiled, add, statementIndex, {
          start: valueStart + cursor,
          end: parsed.end
        });
      }
    }
  }
};

/** Build exact, compiler-resolved declaration/reference occurrences in source order. */
export const createDslSemanticOccurrenceIndex = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis | undefined = compiled.bindingAnalysis
): DslSemanticOccurrenceIndex => {
  const byKey = new Map<string, DslSemanticOccurrence>();
  const add: AddOccurrence = (kind, from, to, identity) => {
    if (!identity || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to) return;
    const key = `${dslSemanticIdentityKey(identity)}:${from}:${to}`;
    const current = byKey.get(key);
    if (!current || (kind === "declaration" && current.kind === "reference")) {
      byKey.set(key, { from, to, kind, identity });
    }
  };

  const addQualifiedPath = (
    statementIndex: number,
    nameSpan: { start: number; end: number },
    finalTarget: DslSemanticIdentity | null
  ) => addQualifiedPathOccurrences(compiled, add, statementIndex, nameSpan, finalTarget);

  addTypedOccurrences(compiled, bindingAnalysis, add, addQualifiedPath);
  addRecordOccurrences(compiled, add);
  addSyntheticRecordFieldOccurrences(compiled, add);
  addRootDeclarations(compiled, add);
  addModuleOccurrences(compiled, add);
  addGeometryArrayOccurrences(compiled, add);
  addGeometryArrayConsumerOccurrences(compiled, add);
  addSourceOutputOccurrences(compiled, add);
  addTransformationOccurrences(compiled, add);
  addDrawingProfileOccurrences(compiled, add);
  addDrawingModifierOccurrences(compiled, add);

  const occurrences = [...byKey.values()].sort((left, right) =>
    left.from - right.from || left.to - right.to || (left.kind === "declaration" ? -1 : 1) ||
    dslSemanticIdentityKey(left.identity).localeCompare(dslSemanticIdentityKey(right.identity))
  );
  const declarationsByIdentity = new Map<string, DslSemanticRange[]>();
  for (const occurrence of occurrences) {
    if (occurrence.kind !== "declaration") continue;
    const declarations = declarationsByIdentity.get(dslSemanticIdentityKey(occurrence.identity)) ?? [];
    if (!declarations.some((range) => range.from === occurrence.from && range.to === occurrence.to)) {
      declarations.push({ from: occurrence.from, to: occurrence.to });
      declarationsByIdentity.set(dslSemanticIdentityKey(occurrence.identity), declarations);
    }
  }
  return { occurrences, declarationsByIdentity };
};

export const dslSemanticOccurrenceAt = (
  index: DslSemanticOccurrenceIndex,
  position: number
): DslSemanticOccurrence | null => {
  const matches = index.occurrences
    .filter((occurrence) => occurrence.from <= position && position <= occurrence.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from) || left.from - right.from || left.to - right.to);
  if (matches.length === 0) return null;
  const shortest = matches[0]!.to - matches[0]!.from;
  const shortestMatches = matches.filter((occurrence) => occurrence.to - occurrence.from === shortest);
  const identities = new Set(shortestMatches.map((occurrence) => dslSemanticIdentityKey(occurrence.identity)));
  return identities.size === 1 ? shortestMatches[0]! : null;
};

export const dslSemanticDeclarationRange = (
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DslSemanticRange | null => {
  const declarations = index.declarationsByIdentity.get(dslSemanticIdentityKey(identity)) ?? [];
  return declarations.length === 1 ? declarations[0]! : null;
};
