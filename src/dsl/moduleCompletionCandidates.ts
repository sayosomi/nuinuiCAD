import type { CompiledDslDocument } from "./dslDocument";
import { physicalToLogicalOffset } from "./logicalStatementSourceMap";
import { resolveModuleLexicalDeclaration, isModuleLookupVisibleWithinBody } from "./moduleLexicalResolution";
import { scalarLiteralCandidates } from "../scalars/typedValueCandidates";
import { BUILTIN_FUNCTION_DEFINITIONS, formatBuiltinFunctionSignatures } from "../scalars/builtinFunctions";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import { scalarExpressionCompletionContextAt } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";
import type { DslModuleParameterType } from "./dslTypes";
import type {
  ModuleDefinitionSemantic,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometrySourceTarget,
  ModuleInstanceSemantic,
  ModuleScalarSourceTarget
} from "./moduleSemanticTypes";
import type { ScopeId } from "../scalars/lexicalScopeIndex";
import { scanCallArgs } from "./dslArgScanner";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfElement,
  moduleRuntimeGeometryKindOf,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";

export type ModuleCompletionSite = {
  statementIndex: number;
  scopeId?: ScopeId;
  /** Source-order anchor; it may be one past the last last-good statement. */
  sourceOrderIndex: number;
};

export type ModuleCompletionParameterMetadata = {
  name: string;
  type: DslModuleParameterType | null;
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
  scopeId?: ScopeId;
  sourceOrderIndex?: number;
};

/** Source-semantic Module completion data. This intentionally has no
 * CodeMirror/VS Code insertion action; adapters decide how a semantic
 * candidate is presented and applied in their host. */
export type ModuleCompletionCandidate = {
  kind: "binding" | "builtin" | "geometry" | "literal" | "module" | "argumentName";
  label: string;
  detail?: string;
  identity?: string;
};

const parameterGeometryKind = moduleRuntimeGeometryKindOf;

const scalarTypeOf = (type: DslModuleParameterType | null | undefined): ScalarType | null =>
  type && ["number", "string", "boolean", "choice"].includes(type.kind) ? type as ScalarType : null;

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

const insideHasValueArgument = (request?: ModuleCompletionRequest): boolean => {
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
  request?: ModuleCompletionRequest
) => {
  if (!parameter.optional) return true;
  if (insideHasValueArgument(request)) return true;
  const owner = currentModuleDefinition(compiled, statementIndex, request?.scopeId);
  const body = owner?.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  return body?.presenceParameterKeys.includes(`${parameter.definitionStatementId}:${parameter.parameterIndex}`) ?? false;
};

const scalarCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: DslModuleParameterType | ScalarType | null | undefined, request?: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const expectedType = scalarTypeOf(expected);
  const result: ModuleCompletionCandidate[] = [];
  if (!expectedType || expectedType.kind === "number") {
    result.push({ kind: "literal", label: "0" }, { kind: "literal", label: "1" });
  }
  if (expectedType?.kind === "string") {
    result.push({ kind: "literal", label: '""' });
  } else if (expectedType && expectedType.kind !== "number") {
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
    // A line-like source is point-compatible only through its named endpoint;
    // iteration variables intentionally never enter this branch.
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

const moduleCalleeCompletions = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const owner = currentModuleDefinition(compiled, statementIndex, request.scopeId);
  const input = lexicalInput(compiled, owner);
  if (!namespace || !input) return [];
  return namespace.allDeclarations
    .filter((declaration) => declaration.kind === "moduleDefinition" && declaration.statementIndex < (request.sourceOrderIndex ?? statementIndex))
    .filter((declaration) => {
      const lookup = resolveModuleLexicalDeclaration(input, statementIndex, declaration.name, { scopeId: request.scopeId, sourceOrderIndex: request.sourceOrderIndex });
      return lookup.kind === "resolved" && lookup.declaration.statementId === declaration.statementId;
    })
    .map((declaration) => ({ kind: "module" as const, label: declaration.name, identity: declaration.statementId }));
};

const liveArguments = (request: ModuleCompletionRequest) => {
  const source = request.liveStatementText;
  if (!source) return null;
  const open = source.indexOf("(");
  if (open < 0) return null;
  return scanCallArgs(source, { start: open + 1, end: source.length }).args;
};

