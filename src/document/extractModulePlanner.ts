import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { bareConstructionFor } from "../dsl/dslConstructions";
import {
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import {
  geometryArrayTypeOfModuleParameter,
  geometryArrayTypeOfTypedDeclaration
} from "../dsl/geometryArraySourceAnnotations";
import type { GeometryArrayType } from "../dsl/geometryArrayTypes";
import { exactPhysicalSpan } from "../dsl/dslDiagnosticSpan";
import { parseDslSnapshot } from "../dsl/dslParser";
import { parseDslSourceReference } from "../dsl/dslReferenceTokens";
import { serializeDslNumericType, type DslNumericTypeOptions } from "../dsl/dslNumericTypeOptions";
import type { DslModuleParameterType, DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import { mutationWriteParameterKeysFor } from "../dsl/moduleMutationOwnership";
import type { ModuleRecordSourceTarget, ResolvedModuleRecordExport } from "../dsl/moduleSemanticTypes";
import type { RecordFieldIdentity } from "../dsl/recordSemanticAnalysis";
import type { ScalarType } from "../scalars/types";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type ExtractModuleRejectCode =
  | "stale-semantic-snapshot"
  | "invalid-target"
  | "non-authored-target"
  | "cross-scope-target"
  | "non-contiguous-target"
  | "unsupported-statement"
  | "invalid-name"
  | "name-collision"
  | "unresolved-semantic-identity"
  | "parameter-name-collision"
  | "unrepresentable-dependency"
  | "cross-boundary-mutation"
  | "unrepresentable-export"
  | "existing-public-interface"
  | "unsafe-rewrite"
  | "identity-loss";

export type ExtractModuleRejection = {
  status: "rejected";
  code: ExtractModuleRejectCode;
  message: string;
  statementId?: StatementIdentity;
  statementIndex?: number;
  interveningStatementId?: StatementIdentity;
  interveningStatementIndex?: number;
};

type ExtractModuleParameterType = DslModuleParameterType | GeometryArrayType;

export type ExtractModuleDependency = {
  identityKey: string;
  name: string;
  type: ExtractModuleParameterType | null;
  typeText: string;
  recordTypeIdentity?: string;
  argumentSource: string;
  declarationFrom: number;
};

export type ExtractModuleExport = {
  identityKey: string;
  name: string;
  statementId: StatementIdentity;
  statementIndex: number;
};

export type ExtractModulePlan = {
  status: "planned";
  sourceRevision: number;
  moduleName: string;
  instanceName: string;
  targetScopeId: string;
  selectedStatementIds: readonly StatementIdentity[];
  dependencies: readonly ExtractModuleDependency[];
  exports: readonly ExtractModuleExport[];
  /** One atomic old-source-coordinate batch. Callers must apply all or none. */
  splices: readonly LineSplice[];
  generatedInstance: {
    name: string;
    moduleName: string;
    startLine: number;
    endLine: number;
  };
};

export type ExtractModulePlanResult = ExtractModulePlan | ExtractModuleRejection;

export type ExtractModulePlanInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  statementIds: readonly StatementIdentity[];
  moduleName: string;
  instanceName: string;
};

type AbsoluteReplacement = { from: number; to: number; text: string };

type DependencyDescriptor = {
  name: string;
  type: ExtractModuleParameterType | null;
  typeText: string;
  recordTypeIdentity?: string;
  numericTypeOptions?: DslNumericTypeOptions;
  declarationFrom: number;
};

type RecordFieldDependencyProof = {
  baseOccurrence: DslSemanticOccurrence;
  fieldOccurrence: DslSemanticOccurrence;
  field: RecordFieldIdentity;
};

type SourcePathRange = {
  rewriteFrom: number;
  to: number;
  argumentFrom: number;
};

type DirectScalarStatement = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>;
};

type DirectGeometryStatement = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "element" }>;
  interfaceType: ModuleGeometryInterfaceType;
};

type DirectGeometryArrayStatement = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>;
  arrayType: GeometryArrayType;
};

type DirectValueStatement = DirectScalarStatement | DirectGeometryStatement | DirectGeometryArrayStatement;

type MovedStatement = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: DslStatement;
};

type MovedExternalModuleCallee = {
  instanceStatementId: StatementIdentity;
  definitionStatementId: StatementIdentity;
};

const reject = (
  code: ExtractModuleRejectCode,
  message: string,
  details: Partial<Omit<ExtractModuleRejection, "status" | "code" | "message">> = {}
): ExtractModuleRejection => ({ status: "rejected", code, message, ...details });

const sameEnclosing = (
  left: DslStatement["enclosing"],
  right: DslStatement["enclosing"]
): boolean =>
  left?.statementIndex === right?.statementIndex &&
  left?.branch === right?.branch;

const isStructuralStatement = (statement: DslStatement): boolean =>
  statement.kind === "blockEnd" || statement.kind === "blockElse";

const isConditionalGroupStatement = (statement: DslStatement): boolean =>
  statement.kind === "element" &&
  statement.type === "conditionalGroup" &&
  statement.category === "if";

const isForGroupStatement = (statement: DslStatement): boolean =>
  statement.kind === "element" && statement.type === "forGroup";

const lineStarts = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const lineEndOffset = (source: string, starts: readonly number[], line: number): number =>
  line < starts.length ? starts[line]! - 1 : source.length;

const lineAtOffset = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, high + 1);
};

const applyAbsoluteReplacements = (
  source: string,
  rangeFrom: number,
  rangeTo: number,
  replacements: readonly AbsoluteReplacement[]
): string | null => {
  const sorted = [...replacements].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = rangeFrom;
  for (const replacement of sorted) {
    if (
      replacement.from < rangeFrom ||
      replacement.to > rangeTo ||
      replacement.from > replacement.to ||
      replacement.from < previousTo
    ) {
      return null;
    }
    previousTo = Math.max(previousTo, replacement.to);
  }

  let result = source.slice(rangeFrom, rangeTo);
  for (const replacement of sorted.reverse()) {
    const from = replacement.from - rangeFrom;
    const to = replacement.to - rangeFrom;
    result = result.slice(0, from) + replacement.text + result.slice(to);
  }
  return result;
};

const sourcePathRangeForOccurrence = (
  source: string,
  occurrences: readonly DslSemanticOccurrence[],
  occurrence: DslSemanticOccurrence
): SourcePathRange => {
  let firstSegmentFrom = occurrence.from;
  let cursor = occurrence.from;
  while (true) {
    const prior = occurrences.find((candidate) =>
      candidate.kind === "reference" &&
      candidate.to + 2 === cursor &&
      source.slice(candidate.to, cursor) === "::"
    );
    if (!prior) break;
    firstSegmentFrom = prior.from;
    cursor = prior.from;
  }

  const rooted = firstSegmentFrom >= 3 && source.slice(firstSegmentFrom - 3, firstSegmentFrom) === "@::";
  return {
    rewriteFrom: rooted ? firstSegmentFrom - 2 : firstSegmentFrom,
    to: occurrence.to,
    argumentFrom: rooted
      ? firstSegmentFrom - 3
      : source[firstSegmentFrom - 1] === "@"
        ? firstSegmentFrom - 1
        : firstSegmentFrom
  };
};

const isFinalReferenceSegment = (source: string, occurrence: DslSemanticOccurrence): boolean =>
  occurrence.kind === "reference" && source.slice(occurrence.to, occurrence.to + 2) !== "::";

const canonicalFinalReferenceOccurrences = (
  source: string,
  occurrences: readonly DslSemanticOccurrence[]
): readonly DslSemanticOccurrence[] => {
  const byEnd = new Map<number, DslSemanticOccurrence>();
  for (const occurrence of occurrences) {
    if (!isFinalReferenceSegment(source, occurrence)) continue;
    const prior = byEnd.get(occurrence.to);
    if (
      !prior ||
      occurrence.from > prior.from ||
      (occurrence.from === prior.from && occurrence.identity.kind === "module" && prior.identity.kind !== "module")
    ) byEnd.set(occurrence.to, occurrence);
  }
  return [...byEnd.values()].sort((left, right) => left.from - right.from || left.to - right.to);
};

const declarationRangesFor = (
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
) => index.declarationsByIdentity.get(dslSemanticIdentityKey(identity)) ?? [];

const statementIndexForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): number | undefined =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const statementIdForIndex = (
  compiled: CompiledDslDocument,
  statementIndex: number | undefined
): StatementIdentity | null =>
  statementIndex === undefined
    ? null
    : compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? null;

const semanticOwnerKey = (compiled: CompiledDslDocument, identity: DslSemanticIdentity): string => {
  if (identity.kind === "typed") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (identity.kind === "element") {
    const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (identity.kind === "source") return `statement:${identity.statementId}`;
  if (identity.kind === "modifier") return dslSemanticIdentityKey(identity);
  if (identity.kind === "recordType" || identity.kind === "recordValue") return `statement:${identity.statementId}`;
  if (identity.kind === "recordField") return `record-field:${identity.field.recordStatementId}:${identity.field.fieldIndex}`;

  const target = identity.target;
  if (target.kind === "documentBinding") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (target.kind === "moduleParameter") {
    return `parameter:${target.slot.definitionStatementId}:${target.slot.parameterIndex}`;
  }
  if (target.kind === "moduleElementLocalVariable") {
    return `module-element-local:${target.statementId}:${target.variableIndex}`;
  }
  return `statement:${target.statementId}`;
};

const scalarTypeText = (type: ScalarType, numericTypeOptions?: DslNumericTypeOptions): string => {
  if (type.kind === "number") return serializeDslNumericType(numericTypeOptions);
  if (type.kind === "choice") return `choice(${type.options.join(", ")})`;
  return type.kind;
};

const moduleParameterTypeText = (
  type: ExtractModuleParameterType,
  numericTypeOptions?: DslNumericTypeOptions
): string => {
  if (type.kind === "geometryArray") return `${type.elementType}[]`;
  if (type.kind === "point" || type.kind === "line" || type.kind === "path") return type.kind;
  return scalarTypeText(type, numericTypeOptions);
};

const exactAuthoredTypeText = (
  compiled: CompiledDslDocument,
  statement: DslStatement,
  span: { start: number; end: number } | null | undefined
): string | null => {
  if (!span) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  if (physical?.segments.length !== 1) return null;
  const segment = physical.segments[0];
  return segment ? compiled.spans.sourceMap.source.slice(segment.from, segment.to) : null;
};

const recordExportForStatement = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): ResolvedModuleRecordExport | null => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  const exports = analysis?.definitions.flatMap((definition) =>
    definition.exports.filter((entry): entry is ResolvedModuleRecordExport =>
      entry.kind === "record" && entry.exportedStatementId === statementId
    )
  ) ?? [];
  return exports.length === 1 ? exports[0]! : null;
};

const moduleGeometryParameterType = (type: ModuleGeometryInterfaceType): DslModuleParameterType => {
  if (type === "point") return { kind: "point" };
  if (type === "line") return { kind: "line" };
  return { kind: "path" };
};

const numericOptionsForStatement = (
  statement: DslStatement | undefined
): DslNumericTypeOptions | undefined =>
  statement?.kind === "typedDeclaration" && statement.declaredType?.kind === "number"
    ? statement.numericTypeOptions
    : undefined;

const moduleParameterDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  if (identity.kind !== "module" || identity.target.kind !== "moduleParameter") return null;
  const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(
    identity.target.slot.definitionStatementId
  );
  const parameter = definition?.parameters[identity.target.slot.parameterIndex];
  const definitionStatement = definition ? compiled.statements[definition.statementIndex] : undefined;
  const sourceParameter = definitionStatement?.kind === "moduleDefinition"
    ? definitionStatement.parameters[identity.target.slot.parameterIndex]
    : undefined;
  if (
    !definition ||
    !parameter ||
    !sourceParameter ||
    parameter.definitionStatementId !== identity.target.slot.definitionStatementId
  ) return null;

  const declarations = declarationRangesFor(index, identity);
  if (declarations.length !== 1) return null;
  if (sourceParameter.recordTypeReference) {
    const typeText = exactAuthoredTypeText(compiled, definitionStatement!, sourceParameter.typeSpan);
    if (!typeText || !parameter.recordTypeIdentity) return null;
    return {
      name: parameter.name,
      type: null,
      typeText,
      recordTypeIdentity: parameter.recordTypeIdentity,
      declarationFrom: declarations[0]!.from
    };
  }

  const arrayType = geometryArrayTypeOfModuleParameter(sourceParameter);
  const type = arrayType ?? parameter.type;
  if (!type) return null;
  return {
    name: parameter.name,
    type,
    typeText: moduleParameterTypeText(type, parameter.numericTypeOptions),
    numericTypeOptions: parameter.numericTypeOptions,
    declarationFrom: declarations[0]!.from
  };
};

const moduleSourceDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  if (identity.kind !== "module" || identity.target.kind !== "moduleSource") return null;
  const statementId = identity.target.statementId;
  const statementIndex = statementIndexForId(compiled, statementId);
  const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
  const declarations = declarationRangesFor(index, identity);
  if (statementIndex === undefined || !statement || declarations.length > 1) return null;

  if (statement.kind === "typedDeclaration") {
    const arrayType = geometryArrayTypeOfTypedDeclaration(statement);
    if (!statement.recordTypeReference && declarations.length !== 1) return null;
    if (arrayType) {
      return {
        name: statement.name,
        type: arrayType,
        typeText: moduleParameterTypeText(arrayType),
        declarationFrom: declarations[0]!.from
      };
    }
    if (statement.recordTypeReference) {
      const recordValue = compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(statementId);
      const exported = recordExportForStatement(compiled, statementId);
      const typeIdentity = recordValue?.typeIdentity;
      const typeText = exactAuthoredTypeText(compiled, statement, statement.payloadSpans.type);
      const declarationFrom = declarations[0]?.from ?? exactPhysicalSpan(compiled.spans, statement, statement.nameSpan ?? statement.keywordSpan)?.segments[0]?.from;
      if (!typeIdentity || !typeText || !declarationFrom || !exported || exported.typeIdentity !== typeIdentity) return null;
      return {
        name: statement.name,
        type: null,
        typeText,
        recordTypeIdentity: typeIdentity,
        declarationFrom
      };
    }
    if (!statement.declaredType) return null;
    return {
      name: statement.name,
      type: statement.declaredType,
      typeText: moduleParameterTypeText(statement.declaredType, numericOptionsForStatement(statement)),
      numericTypeOptions: numericOptionsForStatement(statement),
      declarationFrom: declarations[0]!.from
    };
  }

  const interfaceType = moduleGeometryInterfaceTypeOfElement(statement);
  return statement.kind === "element" && interfaceType
    ? {
        name: statement.name,
        type: moduleGeometryParameterType(interfaceType),
        typeText: moduleParameterTypeText(moduleGeometryParameterType(interfaceType)),
        declarationFrom: declarations[0]!.from
      }
    : null;
};

const recordValueDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  if (identity.kind !== "recordValue") return null;
  const value = compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(identity.statementId);
  const statementIndex = value?.statementIndex;
  const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
  const declarations = declarationRangesFor(index, identity);
  if (
    !value ||
    statementIndex === undefined ||
    statement?.kind !== "typedDeclaration" ||
    !statement.recordTypeReference ||
    !value.typeIdentity ||
    value.statementId !== identity.statementId ||
    declarations.length !== 1
  ) return null;
  const typeText = exactAuthoredTypeText(compiled, statement, statement.payloadSpans.type);
  return typeText
    ? {
        name: statement.name,
        type: null,
        typeText,
        recordTypeIdentity: value.typeIdentity,
        declarationFrom: declarations[0]!.from
      }
    : null;
};

const moduleIterationDependencyDescriptor = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  if (identity.kind !== "module" || identity.target.kind !== "moduleIteration") return null;
  const statementIndex = statementIndexForId(compiled, identity.target.statementId);
  const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
  const slot = compiled.sourceLexicalNamespace?.scopeIndex.forGroupIterationSlots.get(
    `for:${identity.target.statementId}`
  );
  if (!statement || statement.kind !== "element" || statement.type !== "forGroup" || !slot?.name || !slot.nameSpan) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, slot.nameSpan);
  if (physical?.segments.length !== 1) return null;
  return {
    name: slot.name,
    type: { kind: "number" },
    typeText: "number",
    declarationFrom: physical.segments[0]!.from
  };
};

const scalarDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  const descriptorForBinding = (bindingId: string): DependencyDescriptor | null => {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(bindingId);
    if (!binding) return null;
    const statement = compiled.statements[binding.statementIndex];
    if (binding.kind === "iteration") {
      if (!binding.nameSpan || !statement) return null;
      const physical = exactPhysicalSpan(compiled.spans, statement, binding.nameSpan);
      if (physical?.segments.length !== 1) return null;
      return {
        name: binding.name,
        type: { kind: "number" },
        typeText: "number",
        declarationFrom: physical.segments[0]!.from
      };
    }
    if (!binding.declaredType) return null;
    const declarations = declarationRangesFor(index, identity);
    if (declarations.length !== 1) return null;
    // Keep synthetic record-field scalar slots out of Extract dependency inference.
    // Their source owner is record-valued and remains a later checkpoint boundary.
    if (
      statement?.kind !== "typedDeclaration" ||
      !statement.declaredType ||
      statement.recordTypeReference
    ) {
      return null;
    }
    return {
      name: binding.name,
      type: binding.declaredType,
      typeText: moduleParameterTypeText(binding.declaredType, numericOptionsForStatement(statement)),
      numericTypeOptions: numericOptionsForStatement(statement),
      declarationFrom: declarations[0]!.from
    };
  };

  if (identity.kind === "typed") return descriptorForBinding(identity.bindingId);
  if (identity.kind === "module" && identity.target.kind === "documentBinding") {
    return descriptorForBinding(identity.target.bindingId);
  }
  return null;
};

const geometryDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  if (identity.kind !== "element") return null;
  const declarations = declarationRangesFor(index, identity);
  if (declarations.length !== 1) return null;
  const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
  if (statementIndex === undefined) return null;
  const statement = compiled.statements[statementIndex];
  const interfaceType = moduleGeometryInterfaceTypeOfElement(statement);
  if (
    statement?.kind !== "element" ||
    !statement.name ||
    !interfaceType
  ) {
    return null;
  }
  return {
    name: statement.name,
    type: moduleGeometryParameterType(interfaceType),
    typeText: moduleParameterTypeText(moduleGeometryParameterType(interfaceType)),
    declarationFrom: declarations[0]!.from
  };
};

const geometryArrayStatementForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  requireRoot: boolean
): DirectGeometryArrayStatement | null => {
  if (identity.kind !== "module" || identity.target.kind !== "moduleSource") return null;
  const statementId = identity.target.statementId;
  const statementIndex = statementIndexForId(compiled, statementId);
  if (statementIndex === undefined) return null;
  const statement = compiled.statements[statementIndex];
  if (
    statement?.kind !== "typedDeclaration" ||
    (requireRoot && statement.enclosing !== null) ||
    !statement.name
  ) {
    return null;
  }
  const arrayType = geometryArrayTypeOfTypedDeclaration(statement);
  const semantic = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementId.get(statementId);
  if (
    !arrayType ||
    !semantic ||
    semantic.statementIndex !== statementIndex ||
    semantic.type.elementType !== arrayType.elementType
  ) {
    return null;
  }
  return { statementId, statementIndex, statement, arrayType };
};

const geometryArrayDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  const direct = geometryArrayStatementForIdentity(compiled, identity, false);
  if (!direct) return null;
  const declarations = declarationRangesFor(index, identity);
  if (declarations.length !== 1) return null;
  return {
    name: direct.statement.name,
    type: direct.arrayType,
    typeText: moduleParameterTypeText(direct.arrayType),
    declarationFrom: declarations[0]!.from
  };
};

const dependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null =>
  moduleParameterDependencyDescriptor(compiled, index, identity) ??
  moduleSourceDependencyDescriptor(compiled, index, identity) ??
  recordValueDependencyDescriptor(compiled, index, identity) ??
  moduleIterationDependencyDescriptor(compiled, identity) ??
  scalarDependencyDescriptor(compiled, index, identity) ??
  geometryDependencyDescriptor(compiled, index, identity) ??
  geometryArrayDependencyDescriptor(compiled, index, identity);

const recordFieldBaseOccurrenceFor = (
  source: string,
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  fieldOccurrence: DslSemanticOccurrence
): { kind: "resolved"; proof: RecordFieldDependencyProof; descriptor: DependencyDescriptor } | { kind: "notField" } | { kind: "invalid" } => {
  if (fieldOccurrence.identity.kind !== "recordField") return { kind: "notField" };
  if (source[fieldOccurrence.from - 1] !== ".") return { kind: "notField" };
  const statement = compiled.statements.find((candidate) =>
    candidate.documentRange.from <= fieldOccurrence.from && candidate.documentRange.to >= fieldOccurrence.to
  );
  const candidates = index.occurrences.filter((candidate) =>
    candidate.kind === "reference" &&
    candidate.to + 1 === fieldOccurrence.from &&
    source[candidate.to] === "." &&
    statement !== undefined &&
    candidate.from >= statement.documentRange.from &&
    candidate.to <= statement.documentRange.to
  );
  if (candidates.length !== 1) return { kind: "invalid" };
  const baseOccurrence = candidates[0]!;
  const descriptor = dependencyDescriptor(compiled, index, baseOccurrence.identity);
  if (!descriptor?.recordTypeIdentity || descriptor.recordTypeIdentity !== fieldOccurrence.identity.field.recordStatementId) {
    return { kind: "invalid" };
  }
  return {
    kind: "resolved",
    proof: { baseOccurrence, fieldOccurrence, field: fieldOccurrence.identity.field },
    descriptor
  };
};

const recordSourceTargetIdentity = (target: ModuleRecordSourceTarget): DslSemanticIdentity => {
  if (target.kind === "recordValue") return { kind: "recordValue", statementId: target.statementId };
  if (target.kind === "recordParameter") {
    return {
      kind: "module",
      target: {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: target.definitionStatementId,
          parameterIndex: target.parameterIndex
        }
      }
    };
  }
  return {
    kind: "module",
    target: { kind: "moduleSource", statementId: target.exportedStatementId }
  };
};

const directSelectedScalarStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectScalarStatement | null => {
  let statementIndex: number | undefined;
  if (identity.kind === "typed") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
  } else if (identity.kind === "recordValue") {
    statementIndex = compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(identity.statementId)?.statementIndex;
  } else if (identity.kind === "module" && identity.target.kind === "documentBinding") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.target.bindingId)?.statementIndex;
  } else if (identity.kind === "module" && identity.target.kind === "moduleSource") {
    statementIndex = statementIndexForId(compiled, identity.target.statementId);
  }
  if (statementIndex === undefined || !selectedIndexes.has(statementIndex)) return null;

  const statement = compiled.statements[statementIndex];
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  return statement?.kind === "typedDeclaration" && statementId
    ? { statementId, statementIndex, statement }
    : null;
};

const directSelectedGeometryStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectGeometryStatement | null => {
  const statementIndex = identity.kind === "element"
    ? compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex
    : identity.kind === "module" && identity.target.kind === "moduleSource"
      ? statementIndexForId(compiled, identity.target.statementId)
      : undefined;
  if (statementIndex === undefined || !selectedIndexes.has(statementIndex)) return null;
  const statement = compiled.statements[statementIndex];
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  const interfaceType = moduleGeometryInterfaceTypeOfElement(statement);
  return statement?.kind === "element" && statementId && interfaceType
    ? { statementId, statementIndex, statement, interfaceType }
    : null;
};

const directSelectedGeometryArrayStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectGeometryArrayStatement | null => {
  const direct = geometryArrayStatementForIdentity(compiled, identity, false);
  return direct && selectedIndexes.has(direct.statementIndex) ? direct : null;
};

const directSelectedValueStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectValueStatement | null =>
  directSelectedScalarStatement(compiled, identity, selectedIndexes) ??
  directSelectedGeometryStatement(compiled, identity, selectedIndexes) ??
  directSelectedGeometryArrayStatement(compiled, identity, selectedIndexes);

const movedIterationBinding = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  movedIndexes: ReadonlySet<number>
): StatementIdentity | null => {
  if (identity.kind === "module" && identity.target.kind === "moduleIteration") {
    const statementIndex = statementIndexForId(compiled, identity.target.statementId);
    return statementIndex !== undefined && movedIndexes.has(statementIndex)
      ? identity.target.statementId
      : null;
  }
  if (identity.kind !== "typed") return null;
  const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
  if (!binding || binding.kind !== "iteration" || !movedIndexes.has(binding.statementIndex)) return null;
  return statementIdForIndex(compiled, binding.statementIndex);
};

const statementInsideOffsets = (
  statement: DslStatement | undefined,
  from: number,
  to: number
): boolean =>
  Boolean(statement && statement.documentRange.from >= from && statement.documentRange.to <= to);

const geometryReferencesForStatement = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
) => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return null;

  const rootReferences = analysis.rootGeometryReferencesByStatementId.get(statementId);
  if (rootReferences) return rootReferences;

  for (const definition of analysis.definitions) {
    const body = definition.bodyStatements.find((candidate) => candidate.statementId === statementId);
    if (body) return body.geometryReferences;
  }
  return null;
};

const mutationTargetStatementIndexes = (
  compiled: CompiledDslDocument,
  entry: MovedStatement
): readonly number[] | null => {
  const { statement } = entry;
  if (statement.kind !== "element" || statement.category !== "mutation") return [];
  if (!bareConstructionFor(statement.construction)) return null;

  const writeKeys = new Set(mutationWriteParameterKeysFor(statement));
  if (writeKeys.size === 0) return null;

  const references = geometryReferencesForStatement(compiled, entry.statementId);
  if (!references) return null;
  const owners = new Set<number>();
  for (const site of references) {
    if (!site.parameterKey || !writeKeys.has(site.parameterKey)) continue;
    const target = site.reference.target;
    if (!target) return null;

    const ownerStatementId = target.kind === "sourceGeometry"
      ? target.statementId
      : target.kind === "deferredModuleExport"
        ? target.instanceStatementId
        : null;
    const ownerStatementIndex = ownerStatementId === null
      ? undefined
      : statementIndexForId(compiled, ownerStatementId);
    if (ownerStatementIndex === undefined) return null;
    owners.add(ownerStatementIndex);
  }

  return owners.size > 0 ? [...owners] : null;
};

const validateMutationBoundaries = (
  compiled: CompiledDslDocument,
  selectedFrom: number,
  selectedTo: number
): ExtractModuleRejection | null => {
  const setTargetIndexes = new Map<number, number>();
  for (const [setStatementIndex, set] of compiled.setStatements ?? []) {
    const targetIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(set.targetBindingId)?.statementIndex;
    if (targetIndex !== undefined) setTargetIndexes.set(setStatementIndex, targetIndex);
  }
  for (const body of [...(compiled.moduleSemanticAnalysis?.definitions ?? [])].flatMap((definition) => definition.bodyStatements)) {
    if (body.statementKind !== "set" || body.scalarTarget?.kind !== "moduleLocal") continue;
    const targetIndex = statementIndexForId(compiled, body.scalarTarget.statementId);
    if (targetIndex !== undefined) setTargetIndexes.set(body.statementIndex, targetIndex);
  }

  for (const [setStatementIndex, targetIndex] of setTargetIndexes) {
    if (targetIndex === undefined) continue;
    const setInside = statementInsideOffsets(compiled.statements[setStatementIndex], selectedFrom, selectedTo);
    const targetInside = statementInsideOffsets(compiled.statements[targetIndex], selectedFrom, selectedTo);
    if (setInside !== targetInside) {
      return reject(
        "cross-boundary-mutation",
        `set ${compiled.statements[setStatementIndex]?.name ?? "target"} は Extract 境界をまたいで mutable binding を書き換えるため移動できません。`,
        { statementIndex: setStatementIndex }
      );
    }
  }

  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "element" || statement.category !== "mutation") continue;
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
    if (!statementId) return reject(
      "unsafe-rewrite",
      "bare mutation statement の authored StatementIdentity を exact-current source から取得できません。",
      { statementIndex }
    );

    const owners = mutationTargetStatementIndexes(compiled, {
      statementId,
      statementIndex,
      statement
    });
    if (owners === null) {
      return reject(
        "unsafe-rewrite",
        `bare mutation「${statement.construction}」の mutation target owner を compiler semantic metadata から一意に取得できません。`,
        { statementId, statementIndex }
      );
    }

    const mutationInside = statementInsideOffsets(statement, selectedFrom, selectedTo);
    for (const ownerIndex of owners) {
      const ownerInside = statementInsideOffsets(compiled.statements[ownerIndex], selectedFrom, selectedTo);
      if (mutationInside === ownerInside) continue;
      return reject(
        "cross-boundary-mutation",
        `bare mutation「${statement.construction}」は mutation target geometry owner と Extract 境界をまたぐため移動できません。`,
        { statementId, statementIndex }
      );
    }
  }
  return null;
};

const sourceReferenceSequencesByStatementId = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  excludedStatementIds: ReadonlySet<StatementIdentity>
): ReadonlyMap<StatementIdentity, readonly string[]> => {
  const source = compiled.spans.sourceMap.source;
  const references = canonicalFinalReferenceOccurrences(source, index.occurrences);
  const result = new Map<StatementIdentity, string[]>();

  for (const [statementIndex, statementId] of compiled.statementMap?.statementIdByStatementIndex ?? []) {
    if (excludedStatementIds.has(statementId)) continue;
    const statement = compiled.statements[statementIndex];
    if (!statement) continue;
    const identities = references
      .filter((occurrence) =>
        occurrence.from >= statement.documentRange.from &&
        occurrence.to <= statement.documentRange.to
      )
      .map((occurrence) => semanticOwnerKey(compiled, occurrence.identity));
    if (identities.length > 0) result.set(statementId, identities);
  }
  return result;
};

const replacementSplicesOutsideSelection = (
  source: string,
  starts: readonly number[],
  selectedStartLine: number,
  selectedEndLine: number,
  replacements: readonly AbsoluteReplacement[]
): LineSplice[] | null => {
  const byLine = new Map<number, AbsoluteReplacement[]>();
  for (const replacement of replacements) {
    const startLine = lineAtOffset(starts, replacement.from);
    const endLine = lineAtOffset(starts, Math.max(replacement.from, replacement.to - 1));
    if (startLine !== endLine || (startLine >= selectedStartLine && startLine <= selectedEndLine)) {
      return null;
    }
    const bucket = byLine.get(startLine) ?? [];
    bucket.push(replacement);
    byLine.set(startLine, bucket);
  }

  const splices: LineSplice[] = [];
  for (const [line, lineReplacements] of [...byLine.entries()].sort((left, right) => left[0] - right[0])) {
    const from = starts[line - 1]!;
    const to = lineEndOffset(source, starts, line);
    const replacement = applyAbsoluteReplacements(source, from, to, lineReplacements);
    if (replacement === null) return null;
    splices.push({ startLine: line, endLine: line, replacementLines: [replacement] });
  }
  return splices;
};

const exportInsertionPoint = (statement: DslStatement): number | null => {
  const span = statement.keywordPhysicalSpan;
  return span?.segments.length === 1 ? span.segments[0]!.from : null;
};

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

type ValueStatementContext = "selected" | "structural-descendant" | "module-descendant";

const valueStatementRejection = (
  statement: DslStatement,
  statementId: StatementIdentity,
  statementIndex: number,
  context: ValueStatementContext
): ExtractModuleRejection | null => {
  const where = context === "selected"
    ? "選択statement"
    : "structural descendant";
  if (statement.kind === "typedDeclaration") {
    const arrayType = geometryArrayTypeOfTypedDeclaration(statement);
    if (statement.recordTypeReference && context === "structural-descendant") {
      return reject(
        "unsupported-statement",
        `${where} declaration「${statement.name}」の record value は structural Extract subtree の対象外です。`,
        { statementId, statementIndex }
      );
    }
    if (!arrayType && !statement.declaredType && !statement.recordTypeReference) {
      return reject(
        "unsupported-statement",
        `${where} declaration「${statement.name}」は Checkpoint 7 の scalar / geometry-array / record scope 外です。`,
        { statementId, statementIndex }
      );
    }
    if (statement.exported && context !== "module-descendant") {
      return reject(
        "existing-public-interface",
        "既存の export declaration を nested Module へ移すと公開interfaceが変わるため Extract できません。",
        { statementId, statementIndex }
      );
    }
    return null;
  }
  if (statement.kind === "element") {
    if (statement.category === "mutation" && bareConstructionFor(statement.construction)) return null;
    if (!moduleGeometryInterfaceTypeOfElement(statement)) {
      return reject(
        "unsupported-statement",
        `${where} geometry declaration「${statement.name}」は Checkpoint 7 の point / line / path interface で表現できません。`,
        { statementId, statementIndex }
      );
    }
    if (statement.exported && context !== "module-descendant") {
      return reject(
        "existing-public-interface",
        "既存の export geometry declaration を nested Module へ移すと公開interfaceが変わるため Extract できません。",
        { statementId, statementIndex }
      );
    }
    return null;
  }
  if (statement.kind === "set") return null;
  return reject(
    "unsupported-statement",
    `「${statement.kind}」statement は Checkpoint 7 の scalar / single-geometry / geometry-array value scope 外です。`,
    { statementId, statementIndex }
  );
};

