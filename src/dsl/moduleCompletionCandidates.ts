import type { Completion } from "@codemirror/autocomplete";
import type { CompiledDslDocument } from "./dslDocument";
import { physicalToLogicalOffset } from "./logicalStatementSourceMap";
import { resolveSourceLexicalDeclaration } from "./sourceLexicalNamespaceIndex";
import { scopeChain } from "../scalars/lexicalScopeIndex";
import type { DslModuleParameterType } from "./dslTypes";
import type { ModuleDefinitionSemantic, ModuleInstanceSemantic } from "./moduleSemanticTypes";

export type ModuleCompletionRequest = {
  compiled: CompiledDslDocument;
  cursorPosition: number;
  kind: "callee" | "label" | "value" | "reference" | "qualifiedMember";
  argumentIndex?: number;
};

const geometryKindOfCategory = (category: string): "point" | "line" | null => {
  if (category === "point") return "point";
  if (category === "line" || category === "curve" || category === "arc") return "line";
  return null;
};

const parameterGeometryKind = (type: DslModuleParameterType | null | undefined): "point" | "line" | null =>
  type && typeof type === "object" && (type.kind === "point" || type.kind === "line") ? type.kind : null;

const statementIndexAt = (compiled: CompiledDslDocument, position: number) => compiled.statements.findIndex((statement) =>
  statement.physicalSpan.segments.some((segment) => position >= segment.from && position <= segment.to)
);

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

const visibleDeclarations = (compiled: CompiledDslDocument, statementIndex: number) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [];
  return namespace.allDeclarations.filter((declaration) => {
    if (declaration.statementIndex >= statementIndex) return false;
    const resolved = resolveSourceLexicalDeclaration(namespace, statementIndex, declaration.name);
    return resolved.kind === "resolved" && resolved.declaration.statementId === declaration.statementId;
  });
};

const visibleIterationNames = (compiled: CompiledDslDocument, statementIndex: number) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [];
  const scope = namespace.scopeIndex.scopeOfStatement.get(statementIndex);
  if (!scope) return [];
  return scopeChain(namespace.scopeIndex, scope).flatMap((scopeId) => {
    const slot = namespace.scopeIndex.forGroupIterationSlots.get(scopeId);
    return slot && slot.statementIndex < statementIndex ? [slot.name] : [];
  });
};

const scalarCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: DslModuleParameterType | null | undefined): Completion[] => {
  const result: Completion[] = [];
  const expectedKind = expected && typeof expected === "object" ? expected.kind : expected;
  if (expectedKind === "boolean") {
    return [{ label: "true", type: "enum" }, { label: "false", type: "enum" }];
  }
  if (expectedKind === "string") return [{ label: '""', type: "text" }];
  if (expectedKind === "number" || !expectedKind) {
    result.push({ label: "0", type: "constant" }, { label: "1", type: "constant" });
  }
  for (const declaration of visibleDeclarations(compiled, statementIndex)) {
    if (declaration.kind === "typedDeclaration") {
      const type = declaration.statement.kind === "typedDeclaration" ? declaration.statement.declaredType : null;
      if (!expectedKind || type?.kind === expectedKind) result.push({ label: `@${declaration.name}`, apply: `@${declaration.name}`, type: "constant" });
    }
  }
  const owner = currentModuleDefinition(compiled, statementIndex);
  for (const name of visibleIterationNames(compiled, statementIndex)) result.push({ label: `@${name}`, apply: `@${name}`, type: "constant" });
  if (owner) {
    for (const parameter of owner.parameters) {
      const parameterKind = parameter.type && typeof parameter.type === "object" ? parameter.type.kind : parameter.type;
      if (!expectedKind || parameterKind === expectedKind) result.push({ label: `@${parameter.name}`, apply: `@${parameter.name}`, type: "constant" });
    }
    for (const local of owner.localScalars) {
      if (!expectedKind || local.type?.kind === expectedKind) result.push({ label: `@${local.name}`, apply: `@${local.name}`, type: "constant" });
    }
  }
  return result;
};

const geometryCompletions = (compiled: CompiledDslDocument, statementIndex: number, expected: "point" | "line" | null): Completion[] => {
  const result: Completion[] = [];
  for (const declaration of visibleDeclarations(compiled, statementIndex)) {
    if (declaration.kind !== "geometry") continue;
    const kind = geometryKindOfCategory(declaration.statement.kind === "element" ? declaration.statement.category : "");
    if (expected === "line" && kind === "line") result.push({ label: declaration.name, type: "constant" });
    if (expected === "point" && kind === "point") result.push({ label: declaration.name, type: "constant" });
    if (expected === "point" && kind === "line") {
      result.push({ label: `${declaration.name}.start`, type: "constant" }, { label: `${declaration.name}.end`, type: "constant" });
    }
  }
  const owner = currentModuleDefinition(compiled, statementIndex);
  if (owner) for (const parameter of owner.parameters) {
    if (parameterGeometryKind(parameter.type) === expected) result.push({ label: parameter.name, type: "constant" });
  }
  for (const name of visibleIterationNames(compiled, statementIndex)) result.push({ label: name, type: "constant" });
  return result;
};

