import { makeNumericExpression } from "../geometry/numericExpressions";
import { derivedAnchor, isDerivedPointKeyForGeometryCategory, referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { resolveAnchor as resolveAnchorFromDsl, resolveEndpoint as resolveEndpointFromDsl, resolveId as resolveIdFromDsl } from "./dslReferences";
import type { DslDiagnostic, DslStatement } from "./dslTypes";
import type { DslGeometryResolverOverrides } from "./dslApplyArgs";
import type { MaterializedExecutionStatement, ModuleMaterialization } from "./moduleMaterialization";
import type {
  ModuleGeometryReferenceSemantic,
  ModuleGeometryReferenceSite,
  ModuleGeometrySourceTarget,
  ModulePointCoordinateSemantic,
  ModuleDefinitionSemantic,
  ResolvedModuleExport,
  ModuleScalarExpressionSemantic
} from "./moduleSemanticTypes";
import { encodeIdentityTuple } from "../document/identityTuple";

export type GeometryAlias =
  | { kind: "line"; elementId: ElementId }
  | { kind: "point"; anchor: PointAnchor; coordinate?: ModulePointCoordinateSemantic };

export type InstanceContext = {
  path: readonly string[];
  instanceStatementId: string;
  definitionStatementId: string;
  definition: ModuleDefinitionSemantic;
  aliases: ReadonlyMap<number, GeometryAlias>;
};

export type ExportEntry = {
  exported: ResolvedModuleExport;
  alias: GeometryAlias;
};

export type ModuleGeometryPropertyRuntimeTarget =
  | { kind: "runtime"; elementId: ElementId; property: string; targetSourceOrder?: number }
  | { kind: "expression"; expression: ModuleScalarExpressionSemantic };

export const pathKey = (path: readonly string[]) => encodeIdentityTuple(["instance", ...path]);

export const geometryKindOfCategory = (category: ResolvedModuleExport["category"]): "point" | "line" | null =>
  category === "point" ? "point" : category === "line" || category === "curve" || category === "arc" ? "line" : null;

const sourceForStatement = (statement: DslStatement): string => {
  const values = statement.kind === "moduleInstance"
    ? statement.arguments.map((argument) => ({ value: argument.value, start: argument.valueSpan.start, end: argument.valueSpan.end }))
    : statement.attrs.map((attr) => ({ value: attr.value, start: attr.valueStart, end: attr.valueEnd }));
  const maxEnd = values.reduce((max, value) => Math.max(max, value.end), 0);
  const chars = new Array(Math.max(maxEnd, 1)).fill(" ");
  for (const value of values) {
    for (let index = value.start; index < value.end; index += 1) chars[index] = value.value[index - value.start] ?? " ";
  }
  return chars.join("");
};

const coordinateAnchor = (
  coordinate: ModulePointCoordinateSemantic,
  statement: DslStatement
): PointAnchor => {
  const source = sourceForStatement(statement);
  return {
    mode: "coordinate",
    x: coordinate.x ? makeNumericExpression(source.slice(coordinate.x.ast.span.start, coordinate.x.ast.span.end)) : 0,
    y: coordinate.y ? makeNumericExpression(source.slice(coordinate.y.ast.span.start, coordinate.y.ast.span.end)) : 0
  };
};

export const runtimeEntryForBody = (
  materialization: ModuleMaterialization,
  path: readonly string[],
  statementId: string
): MaterializedExecutionStatement | undefined => materialization.executionStatements.find((entry) =>
  entry.origin?.kind === "moduleBody" &&
  entry.origin.sourceStatementId === statementId &&
  pathKey(entry.instancePath) === pathKey(path)
);

export const diagnosticForExport = (
  statement: DslStatement,
  target: Extract<ModuleGeometrySourceTarget, { kind: "deferredModuleExport" }>,
  definition: ModuleDefinitionSemantic | undefined,
  statements: readonly DslStatement[],
  exportEntry: ExportEntry | undefined
): DslDiagnostic | null => {
  const namespaceDiagnostic = diagnosticForExportNamespace(statement, target, definition, statements, exportEntry);
  if (namespaceDiagnostic || !definition || !exportEntry) return namespaceDiagnostic;
  const actualKind = geometryKindOfCategory(exportEntry.exported.category);
  const validDerivedPoint = target.pointKey !== undefined &&
    target.expectedGeometryKind === "point" &&
    isDerivedPointKeyForGeometryCategory(exportEntry.exported.category, target.pointKey);
  const typeCompatible = target.pointKey === undefined
    ? actualKind === target.expectedGeometryKind
    : validDerivedPoint;
  if (!typeCompatible) {
    return {
      severity: "error",
      line: statement.line,
      column: target.memberSpan.start + 1,
      code: "module-geometry-type-mismatch",
      message: `module export「${target.exportName}」の型またはderived point accessorが一致しません。`
    };
  }
  return null;
};

export const diagnosticForExportNamespace = (
  statement: DslStatement,
  target: Pick<Extract<ModuleGeometrySourceTarget, { kind: "deferredModuleExport" }>, "exportName" | "memberSpan">,
  definition: ModuleDefinitionSemantic | undefined,
  statements: readonly DslStatement[],
  exportEntry: ExportEntry | undefined
): DslDiagnostic | null => {
  if (!definition) return null;
  if (!exportEntry) {
    const privateMember = definition.bodyStatements.some((body) =>
      body.statementKind === "element" && statements[body.statementIndex]?.name === target.exportName
    );
    return {
      severity: "error",
      line: statement.line,
      column: target.memberSpan.start + 1,
      code: privateMember ? "module-private-member" : "module-undefined-export",
      message: privateMember
        ? `module member「${target.exportName}」はexportされていないため参照できません。`
        : `module export「${target.exportName}」が見つかりません。`
    };
  }
  return null;
};

const lowerAliasWithPointKey = (alias: GeometryAlias, pointKey: string | undefined): GeometryAlias | undefined => {
  if (!pointKey) return alias;
  if (alias.kind !== "line") return undefined;
  return { kind: "point", anchor: derivedAnchor(alias.elementId, pointKey) };
};

export const propertyForAlias = (
  alias: GeometryAlias,
  property: string,
  elementsById: ReadonlyMap<ElementId, CadElement>
): ModuleGeometryPropertyRuntimeTarget | undefined => {
  if (alias.kind === "line") return { kind: "runtime", elementId: alias.elementId, property };
  if (alias.coordinate && (property === "x" || property === "y")) {
    const expression = alias.coordinate[property];
    return expression ? { kind: "expression", expression } : undefined;
  }
  if (alias.anchor.mode === "reference") {
    if (property !== "x" && property !== "y") return undefined;
    return { kind: "runtime", elementId: alias.anchor.pointId, property };
  }
  if (alias.anchor.mode !== "derived") return undefined;
  if (property !== "x" && property !== "y") return undefined;
  const pointKey = alias.anchor.pointKey;
  const sourceElement = elementsById.get(alias.anchor.elementId);
  const intermediateIndex = pointKey.startsWith("intermediate:") && sourceElement?.type === "bezierCurve"
    ? sourceElement.intermediatePoints.findIndex((point) => point.id === pointKey.slice("intermediate:".length)) + 1
    : 0;
  const canonical = pointKey === "start"
    ? "startPoint"
    : pointKey === "end"
      ? "endPoint"
      : pointKey === "center"
        ? "centerPoint"
        : pointKey.startsWith("intermediate:") && intermediateIndex > 0
          ? `intermediatePoints[${intermediateIndex}]`
          : null;
  return canonical && !canonical.includes("NaN")
    ? { kind: "runtime", elementId: alias.anchor.elementId, property: `${canonical}.${property}` }
    : undefined;
};

export const sourceAliasForTarget = (
  target: ModuleGeometrySourceTarget,
  currentPath: readonly string[],
  contextsByPath: ReadonlyMap<string, InstanceContext>,
  materialization: ModuleMaterialization,
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>
): GeometryAlias | undefined => {
  if (target.kind === "parameter") {
    for (let index = currentPath.length; index >= 0; index -= 1) {
      const context = contextsByPath.get(pathKey(currentPath.slice(0, index)));
      if (context?.definitionStatementId === target.definitionStatementId) return context.aliases.get(target.parameterIndex);
    }
    return undefined;
  }
  if (target.kind === "sourceGeometry") {
    let ownerPath: readonly string[] = [];
    for (let index = currentPath.length; index > 0; index -= 1) {
      const candidatePath = currentPath.slice(0, index);
      const context = contextsByPath.get(pathKey(candidatePath));
      if (context?.definition.bodyStatements.some((body) => body.statementId === target.statementId)) {
        ownerPath = candidatePath;
        break;
      }
    }
    const entry = ownerPath.length
      ? runtimeEntryForBody(materialization, ownerPath, target.statementId)
      : materialization.elementIdBySourceStatementIndex.get(target.statementIndex)
        ? { runtimeElementId: materialization.elementIdBySourceStatementIndex.get(target.statementIndex)! } as MaterializedExecutionStatement
        : undefined;
    if (!entry) return undefined;
    return target.geometryKind === "point"
      ? { kind: "point", anchor: referenceAnchor(entry.runtimeElementId) }
      : { kind: "line", elementId: entry.runtimeElementId };
  }
  const childPath = [...currentPath, target.instanceStatementId];
  return exportsByPath.get(pathKey(childPath))?.get(target.exportName)?.alias;
};

export const lowerReference = (
  reference: ModuleGeometryReferenceSemantic,
  currentPath: readonly string[],
  statement: DslStatement,
  contextsByPath: ReadonlyMap<string, InstanceContext>,
  materialization: ModuleMaterialization,
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>
): GeometryAlias | undefined => {
  if (reference.coordinate) return { kind: "point", anchor: coordinateAnchor(reference.coordinate, statement), coordinate: reference.coordinate };
  if (!reference.target) return undefined;
  const base = sourceAliasForTarget(reference.target, currentPath, contextsByPath, materialization, exportsByPath);
  return base ? lowerAliasWithPointKey(base, reference.target.pointKey) : undefined;
};

export const resolverForBody = ({
  statement,
  sites,
  currentPath,
  contextsByPath,
  materialization,
  exportsByPath
}: {
  statement: DslStatement;
  sites: readonly ModuleGeometryReferenceSite[];
  currentPath: readonly string[];
  contextsByPath: ReadonlyMap<string, InstanceContext>;
  materialization: ModuleMaterialization;
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>;
}): DslGeometryResolverOverrides => {
  const siteFor = (token: string, role: ModuleGeometryReferenceSemantic["role"]) => sites.find((site) =>
    site.reference.role === role && site.reference.source.trim() === token.trim()
  );
  const fallback = {
    resolveId: resolveIdFromDsl,
    resolveAnchor: resolveAnchorFromDsl,
    resolveEndpoint: resolveEndpointFromDsl
  };
  return {
    resolveId: (token, index, line, diagnostics, currentElement) => {
      const site = siteFor(token, "lineReference") ?? siteFor(token, "lineReferenceList");
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath);
      return lowered?.kind === "line" ? lowered.elementId : fallback.resolveId(token, index, line, diagnostics, currentElement);
    },
    resolveAnchor: (token, index, line, diagnostics, numeric, currentElement) => {
      const site = siteFor(token, "pointReference") ?? siteFor(token, "derivedPoint") ?? siteFor(token, "coordinatePoint");
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath);
      return lowered?.kind === "point" ? lowered.anchor : fallback.resolveAnchor(token, index, line, diagnostics, numeric, currentElement);
    },
    resolveEndpoint: (token, index, line, diagnostics, currentElement) => {
      const site = siteFor(token, "lineEndpointReference");
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath);
      if (lowered?.kind === "point" && lowered.anchor.mode === "derived") {
        return { lineId: lowered.anchor.elementId, endpointKey: lowered.anchor.pointKey === "end" ? "end" : "start" };
      }
      if (lowered?.kind === "line") {
        const pointKey = site?.reference.target?.pointKey;
        return { lineId: lowered.elementId, endpointKey: pointKey === "end" ? "end" : "start" };
      }
      return fallback.resolveEndpoint(token, index, line, diagnostics, currentElement);
    }
  };
};
