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
import { geometryArrayTypeOfTypedDeclaration } from "../dsl/geometryArraySourceAnnotations";
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
  type: ExtractModuleParameterType;
  numericTypeOptions?: DslNumericTypeOptions;
  declarationFrom: number;
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
    semantic.ownerModuleDefinitionStatementIndex !== null ||
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
    declarationFrom: declarations[0]!.from
  };
};

const dependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null =>
  scalarDependencyDescriptor(compiled, index, identity) ??
  geometryDependencyDescriptor(compiled, index, identity) ??
  geometryArrayDependencyDescriptor(compiled, index, identity);

const directSelectedScalarStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectScalarStatement | null => {
  let statementIndex: number | undefined;
  if (identity.kind === "typed") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
  } else if (identity.kind === "module" && identity.target.kind === "documentBinding") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.target.bindingId)?.statementIndex;
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
  if (identity.kind !== "element") return null;
  const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
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
  for (const [setStatementIndex, set] of compiled.setStatements ?? []) {
    const targetIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(set.targetBindingId)?.statementIndex;
    if (targetIndex === undefined) continue;
    const setInside = statementInsideOffsets(compiled.statements[setStatementIndex], selectedFrom, selectedTo);
    const targetInside = statementInsideOffsets(compiled.statements[targetIndex], selectedFrom, selectedTo);
    if (setInside !== targetInside) {
      return reject(
        "cross-boundary-mutation",
        `set ${set.targetName} は Extract 境界をまたいで mutable binding を書き換えるため移動できません。`,
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
    if (!arrayType && (!statement.declaredType || statement.recordTypeReference)) {
      return reject(
        "unsupported-statement",
        `${where} declaration「${statement.name}」は Checkpoint 7 の scalar / geometry-array scope 外です。`,
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
  if (statement.kind === "moduleDefinition") {
    const recordParameter = statement.parameters.find((parameter) => parameter.recordTypeReference);
    if (recordParameter) {
      return reject(
        "unsupported-statement",
        `module definition「${statement.name}」のrecord-valued parameter「${recordParameter.name}」は Extract Module の対象外です。`,
        { statementId, statementIndex }
      );
    }
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
  if (statement.kind === "moduleDefinition") {
    const recordParameter = statement.parameters.find((parameter) => parameter.recordTypeReference);
    if (recordParameter) {
      return reject(
        "unsupported-statement",
        `module definition「${statement.name}」のrecord-valued parameter「${recordParameter.name}」は Extract Module の対象外です。`,
        { statementId, statementIndex }
      );
    }
  }
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

const moduleIdentityOwnedByMovedSubtree = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  movedIndexes: ReadonlySet<number>
): boolean => {
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
      if (
        lookup.kind !== "resolved" ||
        lookup.declaration.kind !== "typedDeclaration" ||
        lookup.declaration.statement.kind !== "typedDeclaration"
      ) continue;
      const arrayType = geometryArrayTypeOfTypedDeclaration(lookup.declaration.statement);
      if (!arrayType || arrayType.elementType !== parameter.type.elementType) continue;
      const pathFrom = physical.from + parsed.reference.pathRange.start;
      const pathTo = physical.from + parsed.reference.pathRange.end;
      occurrences.push({
        from: pathFrom,
        to: pathTo,
        kind: "reference",
        identity: { kind: "module", target: { kind: "moduleSource", statementId: lookup.declaration.statementId } }
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

  for (const entry of ordered) {
    const scope = namespace.scopeIndex.scopeOfStatement.get(entry.statementIndex);
    if (scope !== firstScope || !sameEnclosing(entry.statement.enclosing, first.statement.enclosing)) {
      return reject(
        "cross-scope-target",
        "Extract Module の対象は同じ lexical scope の sibling statement に限定されます。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
  }
  for (const entry of ordered) {
    if (moduleDefinitionOwnerIndex(compiled, entry.statementIndex) !== null) {
      return reject(
        "unsupported-statement",
        "Checkpoint 10 は既存 Module definition に所有されない source lexical scope の statement だけを Extract します。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
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
    const calleeStatement = compiled.statements[instance.callee.definitionStatementIndex];
    if (
      calleeStatement?.kind === "moduleDefinition" &&
      calleeStatement.parameters.some((parameter) => parameter.recordTypeReference)
    ) {
      return reject(
        "unsupported-statement",
        `module instance「${instance.name}」のrecord-valued Module interface は Extract Module の対象外です。`,
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
  }>();
  const movedIterationReferences = new Map<StatementIdentity, number>();

  for (const occurrence of selectedReferences) {
    const containingModuleInstance = moduleInstanceContainingOccurrence(occurrence, movedEntries);
    if (occurrence.identity.kind === "module") {
      const target = occurrence.identity.target;
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
    const iterationOwnerStatementId = movedIterationBinding(compiled, occurrence.identity, movedIndexSet);
    if (iterationOwnerStatementId) {
      movedIterationReferences.set(
        iterationOwnerStatementId,
        (movedIterationReferences.get(iterationOwnerStatementId) ?? 0) + 1
      );
      continue;
    }

    if (moduleIdentityOwnedByMovedSubtree(compiled, occurrence.identity, movedIndexSet)) continue;

    const declarationRanges = declarationRangesFor(occurrenceIndex, occurrence.identity);
    let descriptor: DependencyDescriptor | null;
    if (declarationRanges.length === 1) {
      const declaration = declarationRanges[0]!;
      if (declaration.from >= selectedFrom && declaration.to <= selectedTo) {
        if (!directSelectedValueStatement(compiled, occurrence.identity, movedIndexSet)) {
          return reject(
            "unrepresentable-dependency",
            "選択範囲内の reference が Checkpoint 7 の moved scalar / single-geometry / geometry-array owner として証明できません。"
          );
        }
        continue;
      }
      descriptor = dependencyDescriptor(compiled, occurrenceIndex, occurrence.identity);
    } else {
      // Iteration slots are compiler-owned Binding Catalog declarations but
      // intentionally have no declaration occurrence in the editor index.
      descriptor = dependencyDescriptor(compiled, occurrenceIndex, occurrence.identity);
    }
    if (!descriptor) {
      return reject(
        declarationRanges.length === 1 ? "unrepresentable-dependency" : "unresolved-semantic-identity",
        declarationRanges.length === 1
          ? "Checkpoint 7 では direct authored scalar / single-geometry / geometry-array dependency 以外を Module parameter として安全に表現しません。"
          : "選択範囲内の reference identity を一意な declaration へ解決できません。"
      );
    }

    const key = dslSemanticIdentityKey(occurrence.identity);
    const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
    const current = dependencyByIdentity.get(key);
    if (current) current.occurrences.push(occurrence);
    else {
      dependencyByIdentity.set(key, {
        descriptor,
        occurrences: [occurrence],
        argumentSource: source.slice(path.argumentFrom, path.to)
      });
    }
  }

  const dependencies: ExtractModuleDependency[] = [...dependencyByIdentity.entries()]
    .map(([identityKey, value]) => ({
      identityKey,
      name: value.descriptor.name,
      type: value.descriptor.type,
      typeText: moduleParameterTypeText(value.descriptor.type, value.descriptor.numericTypeOptions),
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

  const internalReplacements: AbsoluteReplacement[] = [];
  for (const dependency of dependencyByIdentity.values()) {
    for (const occurrence of dependency.occurrences) {
      const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
      internalReplacements.push({
        from: path.rewriteFrom,
        to: path.to,
        text: formatDslName(dependency.descriptor.name)
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
    if (outsideReferences.length === 0) continue;

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
      if ((!arrayType && (!statement.declaredType || statement.recordTypeReference)) || !statement.name) {
        return reject(
          "unrepresentable-export",
          `statement「${statement.name || statement.kind}」は Checkpoint 7 の direct scalar / geometry-array export で表現できません。`,
          { statementId, statementIndex }
        );
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

    for (const reference of outsideReferences) {
      outsideReplacements.push({
        from: reference.from,
        to: reference.to,
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
    .map((dependency) => `${formatDslName(dependency.name)}: ${dependency.typeText}`)
    .join(", ");
  const argumentText = dependencies
    .map((dependency) => `${formatDslName(dependency.name)}: ${dependency.argumentSource}`)
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

  if (!nextCompiled.statementMap || !nextCompiled.sourceLexicalNamespace || !cleanCompile(nextCompiled)) {
    const firstError = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
      .find((diagnostic) => diagnostic.severity === "error");
    return reject(
      "unsafe-rewrite",
      firstError?.message ?? "Extract 後の source semantics を安全にコンパイルできません。"
    );
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

  const nextOccurrenceIndex = createDslSemanticOccurrenceIndex(nextCompiled);
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

  // Checkpoint 8 recursively accepts complete Module descendants under the
  // previously proven direct/root value, plain-group, conditional, forGroup,
  // and moduleDefinition proof. Module-owned identities stay internal to the
  // moved subtree, while external Module callees are checked above. Records,
  // imports, non-root targets, and host integration remain fail closed.
  // Outside-resolution comparison stays the final guard.
  const oldSequences = sourceReferenceSequencesByStatementId(compiled, occurrenceIndex, movedIds);
  const nextSequences = sourceReferenceSequencesByStatementId(nextCompiled, nextOccurrenceIndex, movedIds);
  for (const [statementId, identities] of oldSequences) {
    const after = nextSequences.get(statementId);
    if (
      !after ||
      identities.length !== after.length ||
      identities.some((identity, index) => identity !== after[index])
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