const checkpointStatementRejection = (
  statement: DslStatement,
  statementId: StatementIdentity,
  statementIndex: number
): ExtractModuleRejection | null => {
  if (statement.kind === "import" || statement.kind === "fileReExport") {
    return reject(
      "unsupported-statement",
      `「${statement.kind}」statement は local-source Extract Module v1 の対象外です。`,
      { statementId, statementIndex }
    );
  }
  if (
    statement.kind === "group" ||
    isConditionalGroupStatement(statement) ||
    isForGroupStatement(statement) ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance"
  ) return null;
  return valueStatementRejection(statement, statementId, statementIndex, "selected");
};

const checkpointStructuralDescendantRejection = (
  statement: DslStatement,
  statementId: StatementIdentity,
  statementIndex: number,
  insideModuleDefinition: boolean
): ExtractModuleRejection | null => {
  if (
    statement.kind === "group" ||
    isConditionalGroupStatement(statement) ||
    isForGroupStatement(statement) ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance"
  ) return null;
  return valueStatementRejection(
    statement,
    statementId,
    statementIndex,
    insideModuleDefinition ? "module-descendant" : "structural-descendant"
  );
};

const moduleDefinitionOwnerIndex = (
  compiled: CompiledDslDocument,
  statementIndex: number
): number | null => {
  const visited = new Set<number>();
  let enclosing = compiled.statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    if (compiled.statements[enclosing.statementIndex]?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = compiled.statements[enclosing.statementIndex]?.enclosing ?? null;
  }
  return null;
};

const moduleDefinitionForOwnedStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number
) => {
  const ownerIndex = moduleDefinitionOwnerIndex(compiled, statementIndex);
  if (ownerIndex === null) return null;
  const statementId = statementIdForIndex(compiled, statementIndex);
  const ownerStatementId = statementIdForIndex(compiled, ownerIndex);
  const definition = ownerStatementId
    ? compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(ownerStatementId)
    : undefined;
  return definition && definition.statementIndex === ownerIndex && statementId && definition.bodyStatementIds.includes(statementId)
    ? definition
    : null;
};

const moduleIdentityOwnedByMovedSubtree = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  movedIndexes: ReadonlySet<number>
): boolean => {
  if (identity.kind === "recordValue") {
    const statementIndex = statementIndexForId(compiled, identity.statementId);
    return statementIndex !== undefined && movedIndexes.has(statementIndex);
  }
  if (identity.kind === "typed") {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
    return binding !== undefined && movedIndexes.has(binding.statementIndex);
  }
  if (identity.kind !== "module") return false;
  const target = identity.target;
  if (target.kind === "documentBinding") return false;
  const statementId = target.kind === "moduleParameter" ? target.slot.definitionStatementId : target.statementId;
  const statementIndex = statementIndexForId(compiled, statementId);
  return statementIndex !== undefined && movedIndexes.has(statementIndex);
};

const moduleInstanceContainingOccurrence = (
  occurrence: DslSemanticOccurrence,
  movedEntries: readonly MovedStatement[]
): MovedStatement | null => {
  for (const entry of movedEntries) {
    if (
      entry.statement.kind === "moduleInstance" &&
      occurrence.from >= entry.statement.documentRange.from &&
      occurrence.to <= entry.statement.documentRange.to
    ) return entry;
  }
  return null;
};

const geometryArrayArgumentOccurrences = (
  compiled: CompiledDslDocument,
  movedEntries: readonly MovedStatement[]
): DslSemanticOccurrence[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = namespace?.geometryArraySemanticAnalysis;
  if (!namespace || !analysis) return [];

  const occurrences: DslSemanticOccurrence[] = [];
  for (const entry of movedEntries) {
    if (entry.statement.kind !== "moduleInstance") continue;
    const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(entry.statementId);
    if (!instance?.callee) continue;
    for (const parameter of analysis.moduleParameters) {
      if (parameter.definitionStatementId !== instance.callee.definitionStatementId) continue;
      const binding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (binding?.argumentIndex === null || binding?.argumentIndex === undefined) continue;
      const argument = entry.statement.arguments[binding.argumentIndex];
      const physical = argument?.valuePhysicalSpan?.segments.length === 1
        ? argument.valuePhysicalSpan.segments[0]
        : null;
      if (!argument || !physical) continue;
      const parsed = parseDslSourceReference(argument.value);
      if (parsed.kind !== "valid" || parsed.reference.property) continue;
      const lookup = resolveSourceLexicalPath(namespace, entry.statementIndex, parsed.reference.path);
      let identity: DslSemanticIdentity | null = null;
      const callerParameterIndex = parsed.reference.path.segments.length === 1 && instance.callerModuleDefinitionStatementId
        ? (() => {
            const callerDefinition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(
              instance.callerModuleDefinitionStatementId
            );
            const callerStatement = callerDefinition ? compiled.statements[callerDefinition.statementIndex] : undefined;
            return callerStatement?.kind === "moduleDefinition"
              ? callerStatement.parameters.findIndex((candidate) => {
                  if (candidate.name !== parsed.reference.path.segments[0]) return false;
                  const arrayType = geometryArrayTypeOfModuleParameter(candidate);
                  return arrayType?.elementType === parameter.type.elementType;
                })
              : -1;
          })()
        : -1;
      if (callerParameterIndex >= 0 && instance.callerModuleDefinitionStatementId) {
        identity = {
          kind: "module",
          target: {
            kind: "moduleParameter",
            slot: {
              definitionStatementId: instance.callerModuleDefinitionStatementId,
              parameterIndex: callerParameterIndex
            }
          }
        };
      } else if (
        lookup.kind === "resolved" &&
        lookup.declaration.kind === "typedDeclaration" &&
        lookup.declaration.statement.kind === "typedDeclaration"
      ) {
        const arrayType = geometryArrayTypeOfTypedDeclaration(lookup.declaration.statement);
        if (arrayType?.elementType === parameter.type.elementType) {
          identity = { kind: "module", target: { kind: "moduleSource", statementId: lookup.declaration.statementId } };
        }
      }
      if (!identity) continue;
      const pathFrom = physical.from + parsed.reference.pathRange.start;
      const pathTo = physical.from + parsed.reference.pathRange.end;
      occurrences.push({
        from: pathFrom,
        to: pathTo,
        kind: "reference",
        identity
      });
    }
  }

  return occurrences;
};

const selectedRootIndexForStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  selectedIndexes: ReadonlySet<number>
): number | null => {
  let currentIndex = statementIndex;
  const visited = new Set<number>();
  while (!visited.has(currentIndex)) {
    if (selectedIndexes.has(currentIndex)) return currentIndex;
    visited.add(currentIndex);
    const enclosing = compiled.statements[currentIndex]?.enclosing;
    if (!enclosing) return null;
    currentIndex = enclosing.statementIndex;
  }
  return null;
};

