import type { Completion } from "@codemirror/autocomplete";
import type { CompiledDslDocument } from "./dslDocument";
import { physicalToLogicalOffset } from "./logicalStatementSourceMap";
import { resolveModuleLexicalDeclaration, isModuleLookupVisibleWithinBody } from "./moduleLexicalResolution";
import { isBareDslIdentifierChar } from "./dslTokens";
import { scalarLiteralCandidates } from "../scalars/typedValueCandidates";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import type { ScalarType } from "../scalars/types";
import type { DslModuleParameterType } from "./dslTypes";
import type { ModuleDefinitionSemantic, ModuleInstanceSemantic } from "./moduleSemanticTypes";

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
};

const geometryKindOfCategory = (category: string): "point" | "line" | null =>
  category === "point" ? "point" : ["line", "curve", "arc"].includes(category) ? "line" : null;

const parameterGeometryKind = (type: DslModuleParameterType | null | undefined): "point" | "line" | null =>
  type?.kind === "point" || type?.kind === "line" ? type.kind : null;

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

const currentModuleDefinition = (compiled: CompiledDslDocument, statementIndex: number): ModuleDefinitionSemantic | null => {
  const id = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  if (!id || !compiled.moduleSemanticAnalysis) return null;
  return compiled.moduleSemanticAnalysis.definitions.find((definition) => definition.bodyStatementIds.includes(id)) ?? null;
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

const lookupFor = (compiled: CompiledDslDocument, statementIndex: number, name: string) => {
  const owner = currentModuleDefinition(compiled, statementIndex);
  const input = lexicalInput(compiled, owner);
  return input ? { owner, lookup: resolveModuleLexicalDeclaration(input, statementIndex, name) } : null;
};

const visibleLookup = (compiled: CompiledDslDocument, statementIndex: number, name: string) => {
  const resolved = lookupFor(compiled, statementIndex, name);
  if (!resolved) return null;
  return resolved.owner && compiled.sourceLexicalNamespace
    ? (isModuleLookupVisibleWithinBody(compiled.sourceLexicalNamespace, resolved.lookup, resolved.owner.bodyScopeId) ? resolved : null)
    : resolved;
};

const bodyNames = (compiled: CompiledDslDocument, statementIndex: number): string[] => {
  const owner = currentModuleDefinition(compiled, statementIndex);
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [];
  return [...new Set([
    ...namespace.allDeclarations.map((declaration) => declaration.name),
    ...(owner?.parameters.map((parameter) => parameter.name) ?? [])
  ])];
};

const scalarCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: DslModuleParameterType | null | undefined): Completion[] => {
  const expectedType = scalarTypeOf(expected);
  const result: Completion[] = [];
  if (!expectedType || expectedType.kind === "number") {
    result.push({ label: "0", type: "constant" }, { label: "1", type: "constant" });
  }
  if (expectedType?.kind === "string") {
    result.push({ label: '""', type: "text" });
  } else if (expectedType && expectedType.kind !== "number") {
    result.push(...scalarLiteralCandidates(expectedType).map((literal) => ({ label: literal.label, type: "enum" as const })));
  }
  for (const name of bodyNames(compiled, statementIndex)) {
    const resolved = visibleLookup(compiled, statementIndex, name);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "iteration") {
      if (!expectedType || expectedType.kind === "number") result.push({ label: `@${name}`, apply: `@${name}`, type: "constant" });
      continue;
    }
    if (lookup.kind === "parameter") {
      const type = scalarTypeOf(lookup.parameter.value.type);
      if (type && (!expectedType || isScalarTypeAssignable(type, expectedType))) result.push({ label: `@${name}`, apply: `@${name}`, type: "constant" });
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration" || lookup.declaration.statement.kind !== "typedDeclaration") continue;
    const type = lookup.declaration.statement.declaredType;
    if (!type) continue;
    if (!expectedType) result.push({ label: `@${name}`, apply: `@${name}`, type: "constant" });
    else if (isScalarTypeAssignable(type, expectedType)) result.push({ label: `@${name}`, apply: `@${name}`, type: "constant" });
  }
  return result;
};

const geometryCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: "point" | "line" | null): Completion[] => {
  if (!expected) return [];
  const result: Completion[] = [];
  for (const name of bodyNames(compiled, statementIndex)) {
    const resolved = visibleLookup(compiled, statementIndex, name);
    if (!resolved) continue;
    const { lookup } = resolved;
    if (lookup.kind === "parameter") {
      if (parameterGeometryKind(lookup.parameter.value.type) === expected) result.push({ label: name, type: "constant" });
      continue;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "geometry" || lookup.declaration.statement.kind !== "element") continue;
    const kind = geometryKindOfCategory(lookup.declaration.statement.category);
    if (kind === expected) result.push({ label: name, type: "constant" });
    // A line-like source is point-compatible only through its named endpoint;
    // iteration variables intentionally never enter this branch.
    if (expected === "point" && kind === "line") {
      result.push({ label: `${name}.start`, type: "constant" }, { label: `${name}.end`, type: "constant" });
    }
  }
  return result;
};