const moduleArgumentLabels = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const statement = compiled.statements[statementIndex];
  const used = request.usedArgumentNames ?? new Set(
    (liveArguments(request)?.map((argument) => argument.key) ?? (statement?.kind === "moduleInstance" ? statement.arguments.map((argument) => argument.label) : []))
      .filter((label): label is string => Boolean(label))
  );
  if (request.currentDefinitionParameters) {
    return request.currentDefinitionParameters
      .filter((parameter) => !used.has(parameter.name))
      .map((parameter) => ({ kind: "argumentName" as const, label: parameter.name }));
  }

  const instance = currentInstance(compiled, statementIndex);
  if (!instance?.callee || statement?.kind !== "moduleInstance") return [];
  const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) return [];
  const parameters = request.currentDefinitionParameters ?? definition.parameters;
  return parameters
    .filter((parameter) => !used.has(parameter.name))
    .map((parameter) => ({ kind: "argumentName" as const, label: parameter.name }));
};

const moduleArgumentParameterType = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  argumentIndex: number,
  request: ModuleCompletionRequest
): DslModuleParameterType | null => {
  const instance = currentInstance(compiled, statementIndex);
  const definition = instance?.callee && compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) return null;
  const liveArgument = liveArguments(request)?.[argumentIndex];
  if (request.currentDefinitionParameters) {
    const parameter = liveArgument?.key
      ? request.currentDefinitionParameters.find((candidate) => candidate.name === liveArgument.key)
      : request.currentDefinitionParameters[argumentIndex];
    return parameter?.type ?? null;
  }
  const binding = instance?.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  const parameter = liveArgument?.key
    ? definition.parameters.find((candidate) => candidate.name === liveArgument.key)
    : binding && definition.parameters[binding.parameterIndex];
  return parameter?.type ?? binding?.parameterType ?? null;
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
  const parameterType = moduleArgumentParameterType(compiled, statementIndex, argumentIndex, request);
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
  const definition = instance?.callee && analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) return [];
  if (request.argumentIndex !== undefined) {
    const parameterType = moduleArgumentParameterType(compiled, statementIndex, request.argumentIndex, request);
    const geometryInterfaceType = moduleGeometryInterfaceTypeOf(parameterType);
    if (geometryInterfaceType) {
      return definition.exports
        .filter((entry): entry is Extract<typeof entry, { kind: "geometry" }> => entry.kind === "geometry")
        .filter((entry) => isModuleGeometryInterfaceAssignable(
          moduleGeometryInterfaceTypeOfElement(compiled.statements[entry.exportedStatementIndex]),
          geometryInterfaceType
        ))
        .map((entry) => ({ kind: "geometry" as const, label: entry.name, identity: entry.name }));
    }
    const expected = scalarTypeOf(parameterType);
    if (!expected) return [];
    return definition.exports
      .filter((entry): entry is Extract<typeof entry, { kind: "scalar" }> => entry.kind === "scalar")
      .filter((entry) => isScalarTypeAssignable(entry.declaredType, expected))
      .map((entry) => ({ kind: "binding" as const, label: entry.name, identity: entry.name }));
  }
  const scalarContext = context?.memberKind === "scalar" || (!context && request.expectedScalarType !== null && request.expectedScalarType !== undefined);
  if (scalarContext) {
    const expected = context?.expectedScalarType ?? request.expectedScalarType ?? null;
    return definition.exports
      .filter((entry): entry is Extract<typeof entry, { kind: "scalar" }> => entry.kind === "scalar")
      .filter((entry) => !expected || isScalarTypeAssignable(entry.declaredType, expected))
      .map((entry) => ({ kind: "binding" as const, label: entry.name, identity: entry.name }));
  }
  return definition.exports
    .filter((entry) => entry.kind === "geometry")
    .map((entry) => ({ kind: "geometry" as const, label: entry.name, identity: entry.name }));
};

/** Module candidates are source-semantic. Last-good identities are accepted
 * for dirty live positions only when the caller supplied a mapped statement;
 * names in the live buffer are never used to re-resolve identities. */
export const moduleCompletionCandidates = (request: ModuleCompletionRequest): ModuleCompletionCandidate[] => {
  const statementIndex = stableStatementIndex(request);
  if (statementIndex < 0 || !request.compiled.sourceLexicalNamespace) return [];
  if (request.kind === "callee") return moduleCalleeCompletions(request.compiled, statementIndex, request);
  if (request.kind === "label") return moduleArgumentLabels(request.compiled, statementIndex, request);
  if (!request.compiled.moduleSemanticAnalysis) return [];
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
