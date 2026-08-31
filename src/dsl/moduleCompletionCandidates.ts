import type { CompiledDslDocument } from "./dslDocument";
import { physicalToLogicalOffset } from "./logicalStatementSourceMap";
import { resolveModuleLexicalDeclaration, isModuleLookupVisibleWithinBody } from "./moduleLexicalResolution";
import { scalarLiteralCandidates } from "../scalars/typedValueCandidates";
import { BUILTIN_FUNCTION_DEFINITIONS, formatBuiltinFunctionSignatures } from "../scalars/builtinFunctions";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import { scalarExpressionCompletionContextAt } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";
import type { DslModuleParameterType } from "./dslTypes";
import {
  moduleSemanticIdentityKey,
  type ModuleDefinitionSemantic,
  type ModuleGeometryPropertySourceTarget,
  type ModuleGeometrySourceTarget,
  type ModuleInstanceSemantic,
  type ModuleScalarSourceTarget,
  type ResolvedModuleExport
} from "./moduleSemanticTypes";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import { formatDslReferencePath, parseDslSourceReference } from "./dslReferenceTokens";
import { qualifySemanticIdentity } from "../document/multiDocumentPrimitives";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfElement,
  moduleRuntimeGeometryKindOf,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import {
  geometryArrayDeclarationCompletionContextAt,
  geometryArrayValueCompletionContextAt,
  type GeometryArrayCompletionContext
} from "./dslGeometryArrayCompletionContext";
import { isGeometryArrayTypeAssignable, type GeometryArrayType } from "./geometryArrayTypes";

export type ModuleCompletionSite = {
  statementIndex: number;
  scopeId?: ScopeId;
  /** Source-order anchor; it may be one past the last last-good statement. */
  sourceOrderIndex: number;
};

export type ModuleCompletionParameterMetadata = {
  name: string;
  type: DslModuleParameterType | null;
  recordTypeIdentity?: string | null;
  optional: boolean;
  definitionStatementId: string;
  parameterIndex: number;
};

export type ModuleCompletionRequest = {
  compiled: CompiledDslDocument;
  cursorPosition: number;
  kind: "callee" | "label" | "value" | "reference" | "qualifiedMember";
  argumentIndex?: number;
  /** A mapped last-good statement identity for dirty live authoring. */
  statementIndex?: number;
  /** Current live source is used only for token shape, never for identity. */
  sourceText?: string;
  logicalCursorPosition?: number;
  qualifiedInstanceName?: string;
  liveStatementText?: string;
  /** Logical value span supplied by the live module argument context. */
  argumentValueSpan?: { start: number; end: number };
  /** Named arguments recovered from the full tolerant call envelope. */
  usedArgumentNames?: ReadonlySet<string>;
  /** Current-source Module signature proven by the live lexical namespace. */
  currentDefinitionParameters?: readonly ModuleCompletionParameterMetadata[];
  expectedScalarType?: ScalarType | null;
  expectedRecordTypeIdentity?: string | null;
  scopeId?: ScopeId;
  sourceOrderIndex?: number;
};

type ModuleCompletionPresenceRequest = Pick<
  ModuleCompletionRequest,
  "scopeId" | "sourceOrderIndex" | "liveStatementText" | "logicalCursorPosition"
>;

/** Source-semantic Module completion data. This intentionally has no
 * CodeMirror/VS Code insertion action; adapters decide how a semantic
 * candidate is presented and applied in their host. */
export type ModuleCompletionCandidate = {
  kind: "binding" | "record" | "recordConstructor" | "builtin" | "geometry" | "literal" | "module" | "argumentName" | "property";
  label: string;
  detail?: string;
  identity?: string;
};

const parameterGeometryKind = moduleRuntimeGeometryKindOf;

const scalarTypeOf = (type: DslModuleParameterType | null | undefined): ScalarType | null =>
  type && ["number", "string", "boolean", "choice"].includes(type.kind) ? type as ScalarType : null;

const recordTypeDefinition = (compiled: CompiledDslDocument, identity: string | null | undefined) =>
  identity ? compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(identity) ?? null : null;

const recordValueCandidates = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expectedTypeIdentity: string,
  request?: ModuleCompletionRequest
): ModuleCompletionCandidate[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const records = namespace?.recordSemanticAnalysis;
  if (!namespace || !records || statementIndex < 0) return [];
  const result: ModuleCompletionCandidate[] = [];
  for (const name of bodyNames(compiled, statementIndex, request?.scopeId)) {
    const resolved = visibleLookup(compiled, statementIndex, name, request?.scopeId, request?.sourceOrderIndex);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      const recordTypeIdentity = lookup.parameter.value.recordTypeIdentity;
      if (recordTypeIdentity === expectedTypeIdentity && optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)) {
        result.push({
          kind: "record",
          label: name,
          identity: `module-record-parameter:${lookup.parameter.value.definitionStatementId}:${lookup.parameter.value.parameterIndex}`
        });
      }
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "recordValue") continue;
    const value = records.valuesByStatementId.get(lookup.declaration.statementId);
    if (value?.typeIdentity === expectedTypeIdentity) {
      result.push({ kind: "record", label: name, identity: value.statementId });
    }
  }
  return result;
};

const constructorFieldNames = (source: string, from: number, to: number) => {
  const names: string[] = [];
  let start = from;
  let depth = 0;
  let quote: string | null = null;
  for (let index = from; index <= to; index += 1) {
    const character = source[index] ?? ",";
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      const segment = source.slice(start, index);
      const label = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(segment)?.[1];
      if (label) names.push(label);
      start = index + 1;
    }
  }
  return names;
};

const recordConstructorFieldCandidates = (
  compiled: CompiledDslDocument,
  expectedTypeIdentity: string,
  request: ModuleCompletionRequest
): ModuleCompletionCandidate[] | null => {
  if (!request.liveStatementText || request.logicalCursorPosition === undefined) return null;
  const valueSpan = request.argumentValueSpan ?? { start: 0, end: request.logicalCursorPosition };
  const prefix = request.liveStatementText.slice(valueSpan.start, request.logicalCursorPosition);
  const open = prefix.indexOf("(");
  if (open < 0) return null;
  const definition = recordTypeDefinition(compiled, expectedTypeIdentity);
  if (!definition || prefix.slice(0, open).trim() !== definition.name) return null;
  const provided = new Set(constructorFieldNames(prefix, open + 1, prefix.length));
  const current = prefix.slice(prefix.lastIndexOf(",") + 1);
  if (current.includes(":")) return [];
  return definition.fields
    .filter((field) => !provided.has(field.name))
    .map((field) => ({ kind: "argumentName" as const, label: field.name, identity: `${definition.statementId}:${field.fieldIndex}` }));
};

const recordCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expectedTypeIdentity: string | null | undefined,
  request?: ModuleCompletionRequest
): ModuleCompletionCandidate[] => {
  if (!expectedTypeIdentity) return [];
  if (request) {
    const fields = recordConstructorFieldCandidates(compiled, expectedTypeIdentity, request);
    if (fields) return fields;
  }
  const definition = recordTypeDefinition(compiled, expectedTypeIdentity);
  if (!definition) return [];
  return [
    ...recordValueCandidates(compiled, statementIndex, expectedTypeIdentity, request),
    { kind: "recordConstructor", label: definition.name, detail: "record constructor", identity: definition.statementId }
  ];
};

/** Completes nominal fields for the shared `@base.` property lane. */
export const moduleRecordFieldCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  baseName: string,
  request?: ModuleCompletionPresenceRequest
): ModuleCompletionCandidate[] => {
  const resolved = visibleLookup(
    compiled,
    statementIndex,
    baseName.replace(/^@/, ""),
    request?.scopeId,
    request?.sourceOrderIndex
  );
  if (!resolved) return [];
  const typeIdentity = resolved.lookup.kind === "parameter"
    ? optionalParameterIsAvailable(compiled, statementIndex, resolved.lookup.parameter.value, request)
      ? resolved.lookup.parameter.value.recordTypeIdentity
      : null
    : resolved.lookup.kind === "resolved" && resolved.lookup.declaration.kind === "recordValue"
      ? compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(resolved.lookup.declaration.statementId)?.typeIdentity ?? null
      : null;
  const definition = recordTypeDefinition(compiled, typeIdentity);
  return definition?.fields.map((field) => ({
    kind: "property" as const,
    label: field.name,
    identity: `${definition.statementId}:${field.fieldIndex}`
  })) ?? [];
};

/** Completes fields after a qualified Module record export, e.g.
 * `@source::output.`. The instance/export lookup remains owned by the Module
 * semantic resolver; this function only projects the resolved nominal fields. */
export const moduleQualifiedRecordFieldCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  qualifiedName: string,
  scopeId?: ScopeId,
  sourceOrderIndex?: number
): ModuleCompletionCandidate[] => {
  const separator = qualifiedName.indexOf("::");
  if (separator < 1) return [];
  const instanceName = qualifiedName.slice(0, separator).replace(/^@/, "");
  const exportName = qualifiedName.slice(separator + 2);
  const resolved = visibleLookup(compiled, statementIndex, instanceName, scopeId, sourceOrderIndex);
  if (resolved?.lookup.kind !== "resolved" || resolved.lookup.declaration.kind !== "moduleInstance") return [];
  const instance = compiled.moduleSemanticAnalysis?.instancesByStatementId.get(resolved.lookup.declaration.statementId);
  const definition = definitionForInstance(compiled, instance ?? null);
  if (!definition) return [];
  const exported = definition.exports.find((entry) => entry.kind === "record" && entry.name === exportName);
  return exported?.kind === "record"
    ? exported.definition.fields.map((field) => ({
        kind: "property" as const,
        label: field.name,
        identity: `${exportIdentityForCandidate(compiled, definition, exported)}:${field.fieldIndex}`
      }))
    : [];
};

const statementIndexAt = (compiled: CompiledDslDocument, position: number) => compiled.statements.findIndex((statement) =>
  statement.physicalSpan.segments.some((segment) => position >= segment.from && position <= segment.to) ||
  (position >= statement.documentRange.from && position <= statement.documentRange.to)
);

const stableStatementIndex = (request: ModuleCompletionRequest): number =>
  request.statementIndex ?? statementIndexAt(request.compiled, request.cursorPosition);

export const isInsideModuleSemanticStatement = (compiled: CompiledDslDocument, position: number) => {
  const index = statementIndexAt(compiled, position);
  const id = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  return index >= 0 && Boolean(id && compiled.moduleSemanticAnalysis?.definitions.some((definition) => definition.bodyStatementIds.includes(id)));
};

const moduleDefinitionForScope = (compiled: CompiledDslDocument, scopeId: ScopeId | undefined): ModuleDefinitionSemantic | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  const namespace = compiled.sourceLexicalNamespace;
  if (!analysis || !namespace || !scopeId) return null;
  let current: ScopeId | null = scopeId;
  while (current) {
    const definition = analysis.definitions.find((candidate) => candidate.bodyScopeId === current);
    if (definition) return definition;
    current = namespace.scopeIndex.scopes.get(current)?.parentId ?? null;
  }
  return null;
};

const currentModuleDefinition = (compiled: CompiledDslDocument, statementIndex: number, scopeId?: ScopeId): ModuleDefinitionSemantic | null => {
  const id = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  if (id && compiled.moduleSemanticAnalysis) {
    const direct = compiled.moduleSemanticAnalysis.definitions.find((definition) => definition.bodyStatementIds.includes(id));
    if (direct) return direct;
  }
  const actualScope = scopeId ?? compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(statementIndex);
  return moduleDefinitionForScope(compiled, actualScope);
};

const currentInstance = (compiled: CompiledDslDocument, statementIndex: number): ModuleInstanceSemantic | null =>
  compiled.moduleSemanticAnalysis?.instances.find((instance) => instance.statementIndex === statementIndex) ?? null;

const definitionForInstance = (
  compiled: CompiledDslDocument,
  instance: ModuleInstanceSemantic | null
): ModuleDefinitionSemantic | null => {
  const callee = instance?.callee;
  if (!callee) return null;
  return callee.definition ??
    (callee.definitionIdentity ? compiled.moduleRuntimeContext?.definitionFor(callee.definitionIdentity) : undefined) ??
    compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(callee.definitionStatementId) ??
    null;
};

const definitionDocumentStatements = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
) => compiled.moduleRuntimeContext?.documentFor(
  definition.identity?.documentId ?? definition.documentId
)?.statements ?? compiled.statements;

const definitionDocumentGeometryArrayAnalysis = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
) => {
  const documentId = definition.identity?.documentId ?? definition.documentId;
  if (compiled.moduleRuntimeContext) {
    return compiled.moduleRuntimeContext.documentFor(documentId)?.sourceLexicalNamespace.geometryArraySemanticAnalysis ?? null;
  }
  return compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis ?? null;
};

const isImportedDefinition = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
) => Boolean(
  definition.identity &&
  compiled.moduleRuntimeContext &&
  definition.identity.documentId !== compiled.moduleRuntimeContext.rootDocumentId
);

const exportIdentityForCandidate = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic,
  entry: ResolvedModuleExport
) => isImportedDefinition(compiled, definition) && entry.exportedIdentity
  ? moduleSemanticIdentityKey(entry.exportedIdentity)
  : entry.exportedStatementId;

const geometryArrayIdentityForCandidate = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic,
  statementId: string
) => isImportedDefinition(compiled, definition) && definition.identity
  ? moduleSemanticIdentityKey(qualifySemanticIdentity(definition.identity.documentId, statementId))
  : statementId;

