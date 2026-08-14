import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ElementId } from "../types/geometry";
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
  type InstanceContext,
  type ModuleGeometryPropertyRuntimeTarget
} from "./moduleGeometryRuntimeLowering";

export type { ModuleGeometryPropertyRuntimeTarget };

export type ModuleGeometryBuiltinRuntimeTarget = {
  elementId: ElementId;
  geometryType: Extract<ModuleGeometryInterfaceType, "point" | "line">;
};

export type ModuleGeometryRuntimeCompilation = {
  diagnostics: readonly DslDiagnostic[];
  resolversByRuntimeElementId: ReadonlyMap<ElementId, DslGeometryResolverOverrides>;
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
  moduleMaterialization
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
}): ModuleGeometryRuntimeCompilation => {
  const diagnostics: DslDiagnostic[] = [];
  const contextsByPath = new Map<string, InstanceContext>();
  const exportsByPath = new Map<string, ReadonlyMap<string, ExportEntry>>();
  const resolversByRuntimeElementId = new Map<ElementId, DslGeometryResolverOverrides>();

  const exportAliasFor = (path: readonly string[], exported: Extract<ResolvedModuleExport, { kind: "geometry" }>): GeometryAlias | undefined => {
    const entry = runtimeEntryForBody(moduleMaterialization, path, exported.exportedStatementId);
    const kind = geometryKindOfCategory(exported.category);
    if (!entry || !kind) return undefined;
    return kind === "point"
      ? { kind: "point", anchor: referenceAnchor(entry.runtimeElementId) }
      : { kind: "line", elementId: entry.runtimeElementId };
  };

  const register = (instanceStatementId: string, parentPath: readonly string[]): InstanceContext | undefined => {
    const path = [...parentPath, instanceStatementId];
    const key = pathKey(path);
    const existing = contextsByPath.get(key);
    if (existing) return existing;
    const instance = moduleSemanticAnalysis.instancesByStatementId.get(instanceStatementId);
    if (!instance?.callee) return undefined;
    const definition = moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) return undefined;
    const context: InstanceContext = {
      path,
      instanceStatementId,
      definitionStatementId: definition.statementId,
      definition,
      aliases: new Map()
    };
    contextsByPath.set(key, context);
    const exportEntries = new Map<string, ExportEntry>();
    for (const exported of definition.exports) {
      if (exported.kind !== "geometry") continue;
      const alias = exportAliasFor(path, exported);
      if (alias) exportEntries.set(exported.name, { exported, alias });
    }
    exportsByPath.set(key, exportEntries);
    for (const parameter of definition.parameters) {
      if (!moduleRuntimeGeometryKindOf(parameter.type)) continue;
      const binding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (binding?.value?.kind !== "geometry") continue;
      const instanceStatement = statements[instance.statementIndex];
      const alias = lowerReference(binding.value.reference, parentPath, instanceStatement, contextsByPath, moduleMaterialization, exportsByPath);
      if (alias) (context.aliases as Map<number, GeometryAlias>).set(parameter.parameterIndex, alias);
    }
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "moduleInstance") continue;
      register(body.statementId, path);
    }
    return context;
  };

  for (const instance of moduleSemanticAnalysis.instances) {
    if (instance.callerModuleDefinitionStatementId === null) register(instance.statementId, []);
  }

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
    const definition = definitionForInstance(target.instanceStatementId);
    const entry = exportsByPath.get(pathKey([...currentPath, target.instanceStatementId]))?.get(target.exportName);
    const diagnostic = diagnosticForExport(statement, target, definition, statements, entry);
    if (diagnostic) diagnostics.push(diagnostic);
  };

  const validateDeferredNamespace = (
    statement: DslStatement,
    target: { instanceStatementId: string; exportName: string; memberSpan: { start: number; end: number } },
    currentPath: readonly string[]
  ) => {
    const definition = definitionForInstance(target.instanceStatementId);
    const entry = exportsByPath.get(pathKey([...currentPath, target.instanceStatementId]))?.get(target.exportName);
    const diagnostic = diagnosticForExportNamespace(statement, target, definition, statements, entry);
    if (diagnostic) diagnostics.push(diagnostic);
  };

  const validateReference = (statement: DslStatement, reference: ModuleGeometryReferenceSemantic, currentPath: readonly string[]) => {
    if (reference.target?.kind === "deferredModuleExport") validateDeferred(statement, reference.target, currentPath);
  };

  // Ownership belongs to the module definition, not to a particular
  // materialized instance. Apply this once even when a definition is not yet
  // instantiated; repeated calls must not duplicate the same source error.
  for (const definition of moduleSemanticAnalysis.definitions) {
    for (const body of definition.bodyStatements) {
      const statement = statements[body.statementIndex];
      if (statement) diagnostics.push(...moduleMutationOwnershipDiagnostics(statement, body));
    }
  }

  for (const context of contextsByPath.values()) {
    const instance = moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId);
    if (!instance) continue;
    for (const binding of instance.parameterBindings) {
      if (binding.value?.kind === "geometry") validateReference(statements[instance.statementIndex], binding.value.reference, context.path.slice(0, -1));
    }
    for (const body of context.definition.bodyStatements) {
      const statement = statements[body.statementIndex];
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
      ? moduleSemanticAnalysis.definitionsByStatementId.get(entry.origin.moduleDefinitionStatementId)
      : undefined;
    const body = definition?.bodyStatements.find((candidate) => candidate.statementId === entry.sourceStatementId);
    return body?.geometryReferences ?? moduleSemanticAnalysis.rootGeometryReferencesByStatementId.get(entry.sourceStatementId) ?? [];
  };
  for (const entry of moduleMaterialization.executionStatements) {
    if (entry.type === "moduleInstance") continue;
    const sites = entrySites(entry);
    resolversByRuntimeElementId.set(entry.runtimeElementId, resolverForBody({
      statement: entry.statement,
      sites,
      currentPath: entry.instancePath,
      contextsByPath,
      materialization: moduleMaterialization,
      exportsByPath
    }));
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
    const baseTarget: ModuleGeometrySourceTarget = target.kind === "parameterProperty"
      ? { ...target, kind: "parameter" }
      : target.kind === "sourceGeometryProperty"
        ? { ...target, kind: "sourceGeometry", geometryKind: target.category === "point" ? "point" : "line" }
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
      return { elementId: alias.elementId, geometryType: "line" };
    }
    if (expectedGeometryType === "point" && alias.kind === "point" && alias.anchor.mode === "reference") {
      return { elementId: alias.anchor.pointId, geometryType: "point" };
    }
    // Coordinate and derived point aliases intentionally fail closed here:
    // geometry builtins require a concrete runtime geometry element identity.
    return undefined;
  };

  return { diagnostics, resolversByRuntimeElementId, resolvePropertyTarget, resolveBuiltinTarget, coordinateForReference };
};