const moduleCalleeCompletions = (compiled: CompiledDslDocument, statementIndex: number): Completion[] => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return [];
  const owner = currentModuleDefinition(compiled, statementIndex);
  const shadowedParameters = new Set(owner?.parameters.map((parameter) => parameter.name) ?? []);
  return namespace.allDeclarations
    .filter((declaration) => declaration.kind === "moduleDefinition" && declaration.statementIndex < statementIndex)
    .filter((declaration) => !shadowedParameters.has(declaration.name))
    .filter((declaration) => {
      const resolved = resolveSourceLexicalDeclaration(namespace, statementIndex, declaration.name);
      return resolved.kind === "resolved" && resolved.declaration.statementId === declaration.statementId;
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
  return definition.parameters.filter((parameter) => !used.has(parameter.name)).map((parameter) => ({
    label: parameter.name,
    apply: `${parameter.name}: `,
    type: "property" as const
  }));
};

const moduleArgumentValues = (compiled: CompiledDslDocument, statementIndex: number, argumentIndex: number): Completion[] => {
  const instance = currentInstance(compiled, statementIndex);
  const binding = instance?.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  if (!binding) return [];
  return parameterGeometryKind(binding.parameterType)
    ? geometryCompletions(compiled, statementIndex, parameterGeometryKind(binding.parameterType))
    : scalarCompletions(compiled, statementIndex, binding.parameterType);
};

const qualifiedMemberCompletions = (compiled: CompiledDslDocument, statementIndex: number, cursorPosition: number): Completion[] => {
  const statement = compiled.statements[statementIndex];
  const analysis = compiled.moduleSemanticAnalysis;
  if (!statement || !analysis) return [];
  const prefix = compiled.spans.sourceMap.source.slice(statement.documentRange.from, cursorPosition);
  const instanceName = prefix.match(/([A-Za-z_][A-Za-z0-9_-]*)::[A-Za-z0-9_-]*$/)?.[1];
  if (!instanceName) return [];
  const declaration = compiled.sourceLexicalNamespace && resolveSourceLexicalDeclaration(compiled.sourceLexicalNamespace, statementIndex, instanceName);
  if (declaration?.kind !== "resolved" || declaration.declaration.kind !== "moduleInstance") return [];
  const instance = analysis.instancesByStatementId.get(declaration.declaration.statementId);
  const definition = instance?.callee && analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  return definition?.exports.map((entry) => ({ label: entry.name, type: "constant" as const })) ?? [];
};

/** Module candidates are intentionally source-semantic and fail closed when
 * the compiled document cannot prove the current statement/namespace. */
export const moduleCompletionCandidates = (request: ModuleCompletionRequest): Completion[] => {
  const statementIndex = statementIndexAt(request.compiled, request.cursorPosition);
  if (statementIndex < 0) return [];
  if (request.kind === "callee") return moduleCalleeCompletions(request.compiled, statementIndex);
  if (request.kind === "label") return moduleArgumentLabels(request.compiled, statementIndex);
  if (request.kind === "value") return moduleArgumentValues(request.compiled, statementIndex, request.argumentIndex ?? 0);
  if (request.kind === "qualifiedMember") return qualifiedMemberCompletions(request.compiled, statementIndex, request.cursorPosition);
  const body = currentModuleDefinition(request.compiled, statementIndex);
  if (!body) return [];
  const bodyStatement = body.bodyStatements.find((candidate) => candidate.statementIndex === statementIndex);
  const logical = request.compiled.spans.sourceMap.statements.find((candidate) => candidate.range.from === request.compiled.statements[statementIndex].documentRange.from);
  const logicalPosition = logical ? physicalToLogicalOffset(request.compiled.spans.sourceMap, logical, request.cursorPosition) : null;
  const geometry = logicalPosition === null ? undefined : bodyStatement?.geometryReferences.find((site) => logicalPosition >= site.span.start && logicalPosition <= site.span.end);
  return geometry ? geometryCompletions(request.compiled, statementIndex, geometry.reference.expectedGeometryKind) : scalarCompletions(request.compiled, statementIndex, null);
};
