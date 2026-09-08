import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ElementId, GeometryInputTarget, GeometryValueOccurrence } from "../types/geometry";
import type { DslDiagnostic, DslStatement } from "./dslTypes";
import type { DslGeometryResolverOverrides } from "./dslApplyArgs";
import type { MaterializedExecutionStatement, ModuleMaterialization } from "./moduleMaterialization";
import { moduleRuntimeGeometryKindOf, type ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
  ModuleGeometryReferenceSite,
  ModuleGeometrySourceTarget,
  ModulePointCoordinateSemantic,
  ModuleSemanticAnalysis,
  ResolvedModuleExport,
} from "./moduleSemanticTypes";
import { moduleMutationOwnershipDiagnostics } from "./moduleMutationOwnership";
import { buildModuleGeometryArrayRuntime } from "./moduleGeometryArrayRuntime";
import {
  diagnosticForExport,
  diagnosticForExportNamespace,
  geometryKindOfCategory,
  lowerReference,
  pathKey,
  propertyForAlias,
  resolverForBody,
  runtimeEntryForBody,
  sourceAliasForTarget,
  type ExportEntry,
  type GeometryAlias,
  type RuntimeGeometryInputTarget,
  type InstanceContext,
  type ModuleGeometryPropertyRuntimeTarget
} from "./moduleGeometryRuntimeLowering";
import type { ModuleRuntimeContext } from "./moduleRuntimeContext";

export type { ModuleGeometryPropertyRuntimeTarget };

export type ModuleGeometryBuiltinRuntimeTarget =
  | {
      kind: "drawable";
      elementId: ElementId;
      geometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
      pointKey?: string;
    }
  | {
      kind: "geometryValue";
      occurrence: GeometryValueOccurrence;
      geometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
      pointKey?: string;
    };

export type ModuleGeometryRuntimeCompilation = {
  diagnostics: readonly DslDiagnostic[];
  resolversByRuntimeElementId: ReadonlyMap<ElementId, DslGeometryResolverOverrides>;
  geometryInputTargetsByRuntimeElementId: ReadonlyMap<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>;
  geometryInputTargetSourcesByRuntimeElementId: ReadonlyMap<ElementId, ReadonlyMap<string, RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]>>;
  resolvePropertyTarget: (
    target: ModuleGeometryPropertySourceTarget,
    instancePath: readonly string[],
    elementsById: ReadonlyMap<ElementId, CadElement>
  ) => ModuleGeometryPropertyRuntimeTarget | undefined;
  resolveBuiltinTarget: (
    target: ModuleGeometrySourceTarget,
    instancePath: readonly string[],
    expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
  ) => ModuleGeometryBuiltinRuntimeTarget | undefined;
  coordinateForReference: (
    reference: ModuleGeometryReferenceSemantic,
    instancePath: readonly string[]
  ) => ModulePointCoordinateSemantic | undefined;
};

