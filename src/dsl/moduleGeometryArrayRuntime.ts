import type { ElementId, PointAnchor } from "../types/geometry";
import { derivedAnchor, isDerivedPointKeyForGeometryCategory } from "../model/pointAnchors";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { makeNumericExpression } from "../geometry/numericExpressions";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import {
  parseGeometryArrayDeferredModuleExportId,
  type GeometryArraySemanticAnalysis,
  type GeometryArraySourceTarget,
  type GeometryArrayValueSemantic
} from "./geometryArraySemanticAnalysis";
import { geometryArrayTypeOfModuleParameter } from "./geometryArraySourceAnnotations";
import {
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "./geometryArrayTypes";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import type { ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryReferenceSemantic, ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { ModuleRuntimeContext } from "./moduleRuntimeContext";
import {
  pathKey,
  sourceAliasForTarget,
  type ExportEntry,
  type GeometryAlias,
  type InstanceContext
} from "./moduleGeometryRuntimeLowering";
import {
  buildSourceLexicalNamespaceIndex,
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";

export type ModuleGeometryArrayRuntimeCompilation = {
  diagnostics: readonly DslDiagnostic[];
  resolveLineReferenceList: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[]
  ) => readonly ElementId[] | null;
  resolvePointReferenceList: (
    token: string,
    statementIndex: number,
    currentPath: readonly string[]
  ) => readonly PointAnchor[] | null;
  acceptsDeferredLineListExport: (
    reference: ModuleGeometryReferenceSemantic,
    currentPath: readonly string[]
  ) => boolean;
};

type RuntimeArrayMember = {
  interfaceType: ModuleGeometryInterfaceType;
  alias: GeometryAlias | null;
  anchor?: PointAnchor;
};

type RuntimeArrayValue = {
  type: GeometryArrayType;
  members: readonly RuntimeArrayMember[];
};

type RuntimeResult = {
  value: RuntimeArrayValue | null;
  actualType: GeometryArrayType | null;
};

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const parsedSourceReference = (text: string) => {
  const parsed = parseDslSourceReference(text.trim());
  return parsed.kind === "valid" ? parsed.reference : null;
};

const referencePath = (text: string) => {
  const reference = parsedSourceReference(text);
  if (!reference || reference.property) return null;
  return parseDslReferenceToken(reference.pathText);
};

const coordinateMember = (text: string) => {
  const span = { start: 0, end: text.length };
  return coordinateComponent(text, span, "x") && coordinateComponent(text, span, "y") ? text.trim() : null;
};

const coordinateAnchor = (text: string): PointAnchor | null => {
  const span = { start: 0, end: text.length };
  const x = coordinateComponent(text, span, "x");
  const y = coordinateComponent(text, span, "y");
  if (!x || !y) return null;
  return {
    mode: "coordinate",
    x: makeNumericExpression(text.slice(x.start, x.end)),
    y: makeNumericExpression(text.slice(y.start, y.end))
  };
};

const isLineEndpointPointKey = (value: string) => value === "start" || value === "end";

const aliasWithPointKey = (alias: GeometryAlias | undefined, pointKey: string | null): GeometryAlias | null => {
  if (!alias) return null;
  if (!pointKey) return alias;
  return alias.kind === "line" ? { kind: "point", anchor: derivedAnchor(alias.elementId, pointKey) } : null;
};

const physicalSpanFor = (statement: DslStatement, span: DslSpan) => {
  const segments: { from: number; to: number }[] = [];
  let logicalStart = 0;
  for (const segment of statement.physicalSpan.segments) {
    const length = segment.to - segment.from;
    const logicalEnd = logicalStart + length;
    const from = Math.max(span.start, logicalStart);
    const to = Math.min(span.end, logicalEnd);
    if (from < to) segments.push({ from: segment.from + from - logicalStart, to: segment.from + to - logicalStart });
    logicalStart = logicalEnd + 1;
  }
  return segments.length ? { segments, sourceRevision: statement.sourceRevision } : null;
};

const runtimeDiagnostic = (statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = physicalSpanFor(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: { key: `diagnostic.${code}` },
    logicalSpan: span,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

const parameterValueId = (definitionStatementId: string, parameterIndex: number) =>
  `${definitionStatementId}:parameter:${parameterIndex}`;

const parameterSlotFromValueId = (
  analysis: GeometryArraySemanticAnalysis,
  valueId: string
) => analysis.moduleParameters.find((parameter) => parameterValueId(parameter.definitionStatementId, parameter.parameterIndex) === valueId) ?? null;

export const buildModuleGeometryArrayRuntime = ({
  statements,
  stableStatementIdByIndex,
  moduleSemanticAnalysis,
  moduleMaterialization,
  contextsByPath,
  exportsByPath,
  moduleRuntimeContext
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  contextsByPath: ReadonlyMap<string, InstanceContext>;
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>;
  moduleRuntimeContext?: ModuleRuntimeContext;
}): ModuleGeometryArrayRuntimeCompilation => {
  type RuntimeSource = {
    documentId: string;
    statements: readonly DslStatement[];
    stableStatementIdByIndex: ReadonlyMap<number, string>;
    sourceNamespace: SourceLexicalNamespaceIndex;
    moduleSemanticAnalysis: ModuleSemanticAnalysis;
    analysis: GeometryArraySemanticAnalysis | null;
  };
  const rootSource: RuntimeSource = {
    documentId: moduleRuntimeContext?.rootDocumentId ?? "root",
    statements,
    stableStatementIdByIndex,
    sourceNamespace: moduleRuntimeContext?.documentFor(moduleRuntimeContext.rootDocumentId)?.sourceLexicalNamespace
      ?? buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex),
    moduleSemanticAnalysis,
    analysis: null
  };
  rootSource.analysis = rootSource.sourceNamespace.geometryArraySemanticAnalysis;
  const sourceForDocument = (documentId: string | undefined): RuntimeSource => {
    if (!moduleRuntimeContext || !documentId || documentId === moduleRuntimeContext.rootDocumentId) return rootSource;
    const document = moduleRuntimeContext.documentFor(documentId as import("../document/multiDocumentPrimitives").DocumentId);
    if (!document) return rootSource;
    return {
      documentId: document.documentId,
      statements: document.statements,
      stableStatementIdByIndex: document.statementIdByStatementIndex,
      sourceNamespace: document.sourceLexicalNamespace,
      moduleSemanticAnalysis: document.moduleSemanticAnalysis,
      analysis: document.sourceLexicalNamespace.geometryArraySemanticAnalysis
    };
  };
  const sourceForPath = (path: readonly string[]): RuntimeSource => {
    for (let length = path.length; length > 0; length -= 1) {
      const context = contextsByPath.get(pathKey(path.slice(0, length)));
      if (context?.definitionDocumentId) return sourceForDocument(context.definitionDocumentId);
    }
    return rootSource;
  };
  const diagnostics: DslDiagnostic[] = [];
  const diagnosticKeys = new Set<string>();

  const addDiagnostic = (diagnostic: DslDiagnostic) => {
    const physicalStart = diagnostic.physicalSpan?.segments[0]?.from ?? -1;
    const key = `${diagnostic.code ?? diagnostic.message}:${physicalStart}:${diagnostic.column}`;
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push(diagnostic);
  };

  const hasForeignArrayAnalysis = Boolean(moduleRuntimeContext && [...moduleRuntimeContext.documentsById.values()]
    .some((document) => document.documentId !== moduleRuntimeContext.rootDocumentId && document.sourceLexicalNamespace.geometryArraySemanticAnalysis));
  if (!rootSource.analysis && !hasForeignArrayAnalysis) {
    return {
      diagnostics,
      resolveLineReferenceList: () => null,
      resolvePointReferenceList: () => null,
      acceptsDeferredLineListExport: () => false
    };
  }
  const arrayExportsByDocument = new Map<string, Map<string, Map<string, GeometryArrayValueSemantic>>>();
  const arrayExportsForSource = (source: RuntimeSource) => {
    const existing = arrayExportsByDocument.get(source.documentId);
    if (existing) return existing;
    const exportsByDefinition = new Map<string, Map<string, GeometryArrayValueSemantic>>();
    const definitionIdByIndex = new Map(source.moduleSemanticAnalysis.definitions.map((definition) => [definition.statementIndex, definition.statementId] as const));
    for (const value of source.analysis?.values ?? []) {
      if (!value.exported || value.ownerModuleDefinitionStatementIndex === null) continue;
      const definitionId = definitionIdByIndex.get(value.ownerModuleDefinitionStatementIndex);
      if (!definitionId) continue;
      const exports = exportsByDefinition.get(definitionId) ?? new Map<string, GeometryArrayValueSemantic>();
      exports.set(value.name, value);
      exportsByDefinition.set(definitionId, exports);
    }
    arrayExportsByDocument.set(source.documentId, exportsByDefinition);
    return exportsByDefinition;
  };

  const contextForDefinition = (currentPath: readonly string[], definitionStatementId: string): InstanceContext | null => {
    for (let length = currentPath.length; length > 0; length -= 1) {
      const context = contextsByPath.get(pathKey(currentPath.slice(0, length)));
      if (context?.definitionStatementId === definitionStatementId) return context;
    }
    return null;
  };

  const childContextFor = (currentPath: readonly string[], instanceStatementId: string) => [...contextsByPath.values()].find((context) =>
    context.path.length === currentPath.length + 1 &&
    currentPath.every((part, index) => context.path[index] === part) &&
    context.instanceStatementId === instanceStatementId
  );

  const arrayExportSemantic = (currentPath: readonly string[], instanceStatementId: string, exportName: string) => {
    const childContext = childContextFor(currentPath, instanceStatementId);
    if (!childContext) return null;
    const childPath = childContext.path;
    const childSource = sourceForDocument(childContext.definitionDocumentId);
    const exported = arrayExportsForSource(childSource).get(childContext.definitionStatementId)?.get(exportName) ?? null;
    return exported ? { childPath, childContext, exported } : null;
  };

  const singularTargetFor = (target: GeometryArraySourceTarget, currentPath: readonly string[]) => {
    if (target.kind === "moduleParameter") {
      return {
        kind: "parameter" as const,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: target.parameterIndex,
        geometryKind: target.interfaceType === "point" ? "point" as const : "line" as const
      };
    }
    if (target.kind !== "geometry") return null;
    const statement = sourceForPath(currentPath).statements[target.statementIndex];
    if (statement?.kind !== "element" || !isGeometryDeclarationCategory(statement.category)) return null;
    return {
      kind: "sourceGeometry" as const,
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      category: statement.category,
      geometryKind: target.interfaceType === "point" ? "point" as const : "line" as const
    };
  };

  const sourceValueCache = new Map<string, RuntimeArrayValue | null>();
  const parameterValueCache = new Map<string, RuntimeArrayValue | null>();
  const cacheKey = (path: readonly string[], id: string) => `${pathKey(path)}:${id}`;

  const lowerArrayExport = (
    currentPath: readonly string[],
    instanceStatementId: string,
    exportName: string,
    visited: ReadonlySet<string>
  ): RuntimeResult => {
    const entry = arrayExportSemantic(currentPath, instanceStatementId, exportName);
    if (!entry) return { value: null, actualType: null };
    return {
      value: lowerSemantic(entry.exported, entry.childPath, visited),
      actualType: entry.exported.type
    };
  };

  const lowerParameter = (
    currentPath: readonly string[],
    definitionStatementId: string,
    parameterIndex: number,
    visited: ReadonlySet<string>
  ): RuntimeArrayValue | null => {
    const context = contextForDefinition(currentPath, definitionStatementId);
    if (!context) return null;
    const key = cacheKey(context.path, parameterValueId(definitionStatementId, parameterIndex));
    if (parameterValueCache.has(key)) return parameterValueCache.get(key) ?? null;
    const instanceSource = sourceForDocument(context.instanceDocumentId);
    const definitionSource = sourceForPath(context.path);
    const instance = instanceSource.moduleSemanticAnalysis.instancesByStatementId.get(context.instanceStatementId);
    const binding = instance?.parameterBindings.find((candidate) => candidate.parameterIndex === parameterIndex);
    const parameter = definitionSource.analysis?.moduleParametersBySlot.get(`${definitionStatementId}:${parameterIndex}`);
    if (!instance || !binding || !parameter || binding.argumentIndex === null || binding.state === "optionalOmitted" || binding.state === "requiredOmitted") {
      parameterValueCache.set(key, null);
      return null;
    }
    const statement = instanceSource.statements[instance.statementIndex];
    if (statement?.kind !== "moduleInstance") {
      parameterValueCache.set(key, null);
      return null;
    }
    const argument = statement.arguments[binding.argumentIndex];
    if (!argument) {
      parameterValueCache.set(key, null);
      return null;
    }
    const parsed = parseGeometryArrayExpression(argument.value);
    for (const issue of parsed.diagnostics) {
      addDiagnostic(runtimeDiagnostic(
        statement,
        { start: argument.valueSpan.start + issue.span.start, end: argument.valueSpan.start + issue.span.end },
        issue.code,
        issue.message
      ));
    }
    if (!parsed.expression || parsed.diagnostics.length) {
      parameterValueCache.set(key, null);
      return null;
    }

    const callerPath = context.path.slice(0, -1);
    let value: RuntimeArrayValue | null = null;
    if (parsed.expression.kind === "reference") {
      const resolved = resolveWholeReference(argument.value, instance.statementIndex, callerPath, visited);
      if (resolved.actualType && !isGeometryArrayTypeAssignable(resolved.actualType, parameter.type)) {
        addDiagnostic(runtimeDiagnostic(
          statement,
          argument.valueSpan,
          "geometry-array-assignability-mismatch",
          `geometry array argument「${parameter.name}」の型が一致しません。`
        ));
      } else if (resolved.value) {
        value = { type: parameter.type, members: resolved.value.members };
      }
    } else {
      const members: RuntimeArrayMember[] = [];
      for (const member of parsed.expression.members) {
        const span = { start: argument.valueSpan.start + member.span.start, end: argument.valueSpan.start + member.span.end };
        const coordinate = coordinateMember(member.text);
        if (coordinate) {
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: "point" };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `geometry array argument「${parameter.name}」に point を渡せません。`));
          } else members.push({ interfaceType: "point", alias: null, anchor: coordinateAnchor(coordinate) ?? undefined });
          continue;
        }
        const sourceReference = parsedSourceReference(member.text);
        if (!sourceReference) {
          addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-invalid-member", "geometry array member は geometry reference または coordinate point で指定してください。"));
          continue;
        }
        const path = parseDslReferenceToken(sourceReference.pathText);
        if (path.segments.length === 0) {
          addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-invalid-member", "geometry array member の参照が不正です。"));
          continue;
        }
        const pointKey = sourceReference.property;
        if (pointKey && parameter.type.elementType !== "point") {
          addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", "derived point reference は point[] の member としてのみ使用できます。"));
          continue;
        }

        const ownerIndex = moduleOwnerIndexOf(instanceSource.statements, instance.statementIndex);
        if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
          const owner = instanceSource.statements[ownerIndex];
          if (owner?.kind === "moduleDefinition") {
            const parameterIndexInOwner = owner.parameters.findIndex((candidate) => candidate.name === path.segments[0]);
            if (parameterIndexInOwner >= 0) {
              const ownerParameter = owner.parameters[parameterIndexInOwner]!;
              const nestedArray = geometryArrayTypeOfModuleParameter(ownerParameter);
              if (nestedArray) {
                addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-nested-array", "geometry array を literal member として入れ子にすることはできません。"));
                continue;
              }
              const interfaceType = moduleGeometryInterfaceTypeOf(ownerParameter.type);
              const ownerDefinitionId = instanceSource.stableStatementIdByIndex.get(ownerIndex);
              if (interfaceType && ownerDefinitionId) {
                if (pointKey && ((interfaceType !== "line" && interfaceType !== "path") || !isLineEndpointPointKey(pointKey))) {
                  addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `geometry parameter「${path.segments[0]}」の derived point「${pointKey}」を point[] member として解決できません。`));
                  continue;
                }
                const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
                const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
                if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
                  addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `geometry array argument「${parameter.name}」の member 型が一致しません。`));
                  continue;
                }
                const baseAlias = sourceAliasForTarget({
                  kind: "parameter",
                  definitionStatementId: ownerDefinitionId,
                  parameterIndex: parameterIndexInOwner,
                  geometryKind: interfaceType === "point" ? "point" : "line"
                }, callerPath, contextsByPath, moduleMaterialization, exportsByPath);
                const alias = aliasWithPointKey(baseAlias, pointKey);
                members.push({
                  interfaceType: memberInterfaceType,
                  alias,
                  ...(alias?.kind === "point" ? { anchor: alias.anchor } : {})
                });
                continue;
              }
            }
          }
        }

        const lookup = resolveSourceLexicalPath(instanceSource.sourceNamespace, instance.statementIndex, path);
        if (lookup.kind === "resolved") {
          const interfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
          if (!interfaceType) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-not-geometry", `参照先「${member.text}」は geometry value ではありません。`));
            continue;
          }
          const sourceStatement = lookup.declaration.statement;
          if (sourceStatement.kind !== "element" || !isGeometryDeclarationCategory(sourceStatement.category)) continue;
          if (pointKey && !isDerivedPointKeyForGeometryCategory(sourceStatement.category, pointKey)) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `derived point「${pointKey}」を参照先「${sourceReference.pathText}」から解決できません。`));
            continue;
          }
          const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `geometry array argument「${parameter.name}」の member 型が一致しません。`));
            continue;
          }
          const baseAlias = sourceAliasForTarget({
            kind: "sourceGeometry",
            statementId: lookup.declaration.statementId,
            statementIndex: lookup.declaration.statementIndex,
            category: sourceStatement.category,
            geometryKind: interfaceType === "point" ? "point" : "line"
          }, callerPath, contextsByPath, moduleMaterialization, exportsByPath);
          const alias = aliasWithPointKey(baseAlias, pointKey);
          members.push({
            interfaceType: memberInterfaceType,
            alias,
            ...(alias?.kind === "point" ? { anchor: alias.anchor } : {})
          });
          continue;
        }
        if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
          const child = childContextFor(callerPath, lookup.declaration.statementId);
          const exportEntry = child ? exportsByPath.get(pathKey(child.path))?.get(path.segments[1]!) : undefined;
          if (!exportEntry) {
            addDiagnostic(runtimeDiagnostic(statement, span, "module-undefined-export", `module export「${path.segments[1]}」が見つかりません。`));
            continue;
          }
          const exportedStatement = sourceForPath(callerPath).statements[exportEntry.exported.exportedStatementIndex];
          const interfaceType = moduleGeometryInterfaceTypeOfElement(exportedStatement);
          if (!interfaceType) continue;
          if (pointKey && (exportedStatement?.kind !== "element" || !isGeometryDeclarationCategory(exportedStatement.category) || !isDerivedPointKeyForGeometryCategory(exportedStatement.category, pointKey))) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `module export「${path.segments[1]}」の derived point「${pointKey}」を解決できません。`));
            continue;
          }
          const memberInterfaceType: ModuleGeometryInterfaceType = pointKey ? "point" : interfaceType;
          const actual: GeometryArrayType = { kind: "geometryArray", elementType: memberInterfaceType };
          if (!isGeometryArrayTypeAssignable(actual, parameter.type)) {
            addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-type-mismatch", `geometry array argument「${parameter.name}」の member 型が一致しません。`));
            continue;
          }
          const alias = aliasWithPointKey(exportEntry.alias, pointKey);
          members.push({
            interfaceType: memberInterfaceType,
            alias,
            ...(alias?.kind === "point" ? { anchor: alias.anchor } : {})
          });
          continue;
        }
        addDiagnostic(runtimeDiagnostic(statement, span, "geometry-array-member-unresolved", `未解決の geometry array member です: ${member.text}`));
      }
      if (members.length === parsed.expression.members.length) value = { type: parameter.type, members };
    }

    parameterValueCache.set(key, value);
    return value;
  };

  function lowerSemantic(
    semantic: GeometryArrayValueSemantic,
    currentPath: readonly string[],
    visited: ReadonlySet<string>
  ): RuntimeArrayValue | null {
    const key = cacheKey(currentPath, semantic.statementId);
    if (sourceValueCache.has(key)) return sourceValueCache.get(key) ?? null;
    if (!semantic.value || visited.has(key)) return null;
    const nextVisited = new Set([...visited, key]);

    if (semantic.value.kind === "literal") {
      const members: RuntimeArrayMember[] = semantic.value.members.map((member) => {
        if (member.target.kind === "coordinate") {
          return {
            interfaceType: member.interfaceType,
            alias: null,
            ...(coordinateAnchor(member.target.source) ? { anchor: coordinateAnchor(member.target.source)! } : {})
          };
        }
        const target = singularTargetFor(member.target, currentPath);
        const alias = target
          ? aliasWithPointKey(
            sourceAliasForTarget(target, currentPath, contextsByPath, moduleMaterialization, exportsByPath),
            member.target.pointKey ?? null
          )
          : undefined;
        return {
          interfaceType: member.interfaceType,
          alias: alias ?? null,
          ...(alias?.kind === "point" ? { anchor: alias.anchor } : {})
        };
      });
      const value = { type: semantic.type, members };
      sourceValueCache.set(key, value);
      return value;
    }

    const currentSource = sourceForPath(currentPath);
    const currentAnalysis = currentSource.analysis;
    if (!currentAnalysis) {
      sourceValueCache.set(key, null);
      return null;
    }
    const targetSemantic = currentAnalysis.valuesByStatementId.get(semantic.value.targetValueId);
    if (targetSemantic) {
      if (
        semantic.ownerModuleDefinitionStatementIndex !== null &&
        targetSemantic.ownerModuleDefinitionStatementIndex !== semantic.ownerModuleDefinitionStatementIndex
      ) {
        const statement = currentSource.statements[semantic.statementIndex];
        if (statement) addDiagnostic(runtimeDiagnostic(statement, semantic.value.sourceSpan, "module-array-outer-capture", "module body から outer geometry array を暗黙 capture できません。"));
        sourceValueCache.set(key, null);
        return null;
      }
      const targetValue = lowerSemantic(targetSemantic, currentPath, nextVisited);
      const value = targetValue ? { type: semantic.type, members: targetValue.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    const parameter = parameterSlotFromValueId(currentAnalysis, semantic.value.targetValueId);
    if (parameter) {
      const parameterValue = lowerParameter(currentPath, parameter.definitionStatementId, parameter.parameterIndex, nextVisited);
      const value = parameterValue ? { type: semantic.type, members: parameterValue.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    const deferred = parseGeometryArrayDeferredModuleExportId(semantic.value.targetValueId);
    if (deferred) {
      const resolved = lowerArrayExport(currentPath, deferred.instanceStatementId, deferred.exportName, nextVisited);
      const statement = currentSource.statements[semantic.statementIndex];
      if (!resolved.actualType) {
        if (statement) addDiagnostic(runtimeDiagnostic(statement, semantic.value.sourceSpan, "module-undefined-export", `module geometry array export「${deferred.exportName}」が見つかりません。`));
        sourceValueCache.set(key, null);
        return null;
      }
      if (!isGeometryArrayTypeAssignable(resolved.actualType, semantic.type)) {
        if (statement) addDiagnostic(runtimeDiagnostic(statement, semantic.value.sourceSpan, "geometry-array-assignability-mismatch", `module geometry array export「${deferred.exportName}」の型が一致しません。`));
        sourceValueCache.set(key, null);
        return null;
      }
      const value = resolved.value ? { type: semantic.type, members: resolved.value.members } : null;
      sourceValueCache.set(key, value);
      return value;
    }

    sourceValueCache.set(key, null);
    return null;
  }

  function resolveWholeReference(
    source: string,
    statementIndex: number,
    currentPath: readonly string[],
    visited: ReadonlySet<string>
  ): RuntimeResult {
    const path = referencePath(source);
    if (!path || path.segments.length === 0) return { value: null, actualType: null };
    const runtimeSource = sourceForPath(currentPath);
    const ownerIndex = moduleOwnerIndexOf(runtimeSource.statements, statementIndex);
    if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
      const owner = runtimeSource.statements[ownerIndex];
      const definitionId = runtimeSource.stableStatementIdByIndex.get(ownerIndex);
      if (owner?.kind === "moduleDefinition" && definitionId) {
        const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === path.segments[0]);
        if (parameterIndex >= 0) {
          const parameterType = geometryArrayTypeOfModuleParameter(owner.parameters[parameterIndex]!);
          if (parameterType) {
            return {
              value: lowerParameter(currentPath, definitionId, parameterIndex, visited),
              actualType: parameterType
            };
          }
        }
      }
    }

    const lookup = resolveSourceLexicalPath(runtimeSource.sourceNamespace, statementIndex, path);
    if (lookup.kind === "resolved") {
      const semantic = runtimeSource.analysis?.valuesByStatementIndex.get(lookup.declaration.statementIndex);
      return semantic
        ? { value: lowerSemantic(semantic, currentPath, visited), actualType: semantic.type }
        : { value: null, actualType: null };
    }
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
      return lowerArrayExport(currentPath, lookup.declaration.statementId, path.segments[1]!, visited);
    }
    return { value: null, actualType: null };
  }

  // Validate supplied array parameter arguments once per concrete instance and
  // deferred export aliases once per reachable instance path. This keeps
  // source diagnostics independent from whether a particular list consumer
  // happens to execute.
  for (const context of contextsByPath.values()) {
    const contextSource = sourceForPath(context.path);
    const contextAnalysis = contextSource.analysis;
    if (!contextAnalysis) continue;
    const parameters = contextAnalysis.moduleParameters.filter((parameter) => parameter.definitionStatementId === context.definitionStatementId);
    for (const parameter of parameters) lowerParameter(context.path, parameter.definitionStatementId, parameter.parameterIndex, new Set());
    for (const semantic of contextAnalysis.values) {
      if (semantic.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) lowerSemantic(semantic, context.path, new Set());
    }
  }
  for (const semantic of rootSource.analysis?.values ?? []) {
    if (semantic.ownerModuleDefinitionStatementIndex === null) lowerSemantic(semantic, [], new Set());
  }

  const resolveLineReferenceList = (token: string, statementIndex: number, currentPath: readonly string[]) => {
    const resolved = resolveWholeReference(token, statementIndex, currentPath, new Set());
    if (!resolved.value || resolved.value.type.elementType === "point") return null;
    const ids: ElementId[] = [];
    for (const member of resolved.value.members) {
      if (!isModuleGeometryInterfaceAssignable(member.interfaceType, "path") || member.alias?.kind !== "line") return null;
      ids.push(member.alias.elementId);
    }
    return ids;
  };

  const pointAnchorsFor = (value: RuntimeArrayValue): readonly PointAnchor[] | null => {
    if (value.type.elementType !== "point") return null;
    const anchors: PointAnchor[] = [];
    for (const member of value.members) {
      if (member.interfaceType !== "point" || !member.anchor) return null;
      anchors.push(member.anchor);
    }
    return anchors;
  };

  const resolvePointReferenceList = (token: string, statementIndex: number, currentPath: readonly string[]) => {
    const resolved = resolveWholeReference(token, statementIndex, currentPath, new Set());
    if (resolved.value) return pointAnchorsFor(resolved.value);

    const parsed = parseGeometryArrayExpression(token);
    if (!parsed.expression || parsed.diagnostics.length || parsed.expression.kind !== "literal") return null;
    const anchors: PointAnchor[] = [];
    for (const member of parsed.expression.members) {
      const coordinate = coordinateAnchor(member.text);
      if (coordinate) {
        anchors.push(coordinate);
        continue;
      }
      const path = referencePath(member.text);
      if (!path || path.segments.length === 0) return null;
      const sourceReference = parsedSourceReference(member.text);
      const pointKey = sourceReference?.property ?? null;
      const runtimeSource = sourceForPath(currentPath);
      const ownerIndex = moduleOwnerIndexOf(runtimeSource.statements, statementIndex);
      let alias: GeometryAlias | null = null;
      if (path.segments.length === 1 && !path.absolute && ownerIndex !== null) {
        const owner = runtimeSource.statements[ownerIndex];
        const definitionId = runtimeSource.stableStatementIdByIndex.get(ownerIndex);
        if (owner?.kind === "moduleDefinition" && definitionId) {
          const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === path.segments[0]);
          if (parameterIndex >= 0 && !geometryArrayTypeOfModuleParameter(owner.parameters[parameterIndex]!)) {
            const interfaceType = moduleGeometryInterfaceTypeOf(owner.parameters[parameterIndex]!.type);
            if (interfaceType) {
              const baseAlias = sourceAliasForTarget({
                kind: "parameter",
                definitionStatementId: definitionId,
                parameterIndex,
                geometryKind: interfaceType === "point" ? "point" : "line"
              }, currentPath, contextsByPath, moduleMaterialization, exportsByPath);
              alias = aliasWithPointKey(baseAlias, pointKey);
            }
          }
        }
      }
      if (!alias) {
        const lookup = resolveSourceLexicalPath(runtimeSource.sourceNamespace, statementIndex, path);
        if (lookup.kind === "resolved") {
          const sourceStatement = lookup.declaration.statement;
          const interfaceType = moduleGeometryInterfaceTypeOfElement(sourceStatement);
          if (sourceStatement.kind === "element" && isGeometryDeclarationCategory(sourceStatement.category) && interfaceType) {
            if (!pointKey || isDerivedPointKeyForGeometryCategory(sourceStatement.category, pointKey)) {
              const baseAlias = sourceAliasForTarget({
                kind: "sourceGeometry",
                statementId: lookup.declaration.statementId,
                statementIndex: lookup.declaration.statementIndex,
                category: sourceStatement.category,
                geometryKind: interfaceType === "point" ? "point" : "line"
              }, currentPath, contextsByPath, moduleMaterialization, exportsByPath);
              alias = aliasWithPointKey(baseAlias, pointKey);
            }
          }
        } else if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
          const child = childContextFor(currentPath, lookup.declaration.statementId);
          const exportEntry = child ? exportsByPath.get(pathKey(child.path))?.get(path.segments[1]!) : undefined;
          if (exportEntry) alias = aliasWithPointKey(exportEntry.alias, pointKey);
        }
      }
      if (alias?.kind !== "point") return null;
      anchors.push(alias.anchor);
    }
    return anchors;
  };

  const acceptsDeferredLineListExport = (reference: ModuleGeometryReferenceSemantic, currentPath: readonly string[]) => {
    if (reference.role !== "lineReferenceList" || reference.target?.kind !== "deferredModuleExport") return false;
    const exported = arrayExportSemantic(currentPath, reference.target.instanceStatementId, reference.target.exportName)?.exported;
    return Boolean(exported && exported.type.elementType !== "point");
  };

  return { diagnostics, resolveLineReferenceList, resolvePointReferenceList, acceptsDeferredLineListExport };
};