const lexicalTieBreak = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const planExtractModule = (input: ExtractModulePlanInput): ExtractModulePlanResult => {
  const { source: snapshot, compiled, statementIds, moduleName, instanceName } = input;
  const statementMap = compiled.statementMap;
  const namespace = compiled.sourceLexicalNamespace;
  const source = snapshot.normalizedSource;

  if (
    !statementMap ||
    !namespace ||
    snapshot.sourceRevision !== statementMap.sourceRevision ||
    snapshot.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    source !== compiled.spans.sourceMap.source
  ) {
    return reject("stale-semantic-snapshot", "Extract Module には exact-current の source/semantic snapshot が必要です。");
  }
  if (!cleanCompile(compiled)) {
    return reject("stale-semantic-snapshot", "現在の semantic snapshot に未解決エラーがあるため Extract Module の安全性を証明できません。");
  }
  if (statementIds.length === 0 || new Set(statementIds).size !== statementIds.length) {
    return reject("invalid-target", "Extract Module には1件以上の重複しない authored statement が必要です。");
  }
  if (!moduleName || !instanceName || moduleName.includes("\n") || instanceName.includes("\n")) {
    return reject("invalid-name", "生成する Module 名と instance 名には空でない有効な名前が必要です。");
  }
  if (moduleName === instanceName) {
    return reject("invalid-name", "Module 名と instance 名は別の名前にしてください。");
  }

  const selected = statementIds.map((statementId) => {
    const statementIndex = statementIndexForId(compiled, statementId);
    return statementIndex === undefined
      ? null
      : { statementId, statementIndex, statement: compiled.statements[statementIndex] };
  });
  if (selected.some((entry) => !entry?.statement)) {
    return reject(
      "non-authored-target",
      "選択対象が現在の authored source statement として解決できません。materialized Module descendant または stale target の可能性があります。"
    );
  }

  const ordered = (selected as MovedStatement[]).sort((left, right) => left.statementIndex - right.statementIndex);
  const first = ordered[0]!;
  const firstScope = namespace.scopeIndex.scopeOfStatement.get(first.statementIndex);
  if (!firstScope) {
    return reject("invalid-target", "選択先の lexical scope を解決できません。", {
      statementId: first.statementId,
      statementIndex: first.statementIndex
    });
  }

  const firstModuleOwnerIndex = moduleDefinitionOwnerIndex(compiled, first.statementIndex);
  const containingModuleDefinition = firstModuleOwnerIndex === null
    ? null
    : moduleDefinitionForOwnedStatement(compiled, first.statementIndex);
  if (firstModuleOwnerIndex !== null && !containingModuleDefinition) {
    return reject(
      "unresolved-semantic-identity",
      "既存 Module definition の exact semantic identity と body ownership を取得できません。",
      { statementId: first.statementId, statementIndex: first.statementIndex }
    );
  }

  for (const entry of ordered) {
    const scope = namespace.scopeIndex.scopeOfStatement.get(entry.statementIndex);
    if (scope !== firstScope || !sameEnclosing(entry.statement.enclosing, first.statement.enclosing)) {
      return reject(
        "cross-scope-target",
        "Extract Module の対象は同じ lexical scope の sibling statement に限定されます。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
    const ownerIndex = moduleDefinitionOwnerIndex(compiled, entry.statementIndex);
    if (ownerIndex !== firstModuleOwnerIndex) {
      return reject(
        "cross-scope-target",
        "Extract Module の対象は同じ containing Module definition に所有される sibling statement に限定されます。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
    if (ownerIndex !== null && !moduleDefinitionForOwnedStatement(compiled, entry.statementIndex)) {
      return reject(
        "unresolved-semantic-identity",
        "既存 Module definition の body ownership と authored statement identity を証明できません。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
  }
  for (const entry of ordered) {
    const rejection = checkpointStatementRejection(entry.statement, entry.statementId, entry.statementIndex);
    if (rejection) return rejection;
  }

  const selectedIndexSet = new Set(ordered.map((entry) => entry.statementIndex));
  const siblings = compiled.statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter(({ statement, statementIndex }) =>
      !isStructuralStatement(statement) &&
      namespace.scopeIndex.scopeOfStatement.get(statementIndex) === firstScope &&
      sameEnclosing(statement.enclosing, first.statement.enclosing)
    );
  const selectedSiblingPositions = siblings
    .map((entry, position) => selectedIndexSet.has(entry.statementIndex) ? position : -1)
    .filter((position) => position >= 0);
  const minPosition = Math.min(...selectedSiblingPositions);
  const maxPosition = Math.max(...selectedSiblingPositions);
  if (maxPosition - minPosition + 1 !== selectedSiblingPositions.length) {
    const intervening = siblings
      .slice(minPosition, maxPosition + 1)
      .find((entry) => !selectedIndexSet.has(entry.statementIndex));
    const interveningId = intervening
      ? statementMap.statementIdByStatementIndex?.get(intervening.statementIndex)
      : undefined;
    return reject(
      "non-contiguous-target",
      "Extract Module の対象statementは authored source order で連続している必要があります。",
      {
        ...(intervening ? { interveningStatementIndex: intervening.statementIndex } : {}),
        ...(interveningId ? { interveningStatementId: interveningId } : {})
      }
    );
  }

  for (const generatedName of [moduleName, instanceName]) {
    if ((namespace.declarationsByScopeAndName.get(firstScope)?.get(generatedName) ?? []).length > 0) {
      return reject(
        "name-collision",
        `生成名「${generatedName}」は対象 lexical scope の既存 declaration と衝突します。`
      );
    }
  }

  const starts = lineStarts(source);
  const firstInfo = statementMap.statements[first.statementIndex];
  const last = ordered[ordered.length - 1]!;
  const lastInfo = statementMap.statements[last.statementIndex];
  if (
    !firstInfo ||
    !lastInfo ||
    firstInfo.sourceRevision !== snapshot.sourceRevision ||
    lastInfo.sourceRevision !== snapshot.sourceRevision
  ) {
    return reject("stale-semantic-snapshot", "選択statementの source range が current revision と一致しません。");
  }
  const selectedStartLine = firstInfo.range.startLine;
  const selectedEndLine = lastInfo.range.endLine;
  const selectedFrom = starts[selectedStartLine - 1];
  const selectedTo = lineEndOffset(source, starts, selectedEndLine);
  if (selectedFrom === undefined || selectedFrom > selectedTo) {
    return reject("invalid-target", "選択statementの物理 source range を確定できません。");
  }

  const movedEntries: MovedStatement[] = [];
  for (let statementIndex = 0; statementIndex < compiled.statements.length; statementIndex += 1) {
    const statement = compiled.statements[statementIndex]!;
    if (isStructuralStatement(statement) || !statementInsideOffsets(statement, selectedFrom, selectedTo)) continue;
    const statementId = statementMap.statementIdByStatementIndex?.get(statementIndex);
    if (!statementId) {
      return reject(
        "non-authored-target",
        "Extract 範囲内の authored statement identity を exact-current StatementMap から取得できません。",
        { statementIndex }
      );
    }
    movedEntries.push({ statementId, statementIndex, statement });
  }
  const movedIndexSet = new Set(movedEntries.map((entry) => entry.statementIndex));
  const movedModuleDeclarationNames = new Set(
    movedEntries
      .filter((entry) => entry.statement.kind === "moduleDefinition" || entry.statement.kind === "moduleInstance")
      .map((entry) => entry.statement.name)
  );
  for (const generatedName of [moduleName, instanceName]) {
    if (movedModuleDeclarationNames.has(generatedName)) {
      return reject(
        "name-collision",
        `生成名「${generatedName}」が移動対象の Module definition / instance と衝突します。`
      );
    }
  }
  for (const entry of movedEntries) {
    const selectedRootIndex = selectedRootIndexForStatement(compiled, entry.statementIndex, selectedIndexSet);
    if (selectedRootIndex === null || selectedRootIndex === entry.statementIndex) continue;
    const selectedRoot = compiled.statements[selectedRootIndex];
    const rejection = selectedRoot && (
      selectedRoot.kind === "group" ||
      isConditionalGroupStatement(selectedRoot) ||
      isForGroupStatement(selectedRoot) ||
      selectedRoot.kind === "moduleDefinition"
    )
      ? checkpointStructuralDescendantRejection(
          entry.statement,
          entry.statementId,
          entry.statementIndex,
          moduleDefinitionOwnerIndex(compiled, entry.statementIndex) !== null
        )
      : null;
    if (rejection) return rejection;
  }

  const mutationRejection = validateMutationBoundaries(compiled, selectedFrom, selectedTo);
  if (mutationRejection) return mutationRejection;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(compiled);
  const references = canonicalFinalReferenceOccurrences(source, occurrenceIndex.occurrences);
  const selectedReferences = [
    ...references.filter((occurrence) => occurrence.from >= selectedFrom && occurrence.to <= selectedTo),
    ...geometryArrayArgumentOccurrences(compiled, movedEntries)
  ];
  const movedExternalModuleCallees: MovedExternalModuleCallee[] = [];
  for (const instance of compiled.moduleSemanticAnalysis?.instancesByStatementId.values() ?? []) {
    if (!movedIndexSet.has(instance.statementIndex)) continue;
    if (instance.calleeResolution !== "resolved" || !instance.callee) {
      return reject(
        "unsafe-rewrite",
        "移動対象の module instance の callee を一意な Module definition として証明できません。",
        { statementId: instance.statementId, statementIndex: instance.statementIndex }
      );
    }
    if (!movedIndexSet.has(instance.callee.definitionStatementIndex)) {
      movedExternalModuleCallees.push({
        instanceStatementId: instance.statementId,
        definitionStatementId: instance.callee.definitionStatementId
      });
    }
  }
  const dependencyByIdentity = new Map<string, {
    descriptor: DependencyDescriptor;
    occurrences: DslSemanticOccurrence[];
    argumentSource: string;
    recordFieldProofs: RecordFieldDependencyProof[];
    sourceOwnerKey: string;
  }>();
  const movedIterationReferences = new Map<StatementIdentity, number>();

  for (const occurrence of selectedReferences) {
    if (occurrence.identity.kind === "recordType") continue;
    if (
      occurrence.kind === "reference" &&
      source[occurrence.to] === "."
    ) {
      const ownerDescriptor = dependencyDescriptor(compiled, occurrenceIndex, occurrence.identity);
      if (ownerDescriptor?.recordTypeIdentity) continue;
    }
    let dependencyIdentity: DslSemanticIdentity = occurrence.identity;
    let dependencyOccurrence = occurrence;
    let recordFieldProof: RecordFieldDependencyProof | null = null;
    if (occurrence.identity.kind === "recordField") {
      const resolved = recordFieldBaseOccurrenceFor(source, compiled, occurrenceIndex, occurrence);
      if (resolved.kind === "notField") continue;
      if (resolved.kind === "invalid") {
        return reject(
          "unrepresentable-dependency",
          "record field reference の whole-record source と nominal owner を一意に証明できません。"
        );
      }
      dependencyIdentity = resolved.proof.baseOccurrence.identity;
      dependencyOccurrence = resolved.proof.baseOccurrence;
      recordFieldProof = resolved.proof;
    }
    const containingModuleInstance = moduleInstanceContainingOccurrence(occurrence, movedEntries);
    if (dependencyIdentity.kind === "module") {
      const target = dependencyIdentity.target;
      const externalCallee = containingModuleInstance
        ? movedExternalModuleCallees.find((candidate) => candidate.instanceStatementId === containingModuleInstance.statementId)
        : undefined;
      if (target.kind === "moduleDefinition" && containingModuleInstance && externalCallee) {
        if (externalCallee?.definitionStatementId !== target.statementId) {
          return reject(
            "unrepresentable-dependency",
            "移動対象の module instance の authored callee を外部 Module dependency として証明できません。",
            { statementId: containingModuleInstance.statementId, statementIndex: containingModuleInstance.statementIndex }
          );
        }
        // The authored callee is a lexical Module dependency, not a wrapper
        // value parameter. Its identity is checked again after candidate
        // recompilation below.
        continue;
      }
      if (
        target.kind === "moduleParameter" &&
        externalCallee?.definitionStatementId === target.slot.definitionStatementId
      ) {
        // Argument labels belong to the external callee's authored interface;
        // they are not values captured by the generated wrapper Module.
        continue;
      }
    }
    const iterationOwnerStatementId = movedIterationBinding(compiled, dependencyIdentity, movedIndexSet);
    if (iterationOwnerStatementId) {
      movedIterationReferences.set(
        iterationOwnerStatementId,
        (movedIterationReferences.get(iterationOwnerStatementId) ?? 0) + 1
      );
      continue;
    }

    if (moduleIdentityOwnedByMovedSubtree(compiled, dependencyIdentity, movedIndexSet)) continue;

    const declarationRanges = declarationRangesFor(occurrenceIndex, dependencyIdentity);
    let descriptor: DependencyDescriptor | null;
    if (declarationRanges.length === 1) {
      const declaration = declarationRanges[0]!;
      if (declaration.from >= selectedFrom && declaration.to <= selectedTo) {
        if (!directSelectedValueStatement(compiled, dependencyIdentity, movedIndexSet)) {
          return reject(
            "unrepresentable-dependency",
            "選択範囲内の reference が Checkpoint 7 の moved scalar / single-geometry / geometry-array owner として証明できません。"
          );
        }
        continue;
      }
      descriptor = dependencyDescriptor(compiled, occurrenceIndex, dependencyIdentity);
    } else {
      // Iteration slots are compiler-owned Binding Catalog declarations but
      // intentionally have no declaration occurrence in the editor index.
      descriptor = dependencyDescriptor(compiled, occurrenceIndex, dependencyIdentity);
    }
    if (!descriptor) {
      return reject(
        declarationRanges.length === 1 ? "unrepresentable-dependency" : "unresolved-semantic-identity",
        declarationRanges.length === 1
          ? "Checkpoint 7 では direct authored scalar / single-geometry / geometry-array dependency 以外を Module parameter として安全に表現しません。"
          : "選択範囲内の reference identity を一意な declaration へ解決できません。"
      );
    }

    const key = dslSemanticIdentityKey(dependencyIdentity);
    const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, dependencyOccurrence);
    const current = dependencyByIdentity.get(key);
    if (current) {
      current.occurrences.push(dependencyOccurrence);
      if (recordFieldProof) current.recordFieldProofs.push(recordFieldProof);
    }
    else {
      dependencyByIdentity.set(key, {
        descriptor,
        occurrences: [dependencyOccurrence],
        argumentSource: source.slice(path.argumentFrom, path.to),
        recordFieldProofs: recordFieldProof ? [recordFieldProof] : [],
        sourceOwnerKey: semanticOwnerKey(compiled, dependencyIdentity)
      });
    }
  }

  const dependencies: ExtractModuleDependency[] = [...dependencyByIdentity.entries()]
    .map(([identityKey, value]) => ({
      identityKey,
      name: value.descriptor.name,
      type: value.descriptor.type,
      typeText: value.descriptor.typeText,
      ...(value.descriptor.recordTypeIdentity ? { recordTypeIdentity: value.descriptor.recordTypeIdentity } : {}),
      argumentSource: value.argumentSource,
      declarationFrom: value.descriptor.declarationFrom
    }))
    .sort((left, right) =>
      left.declarationFrom - right.declarationFrom ||
      lexicalTieBreak(left.identityKey, right.identityKey)
    );

  const dependencyNames = new Map<string, string>();
  for (const dependency of dependencies) {
    const prior = dependencyNames.get(dependency.name);
    if (prior && prior !== dependency.identityKey) {
      return reject(
        "parameter-name-collision",
        `異なる dependency が同じ parameter 名「${dependency.name}」になるため安全に Extract できません。`
      );
    }
    dependencyNames.set(dependency.name, dependency.identityKey);
  }

  const selectedDeclarationNames = new Set(
    ordered
      .filter((entry) =>
        entry.statement.kind === "typedDeclaration" ||
        entry.statement.kind === "element" ||
        entry.statement.kind === "group" ||
        entry.statement.kind === "moduleDefinition" ||
        entry.statement.kind === "moduleInstance"
      )
      .map((entry) => entry.statement.name)
  );
  for (const name of movedModuleDeclarationNames) selectedDeclarationNames.add(name);
  for (const dependency of dependencies) {
    if (selectedDeclarationNames.has(dependency.name)) {
      return reject(
        "parameter-name-collision",
        `生成 parameter「${dependency.name}」が移動対象内の declaration と衝突します。`
      );
    }
  }

  const generatedParameterNameByIdentity = new Map<string, string>();
  const occupiedGeneratedNames = new Set(selectedDeclarationNames);
  for (const name of namespace.declarationsByScopeAndName.get(firstScope)?.keys() ?? []) occupiedGeneratedNames.add(name);
  for (const dependency of dependencies) {
    let generatedName = dependency.name;
    if (dependency.recordTypeIdentity && firstModuleOwnerIndex !== null) {
      generatedName = `${dependency.name}__extract`;
      let suffix = 2;
      while (occupiedGeneratedNames.has(generatedName)) {
        generatedName = `${dependency.name}__extract${suffix}`;
        suffix += 1;
      }
    }
    occupiedGeneratedNames.add(generatedName);
    generatedParameterNameByIdentity.set(dependency.identityKey, generatedName);
  }

  const internalReplacements: AbsoluteReplacement[] = [];
  for (const dependency of dependencyByIdentity.values()) {
    const generatedName = generatedParameterNameByIdentity.get(
      dslSemanticIdentityKey(dependency.occurrences[0]!.identity)
    );
    if (!generatedName) {
      return reject("unsafe-rewrite", "generated record parameter name を dependency identity へ結び付けられません。");
    }
    for (const occurrence of dependency.occurrences) {
      const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
      internalReplacements.push({
        from: path.rewriteFrom,
        to: path.to,
        text: formatDslName(generatedName)
      });
    }
  }

  const exports: ExtractModuleExport[] = [];
  const outsideReplacements: AbsoluteReplacement[] = [];
  const exportedIdentityKeys = new Set<string>();
  for (const declarationOccurrence of occurrenceIndex.occurrences.filter((occurrence) =>
    occurrence.kind === "declaration" &&
    occurrence.from >= selectedFrom &&
    occurrence.to <= selectedTo
  )) {
    const identityKey = dslSemanticIdentityKey(declarationOccurrence.identity);
    if (exportedIdentityKeys.has(identityKey)) continue;

    const outsideReferences = references.filter((reference) =>
      dslSemanticIdentityKey(reference.identity) === identityKey &&
      (reference.from < selectedFrom || reference.to > selectedTo)
    );
    const isRecordValue = declarationOccurrence.identity.kind === "recordValue";
    const outsideRecordFieldBases = isRecordValue
      ? references.flatMap((reference) => {
          if (
            reference.identity.kind !== "recordField" ||
            reference.from >= selectedFrom && reference.to <= selectedTo
          ) return [];
          const resolved = recordFieldBaseOccurrenceFor(source, compiled, occurrenceIndex, reference);
          if (resolved.kind === "invalid") return [];
          return resolved.kind === "resolved" &&
            dslSemanticIdentityKey(resolved.proof.baseOccurrence.identity) === identityKey
            ? [resolved.proof.baseOccurrence]
            : [];
        })
      : [];
    const recordOutsideReferences = [...outsideReferences, ...outsideRecordFieldBases]
      .filter((reference, index, all) => all.findIndex((candidate) =>
        candidate.from === reference.from && candidate.to === reference.to &&
        dslSemanticIdentityKey(candidate.identity) === dslSemanticIdentityKey(reference.identity)
      ) === index);
    if (recordOutsideReferences.length === 0) continue;

    // Keep export eligibility tied to the explicitly selected direct siblings.
    // A declaration nested under a moved structural subtree may move internally,
    // but exposing it through the generated Module would change its lexical interface.
    const direct = directSelectedValueStatement(compiled, declarationOccurrence.identity, selectedIndexSet);
    if (!direct) {
      return reject(
        "unrepresentable-export",
        "Checkpoint 7 では明示選択された direct scalar / single-geometry / geometry-array declaration 以外を Module export として公開しません。"
      );
    }

    const { statement, statementIndex, statementId } = direct;
    if (statement.kind === "typedDeclaration") {
      const arrayType = geometryArrayTypeOfTypedDeclaration(statement);
      if (!statement.name || (!arrayType && !statement.declaredType && !statement.recordTypeReference)) {
        return reject(
          "unrepresentable-export",
          `statement「${statement.name || statement.kind}」は Checkpoint 7 の direct scalar / geometry-array / record export で表現できません。`,
          { statementId, statementIndex }
        );
      }
      if (statement.recordTypeReference) {
        const recordValue = namespace.recordSemanticAnalysis?.valuesByStatementId.get(statementId);
        const typeText = exactAuthoredTypeText(compiled, statement, statement.payloadSpans.type);
        if (!recordValue?.typeIdentity || !typeText) {
          return reject(
            "unrepresentable-export",
            `record statement「${statement.name}」の nominal type identity と authored type source を証明できません。`,
            { statementId, statementIndex }
          );
        }
      }
    } else if (!moduleGeometryInterfaceTypeOfElement(statement) || !statement.name) {
      return reject(
        "unrepresentable-export",
        `geometry statement「${statement.name || statement.kind}」は Checkpoint 7 の direct geometry export で表現できません。`,
        { statementId, statementIndex }
      );
    }

    const insertion = exportInsertionPoint(statement);
    if (insertion === null) {
      return reject("unsafe-rewrite", "export keyword の exact source insertion point を確定できません。", {
        statementId,
        statementIndex
      });
    }
    internalReplacements.push({ from: insertion, to: insertion, text: "export " });

    for (const reference of recordOutsideReferences) {
      const path = isRecordValue
        ? sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, reference)
        : { rewriteFrom: reference.from, to: reference.to };
      outsideReplacements.push({
        from: path.rewriteFrom,
        to: path.to,
        text: `${formatDslName(instanceName)}::${formatDslName(statement.name)}`
      });
    }
    exports.push({ identityKey, name: statement.name, statementId, statementIndex });
    exportedIdentityKeys.add(identityKey);
  }

  const selectedText = applyAbsoluteReplacements(source, selectedFrom, selectedTo, internalReplacements);
  if (selectedText === null) {
    return reject("unsafe-rewrite", "選択範囲内の semantic rewrite が重複し、atomic source patch を構成できません。");
  }

  const firstRawLine = source.slice(
    starts[selectedStartLine - 1]!,
    lineEndOffset(source, starts, selectedStartLine)
  );
  const outerIndent = firstRawLine.match(/^\s*/)?.[0] ?? "";
  const parameterText = dependencies
    .map((dependency) => `${formatDslName(generatedParameterNameByIdentity.get(dependency.identityKey) ?? dependency.name)}: ${dependency.typeText}`)
    .join(", ");
  const argumentText = dependencies
    .map((dependency) => `${formatDslName(generatedParameterNameByIdentity.get(dependency.identityKey) ?? dependency.name)}: ${dependency.argumentSource}`)
    .join(", ");
  const bodyLines = selectedText
    .split("\n")
    .map((line) => line.trim().length === 0 ? line : `${DSL_INDENT}${line}`);

  const selectedSplice: LineSplice = {
    startLine: selectedStartLine,
    endLine: selectedEndLine,
    replacementLines: [
      `${outerIndent}module ${formatDslName(moduleName)}(${parameterText}) {`,
      ...bodyLines,
      `${outerIndent}}`,
      `${outerIndent}instance ${formatDslName(instanceName)} = ${formatDslName(moduleName)}(${argumentText})`
    ]
  };
  const outsideSplices = replacementSplicesOutsideSelection(
    source,
    starts,
    selectedStartLine,
    selectedEndLine,
    outsideReplacements
  );
  if (outsideSplices === null) {
    return reject("unsafe-rewrite", "範囲外 reference rewrite を exact single-line splice として表現できません。");
  }
  const splices = [...outsideSplices, selectedSplice]
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);

  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }

  const nextRevision = snapshot.sourceRevision + 1;
  const parsed = parseDslSnapshot({ normalizedSource: candidateSource, sourceRevision: nextRevision });
  const reconciled = reconcileStatements({
    oldStatements: compiled.statements,
    oldLines: compiled.sourceLines,
    oldElementIds: statementMap.elementIdByStatementIndex,
    oldStatementIds: statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: candidateSource.split("\n")
  });
  const nextCompiled = compileDslDocument(candidateSource, {
    preparsed: parsed,
    sourceRevision: nextRevision,
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds
  });

  const nextOccurrenceIndex = nextCompiled.statementMap && nextCompiled.sourceLexicalNamespace
    ? createDslSemanticOccurrenceIndex(nextCompiled)
    : null;
  const candidateRecordBindingIssuesOnly = Boolean(
    nextOccurrenceIndex &&
    (nextCompiled.bindingIssueDiagnostics ?? []).every((diagnostic) =>
      diagnostic.code === "undefined-binding" &&
      diagnostic.physicalSpan?.segments.length === 1 &&
      nextOccurrenceIndex.occurrences.some((occurrence) =>
        occurrence.kind === "reference" &&
        occurrence.identity.kind === "recordField" &&
        occurrence.from < diagnostic.physicalSpan!.segments[0]!.to &&
        diagnostic.physicalSpan!.segments[0]!.from < occurrence.to
      )
    )
  );
  if (
    !nextCompiled.statementMap ||
    !nextCompiled.sourceLexicalNamespace ||
    nextCompiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    (!candidateRecordBindingIssuesOnly && (nextCompiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error"))
  ) {
    const firstError = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
      .find((diagnostic) => diagnostic.severity === "error");
    return reject(
      "unsafe-rewrite",
      firstError?.message ?? "Extract 後の source semantics を安全にコンパイルできません。"
    );
  }
  if (!nextOccurrenceIndex) {
    return reject("unsafe-rewrite", "Extract 後の semantic occurrence index を再構成できません。");
  }

  const movedIds = new Set<StatementIdentity>(movedEntries.map((entry) => entry.statementId));
  for (const entry of movedEntries) {
    const nextIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(entry.statementId);
    const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
    if (
      !nextStatement ||
      nextStatement.kind !== entry.statement.kind ||
      nextStatement.name !== entry.statement.name
    ) {
      return reject("identity-loss", "Extract 後に authored statement identity を保持できませんでした。", {
        statementId: entry.statementId
      });
    }
  }

  for (const entry of movedEntries) {
    if (entry.statement.kind !== "typedDeclaration" || !entry.statement.recordTypeReference) continue;
    const beforeValue = compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(entry.statementId);
    const nextIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(entry.statementId);
    const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
    const nextValue = nextCompiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(entry.statementId);
    if (
      !beforeValue?.typeIdentity ||
      nextStatement?.kind !== "typedDeclaration" ||
      !nextStatement.recordTypeReference ||
      nextValue?.typeIdentity !== beforeValue.typeIdentity ||
      exactAuthoredTypeText(compiled, entry.statement, entry.statement.payloadSpans.type) !==
        exactAuthoredTypeText(nextCompiled, nextStatement, nextStatement.payloadSpans.type)
    ) {
      return reject("unsafe-rewrite", "moved record value の nominal type identity が変化しました。", {
        statementId: entry.statementId,
        statementIndex: entry.statementIndex
      });
    }
  }

  for (const entry of movedEntries) {
    if (entry.statement.kind !== "moduleDefinition") continue;
    const beforeDefinition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(entry.statementId);
    const nextIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(entry.statementId);
    const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
    const nextDefinition = nextCompiled.moduleSemanticAnalysis?.definitionsByStatementId.get(entry.statementId);
    if (!beforeDefinition || nextStatement?.kind !== "moduleDefinition" || !nextDefinition ||
      beforeDefinition.parameters.length !== nextDefinition.parameters.length ||
      nextStatement.parameters.length !== entry.statement.parameters.length) {
      return reject("unsafe-rewrite", "moved Module definition の semantic interface を再検証できません。", {
        statementId: entry.statementId,
        statementIndex: entry.statementIndex
      });
    }
    for (const [parameterIndex, beforeParameter] of beforeDefinition.parameters.entries()) {
      const beforeSource = entry.statement.parameters[parameterIndex];
      const nextParameter = nextDefinition.parameters[parameterIndex];
      const nextSource = nextStatement.parameters[parameterIndex];
      if (!beforeSource || !nextParameter || !nextSource) {
        return reject("unsafe-rewrite", "moved Module definition の parameter mapping を再検証できません。", {
          statementId: entry.statementId,
          statementIndex: entry.statementIndex
        });
      }
      const beforeRecord = beforeSource.recordTypeReference !== null && beforeSource.recordTypeReference !== undefined;
      const nextRecord = nextSource.recordTypeReference !== null && nextSource.recordTypeReference !== undefined;
      if (beforeRecord !== nextRecord || (beforeRecord && (
        !beforeParameter.recordTypeIdentity ||
        !nextParameter.recordTypeIdentity ||
        nextParameter.recordTypeIdentity !== beforeParameter.recordTypeIdentity ||
        exactAuthoredTypeText(compiled, entry.statement, beforeSource.typeSpan) !==
          exactAuthoredTypeText(nextCompiled, nextStatement, nextSource.typeSpan)
      ))) {
        return reject("unsafe-rewrite", "moved Module definition の record parameter nominal identity が変化しました。", {
          statementId: entry.statementId,
          statementIndex: entry.statementIndex
        });
      }
    }
  }

  for (const entry of movedEntries) {
    if (entry.statement.kind !== "element" || entry.statement.category !== "mutation") continue;
    const beforeOwners = mutationTargetStatementIndexes(compiled, entry);
    const expectedOwnerIds = beforeOwners?.map((ownerIndex) => statementIdForIndex(compiled, ownerIndex));
    const nextIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(entry.statementId);
    const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
    const nextOwners = nextStatement && nextIndex !== undefined
      ? mutationTargetStatementIndexes(nextCompiled, {
          statementId: entry.statementId,
          statementIndex: nextIndex,
          statement: nextStatement
        })
      : null;
    const nextOwnerIds = nextOwners?.map((ownerIndex) => statementIdForIndex(nextCompiled, ownerIndex));
    const expected = expectedOwnerIds?.filter((ownerId): ownerId is StatementIdentity => ownerId !== null) ?? [];
    const actual = nextOwnerIds?.filter((ownerId): ownerId is StatementIdentity => ownerId !== null) ?? [];
    if (
      expected.length !== expectedOwnerIds?.length ||
      actual.length !== nextOwnerIds?.length ||
      expected.length !== actual.length ||
      expected.some((ownerId) => !actual.includes(ownerId))
    ) {
      return reject(
        "identity-loss",
        "Extract 後に moved bare mutation の mutation target geometry owner identity を保持できませんでした。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
  }

  for (const movedExternalModuleCallee of movedExternalModuleCallees) {
    const nextInstance = nextCompiled.moduleSemanticAnalysis?.instancesByStatementId.get(
      movedExternalModuleCallee.instanceStatementId
    );
    const nextDefinitionIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(
      movedExternalModuleCallee.definitionStatementId
    );
    const nextDefinition = nextDefinitionIndex === undefined
      ? undefined
      : nextCompiled.statements[nextDefinitionIndex];
    if (
      !nextInstance ||
      nextInstance.calleeResolution !== "resolved" ||
      nextInstance.callee?.definitionStatementId !== movedExternalModuleCallee.definitionStatementId ||
      nextDefinition?.kind !== "moduleDefinition"
    ) {
      return reject(
        "unsafe-rewrite",
        "Extract 後に moved module instance の外部 Module callee が同じ StatementIdentity へ解決されませんでした。",
        { statementId: movedExternalModuleCallee.instanceStatementId }
      );
    }
    const beforeInstance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(
      movedExternalModuleCallee.instanceStatementId
    );
    const beforeDefinition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(
      movedExternalModuleCallee.definitionStatementId
    );
    const afterDefinition = nextCompiled.moduleSemanticAnalysis?.definitionsByStatementId.get(
      movedExternalModuleCallee.definitionStatementId
    );
    if (!beforeInstance || !beforeDefinition || !afterDefinition ||
      beforeDefinition.parameters.length !== afterDefinition.parameters.length) {
      return reject("unsafe-rewrite", "moved module instance の external Module interface を再検証できません。", {
        statementId: movedExternalModuleCallee.instanceStatementId
      });
    }
    const beforeDefinitionStatement = compiled.statements[beforeDefinition.statementIndex];
    for (const beforeParameter of beforeDefinition.parameters) {
      const beforeSourceParameter = beforeDefinitionStatement?.kind === "moduleDefinition"
        ? beforeDefinitionStatement.parameters[beforeParameter.parameterIndex]
        : undefined;
      if (!beforeSourceParameter?.recordTypeReference) continue;
      if (!beforeParameter.recordTypeIdentity) {
        return reject("unsafe-rewrite", "moved module instance の external Module record interface に nominal identity がありません。", {
          statementId: movedExternalModuleCallee.instanceStatementId
        });
      }
      const beforeBinding = beforeInstance.parameterBindings.find((binding) =>
        binding.parameterIndex === beforeParameter.parameterIndex
      );
      const afterBinding = nextInstance.parameterBindings.find((binding) =>
        binding.parameterIndex === beforeParameter.parameterIndex
      );
      const afterParameter = afterDefinition.parameters[beforeParameter.parameterIndex];
      const afterRecordBinding = afterBinding?.value?.kind === "record" ? afterBinding.value : null;
      if (
        !beforeBinding ||
        !afterBinding ||
        !afterParameter ||
        afterParameter.recordTypeIdentity !== beforeParameter.recordTypeIdentity ||
        beforeBinding.state !== afterBinding.state ||
        (beforeBinding.value?.kind === "record" && (
          afterRecordBinding === null ||
          afterRecordBinding.reference.resolution !== "resolved" ||
          afterRecordBinding.reference.typeIdentity !== beforeParameter.recordTypeIdentity ||
          (afterRecordBinding.reference.target === null && afterRecordBinding.reference.constructor === null)
        ))
      ) {
        return reject("unsafe-rewrite", "moved module instance の record argument semantic binding が変化しました。", {
          statementId: movedExternalModuleCallee.instanceStatementId
        });
      }
    }
  }

  const generatedModule = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleDefinition" &&
    declaration.scopeId === firstScope &&
    declaration.name === moduleName
  );
  const generatedInstance = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleInstance" &&
    declaration.scopeId === firstScope &&
    declaration.name === instanceName
  );
  if (!generatedModule || !generatedInstance) {
    return reject("unsafe-rewrite", "生成した Module / instance を target lexical scope で再解決できません。");
  }

  const generatedModuleStatement = nextCompiled.statements[generatedModule.statementIndex];
  const generatedInstanceStatement = nextCompiled.statements[generatedInstance.statementIndex];
  const generatedModuleSemantic = nextCompiled.moduleSemanticAnalysis?.definitionsByStatementId.get(generatedModule.statementId);
  const generatedInstanceSemantic = nextCompiled.moduleSemanticAnalysis?.instancesByStatementId.get(generatedInstance.statementId);
  if (
    generatedModuleStatement?.kind !== "moduleDefinition" ||
    generatedInstanceStatement?.kind !== "moduleInstance" ||
    !generatedModuleSemantic ||
    !generatedInstanceSemantic ||
    generatedModuleSemantic.declarationScopeId !== firstScope ||
    generatedInstanceSemantic.callerModuleDefinitionStatementId !== (containingModuleDefinition?.statementId ?? null) ||
    generatedInstanceSemantic.calleeResolution !== "resolved" ||
    generatedInstanceSemantic.callee?.definitionStatementId !== generatedModule.statementId
  ) {
    return reject("unsafe-rewrite", "生成した nested Module と instance の lexical ownership を証明できません。");
  }

  if (generatedModuleStatement.parameters.length !== dependencies.length) {
    return reject("unsafe-rewrite", "生成した nested Module の parameter interface が計画内容と一致しません。");
  }
  for (const exported of exports) {
    const originalStatement = compiled.statements[exported.statementIndex];
    if (originalStatement?.kind !== "typedDeclaration" || !originalStatement.recordTypeReference) continue;
    const originalValue = namespace.recordSemanticAnalysis?.valuesByStatementId.get(exported.statementId);
    const generatedExport = generatedModuleSemantic.exports.find((candidate) =>
      candidate.kind === "record" &&
      candidate.name === exported.name &&
      candidate.exportedStatementId === exported.statementId
    );
    if (
      !originalValue?.typeIdentity ||
      !generatedExport ||
      generatedExport.kind !== "record" ||
      generatedExport.ownerModuleDefinitionStatementId !== generatedModule.statementId ||
      generatedExport.typeIdentity !== originalValue.typeIdentity
    ) {
      return reject("unsafe-rewrite", "generated record export の Module semantic identity が元の nominal record と一致しません.", {
        statementId: exported.statementId,
        statementIndex: exported.statementIndex
      });
    }
  }
  const nextMovedEntries = movedEntries.flatMap((entry) => {
    const statementIndex = nextCompiled.statementMap?.statementIndexByStatementId?.get(entry.statementId);
    const statement = statementIndex === undefined ? undefined : nextCompiled.statements[statementIndex];
    return statementIndex === undefined || !statement
      ? []
      : [{ statementId: entry.statementId, statementIndex, statement }];
  });
  const nextArrayArgumentOccurrences = geometryArrayArgumentOccurrences(nextCompiled, [
    ...nextMovedEntries,
    { statementId: generatedInstance.statementId, statementIndex: generatedInstance.statementIndex, statement: generatedInstanceStatement }
  ]);
  const nextReferenceOccurrences = [...nextOccurrenceIndex.occurrences, ...nextArrayArgumentOccurrences];
  const nextReferenceOwnerKey = (occurrence: DslSemanticOccurrence) => semanticOwnerKey(nextCompiled, occurrence.identity);
  const characterBeforeOccurrence = (occurrence: DslSemanticOccurrence): string =>
    nextCompiled.spans.sourceMap.source.slice(Math.max(0, occurrence.from - 1), occurrence.from);
  const candidateArrayArgumentOwnerMatches = (
    planned: { occurrences: readonly DslSemanticOccurrence[] },
    dependency: ExtractModuleDependency
  ): boolean => {
    if (dependency.type?.kind !== "geometryArray") return false;
    const identity = planned.occurrences[0]?.identity;
    if (identity?.kind !== "module") return false;
    if (identity.target.kind === "moduleParameter") {
      const definition = nextCompiled.moduleSemanticAnalysis?.definitionsByStatementId.get(
        identity.target.slot.definitionStatementId
      );
      const parameter = definition?.parameters[identity.target.slot.parameterIndex];
      const statement = definition ? nextCompiled.statements[definition.statementIndex] : undefined;
      const sourceParameter = statement?.kind === "moduleDefinition"
        ? statement.parameters[identity.target.slot.parameterIndex]
        : undefined;
      const arrayType = sourceParameter ? geometryArrayTypeOfModuleParameter(sourceParameter) ?? parameter?.type : undefined;
      return Boolean(
        definition &&
        parameter?.name === dependency.name &&
        arrayType?.kind === "geometryArray" &&
        arrayType.elementType === dependency.type.elementType
      );
    }
    if (identity.target.kind !== "moduleSource") return false;
    const statementIndex = statementIndexForId(nextCompiled, identity.target.statementId);
    const statement = statementIndex === undefined ? undefined : nextCompiled.statements[statementIndex];
    const arrayType = statement?.kind === "typedDeclaration"
      ? geometryArrayTypeOfTypedDeclaration(statement)
      : nextCompiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementId.get(
          identity.target.statementId
        )?.type;
    return Boolean(
      statement &&
      arrayType?.kind === "geometryArray" &&
      arrayType.elementType === dependency.type.elementType
    );
  };
  for (const [dependencyIndex, dependency] of dependencies.entries()) {
    const planned = dependencyByIdentity.get(dependency.identityKey);
    const generatedParameter = generatedModuleSemantic.parameters[dependencyIndex];
    const sourceParameter = generatedModuleStatement.parameters[dependencyIndex];
    const recordDependency = dependency.type === null && dependency.recordTypeIdentity !== undefined;
    const generatedParameterName = generatedParameterNameByIdentity.get(dependency.identityKey);
    const generatedType = sourceParameter
      ? geometryArrayTypeOfModuleParameter(sourceParameter) ?? generatedParameter?.type
      : undefined;
    const generatedRecordTypeText = sourceParameter?.recordTypeReference
      ? exactAuthoredTypeText(nextCompiled, generatedModuleStatement, sourceParameter.typeSpan)
      : null;
    const parameterMatches = recordDependency
      ? Boolean(
          sourceParameter?.recordTypeReference &&
          generatedParameter?.type === null &&
          generatedParameter.recordTypeIdentity === dependency.recordTypeIdentity &&
          generatedRecordTypeText === dependency.typeText
        )
      : Boolean(
          generatedType &&
          moduleParameterTypeText(generatedType, generatedParameter?.numericTypeOptions) === dependency.typeText
        );
    if (!planned || !generatedParameter || !sourceParameter || !generatedParameterName || sourceParameter.name !== generatedParameterName || !parameterMatches) {
      return reject("unsafe-rewrite", "生成した nested Module parameter が元の semantic dependency と一致しません。");
    }

    const argument = generatedInstanceStatement.arguments[dependencyIndex];
    const binding = generatedInstanceSemantic.parameterBindings.find((candidate) =>
      candidate.parameterIndex === dependencyIndex
    );
    if (
      !argument ||
      argument.label !== generatedParameterName ||
      argument.value.trim() !== dependency.argumentSource.trim() ||
      !binding ||
      binding.argumentIndex !== dependencyIndex
    ) {
      return reject("unsafe-rewrite", "生成した Module instance argument が元の authored dependency source と一致しません。");
    }

    const expectedOwnerKey = planned.sourceOwnerKey;
    const recordArgument = recordDependency && binding?.value?.kind === "record"
      ? binding.value.reference
      : null;
    const recordArgumentTargetIdentity = recordArgument?.target
      ? recordSourceTargetIdentity(recordArgument.target)
      : null;
    const recordArgumentMatches = recordDependency && recordArgument
      ? recordArgument.resolution === "resolved" &&
        recordArgument.source.trim() === dependency.argumentSource.trim() &&
        recordArgument.typeIdentity === dependency.recordTypeIdentity &&
        (recordArgument.target?.typeIdentity ?? recordArgument.constructor?.targetTypeIdentity) === dependency.recordTypeIdentity &&
        recordArgumentTargetIdentity !== null &&
        semanticOwnerKey(nextCompiled, recordArgumentTargetIdentity) === expectedOwnerKey
      : false;
    const argumentOwnerMatches = recordDependency
      ? recordArgumentMatches
      : dependency.type?.kind === "geometryArray"
      ? nextArrayArgumentOccurrences.some((occurrence) =>
          occurrence.from >= generatedInstanceStatement.documentRange.from &&
          occurrence.to <= generatedInstanceStatement.documentRange.to &&
          nextReferenceOwnerKey(occurrence) === expectedOwnerKey
        )
        || candidateArrayArgumentOwnerMatches(planned, dependency)
      : nextReferenceOccurrences.some((occurrence) =>
          occurrence.kind === "reference" &&
          occurrence.from >= generatedInstanceStatement.documentRange.from &&
          occurrence.to <= generatedInstanceStatement.documentRange.to &&
          nextReferenceOwnerKey(occurrence) === expectedOwnerKey
        );
    if (!argumentOwnerMatches) {
      return reject("unsafe-rewrite", "生成した Module instance argument が元の semantic owner へ解決されません。");
    }
  }

  const candidateRecordFieldCount = (
    planned: { recordFieldProofs: readonly RecordFieldDependencyProof[] },
    expectedOwnerKey: string
  ): number => nextReferenceOccurrences.filter((occurrence) => {
    if (
      occurrence.kind !== "reference" ||
      occurrence.identity.kind !== "recordField" ||
      characterBeforeOccurrence(occurrence) !== "."
    ) return false;
    const field = occurrence.identity.field;
    if (!planned.recordFieldProofs.some((proof) =>
      proof.field.recordStatementId === field.recordStatementId &&
      proof.field.fieldIndex === field.fieldIndex
    )) return false;
    const baseCandidates = nextReferenceOccurrences.filter((candidate) =>
      candidate.kind === "reference" &&
      candidate.to + 1 === occurrence.from &&
      nextCompiled.spans.sourceMap.source[candidate.to] === "." &&
      expectedOwnerKey === nextReferenceOwnerKey(candidate)
    );
    return baseCandidates.length === 1 && movedEntries.some((entry) => {
      const nextIndex = nextCompiled.statementMap?.statementIndexByStatementId?.get(entry.statementId);
      const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
      return Boolean(nextStatement && occurrence.from >= nextStatement.documentRange.from && occurrence.to <= nextStatement.documentRange.to);
    });
  }).length;

  for (const [identityKey, planned] of dependencyByIdentity) {
    const dependencyIndex = dependencies.findIndex((dependency) => dependency.identityKey === identityKey);
    const generatedParameter = generatedModuleSemantic.parameters[dependencyIndex];
    const expectedOwnerKey = semanticOwnerKey(nextCompiled, {
      kind: "module",
      target: {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: generatedModule.statementId,
          parameterIndex: dependencyIndex
        }
      }
    });
    const movedReferenceCount = nextReferenceOccurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      movedEntries.some((entry) => {
        const nextIndex = nextCompiled.statementMap?.statementIndexByStatementId?.get(entry.statementId);
        const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
        return Boolean(nextStatement &&
          occurrence.from >= nextStatement.documentRange.from &&
          occurrence.to <= nextStatement.documentRange.to);
      }) &&
      nextReferenceOwnerKey(occurrence) === expectedOwnerKey
    ).length;
    const dependency = dependencies[dependencyIndex];
    const movedRecordFieldCount = dependency?.recordTypeIdentity
      ? candidateRecordFieldCount(planned, expectedOwnerKey)
      : 0;
    if (
      !generatedParameter ||
      movedReferenceCount !== planned.occurrences.length ||
      movedRecordFieldCount !== planned.recordFieldProofs.length
    ) {
      return reject("unsafe-rewrite", "移動した subtree の dependency reference が generated parameter identity へ解決されません。");
    }
  }

  for (const [ownerStatementId, expectedCount] of movedIterationReferences) {
    const nextReferenceCount = nextOccurrenceIndex.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.identity.kind === "module" &&
      occurrence.identity.target.kind === "moduleIteration" &&
      occurrence.identity.target.statementId === ownerStatementId
    ).length;
    if (nextReferenceCount !== expectedCount) {
      return reject(
        "unsafe-rewrite",
        "Extract 後に moved for の iteration binding/reference identity を保持できませんでした。",
        { statementId: ownerStatementId }
      );
    }
  }

  // Checkpoint 8 recursively accepts complete Module descendants and the
  // previously proven direct/root value, plain-group, conditional, forGroup,
  // and containing-Module ownership proofs. Module-owned values cross the
  // boundary through proven scalar, geometry, array, or record parameters;
  // external Module callees are checked above. Imports and host integration
  // remain fail closed.
  // Outside-resolution comparison stays the final guard.
  const oldSequences = sourceReferenceSequencesByStatementId(compiled, occurrenceIndex, movedIds);
  const nextSequences = sourceReferenceSequencesByStatementId(nextCompiled, nextOccurrenceIndex, movedIds);
  const recordExportIdentityTransitions = new Set(
    exports.flatMap((entry) => {
      const statement = compiled.statements[entry.statementIndex];
      return statement?.kind === "typedDeclaration" && statement.recordTypeReference
        ? [`${entry.identityKey}\u0000${dslSemanticIdentityKey({
            kind: "module",
            target: { kind: "moduleSource", statementId: entry.statementId }
          })}`]
        : [];
    })
  );
  const sameOutsideIdentity = (before: string, after: string): boolean =>
    before === after || recordExportIdentityTransitions.has(`${before}\u0000${after}`);
  for (const [statementId, identities] of oldSequences) {
    const after = nextSequences.get(statementId);
    if (
      !after ||
      identities.length !== after.length ||
      identities.some((identity, index) => !sameOutsideIdentity(identity, after[index]!))
    ) {
      return reject(
        "unsafe-rewrite",
        "Extract 後に範囲外 statement の reference resolution が変化するため適用できません。",
        { statementId }
      );
    }
  }

  const generatedInstanceInfo = nextCompiled.statementMap.statements[generatedInstance.statementIndex];
  if (!generatedInstanceInfo) {
    return reject("unsafe-rewrite", "生成 instance の source metadata を取得できません。");
  }

  return {
    status: "planned",
    sourceRevision: snapshot.sourceRevision,
    moduleName,
    instanceName,
    targetScopeId: firstScope,
    selectedStatementIds: ordered.map((entry) => entry.statementId),
    dependencies,
    exports,
    splices,
    generatedInstance: {
      name: instanceName,
      moduleName,
      startLine: generatedInstanceInfo.range.startLine,
      endLine: generatedInstanceInfo.range.endLine
    }
  };
};