export const buildModuleGeometryRuntime = ({
  statements,
  stableStatementIdByIndex,
  moduleSemanticAnalysis,
  moduleMaterialization,
  moduleRuntimeContext
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  moduleRuntimeContext?: ModuleRuntimeContext;
}): ModuleGeometryRuntimeCompilation => {
  const diagnostics: DslDiagnostic[] = [];
  const contextsByPath = new Map<string, InstanceContext>();
  const exportsByPath = new Map<string, ReadonlyMap<string, ExportEntry>>();
  const resolversByRuntimeElementId = new Map<ElementId, DslGeometryResolverOverrides>();
  const geometryInputTargetsByRuntimeElementId = new Map<ElementId, Map<string, GeometryInputTarget | readonly GeometryInputTarget[]>>();
  const geometryInputTargetSourcesByRuntimeElementId = new Map<ElementId, Map<string, RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]>>();
  const isTargetList = (target: RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]): target is readonly RuntimeGeometryInputTarget[] => Array.isArray(target);

  const exportAliasFor = (path: readonly string[], exported: Extract<ResolvedModuleExport, { kind: "geometry" }>): GeometryAlias | undefined => {
    if (exported.backingTarget) {
      return sourceAliasForTarget(exported.backingTarget, path, contextsByPath, moduleMaterialization, exportsByPath);
    }
    const entry = runtimeEntryForBody(moduleMaterialization, path, exported.exportedStatementId);
    const kind = geometryKindOfCategory(exported.category, exported.interfaceType);
    if (!entry || !kind) return undefined;
    return kind === "point"
      ? { kind: "point", anchor: referenceAnchor(entry.runtimeElementId) }
      : { kind: "line", elementId: entry.runtimeElementId };
  };

  const register = (instance: import("./moduleSemanticTypes").ModuleInstanceSemantic, parentPath: readonly string[]): InstanceContext | undefined => {
    const path = moduleRuntimeContext
      ? moduleRuntimeContext.runtimePathForInstance(parentPath, instance)
      : [...parentPath, instance.statementId];
    const key = pathKey(path);
    const existing = contextsByPath.get(key);
    if (existing) return existing;
    if (!instance?.callee) return undefined;
    const instanceDocumentId = instance.identity?.documentId ?? instance.documentId ?? moduleRuntimeContext?.rootDocumentId;
    const definition = moduleRuntimeContext
      ? moduleRuntimeContext.definitionFor(instance.callee.definitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId)
      : moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) return undefined;
    const definitionDocumentId = definition.identity?.documentId ?? definition.documentId ?? instance.callee.definitionIdentity?.documentId ?? moduleRuntimeContext?.rootDocumentId;
    const context: InstanceContext = {
      path,
      instanceStatementId: instance.statementId,
      instanceDocumentId,
      definitionStatementId: definition.statementId,
      definitionDocumentId,
      definition,
      aliases: new Map()
    };
    contextsByPath.set(key, context);
    const exportEntries = new Map<string, ExportEntry>();
    exportsByPath.set(key, exportEntries);
    const populateExports = () => {
      exportEntries.clear();
      for (const exported of definition.exports) {
        if (exported.kind !== "geometry") continue;
        const alias = exportAliasFor(path, exported);
        if (alias) exportEntries.set(exported.name, { exported, alias });
      }
    };
    populateExports();
    for (const parameter of definition.parameters) {
      if (!moduleRuntimeGeometryKindOf(parameter.type)) continue;
      const binding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (binding?.value?.kind !== "geometry") continue;
      const instanceStatement = moduleRuntimeContext?.documentFor(instanceDocumentId)?.statements[instance.statementIndex] ?? statements[instance.statementIndex];
      const alias = lowerReference(binding.value.reference, parentPath, instanceStatement, contextsByPath, moduleMaterialization, exportsByPath);
      if (alias) (context.aliases as Map<number, GeometryAlias>).set(parameter.parameterIndex, alias);
    }
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "moduleInstance") continue;
      const definitionAnalysis = moduleRuntimeContext?.analysisFor(definitionDocumentId) ?? moduleSemanticAnalysis;
      const nested = definitionAnalysis.instancesByStatementId.get(body.statementId);
      if (nested) register(nested, path);
    }
    populateExports();
    return context;
  };

  for (const instance of moduleSemanticAnalysis.instances) {
    if (instance.callerModuleDefinitionStatementId === null) register(instance, []);
  }

  const geometryArrayRuntime = buildModuleGeometryArrayRuntime({
    statements,
    stableStatementIdByIndex,
    moduleSemanticAnalysis,
    moduleMaterialization,
    contextsByPath,
    exportsByPath,
    moduleRuntimeContext
  });
  for (const context of contextsByPath.values()) {
    const instance = moduleRuntimeContext?.instanceFor({
      documentId: context.instanceDocumentId!,
      localIdentity: context.instanceStatementId
    }) ?? moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId);
    if (!instance) continue;
    for (const parameter of context.definition.parameters) {
      const binding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      const reference = binding?.value?.kind === "geometry" ? binding.value.reference : null;
      if (reference?.target?.kind !== "collectionIndex") continue;
      const indexedTarget = reference.target.expectedGeometryKind === "point"
        ? (() => {
            const target = geometryArrayRuntime.resolvePointReferenceAt(reference.source, instance.statementIndex, context.path.slice(0, -1), reference.target);
            if (!target) return undefined;
            if (target && "target" in target) {
              return { kind: "collectionIndex" as const, target: target.target, members: target.members } satisfies GeometryAlias;
            }
            return target ? { kind: "point" as const, anchor: target } : undefined;
          })()
        : (() => {
            const resolved = geometryArrayRuntime.resolveLineReferenceTargetAt(reference.source, instance.statementIndex, context.path.slice(0, -1), reference.target);
            if (!resolved) return undefined;
            if ("target" in resolved) return { kind: "collectionIndex" as const, target: resolved.target, members: resolved.members } satisfies GeometryAlias;
            if (resolved.kind === "drawable") return { kind: "line" as const, elementId: resolved.elementId };
            if (resolved.kind !== "geometryValue") return undefined;
            return {
              kind: "value" as const,
              occurrence: resolved.occurrence,
              geometryType: resolved.geometryType === "path" ? "line" as const : resolved.geometryType,
              interfaceType: resolved.geometryType
            };
          })();
      if (indexedTarget) (context.aliases as Map<number, GeometryAlias>).set(parameter.parameterIndex, indexedTarget);
    }
  }

  diagnostics.push(...geometryArrayRuntime.diagnostics);

  const definitionForInstance = (instanceStatementId: string) => {
    const childInstance = moduleSemanticAnalysis.instancesByStatementId.get(instanceStatementId);
    return childInstance?.callee
      ? moduleSemanticAnalysis.definitionsByStatementId.get(childInstance.callee.definitionStatementId)
      : undefined;
  };

  const validateDeferred = (
    statement: DslStatement,
    target: Extract<ModuleGeometrySourceTarget, { kind: "deferredModuleExport" }>,
    currentPath: readonly string[]
  ) => {
    const targetInstance = moduleRuntimeContext?.instanceFor(target.instanceIdentity) ?? moduleSemanticAnalysis.instancesByStatementId.get(target.instanceStatementId);
    const definition = targetInstance?.callee
      ? moduleRuntimeContext?.definitionFor(targetInstance.callee.definitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(targetInstance.callee.definitionStatementId)
      : definitionForInstance(target.instanceStatementId);
    const child = [...contextsByPath.values()].find((candidate) =>
      candidate.path.length === currentPath.length + 1 &&
      currentPath.every((part, index) => candidate.path[index] === part) &&
      candidate.instanceStatementId === target.instanceStatementId &&
      (!target.instanceIdentity || candidate.instanceDocumentId === target.instanceIdentity.documentId)
    );
    const entry = child ? exportsByPath.get(pathKey(child.path))?.get(target.exportName) : undefined;
    const targetStatements = definition?.documentId
      ? moduleRuntimeContext?.documentFor(definition.documentId)?.statements ?? statements
      : statements;
    const diagnostic = diagnosticForExport(statement, target, definition, targetStatements, entry);
    if (diagnostic) diagnostics.push(diagnostic);
  };

  const validateDeferredNamespace = (
    statement: DslStatement,
    target: Extract<ModuleGeometryPropertySourceTarget, { kind: "deferredModuleExportProperty" }>,
    currentPath: readonly string[]
  ) => {
    const targetInstance = moduleRuntimeContext?.instanceFor(target.instanceIdentity) ?? moduleSemanticAnalysis.instancesByStatementId.get(target.instanceStatementId);
    const definition = targetInstance?.callee
      ? moduleRuntimeContext?.definitionFor(targetInstance.callee.definitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(targetInstance.callee.definitionStatementId)
      : definitionForInstance(target.instanceStatementId);
    const child = [...contextsByPath.values()].find((candidate) =>
      candidate.path.length === currentPath.length + 1 &&
      currentPath.every((part, index) => candidate.path[index] === part) &&
      candidate.instanceStatementId === target.instanceStatementId &&
      (!target.instanceIdentity || candidate.instanceDocumentId === target.instanceIdentity.documentId)
    );
    const entry = child ? exportsByPath.get(pathKey(child.path))?.get(target.exportName) : undefined;
    const targetStatements = definition?.documentId
      ? moduleRuntimeContext?.documentFor(definition.documentId)?.statements ?? statements
      : statements;
    const diagnostic = diagnosticForExportNamespace(statement, target, definition, targetStatements, entry);
    if (diagnostic) diagnostics.push(diagnostic);
  };

  const validateReference = (statement: DslStatement, reference: ModuleGeometryReferenceSemantic, currentPath: readonly string[]) => {
    if (reference.target?.kind !== "deferredModuleExport") return;
    if (geometryArrayRuntime.acceptsDeferredLineListExport(reference, currentPath)) return;
    validateDeferred(statement, reference.target, currentPath);
  };

  // Ownership belongs to the module definition, not to a particular
  // materialized instance. Apply this once even when a definition is not yet
  // instantiated; repeated calls must not duplicate the same source error.
  const mutationDefinitions = moduleRuntimeContext
    ? [...moduleRuntimeContext.documentsById.values()].flatMap((document) => document.moduleSemanticAnalysis.definitions)
    : moduleSemanticAnalysis.definitions;
  for (const definition of mutationDefinitions) {
    for (const body of definition.bodyStatements) {
      const statement = moduleRuntimeContext?.documentFor(definition.documentId)?.statements[body.statementIndex] ?? statements[body.statementIndex];
      if (statement) diagnostics.push(...moduleMutationOwnershipDiagnostics(statement, body));
    }
  }

  for (const context of contextsByPath.values()) {
    const instance = moduleRuntimeContext?.instanceFor({
      documentId: context.instanceDocumentId!,
      localIdentity: context.instanceStatementId
    }) ?? moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId);
    if (!instance) continue;
    const instanceStatements = moduleRuntimeContext?.documentFor(context.instanceDocumentId)?.statements ?? statements;
    for (const binding of instance.parameterBindings) {
      if (binding.value?.kind === "geometry") validateReference(instanceStatements[instance.statementIndex], binding.value.reference, context.path.slice(0, -1));
    }
    const definitionStatements = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements ?? statements;
    for (const body of context.definition.bodyStatements) {
      const statement = definitionStatements[body.statementIndex];
      if (!statement) continue;
      for (const site of body.geometryReferences) validateReference(statement, site.reference, context.path);
      for (const site of body.scalarExpressions) {
        for (const property of site.expression.geometryProperties) {
          if (property.target?.kind === "deferredModuleExportProperty") {
            validateDeferredNamespace(statement, property.target, context.path);
          }
        }
      }
    }
  }

  const entrySites = (entry: MaterializedExecutionStatement): readonly ModuleGeometryReferenceSite[] => {
    const definition = entry.origin?.moduleDefinitionStatementId
      ? moduleRuntimeContext?.definitionFor(entry.origin.moduleDefinitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(entry.origin.moduleDefinitionStatementId)
      : undefined;
    const body = definition?.bodyStatements.find((candidate) => candidate.statementId === entry.sourceStatementId);
    return body?.geometryReferences ?? moduleSemanticAnalysis.rootGeometryReferencesByStatementId.get(entry.sourceStatementId) ?? [];
  };
  for (const entry of moduleMaterialization.executionStatements) {
    if (entry.type === "moduleInstance") continue;
    const sites = entrySites(entry);
    const baseResolver = resolverForBody({
      statement: entry.statement,
      sites,
      currentPath: entry.runtimeInstancePath ?? entry.instancePath,
      statementIndex: entry.sourceStatementIndex,
      contextsByPath,
      materialization: moduleMaterialization,
      exportsByPath,
      resolveLineReferenceTargetAt: geometryArrayRuntime.resolveLineReferenceTargetAt,
      resolvePointReferenceAt: geometryArrayRuntime.resolvePointReferenceAt
    });
    const targetsForElement = new Map<string, RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]>();
    resolversByRuntimeElementId.set(entry.runtimeElementId, {
      ...baseResolver,
      recordGeometryInputTarget: (_elementId, parameterKey, target) => {
        const existing = targetsForElement.get(parameterKey);
        if (!existing) {
          targetsForElement.set(parameterKey, target);
        } else {
          const existingTargets = Array.isArray(existing) ? existing : [existing];
          const newTargets = Array.isArray(target) ? target : [target];
          targetsForElement.set(parameterKey, [...existingTargets, ...newTargets]);
        }
        const sourceTargets = geometryInputTargetSourcesByRuntimeElementId.get(entry.runtimeElementId) ?? new Map();
        sourceTargets.set(parameterKey, target);
        geometryInputTargetSourcesByRuntimeElementId.set(entry.runtimeElementId, sourceTargets);
        if (!isTargetList(target) && target.kind !== "collectionIndex") {
          geometryInputTargetsByRuntimeElementId.set(entry.runtimeElementId, targetsForElement as Map<string, GeometryInputTarget | readonly GeometryInputTarget[]>);
        }
      },
      resolveLineReferenceList: (token) => geometryArrayRuntime.resolveLineReferenceList(
        token,
        entry.sourceStatementIndex,
        entry.runtimeInstancePath ?? entry.instancePath
      ),
      resolvePointReferenceList: (token) => geometryArrayRuntime.resolvePointReferenceList(
        token,
        entry.sourceStatementIndex,
        entry.runtimeInstancePath ?? entry.instancePath
      )
    });
  }

  for (const [statementIndex, statement] of statements.entries()) {
    const statementId = stableStatementIdByIndex.get(statementIndex);
    const sites = statementId ? moduleSemanticAnalysis.rootGeometryReferencesByStatementId.get(statementId) : undefined;
    if (!sites) continue;
    for (const site of sites) validateReference(statement, site.reference, []);
  }

  const resolvePropertyTarget = (
    target: ModuleGeometryPropertySourceTarget,
    instancePath: readonly string[],
    elementsById: ReadonlyMap<ElementId, CadElement>
  ): ModuleGeometryPropertyRuntimeTarget | undefined => {
    if (
      target.kind === "recordField" ||
      target.kind === "collectionValueLength" ||
      target.kind === "collectionParameterLength" ||
      target.kind === "deferredModuleCollectionExportLength"
    ) return undefined;
    const baseTarget: ModuleGeometrySourceTarget = target.kind === "parameterProperty"
      ? { ...target, kind: "parameter" }
      : target.kind === "sourceGeometryProperty"
        ? { ...target, kind: "sourceGeometry", geometryKind: target.category === "point" ? "point" : "line" }
        : target.kind === "geometryValueProperty"
          ? {
              kind: "geometryValue",
              statementId: target.statementId,
              statementIndex: target.statementIndex,
              declaredInterfaceType: target.declaredInterfaceType,
              backingTarget: null,
              ownerModuleDefinitionStatementId: target.ownerModuleDefinitionStatementId,
              ownerModuleDefinitionStatementIndex: target.ownerModuleDefinitionStatementIndex,
              ...(target.pointKey ? { pointKey: target.pointKey } : {}),
              ...(target.identity ? { identity: target.identity } : {})
            }
        : { ...target, kind: "deferredModuleExport", expectedGeometryKind: "line" };
    const alias = sourceAliasForTarget(baseTarget, instancePath, contextsByPath, moduleMaterialization, exportsByPath);
    return alias ? propertyForAlias(alias, target.property, elementsById) : undefined;
  };

  const coordinateForReference = (reference: ModuleGeometryReferenceSemantic, instancePath: readonly string[]) => {
    if (reference.coordinate) return reference.coordinate;
    if (!reference.target) return undefined;
    const alias = sourceAliasForTarget(reference.target, instancePath, contextsByPath, moduleMaterialization, exportsByPath);
    return alias?.kind === "point" ? alias.coordinate : undefined;
  };

  const resolveBuiltinTarget = (
    target: ModuleGeometrySourceTarget,
    instancePath: readonly string[],
    expectedGeometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">
  ): ModuleGeometryBuiltinRuntimeTarget | undefined => {
    const alias = sourceAliasForTarget(target, instancePath, contextsByPath, moduleMaterialization, exportsByPath);
    if (!alias) return undefined;
    if (expectedGeometryType === "line" && alias.kind === "line") {
      return { kind: "drawable", elementId: alias.elementId, geometryType: "line" };
    }
    if (alias.kind === "value" && alias.geometryType === expectedGeometryType) {
      return {
        kind: "geometryValue",
        occurrence: alias.occurrence,
        geometryType: expectedGeometryType,
        ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
      };
    }
    if (expectedGeometryType === "point" && alias.kind === "point" && alias.anchor.mode === "reference") {
      return { kind: "drawable", elementId: alias.anchor.pointId, geometryType: "point" };
    }
    if (expectedGeometryType === "point" && alias.kind === "point" && alias.anchor.mode === "derived") {
      return { kind: "drawable", elementId: alias.anchor.elementId, geometryType: "point", pointKey: alias.anchor.pointKey };
    }
    // Coordinate aliases intentionally fail closed here:
    // geometry builtins require a concrete runtime geometry element identity.
    return undefined;
  };

  return {
    diagnostics,
    resolversByRuntimeElementId,
    geometryInputTargetsByRuntimeElementId,
    geometryInputTargetSourcesByRuntimeElementId,
    resolvePropertyTarget,
    resolveBuiltinTarget,
    coordinateForReference
  };
};