const moduleCalleeCompletions = (compiled: CompiledDslDocument, statementIndex: number): Completion[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const input = lexicalInput(compiled, currentModuleDefinition(compiled, statementIndex));
  if (!namespace || !input) return [];
  return namespace.allDeclarations
    .filter((declaration) => declaration.kind === "moduleDefinition" && declaration.statementIndex < statementIndex)
    .filter((declaration) => {
      const lookup = resolveModuleLexicalDeclaration(input, statementIndex, declaration.name);
      return lookup.kind === "resolved" && lookup.declaration.statementId === declaration.statementId;
    })
    .map((declaration) => ({ label: declaration.name, type: "class" as const }));
};

const moduleArgumentLabels = (compiled: CompiledDslDocument, statementIndex: number): Completion[] => {
  const instance = currentInstance(compiled, statementIndex);
  const statement = compiled.statements[statementIndex];
  if (!instance?.callee || statement?.kind !== "moduleInstance") return [];
  const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) return [];
  const used = new Set(statement.arguments.map((argument) => argument.label).filter((label): label is string => Boolean(label)));
  return definition.parameters.filter((parameter) => !used.has(parameter.name)).map((parameter) => ({ label: parameter.name, apply: `${parameter.name}: `, type: "property" as const }));
};

const moduleArgumentValues = (compiled: CompiledDslDocument, statementIndex: number, argumentIndex: number): Completion[] => {
  const instance = currentInstance(compiled, statementIndex);
  const binding = instance?.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  if (!binding) return [];
  const geometryKind = parameterGeometryKind(binding.parameterType);
  return geometryKind ? geometryCompletions(compiled, statementIndex, geometryKind) : scalarCompletions(compiled, statementIndex, binding.parameterType);
};

const isIdentifierChar = (value: string | undefined) => Boolean(value && isBareDslIdentifierChar(value));

const qualifiedInstanceFrom = (source: string, position: number): string | null => {
  const before = source.slice(0, position);
  let memberStart = before.length;
  while (memberStart > 0 && isIdentifierChar(before[memberStart - 1])) memberStart -= 1;
  if (before.slice(Math.max(0, memberStart - 2), memberStart) !== "::") return null;
  const instanceEnd = memberStart - 2;
  let instanceStart = instanceEnd;
  while (instanceStart > 0 && isIdentifierChar(before[instanceStart - 1])) instanceStart -= 1;
  return instanceStart < instanceEnd ? before.slice(instanceStart, instanceEnd) : null;
};

const qualifiedMemberCompletions = (compiled: CompiledDslDocument, statementIndex: number, request: ModuleCompletionRequest): Completion[] => {
  const source = request.sourceText ?? compiled.spans.sourceMap.source;
  const instanceName = request.qualifiedInstanceName ?? qualifiedInstanceFrom(source, request.cursorPosition);
  const input = lexicalInput(compiled, currentModuleDefinition(compiled, statementIndex));
  const analysis = compiled.moduleSemanticAnalysis;
  if (!instanceName || !input || !analysis) return [];
  const lookup = resolveModuleLexicalDeclaration(input, statementIndex, instanceName);
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "moduleInstance") return [];
  const instance = analysis.instancesByStatementId.get(lookup.declaration.statementId);
  const definition = instance?.callee && analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  return definition?.exports.map((entry) => ({ label: entry.name, type: "constant" as const })) ?? [];
};

/** Module candidates are source-semantic. Last-good identities are accepted
 * for dirty live positions only when the caller supplied a mapped statement;
 * names in the live buffer are never used to re-resolve identities. */
export const moduleCompletionCandidates = (request: ModuleCompletionRequest): Completion[] => {
  const statementIndex = stableStatementIndex(request);
  if (statementIndex < 0 || !request.compiled.sourceLexicalNamespace) return [];
  if (request.kind === "callee") return moduleCalleeCompletions(request.compiled, statementIndex);
  if (!request.compiled.moduleSemanticAnalysis) return [];
  if (request.kind === "label") return moduleArgumentLabels(request.compiled, statementIndex);
  if (request.kind === "value") return moduleArgumentValues(request.compiled, statementIndex, request.argumentIndex ?? 0);
  if (request.kind === "qualifiedMember") return qualifiedMemberCompletions(request.compiled, statementIndex, request);
  const owner = currentModuleDefinition(request.compiled, statementIndex);
  if (!owner) return [];
  const bodyStatement = owner.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  const statement = request.compiled.statements[statementIndex];
  const logical = statement
    ? request.compiled.spans.sourceMap.statements.find((candidate) => candidate.range.from === statement.documentRange.from)
    : undefined;
  const logicalPosition = request.logicalCursorPosition ?? (logical ? physicalToLogicalOffset(request.compiled.spans.sourceMap, logical, request.cursorPosition) : null);
  const geometry = logicalPosition === null ? undefined : bodyStatement?.geometryReferences.find((site) => logicalPosition >= site.span.start && logicalPosition <= site.span.end);
  return geometry ? geometryCompletions(request.compiled, statementIndex, geometry.reference.expectedGeometryKind) : scalarCompletions(request.compiled, statementIndex, null);
};