const lexicalInput = (compiled: CompiledDslDocument, owner: ModuleDefinitionSemantic | null) => {
  const namespace = compiled.sourceLexicalNamespace;
  const ids = compiled.statementMap?.statementIdByStatementIndex ?? new Map(
    namespace?.allDeclarations.map((declaration) => [declaration.statementIndex, declaration.statementId] as const) ?? []
  );
  if (!namespace) return null;
  return {
    sourceNamespace: namespace,
    stableStatementIdByIndex: ids,
    parameterOverlays: owner ? [{
      bodyScopeId: owner.bodyScopeId,
      value: owner,
      parameters: owner.parameters.map((parameter, index) => ({ index, name: parameter.name, value: parameter }))
    }] : []
  };
};

const lookupFor = (compiled: CompiledDslDocument, statementIndex: number, name: string, scopeId?: ScopeId, sourceOrderIndex?: number) => {
  const owner = currentModuleDefinition(compiled, statementIndex, scopeId);
  const input = lexicalInput(compiled, owner);
  return input ? { owner, lookup: resolveModuleLexicalDeclaration(input, statementIndex, name, { scopeId, sourceOrderIndex }) } : null;
};

const visibleLookup = (compiled: CompiledDslDocument, statementIndex: number, name: string, scopeId?: ScopeId, sourceOrderIndex?: number) => {
  const resolved = lookupFor(compiled, statementIndex, name, scopeId, sourceOrderIndex);
  if (!resolved) return null;
  return resolved.owner && compiled.sourceLexicalNamespace
    ? (isModuleLookupVisibleWithinBody(compiled.sourceLexicalNamespace, resolved.lookup, resolved.owner.bodyScopeId) ? resolved : null)
    : resolved;
};

const bodyNames = (compiled: CompiledDslDocument, statementIndex: number, scopeId?: ScopeId): string[] => {
  const owner = currentModuleDefinition(compiled, statementIndex, scopeId);
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [];
  return [...new Set([
    ...namespace.allDeclarations.map((declaration) => declaration.name),
    ...[...namespace.scopeIndex.forGroupIterationSlots.values()].map((slot) => slot.name).filter(Boolean),
    ...(owner?.parameters.map((parameter) => parameter.name) ?? [])
  ])];
};

const insideHasValueArgument = (request?: ModuleCompletionPresenceRequest): boolean => {
  const source = request?.liveStatementText;
  const cursor = request?.logicalCursorPosition;
  if (!source || cursor === undefined) return false;
  const prefix = source.slice(0, cursor);
  const open = prefix.lastIndexOf("hasValue(");
  return open >= 0 && prefix.slice(open).indexOf(")") < 0;
};

const optionalParameterIsAvailable = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  parameter: { optional: boolean; definitionStatementId: string; parameterIndex: number },
  request?: ModuleCompletionPresenceRequest
) => {
  if (!parameter.optional) return true;
  if (insideHasValueArgument(request)) return true;
  const owner = currentModuleDefinition(compiled, statementIndex, request?.scopeId);
  const body = owner?.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  if (body?.presenceParameterKeys.includes(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)) return true;
  const recordValue = owner?.recordValues.find((candidate) => candidate.value.statementIndex === statementIndex);
  return recordValue?.presenceParameterKeys.includes(`${parameter.definitionStatementId}:${parameter.parameterIndex}`) ?? false;
};

const scalarCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: DslModuleParameterType | ScalarType | null | undefined, request?: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const expectedType = scalarTypeOf(expected);
  const result: ModuleCompletionCandidate[] = [];
  if (!expectedType || expectedType.kind === "number") {
    result.push({ kind: "literal", label: "0" }, { kind: "literal", label: "1" });
  }
  if (expectedType?.kind === "string") {
    result.push({ kind: "literal", label: '""' });
  } else if (expectedType) {
    result.push(...scalarLiteralCandidates(expectedType).map((literal) => ({ kind: "literal" as const, label: literal.label })));
  }
  if (expectedType) {
    result.push(...BUILTIN_FUNCTION_DEFINITIONS
      .filter((definition) => definition.signatures.some((signature) => isScalarTypeAssignable(signature.returnType, expectedType)))
      .map((definition) => ({
        kind: "builtin" as const,
        label: definition.name,
        detail: formatBuiltinFunctionSignatures(definition),
        identity: definition.name
      })));
  }
  if (request?.kind === "reference" && (!expectedType || expectedType.kind === "boolean")) {
    result.push({ kind: "builtin", label: "hasValue", detail: "hasValue(@optionalParameter) -> boolean", identity: "hasValue" });
  }
  const hasValueArgument = insideHasValueArgument(request);
  for (const name of bodyNames(compiled, statementIndex, request?.scopeId)) {
    const resolved = visibleLookup(compiled, statementIndex, name, request?.scopeId, request?.sourceOrderIndex);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "iteration") {
      if (!expectedType || expectedType.kind === "number") result.push({ kind: "binding", label: name, identity: lookup.statementId });
      continue;
    }
    if (lookup.kind === "parameter") {
      const type = scalarTypeOf(lookup.parameter.value.type);
      if (type && (!expectedType || isScalarTypeAssignable(type, expectedType)) && optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)) {
        result.push({ kind: "binding", label: name, identity: `module-parameter:${name}` });
      } else if (hasValueArgument && lookup.parameter.value.optional) {
        result.push({ kind: parameterGeometryKind(lookup.parameter.value.type) ? "geometry" : "binding", label: name, identity: `module-parameter:${name}` });
      }
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration" || lookup.declaration.statement.kind !== "typedDeclaration") continue;
    const type = lookup.declaration.statement.declaredType;
    if (!type) continue;
    if (!expectedType) result.push({ kind: "binding", label: name, identity: lookup.declaration.statementId });
    else if (isScalarTypeAssignable(type, expectedType)) result.push({ kind: "binding", label: name, identity: lookup.declaration.statementId });
  }
  return result;
};

const geometryCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: "point" | "line" | null, request?: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  if (!expected) return [];
  const result: ModuleCompletionCandidate[] = [];
  for (const name of bodyNames(compiled, statementIndex, request?.scopeId)) {
    const resolved = visibleLookup(compiled, statementIndex, name, request?.scopeId, request?.sourceOrderIndex);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      if (parameterGeometryKind(lookup.parameter.value.type) === expected && optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)) {
        result.push({ kind: "geometry", label: name, identity: `module-parameter:${name}` });
      }
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "geometry" || lookup.declaration.statement.kind !== "element") continue;
    const interfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
    const kind = interfaceType === "point" ? "point" : interfaceType ? "line" : null;
    if (kind === expected) result.push({ kind: "geometry", label: name, identity: lookup.declaration.statementId });
    if (expected === "point" && kind === "line") {
      result.push(
        { kind: "geometry", label: `${name}.start`, identity: `${lookup.declaration.statementId}:start` },
        { kind: "geometry", label: `${name}.end`, identity: `${lookup.declaration.statementId}:end` }
      );
    }
  }
  return result;
};

const geometryInterfaceCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expected: ModuleGeometryInterfaceType,
  request?: ModuleCompletionRequest
): ModuleCompletionCandidate[] => {
  const result: ModuleCompletionCandidate[] = [];
  for (const name of bodyNames(compiled, statementIndex, request?.scopeId)) {
    const resolved = visibleLookup(compiled, statementIndex, name, request?.scopeId, request?.sourceOrderIndex);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      const actual = moduleGeometryInterfaceTypeOf(lookup.parameter.value.type);
      if (isModuleGeometryInterfaceAssignable(actual, expected) && optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)) {
        result.push({ kind: "geometry", label: name, identity: `module-parameter:${name}` });
      }
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "geometry" || lookup.declaration.statement.kind !== "element") continue;
    const actual = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
    if (isModuleGeometryInterfaceAssignable(actual, expected)) result.push({ kind: "geometry", label: name, identity: lookup.declaration.statementId });
  }
  return result;
};


const geometryArrayTypeForSlot = (
  compiled: CompiledDslDocument,
  definitionStatementId: string,
  parameterIndex: number
): GeometryArrayType | null =>
  compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.moduleParametersBySlot
    .get(`${definitionStatementId}:${parameterIndex}`)?.type ?? null;

const sourceModuleOwnerIndex = (compiled: CompiledDslDocument, statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = compiled.statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = compiled.statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const uniqueGeometryArrayCandidates = (candidates: readonly ModuleCompletionCandidate[]): ModuleCompletionCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.identity ?? `${candidate.kind}:${candidate.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sourceModuleArrayParameterCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expected: GeometryArrayType
): ModuleCompletionCandidate[] => {
  const analysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  const ownerIndex = sourceModuleOwnerIndex(compiled, statementIndex);
  if (!analysis || ownerIndex === null) return [];
  return analysis.moduleParameters
    .filter((parameter) => parameter.definitionStatementIndex === ownerIndex && !parameter.optional)
    .filter((parameter) => isGeometryArrayTypeAssignable(parameter.type, expected))
    .map((parameter) => ({
      kind: "binding" as const,
      label: parameter.name,
      identity: `module-array-parameter:${parameter.definitionStatementId}:${parameter.parameterIndex}`
    }));
};

const sourceModuleGeometryParameterCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expected: GeometryArrayType
): ModuleCompletionCandidate[] => {
  const ownerIndex = sourceModuleOwnerIndex(compiled, statementIndex);
  const owner = ownerIndex === null ? null : compiled.statements[ownerIndex];
  if (owner?.kind !== "moduleDefinition") return [];
  const result: ModuleCompletionCandidate[] = [];
  owner.parameters.forEach((parameter, parameterIndex) => {
    if (parameter.optional) return;
    const actual = moduleGeometryInterfaceTypeOf(parameter.type);
    if (!actual) return;
    const identity = `source-module-geometry:${ownerIndex}:${parameterIndex}`;
    if (expected.elementType === "point") {
      if (actual === "point") result.push({ kind: "geometry", label: parameter.name, identity });
      else if (actual === "line" || actual === "path") {
        result.push(
          { kind: "geometry", label: `${parameter.name}.start`, identity: `${identity}:start` },
          { kind: "geometry", label: `${parameter.name}.end`, identity: `${identity}:end` }
        );
      }
      return;
    }
    if (isModuleGeometryInterfaceAssignable(actual, expected.elementType)) {
      result.push({ kind: "geometry", label: parameter.name, identity });
    }
  });
  return result;
};

const geometryArrayReferenceCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expected: GeometryArrayType,
  request?: ModuleCompletionRequest
): ModuleCompletionCandidate[] => {
  const analysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  if (!analysis) return [];
  const result: ModuleCompletionCandidate[] = [
    ...sourceModuleArrayParameterCompletions(compiled, statementIndex, expected)
  ];
  for (const name of bodyNames(compiled, statementIndex, request?.scopeId)) {
    const resolved = visibleLookup(compiled, statementIndex, name, request?.scopeId, request?.sourceOrderIndex);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      const actual = geometryArrayTypeForSlot(
        compiled,
        lookup.parameter.value.definitionStatementId,
        lookup.parameter.value.parameterIndex
      );
      if (
        isGeometryArrayTypeAssignable(actual, expected) &&
        optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)
      ) {
        result.push({
kind: "binding",
label: name,
identity: `module-array-parameter:${lookup.parameter.value.definitionStatementId}:${lookup.parameter.value.parameterIndex}`
        });
      }
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration") continue;
    const value = analysis.valuesByStatementIndex.get(lookup.declaration.statementIndex);
    if (value && isGeometryArrayTypeAssignable(value.type, expected)) {
      result.push({ kind: "binding", label: name, identity: value.statementId });
    }
  }
  return uniqueGeometryArrayCandidates(result);
};

const geometryArrayMemberCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  expected: GeometryArrayType,
  request?: ModuleCompletionRequest
): ModuleCompletionCandidate[] => {
  const semantic = expected.elementType === "point"
    ? geometryCompletions(compiled, statementIndex, "point", request)
    : geometryInterfaceCompletions(compiled, statementIndex, expected.elementType, request);
  return uniqueGeometryArrayCandidates([
    ...semantic,
    ...sourceModuleGeometryParameterCompletions(compiled, statementIndex, expected)
  ]);
};

const geometryArrayCandidates = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  context: GeometryArrayCompletionContext,
  request?: ModuleCompletionRequest
) => context.mode === "member"
  ? geometryArrayMemberCompletions(compiled, statementIndex, context.expectedType, request)
  : geometryArrayReferenceCompletions(compiled, statementIndex, context.expectedType, request);

const importedModuleCalleeCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  request: ModuleCompletionRequest,
  input: ReturnType<typeof lexicalInput>
): ModuleCompletionCandidate[] => {
  const source = request.liveStatementText;
  const position = request.logicalCursorPosition;
  const runtime = compiled.moduleRuntimeContext;
  if (!source || position === undefined || !runtime?.valid || !input) return [];
  const equals = source.indexOf("=");
  if (equals < 0 || position <= equals) return [];
  const typedCallee = source.slice(equals + 1, position).trim();
  const separator = typedCallee.indexOf("::");
  if (separator <= 0 || typedCallee.slice(separator + 2).includes("::")) return [];
  const alias = typedCallee.slice(0, separator).replace(/^@/, "").trim();
  if (!alias) return [];

  const lookup = resolveModuleLexicalDeclaration(input, statementIndex, alias, {
    scopeId: request.scopeId,
    sourceOrderIndex: request.sourceOrderIndex
  });
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "import") return [];

  const importer = runtime.graph.nodes.get(runtime.rootDocumentId);
  const edge = importer?.imports.find((candidate) =>
    candidate.importIdentity.localIdentity === lookup.declaration.statementId &&
    candidate.status === "resolved" &&
    candidate.targetDocumentId
  );
  const target = edge?.targetDocumentId ? runtime.graph.nodes.get(edge.targetDocumentId) : undefined;
  if (!target?.valid || !target.publicApi.valid) return [];
  return [...target.publicApi.publicEntriesByName.values()]
    .filter((entry) => entry.family === "module")
    .map((entry) => ({
      kind: "module" as const,
      label: entry.name,
      identity: moduleSemanticIdentityKey(entry.identity)
    }));
};

const moduleCalleeCompletions = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const owner = currentModuleDefinition(compiled, statementIndex, request.scopeId);
  const input = lexicalInput(compiled, owner);
  if (!namespace || !input) return [];
  const local = namespace.allDeclarations
    .filter((declaration) => declaration.kind === "moduleDefinition" && declaration.statementIndex < (request.sourceOrderIndex ?? statementIndex))
    .filter((declaration) => {
      const lookup = resolveModuleLexicalDeclaration(input, statementIndex, declaration.name, { scopeId: request.scopeId, sourceOrderIndex: request.sourceOrderIndex });
      return lookup.kind === "resolved" && lookup.declaration.statementId === declaration.statementId;
    })
    .map((declaration) => ({ kind: "module" as const, label: declaration.name, identity: declaration.statementId }));
  return [...local, ...importedModuleCalleeCompletions(compiled, statementIndex, request, input)];
};

const liveArguments = (request: ModuleCompletionRequest) => {
  const source = request.liveStatementText;
  if (!source) return null;
  const open = source.indexOf("(");
  if (open < 0) return null;
  return scanCallArgs(source, { start: open + 1, end: source.length }).args;
};

const shorthandLabelForArgument = (argument: ScannedArg): string | null => {
  if (argument.key !== null) return argument.key;
  const parsed = parseDslSourceReference(argument.value);
  if (parsed.kind !== "valid") return null;
  const { reference } = parsed;
  return !reference.path.absolute && reference.path.segments.length === 1 && reference.property === null
    ? reference.path.segments[0]
    : null;
};

const shorthandSourceFor = (name: string) => `@${formatDslReferencePath({ absolute: false, segments: [name] })}`;

const shorthandCompatible = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  parameter: ModuleCompletionParameterMetadata,
  request: ModuleCompletionRequest
) => {
  const resolved = visibleLookup(compiled, statementIndex, parameter.name, request.scopeId, request.sourceOrderIndex);
  if (!resolved) return false;
  const expectedRecord = parameter.recordTypeIdentity ?? null;
  if (expectedRecord) {
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      return lookup.parameter.value.recordTypeIdentity === expectedRecord &&
        optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request);
    }
    if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
      return compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(lookup.declaration.statementId)?.typeIdentity === expectedRecord;
    }
    return false;
  }
  if (!parameter.type) return false;
  const expectedScalar = scalarTypeOf(parameter.type);
  const expectedGeometry = moduleGeometryInterfaceTypeOf(parameter.type);
  const { lookup } = resolved;
  if (lookup.kind === "iteration") return expectedScalar?.kind === "number";
  if (lookup.kind === "parameter") {
    if (!optionalParameterIsAvailable(compiled, statementIndex, lookup.parameter.value, request)) return false;
    const actualScalar = scalarTypeOf(lookup.parameter.value.type);
    if (expectedScalar) return Boolean(actualScalar && isScalarTypeAssignable(actualScalar, expectedScalar));
    const actualGeometry = moduleGeometryInterfaceTypeOf(lookup.parameter.value.type);
    return Boolean(expectedGeometry && isModuleGeometryInterfaceAssignable(actualGeometry, expectedGeometry));
  }
  if (lookup.kind !== "resolved") return false;
  if (lookup.declaration.kind === "typedDeclaration" && lookup.declaration.statement.kind === "typedDeclaration") {
    const actualScalar = lookup.declaration.statement.declaredType;
    return Boolean(expectedScalar && actualScalar && isScalarTypeAssignable(actualScalar, expectedScalar));
  }
  if (lookup.declaration.kind === "geometry" && lookup.declaration.statement.kind === "element") {
    const actualGeometry = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
    return Boolean(expectedGeometry && isModuleGeometryInterfaceAssignable(actualGeometry, expectedGeometry));
  }
  return false;
};

const moduleArgumentLabels = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const statement = compiled.statements[statementIndex];
  const live = liveArguments(request) ?? [];
  const used = new Set<string>([
    ...(request.usedArgumentNames ?? []),
    ...live.map(shorthandLabelForArgument).filter((label): label is string => Boolean(label)),
    ...(live.length === 0 && statement?.kind === "moduleInstance"
      ? statement.arguments.map((argument) => argument.label).filter((label): label is string => Boolean(label))
      : [])
  ]);

  let parameters: readonly ModuleCompletionParameterMetadata[] | null = request.currentDefinitionParameters ?? null;
  if (!parameters) {
    const instance = currentInstance(compiled, statementIndex);
    if (!instance?.callee || statement?.kind !== "moduleInstance") return [];
    const definition = definitionForInstance(compiled, instance);
    if (!definition) return [];
    parameters = definition.parameters;
  }
  const remaining = parameters.filter((parameter) => !used.has(parameter.name));
  const shorthand = remaining
    .filter((parameter) => shorthandCompatible(compiled, statementIndex, parameter, request))
    .map((parameter) => ({
      kind: "literal" as const,
      label: shorthandSourceFor(parameter.name),
      detail: `same-name Module argument for ${parameter.name}`,
      identity: `module-argument-shorthand:${parameter.definitionStatementId}:${parameter.parameterIndex}`
    }));
  const explicit = remaining.map((parameter) => ({ kind: "argumentName" as const, label: parameter.name }));
  return [...shorthand, ...explicit];
};

type ModuleArgumentParameterSlot = {
  definitionStatementId: string;
  parameterIndex: number;
  type: DslModuleParameterType | null;
  recordTypeIdentity: string | null;
};

const recordTypeIdentityForSlot = (
  compiled: CompiledDslDocument,
  definitionStatementId: string,
  parameterIndex: number
) => compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(definitionStatementId)?.parameters[parameterIndex]?.recordTypeIdentity ??
  compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.moduleParameters.find((parameter) =>
    parameter.definitionStatementId === definitionStatementId && parameter.parameterIndex === parameterIndex
  )?.typeIdentity ?? null;

const moduleArgumentParameterSlot = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argumentIndex: number,
  request: ModuleCompletionRequest
): ModuleArgumentParameterSlot | null => {
  const instance = currentInstance(compiled, statementIndex);
  const definition = definitionForInstance(compiled, instance);
  if (!definition) return null;
  const liveArgument = liveArguments(request)?.[argumentIndex];
  if (request.currentDefinitionParameters) {
    const parameter = liveArgument?.key
      ? request.currentDefinitionParameters.find((candidate) => candidate.name === liveArgument.key)
      : request.currentDefinitionParameters[argumentIndex];
    return parameter
      ? {
definitionStatementId: parameter.definitionStatementId,
parameterIndex: parameter.parameterIndex,
type: parameter.type,
recordTypeIdentity: parameter.recordTypeIdentity ?? recordTypeIdentityForSlot(compiled, parameter.definitionStatementId, parameter.parameterIndex)
        }
      : null;
  }
  const binding = instance?.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  const parameter = liveArgument?.key
    ? definition.parameters.find((candidate) => candidate.name === liveArgument.key)
    : binding && definition.parameters[binding.parameterIndex];
  if (parameter) {
    return {
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex,
      type: parameter.type,
      recordTypeIdentity: parameter.recordTypeIdentity ?? recordTypeIdentityForSlot(compiled, parameter.definitionStatementId, parameter.parameterIndex)
    };
  }
  return binding
    ? {
        definitionStatementId: definition.statementId,
        parameterIndex: binding.parameterIndex,
        type: binding.parameterType,
        recordTypeIdentity: recordTypeIdentityForSlot(compiled, definition.statementId, binding.parameterIndex)
      }
    : null;
};

const moduleArgumentParameterType = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argumentIndex: number,
  request: ModuleCompletionRequest
): DslModuleParameterType | null =>
  moduleArgumentParameterSlot(compiled, statementIndex, argumentIndex, request)?.type ?? null;

const moduleArgumentGeometryArrayContext = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argumentIndex: number,
  request: ModuleCompletionRequest
): GeometryArrayCompletionContext | null => {
  const slot = moduleArgumentParameterSlot(compiled, statementIndex, argumentIndex, request);
  const expectedType = slot
    ? geometryArrayTypeForSlot(compiled, slot.definitionStatementId, slot.parameterIndex)
    : null;
  if (!expectedType || !request.liveStatementText || request.logicalCursorPosition === undefined) return null;
  const liveArgument = liveArguments(request)?.[argumentIndex];
  const valueSpan = liveArgument
    ? liveArgument.valueSpan.start === liveArgument.valueSpan.end && liveArgument.rawValueSpan
      ? liveArgument.rawValueSpan
      : liveArgument.valueSpan
    : request.argumentValueSpan;
  if (!valueSpan) return null;
  return geometryArrayValueCompletionContextAt(
    request.liveStatementText,
    request.logicalCursorPosition,
    { start: valueSpan.start, end: Math.max(valueSpan.end, request.logicalCursorPosition) },
    expectedType
  );
};

const geometryArrayContextForRequest = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  request: ModuleCompletionRequest
): GeometryArrayCompletionContext | null => {
  if (request.liveStatementText && request.logicalCursorPosition !== undefined) {
    const declaration = geometryArrayDeclarationCompletionContextAt(
      request.liveStatementText,
      request.logicalCursorPosition
    );
    if (declaration) return declaration;
  }
  return request.argumentIndex !== undefined
    ? moduleArgumentGeometryArrayContext(compiled, statementIndex, request.argumentIndex, request)
    : null;
};

const moduleScalarExpectedType = (
  parameterType: DslModuleParameterType | null,
  argumentIndex: number,
  request: ModuleCompletionRequest
): ScalarType | null => {
  const rootType = scalarTypeOf(parameterType);
  if (!request.liveStatementText || request.logicalCursorPosition === undefined) return rootType;
  const liveArgument = liveArguments(request)?.[argumentIndex];
  const valueSpan = liveArgument
    ? liveArgument.valueSpan.start === liveArgument.valueSpan.end && liveArgument.rawValueSpan
      ? liveArgument.rawValueSpan
      : liveArgument.valueSpan
    : request.argumentValueSpan;
  if (!valueSpan) return rootType;
  const context = scalarExpressionCompletionContextAt(
    request.liveStatementText,
    request.logicalCursorPosition,
    valueSpan,
    rootType
  );
  return context?.kind === "operand" ? context.expectedType ?? rootType : rootType;
};

const moduleArgumentValues = (compiled: CompiledDslDocument, statementIndex: number, argumentIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const arrayContext = moduleArgumentGeometryArrayContext(compiled, statementIndex, argumentIndex, request);
  if (arrayContext) return geometryArrayCandidates(compiled, statementIndex, arrayContext, request);
  const parameterType = moduleArgumentParameterType(compiled, statementIndex, argumentIndex, request);
  const slot = moduleArgumentParameterSlot(compiled, statementIndex, argumentIndex, request);
  if (slot?.recordTypeIdentity) return recordCompletions(compiled, statementIndex, slot.recordTypeIdentity, request);
  if (parameterType?.kind === "point") return geometryCompletions(compiled, statementIndex, "point", request);
  const geometryInterfaceType = moduleGeometryInterfaceTypeOf(parameterType);
  return geometryInterfaceType
    ? geometryInterfaceCompletions(compiled, statementIndex, geometryInterfaceType, request)
    : scalarCompletions(compiled, statementIndex, moduleScalarExpectedType(parameterType, argumentIndex, request), request);
};

const deferredInstanceIdOf = (target: ModuleScalarSourceTarget | ModuleGeometrySourceTarget | ModuleGeometryPropertySourceTarget | null) =>
  target?.kind === "deferredModuleScalarExport" || target?.kind === "deferredModuleExport" || target?.kind === "deferredModuleExportProperty"
    ? target.instanceStatementId
    : null;

type QualifiedMemberContext = {
  instanceStatementId: string;
  memberKind: "scalar" | "geometry";
  expectedScalarType: ScalarType | null;
};

const containsLogicalPosition = (position: number, span: { start: number; end: number }) =>
  position >= span.start && position <= span.end;

const qualifiedMemberContextAt = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  request: ModuleCompletionRequest
): QualifiedMemberContext | null => {
  const logicalPosition = request.logicalCursorPosition;
  if (logicalPosition === undefined) return null;
  const owner = currentModuleDefinition(compiled, statementIndex, request.scopeId);
  const body = owner?.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  for (const site of body?.scalarExpressions ?? []) {
    for (const reference of site.expression.references) {
      const instanceStatementId = deferredInstanceIdOf(reference.target);
      if (!instanceStatementId || !containsLogicalPosition(logicalPosition, reference.span)) continue;
      return {
        instanceStatementId,
        memberKind: "scalar",
        expectedScalarType: site.expression.ast.kind === "reference" ? site.expression.type : null
      };
    }
  }
  for (const site of body?.textTemplateHoles ?? []) {
    for (const reference of site.expression.references) {
      const instanceStatementId = deferredInstanceIdOf(reference.target);
      if (!instanceStatementId || !containsLogicalPosition(logicalPosition, reference.span)) continue;
      return { instanceStatementId, memberKind: "scalar", expectedScalarType: site.expression.ast.kind === "reference" ? site.expression.type : null };
    }
  }
  for (const site of body?.geometryReferences ?? []) {
    const instanceStatementId = deferredInstanceIdOf(site.reference.target);
    if (instanceStatementId && containsLogicalPosition(logicalPosition, site.reference.span)) {
      return { instanceStatementId, memberKind: "geometry", expectedScalarType: null };
    }
  }
  for (const site of body?.scalarExpressions ?? []) {
    for (const reference of site.expression.geometryProperties) {
      const instanceStatementId = deferredInstanceIdOf(reference.target);
      if (instanceStatementId && containsLogicalPosition(logicalPosition, reference.span)) {
        return { instanceStatementId, memberKind: "geometry", expectedScalarType: null };
      }
    }
  }
  const rootScalarSite = compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId.get(
    compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? ""
  );
  const rootScalarExpectedType = rootScalarSite?.expression.ast.kind === "reference" ? rootScalarSite.expression.type : null;
  for (const reference of rootScalarSite?.expression.references ?? []) {
    const instanceStatementId = deferredInstanceIdOf(reference.target);
    if (!instanceStatementId || !containsLogicalPosition(logicalPosition, reference.span)) continue;
    return {
      instanceStatementId,
      memberKind: "scalar",
      expectedScalarType: rootScalarExpectedType
    };
  }
  for (const site of compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(
    compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? ""
  ) ?? []) {
    const instanceStatementId = deferredInstanceIdOf(site.reference.target);
    if (instanceStatementId && containsLogicalPosition(logicalPosition, site.reference.span)) {
      return { instanceStatementId, memberKind: "geometry", expectedScalarType: null };
    }
  }
  return null;
};

const stableQualifiedInstanceIdAt = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest) => {
  const logicalPosition = request.logicalCursorPosition;
  if (logicalPosition === undefined) return null;
  const body = currentModuleDefinition(compiled, statementIndex, request.scopeId)?.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  for (const site of body?.geometryReferences ?? []) {
    if (logicalPosition >= site.reference.span.start && logicalPosition <= site.reference.span.end) {
      const id = deferredInstanceIdOf(site.reference.target);
      if (id) return id;
    }
  }
  for (const site of body?.scalarExpressions ?? []) {
    for (const reference of site.expression.geometryProperties) {
      if (logicalPosition >= reference.span.start && logicalPosition <= reference.span.end) {
        const id = deferredInstanceIdOf(reference.target);
        if (id) return id;
      }
    }
  }
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  if (!statementId) return null;
  for (const site of compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(statementId) ?? []) {
    if (logicalPosition >= site.reference.span.start && logicalPosition <= site.reference.span.end) {
      const id = deferredInstanceIdOf(site.reference.target);
      if (id) return id;
    }
  }
  return null;
};


const qualifiedGeometryArrayMemberCompletions = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic,
  expected: GeometryArrayType
): ModuleCompletionCandidate[] => {
  const result: ModuleCompletionCandidate[] = [];
  const statements = definitionDocumentStatements(compiled, definition);
  for (const entry of definition.exports) {
    if (entry.kind !== "geometry") continue;
    const actual = moduleGeometryInterfaceTypeOfElement(statements[entry.exportedStatementIndex]);
    if (expected.elementType === "point") {
      if (actual === "point") result.push({ kind: "geometry", label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) });
      else if (actual === "line" || actual === "path") {
        result.push(
          { kind: "geometry", label: `${entry.name}.start`, identity: `${exportIdentityForCandidate(compiled, definition, entry)}:start` },
          { kind: "geometry", label: `${entry.name}.end`, identity: `${exportIdentityForCandidate(compiled, definition, entry)}:end` }
        );
      }
      continue;
    }
    if (isModuleGeometryInterfaceAssignable(actual, expected.elementType)) {
      result.push({ kind: "geometry", label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) });
    }
  }
  return result;
};

const qualifiedGeometryArrayReferenceCompletions = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic,
  expected: GeometryArrayType
): ModuleCompletionCandidate[] =>
  (definitionDocumentGeometryArrayAnalysis(compiled, definition)?.values ?? [])
    .filter((value) => value.ownerModuleDefinitionStatementIndex === definition.statementIndex && value.exported)
    .filter((value) => isGeometryArrayTypeAssignable(value.type, expected))
    .map((value) => ({
      kind: "binding" as const,
      label: value.name,
      identity: geometryArrayIdentityForCandidate(compiled, definition, value.statementId)
    }));

const sourceQualifiedGeometryArrayCompletions = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  request: ModuleCompletionRequest
): ModuleCompletionCandidate[] | null => {
  const context = geometryArrayContextForRequest(compiled, statementIndex, request);
  if (!context || !request.qualifiedInstanceName) return null;
  const resolved = visibleLookup(
    compiled,
    statementIndex,
    request.qualifiedInstanceName,
    request.scopeId,
    request.sourceOrderIndex
  );
  if (resolved?.lookup.kind !== "resolved" || resolved.lookup.declaration.kind !== "moduleInstance") return [];
  if (compiled.moduleSemanticAnalysis) {
    const instance = currentInstance(compiled, resolved.lookup.declaration.statementIndex);
    const definition = definitionForInstance(compiled, instance);
    if (!definition) return [];
    return context.mode === "arrayReference"
      ? qualifiedGeometryArrayReferenceCompletions(compiled, definition, context.expectedType)
      : qualifiedGeometryArrayMemberCompletions(compiled, definition, context.expectedType);
  }

  const instanceStatement = compiled.statements[resolved.lookup.declaration.statementIndex];
  const input = lexicalInput(compiled, null);
  if (instanceStatement?.kind !== "moduleInstance" || !input) return [];
  const callee = resolveModuleLexicalDeclaration(
    input,
    resolved.lookup.declaration.statementIndex,
    instanceStatement.moduleName
  );
  if (callee.kind !== "resolved" || callee.declaration.kind !== "moduleDefinition") return [];
  const definitionIndex = callee.declaration.statementIndex;
  if (context.mode === "arrayReference") {
    return (compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.values ?? [])
      .filter((value) => value.ownerModuleDefinitionStatementIndex === definitionIndex && value.exported)
      .filter((value) => isGeometryArrayTypeAssignable(value.type, context.expectedType))
      .map((value) => ({ kind: "binding" as const, label: value.name, identity: value.statementId }));
  }
  const result: ModuleCompletionCandidate[] = [];
  compiled.statements.forEach((statement, candidateIndex) => {
    if (
      statement.kind !== "element" ||
      !statement.exported ||
      sourceModuleOwnerIndex(compiled, candidateIndex) !== definitionIndex
    ) return;
    const actual = moduleGeometryInterfaceTypeOfElement(statement);
    if (!actual) return;
    const identity = compiled.statementMap?.statementIdByStatementIndex?.get(candidateIndex) ?? `module-export:${candidateIndex}`;
    if (context.expectedType.elementType === "point") {
      if (actual === "point") result.push({ kind: "geometry", label: statement.name, identity });
      else if (actual === "line" || actual === "path") {
        result.push(
          { kind: "geometry", label: `${statement.name}.start`, identity: `${identity}:start` },
          { kind: "geometry", label: `${statement.name}.end`, identity: `${identity}:end` }
        );
      }
      return;
    }
    if (isModuleGeometryInterfaceAssignable(actual, context.expectedType.elementType)) {
      result.push({ kind: "geometry", label: statement.name, identity });
    }
  });
  return result;
};

const qualifiedMemberCompletions = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return [];
  const context = qualifiedMemberContextAt(compiled, statementIndex, request);
  const semanticInstanceStatementId = context?.instanceStatementId ?? stableQualifiedInstanceIdAt(compiled, statementIndex, request);
  const instanceStatementId = semanticInstanceStatementId ?? (() => {
    if (!request.qualifiedInstanceName) return null;
    const resolved = visibleLookup(compiled, statementIndex, request.qualifiedInstanceName, request.scopeId, request.sourceOrderIndex);
    return resolved?.lookup.kind === "resolved" && resolved.lookup.declaration.kind === "moduleInstance"
      ? resolved.lookup.declaration.statementId
      : null;
  })();
  if (!instanceStatementId) return [];
  const instance = analysis.instancesByStatementId.get(instanceStatementId);
  const definition = definitionForInstance(compiled, instance ?? null);
  if (!definition) return [];
  const arrayContext = geometryArrayContextForRequest(compiled, statementIndex, request);
  if (arrayContext) {
    return arrayContext.mode === "member"
      ? qualifiedGeometryArrayMemberCompletions(compiled, definition, arrayContext.expectedType)
      : qualifiedGeometryArrayReferenceCompletions(compiled, definition, arrayContext.expectedType);
  }
  if (request.expectedRecordTypeIdentity) {
    return definition.exports
      .filter((entry): entry is Extract<typeof entry, { kind: "record" }> => entry.kind === "record")
      .filter((entry) => entry.typeIdentity === request.expectedRecordTypeIdentity)
      .map((entry) => ({ kind: "record" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
  }
  if (request.argumentIndex !== undefined) {
    const parameterType = moduleArgumentParameterType(compiled, statementIndex, request.argumentIndex, request);
    const geometryInterfaceType = moduleGeometryInterfaceTypeOf(parameterType);
    if (geometryInterfaceType) {
      const statements = definitionDocumentStatements(compiled, definition);
      return definition.exports
        .filter((entry): entry is Extract<typeof entry, { kind: "geometry" }> => entry.kind === "geometry")
        .filter((entry) => isModuleGeometryInterfaceAssignable(
          moduleGeometryInterfaceTypeOfElement(statements[entry.exportedStatementIndex]),
          geometryInterfaceType
        ))
        .map((entry) => ({ kind: "geometry" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
    }
    const expected = scalarTypeOf(parameterType);
    const recordTypeIdentity = moduleArgumentParameterSlot(compiled, statementIndex, request.argumentIndex, request)?.recordTypeIdentity;
    if (recordTypeIdentity) {
      return definition.exports
        .filter((entry): entry is Extract<typeof entry, { kind: "record" }> => entry.kind === "record")
        .filter((entry) => entry.typeIdentity === recordTypeIdentity)
        .map((entry) => ({ kind: "record" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
    }
    if (!expected) return [];
    return definition.exports
      .filter((entry): entry is Extract<typeof entry, { kind: "scalar" }> => entry.kind === "scalar")
      .filter((entry) => isScalarTypeAssignable(entry.declaredType, expected))
      .map((entry) => ({ kind: "binding" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
  }
  const scalarContext = context?.memberKind === "scalar" || (!context && request.expectedScalarType !== null && request.expectedScalarType !== undefined);
  if (scalarContext) {
    const expected = context?.expectedScalarType ?? request.expectedScalarType ?? null;
    return definition.exports
      .filter((entry): entry is Extract<typeof entry, { kind: "scalar" }> => entry.kind === "scalar")
      .filter((entry) => !expected || isScalarTypeAssignable(entry.declaredType, expected))
      .map((entry) => ({ kind: "binding" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
  }
  return definition.exports
    .filter((entry) => entry.kind === "geometry")
    .map((entry) => ({ kind: "geometry" as const, label: entry.name, identity: exportIdentityForCandidate(compiled, definition, entry) }));
};

/** Module candidates are source-semantic. Last-good identities are accepted
 * for dirty live positions only when the caller supplied a mapped statement;
 * names in the live buffer are never used to re-resolve identities. */
export const moduleCompletionCandidates = (request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const statementIndex = stableStatementIndex(request);
  if (statementIndex < 0 || !request.compiled.sourceLexicalNamespace) return [];
  if (request.kind === "callee") return moduleCalleeCompletions(request.compiled, statementIndex, request);
  if (request.kind === "label") return moduleArgumentLabels(request.compiled, statementIndex, request);
  const declarationArrayContext = request.liveStatementText && request.logicalCursorPosition !== undefined
    ? geometryArrayDeclarationCompletionContextAt(request.liveStatementText, request.logicalCursorPosition)
    : null;
  if (declarationArrayContext && request.kind !== "qualifiedMember") {
    return geometryArrayCandidates(request.compiled, statementIndex, declarationArrayContext, request);
  }
  if (request.kind === "qualifiedMember") {
    const sourceArrayCandidates = sourceQualifiedGeometryArrayCompletions(request.compiled, statementIndex, request);
    if (sourceArrayCandidates !== null) return sourceArrayCandidates;
  }
  if (!request.compiled.moduleSemanticAnalysis) return [];
  if (request.expectedRecordTypeIdentity && request.kind === "reference") {
    return recordCompletions(request.compiled, statementIndex, request.expectedRecordTypeIdentity, request);
  }
  if (request.kind === "value") return moduleArgumentValues(request.compiled, statementIndex, request.argumentIndex ?? 0, request);
  if (request.kind === "qualifiedMember") return qualifiedMemberCompletions(request.compiled, statementIndex, request);
  const owner = currentModuleDefinition(request.compiled, statementIndex, request.scopeId);
  if (!owner) return [];
  const bodyStatement = owner.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  const statement = request.compiled.statements[statementIndex];
  const logical = statement
    ? request.compiled.spans.sourceMap.statements.find((candidate) => candidate.range.from === statement.documentRange.from)
    : undefined;
  const logicalPosition = request.logicalCursorPosition ?? (logical ? physicalToLogicalOffset(request.compiled.spans.sourceMap, logical, request.cursorPosition) : null);
  const geometry = logicalPosition === null ? undefined : bodyStatement?.geometryReferences.find((site) => logicalPosition >= site.span.start && logicalPosition <= site.span.end);
  return geometry
    ? geometryCompletions(request.compiled, statementIndex, geometry.reference.expectedGeometryKind, request)
    : scalarCompletions(request.compiled, statementIndex, request.expectedScalarType ?? null, request);
};
