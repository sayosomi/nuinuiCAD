import { makeNumericExpression } from "../geometry/numericExpressions";
import { derivedAnchor, isDerivedPointKeyForGeometryCategory, isLineEndpointPointKey, referenceAnchor } from "../model/pointAnchors";
import type { CadElement, ElementId, PointAnchor, GeometryInputTarget, GeometryValueOccurrence } from "../types/geometry";
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
  ModuleScalarExpressionSemantic,
  ModuleRecordFieldValueExpressionSemantic,
  ModuleRecordValueSemantic,
  ModuleRecordSourceTarget
} from "./moduleSemanticTypes";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import { encodeIdentityTuple } from "../document/identityTuple";
import type { RecordFieldIdentity } from "./recordSemanticAnalysis";
import { isDslGeometryValueType } from "./dslValueTypes";

export type GeometryAlias =
  | { kind: "line"; elementId: ElementId }
  | { kind: "point"; anchor: PointAnchor; coordinate?: ModulePointCoordinateSemantic }
  | { kind: "value"; occurrence: GeometryValueOccurrence; geometryType: "point" | "line"; interfaceType: "point" | "line" | "path"; pointKey?: string }
  | { kind: "mappedValue"; occurrence: GeometryValueOccurrence; geometryType: "point" | "line"; interfaceType: "point" | "line" | "path"; source: Exclude<GeometryAlias, { kind: "collectionIndex" }>; mapValueId: string; binderId: string; executionPosition: number; pointKey?: string }
  | { kind: "forGroupOccurrence"; templateElementId: ElementId; geometryType: "point" | "line" | "path"; targetSourceOrder: number; index: ModuleScalarExpressionSemantic | null; pointKey?: string }
  | { kind: "collectionIndex"; target: Extract<ModuleGeometrySourceTarget, { kind: "collectionIndex" }>; members: readonly GeometryAlias[]; value?: RuntimeGeometryCollectionNode };

export type RuntimeGeometryCollectionNode =
  | { kind: "none" }
  | { kind: "leaf"; aliases: readonly Exclude<GeometryAlias, { kind: "collectionIndex" }>[] }
  | { kind: "if"; condition: ModuleScalarExpressionSemantic; sourceOrder: number; sourcePath: readonly string[]; thenBranch: RuntimeGeometryCollectionNode; elseBranch: RuntimeGeometryCollectionNode }
  | { kind: "match"; scrutinee: ModuleScalarExpressionSemantic; sourceOrder: number; sourcePath: readonly string[]; arms: readonly { label: string; value: RuntimeGeometryCollectionNode }[] }
  | { kind: "coalesce"; leftBranch: RuntimeGeometryCollectionNode; rightBranch: RuntimeGeometryCollectionNode };

export type GeometryValueMapPendingTarget = {
  kind: "geometryValueMapPending";
  occurrence: GeometryValueOccurrence;
  geometryType: "point" | "line" | "path";
  source: Exclude<GeometryAlias, { kind: "collectionIndex" }>;
  mapValueId: string;
  binderId: string;
  executionPosition: number;
  declaredInterfaceType: "point" | "line" | "path";
  pointKey?: string;
  currentPath?: readonly string[];
};

/** Geometry consumer lowering may need to defer only the numeric index until
 * the scalar runtime has produced its typed expression. The collection and
 * its already-resolved members stay compiler-owned; runtime never reparses
 * the authored reference. */
export type GeometryInputTargetSource = {
  kind: "collectionIndex";
  target: Extract<ModuleGeometrySourceTarget, { kind: "collectionIndex" }>;
  members: readonly GeometryAlias[];
  value?: RuntimeGeometryCollectionNode;
  currentPath?: readonly string[];
};

export type ForGroupOccurrenceInputTargetSource = {
  kind: "forGroupOccurrenceSource";
  templateElementId: ElementId;
  geometryType: "point" | "line" | "path";
  targetSourceOrder: number;
  index: ModuleScalarExpressionSemantic | null;
  pointKey?: string;
  currentPath?: readonly string[];
};

export type GeometryCollectionInputTargetSource = {
  kind: "collectionValue";
  collectionValueId: string;
  targetSourceOrder: number;
  value: RuntimeGeometryCollectionNode;
  currentPath?: readonly string[];
};

export type RuntimeGeometryInputTarget = Exclude<GeometryInputTarget, { kind: "collectionIndex" | "collectionValue" | "forGroupOccurrence" }> | GeometryInputTargetSource | GeometryCollectionInputTargetSource | ForGroupOccurrenceInputTargetSource | GeometryValueMapPendingTarget;

export type InstanceContext = {
  path: readonly string[];
  instanceStatementId: string;
  instanceDocumentId?: import("../document/multiDocumentPrimitives").DocumentId;
  definitionStatementId: string;
  definitionDocumentId?: import("../document/multiDocumentPrimitives").DocumentId;
  instance: import("./moduleSemanticTypes").ModuleInstanceSemantic;
  definition: ModuleDefinitionSemantic;
  aliases: ReadonlyMap<number, GeometryAlias>;
};

export type ExportEntry = {
  exported: Extract<ResolvedModuleExport, { kind: "geometry" }>;
  alias: GeometryAlias;
};

export type ModuleGeometryPropertyRuntimeTarget =
  | { kind: "runtime"; elementId: ElementId; property: string; targetSourceOrder?: number }
  | { kind: "forGroupOccurrence"; templateElementId: ElementId; property: string; targetSourceOrder: number; index: ModuleScalarExpressionSemantic | null; pointKey?: string }
  | { kind: "value"; occurrence: GeometryValueOccurrence; property: string; pointKey?: string; targetSourceOrder?: number }
  | { kind: "binder"; binderId: string; property: string; pointKey?: string; targetSourceOrder?: number }
  | { kind: "expression"; expression: ModuleScalarExpressionSemantic };

export const pathKey = (path: readonly string[]) => encodeIdentityTuple(["instance", ...path]);

const recordTargetIdentity = (target: ModuleRecordSourceTarget): readonly string[] => {
  switch (target.kind) {
    case "recordValue":
      return [target.kind, target.identity?.documentId ?? "", target.statementId];
    case "recordParameter":
      return [target.kind, target.definitionIdentity?.documentId ?? "", target.definitionStatementId, String(target.parameterIndex)];
    case "recordValueForBinder":
      return [target.kind, target.binderId, target.statementId, target.typeIdentity];
    case "recordCollectionIndex":
      return [target.kind, target.collectionValueId, String(target.targetSourceOrder), String(target.index.ast.span.start), String(target.index.ast.span.end), target.typeIdentity];
    case "deferredModuleRecordExport":
      return [target.kind, target.instanceIdentity?.documentId ?? "", target.instanceStatementId, target.exportName, target.exportedStatementId];
  }
};

/** Synthetic occurrence identity for a geometry construction stored inside an
 * immutable record field. The source statement remains encoded in the
 * identity, while the field path keeps otherwise-colliding field values
 * distinct without inventing a drawable element identity. */
export const geometryValueOccurrenceForRecordField = (
  target: ModuleRecordSourceTarget,
  fieldPath: readonly RecordFieldIdentity[],
  instancePath: readonly string[]
): GeometryValueOccurrence => ({
  sourceStatementId: encodeIdentityTuple([
    "record-field-geometry",
    ...recordTargetIdentity(target),
    ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])
  ]),
  instancePath: [...instancePath]
});

export const geometryKindOfCategory = (
  category: Extract<ResolvedModuleExport, { kind: "geometry" }>["category"],
  interfaceType: ModuleGeometryInterfaceType
): "point" | "line" | null =>
  interfaceType === "point" ? "point" : interfaceType === "line" || interfaceType === "path" ? "line" :
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
  const actualInterfaceType = exportEntry.exported.interfaceType ?? moduleGeometryInterfaceTypeOfElement(statements[exportEntry.exported.exportedStatementIndex]);
  const validDerivedPoint = target.pointKey !== undefined &&
    target.expectedGeometryKind === "point" &&
    (exportEntry.exported.category
      ? isDerivedPointKeyForGeometryCategory(exportEntry.exported.category, target.pointKey)
      : actualInterfaceType !== "point" && isLineEndpointPointKey(target.pointKey));
  const typeCompatible = target.pointKey === undefined
    ? isModuleGeometryInterfaceAssignable(actualInterfaceType, target.expectedInterfaceType ?? target.expectedGeometryKind)
    : validDerivedPoint;
  if (!typeCompatible) {
    return {
      severity: "error",
      line: statement.line,
      column: target.memberSpan.start + 1,
      code: "module-geometry-type-mismatch",
      message: `module export「${target.exportName}」の型またはderived point accessorが一致しません。`,
      presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: target.exportName } }
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
      statements[body.statementIndex]?.name === target.exportName
    );
    return {
      severity: "error",
      line: statement.line,
      column: target.memberSpan.start + 1,
      code: privateMember ? "module-private-member" : "module-undefined-export",
      message: privateMember
        ? `module member「${target.exportName}」はexportされていないため参照できません。`
        : `module export「${target.exportName}」が見つかりません。`,
      presentation: {
        key: `diagnostic.${privateMember ? "module-private-member" : "module-undefined-export"}`,
        parameters: { target: target.exportName }
      }
    };
  }
  return null;
};

const lowerAliasWithPointKey = (alias: GeometryAlias, pointKey: string | undefined): GeometryAlias | undefined => {
  if (alias.kind === "collectionIndex") {
    return pointKey ? undefined : alias;
  }
  if (!pointKey) return alias;
  if (alias.kind === "value" || alias.kind === "mappedValue") return { ...alias, geometryType: "point", pointKey };
  if (alias.kind !== "line") return undefined;
  return { kind: "point", anchor: derivedAnchor(alias.elementId, pointKey) };
};

export const geometryInputTargetForAlias = (alias: GeometryAlias): Exclude<GeometryInputTarget, { kind: "collectionIndex" } | { kind: "collectionValue" } | { kind: "forGroupOccurrence" }> | GeometryValueMapPendingTarget | null => {
  if (alias.kind === "collectionIndex") return null;
  if (alias.kind === "line") {
    return { kind: "drawable", elementId: alias.elementId, geometryType: "line" };
  }
  if (alias.kind === "value") {
    return {
      kind: "geometryValue",
      occurrence: alias.occurrence,
      geometryType: alias.interfaceType === "path" ? "path" : alias.geometryType,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
  if (alias.kind === "mappedValue") {
    return {
      kind: "geometryValueMapPending",
      occurrence: alias.occurrence,
      geometryType: alias.interfaceType === "path" ? "path" : alias.geometryType,
      source: alias.source,
      mapValueId: alias.mapValueId,
      binderId: alias.binderId,
      executionPosition: alias.executionPosition,
      declaredInterfaceType: alias.interfaceType,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
  if (alias.kind === "forGroupOccurrence") return null;
  if (alias.anchor.mode === "reference") {
    return { kind: "drawable", elementId: alias.anchor.pointId, geometryType: "point" };
  }
  if (alias.anchor.mode === "derived") {
    return { kind: "drawable", elementId: alias.anchor.elementId, geometryType: "point", pointKey: alias.anchor.pointKey };
  }
  if (alias.anchor.mode === "geometryValue") {
    return { kind: "geometryValue", occurrence: alias.anchor.occurrence, geometryType: "point", ...(alias.anchor.pointKey ? { pointKey: alias.anchor.pointKey } : {}) };
  }
  return { kind: "coordinate", anchor: alias.anchor };
};

export const pointAnchorForAlias = (alias: GeometryAlias): PointAnchor | null => {
  if (alias.kind === "collectionIndex") return null;
  if (alias.kind === "point") return alias.anchor;
  if (alias.kind === "value" && alias.geometryType === "point") {
    return { mode: "geometryValue", occurrence: alias.occurrence, ...(alias.pointKey ? { pointKey: alias.pointKey } : {}) };
  }
  if (alias.kind === "mappedValue" && alias.geometryType === "point") {
    return { mode: "geometryValue", occurrence: alias.occurrence, ...(alias.pointKey ? { pointKey: alias.pointKey } : {}) };
  }
  return null;
};

export const geometryInputTargetSourceForAlias = (alias: GeometryAlias): RuntimeGeometryInputTarget | null => {
  if (alias.kind === "forGroupOccurrence") {
    return {
      kind: "forGroupOccurrenceSource",
      templateElementId: alias.templateElementId,
      geometryType: alias.geometryType,
      targetSourceOrder: alias.targetSourceOrder,
      index: alias.index,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
  if (alias.kind !== "collectionIndex") return geometryInputTargetForAlias(alias);
  return {
    kind: "collectionIndex",
    target: alias.target,
    members: alias.members,
    ...(alias.value ? { value: alias.value } : {})
  };
};

export const propertyForAlias = (
  alias: GeometryAlias,
  property: string,
  elementsById: ReadonlyMap<ElementId, CadElement>
): ModuleGeometryPropertyRuntimeTarget | undefined => {
  if (alias.kind === "value") {
    return {
      kind: "value",
      occurrence: alias.occurrence,
      property,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
  if (alias.kind === "mappedValue") {
    return {
      kind: "value",
      occurrence: alias.occurrence,
      property,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
  if (alias.kind === "line") return { kind: "runtime", elementId: alias.elementId, property };
  if (alias.kind === "collectionIndex") return undefined;
  if (alias.kind === "forGroupOccurrence") {
    return {
      kind: "forGroupOccurrence",
      templateElementId: alias.templateElementId,
      property,
      targetSourceOrder: alias.targetSourceOrder,
      index: alias.index,
      ...(alias.pointKey ? { pointKey: alias.pointKey } : {})
    };
  }
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

export const geometryAliasForSourceElement = (
  elementId: ElementId,
  geometryKind: "point" | "line",
  pointKey?: string
): GeometryAlias | undefined => lowerAliasWithPointKey(
  geometryKind === "point"
    ? { kind: "point", anchor: referenceAnchor(elementId) }
    : { kind: "line", elementId },
  pointKey
);

export const sourceAliasForTarget = (
  target: ModuleGeometrySourceTarget,
  currentPath: readonly string[],
  contextsByPath: ReadonlyMap<string, InstanceContext>,
  materialization: ModuleMaterialization,
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>,
  rootRecordValuesByStatementId: ReadonlyMap<string, ModuleRecordValueSemantic> = new Map()
): GeometryAlias | undefined => {
  const childContextFor = (statementId: string, documentId?: import("../document/multiDocumentPrimitives").DocumentId) =>
    [...contextsByPath.values()].find((context) =>
      context.path.length === currentPath.length + 1 &&
      currentPath.every((part, index) => context.path[index] === part) &&
      context.instanceStatementId === statementId &&
      (documentId === undefined || context.instanceDocumentId === documentId)
    );
  if (target.kind === "parameter") {
    for (let index = currentPath.length; index >= 0; index -= 1) {
      const context = contextsByPath.get(pathKey(currentPath.slice(0, index)));
      if (context?.definitionStatementId === target.definitionStatementId &&
          (!target.definitionIdentity || context.definitionDocumentId === target.definitionIdentity.documentId)) {
        const alias = context.aliases.get(target.parameterIndex);
        return alias ? lowerAliasWithPointKey(alias, target.pointKey) : undefined;
      }
    }
    return undefined;
  }
  if (target.kind === "geometryValue") {
    if (target.backingTarget) {
      const alias = sourceAliasForTarget(target.backingTarget, currentPath, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      if (!alias) return undefined;
      return lowerAliasWithPointKey(alias, target.pointKey);
    }
    return {
      kind: "value",
      occurrence: { sourceStatementId: target.statementId, instancePath: [...currentPath] },
      geometryType: target.declaredInterfaceType === "point" ? "point" : "line",
      interfaceType: target.declaredInterfaceType,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  if (target.kind === "sourceGeometry") {
    let ownerPath: readonly string[] = [];
    for (let index = currentPath.length; index > 0; index -= 1) {
      const candidatePath = currentPath.slice(0, index);
      const context = contextsByPath.get(pathKey(candidatePath));
      if (context?.definition.bodyStatements.some((body) => body.statementId === target.statementId) &&
          (!target.identity || context.definitionDocumentId === target.identity.documentId)) {
        ownerPath = candidatePath;
        break;
      }
    }
    const rootDocumentIds = new Set(
      [...contextsByPath.values()]
        .filter((context) => context.path.length === 1)
        .map((context) => context.instanceDocumentId)
    );
    if (!ownerPath.length && target.identity && !rootDocumentIds.has(target.identity.documentId)) return undefined;
    const entry = ownerPath.length
      ? runtimeEntryForBody(materialization, ownerPath, target.statementId)
      : materialization.elementIdBySourceStatementIndex.get(target.statementIndex)
        ? { runtimeElementId: materialization.elementIdBySourceStatementIndex.get(target.statementIndex)! } as MaterializedExecutionStatement
        : undefined;
    if (!entry) return undefined;
    const alias = target.geometryKind === "point"
      ? { kind: "point", anchor: referenceAnchor(entry.runtimeElementId) } as const
      : { kind: "line", elementId: entry.runtimeElementId } as const;
    return lowerAliasWithPointKey(alias, target.pointKey);
  }
  if (target.kind === "forGroupOccurrence") {
    let ownerPath: readonly string[] = [];
    for (let index = currentPath.length; index > 0; index -= 1) {
      const candidatePath = currentPath.slice(0, index);
      const context = contextsByPath.get(pathKey(candidatePath));
      if (context?.definition.bodyStatements.some((body) => body.statementId === target.statementId) &&
          (!target.identity || context.definitionDocumentId === target.identity.documentId)) {
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
    return {
      kind: "forGroupOccurrence",
      templateElementId: entry.runtimeElementId,
      geometryType: target.expectedInterfaceType ?? target.geometryKind,
      targetSourceOrder: target.statementIndex,
      index: target.index,
      ...(target.pointKey ? { pointKey: target.pointKey } : {})
    };
  }
  if (target.kind === "recordFieldValue") {
    const recordValueExpressionForTarget = (recordTarget: ModuleRecordSourceTarget): ModuleRecordValueSemantic["valueExpression"] | null => {
      if (recordTarget.kind === "recordValue") {
        for (let index = currentPath.length; index >= 0; index -= 1) {
          const context = contextsByPath.get(pathKey(currentPath.slice(0, index)));
          const local = context?.definition.recordValues.find((value) => value.value.statementId === recordTarget.statementId);
          if (local) return local.valueExpression;
        }
        return rootRecordValuesByStatementId.get(recordTarget.statementId)?.valueExpression ?? null;
      }
      if (recordTarget.kind === "recordCollectionIndex") {
        const index = recordTarget.index.ast.kind === "numberLiteral" ? recordTarget.index.ast.value : null;
        const member = index !== null && Number.isInteger(index) && index >= 0 ? recordTarget.members?.[index] : undefined;
        return member ? recordValueExpressionForTarget(member) : null;
      }
      if (recordTarget.kind === "deferredModuleRecordExport") {
        const child = childContextFor(recordTarget.instanceStatementId, recordTarget.instanceIdentity?.documentId);
        const exported = child?.definition.exports.find((candidate) =>
          candidate.kind === "record" && candidate.name === recordTarget.exportName && candidate.exportedStatementId === recordTarget.exportedStatementId
        );
        return exported?.kind === "record" ? recordValueExpressionForTarget(exported.backingTarget) : null;
      }
      if (recordTarget.kind === "recordParameter") {
        const context = [...contextsByPath.values()].find((candidate) =>
          candidate.definition.statementId === recordTarget.definitionStatementId &&
          candidate.path.length <= currentPath.length &&
          candidate.path.every((part, index) => currentPath[index] === part)
        );
        const binding = context?.instance.parameterBindings.find((candidate) => candidate.parameterIndex === recordTarget.parameterIndex);
        if (binding?.value?.kind !== "record") return null;
        return binding.value.reference.constructor
          ? { kind: "constructor", span: binding.value.reference.span, constructor: binding.value.reference.constructor }
          : binding.value.reference.target
            ? { kind: "reference", span: binding.value.reference.span, reference: binding.value.reference }
            : null;
      }
      return null;
    };
    const fieldExpressionFor = (
      expression: ModuleRecordValueSemantic["valueExpression"] | ModuleRecordFieldValueExpressionSemantic | null,
      path: readonly import("./recordSemanticAnalysis").RecordFieldIdentity[],
      seen: ReadonlySet<string> = new Set()
    ): ModuleRecordFieldValueExpressionSemantic | null => {
      if (!expression || path.length === 0) return null;
      const key = `${expression.kind}:${path.map((field) => `${field.recordStatementId}:${field.fieldIndex}`).join("/")}`;
      if (seen.has(key)) return null;
      const nextSeen = new Set([...seen, key]);
      if (expression.kind === "constructor") {
        const field = expression.constructor.fields.find((candidate) => candidate.field.fieldIndex === path[0]!.fieldIndex);
        if (!field?.valueExpression) return null;
        if (path.length === 1) return field.valueExpression;
        return field.valueExpression.kind === "record"
          ? fieldExpressionFor(field.valueExpression.expression, path.slice(1), nextSeen)
          : null;
      }
      if (expression.kind === "reference" || expression.kind === "collectionIndex") {
        const nextTarget = expression.reference.target;
        return nextTarget
          ? fieldExpressionFor(recordValueExpressionForTarget(nextTarget), path, nextSeen)
          : null;
      }
      return null;
    };
    const recordValueExpression = recordValueExpressionForTarget(target.record);
    const expression = fieldExpressionFor(recordValueExpression, target.fieldPath ?? [target.field]);
    if (!expression) return undefined;
    if (!isDslGeometryValueType(target.valueType)) return undefined;
    if (expression.kind === "geometry") {
      if (expression.expression?.kind === "reference" && expression.expression.reference.target) {
        const alias = sourceAliasForTarget(expression.expression.reference.target, currentPath, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
        return alias ? lowerAliasWithPointKey(alias, target.pointKey) : undefined;
      }
      if (!expression.expression) return undefined;
      return lowerAliasWithPointKey({
        kind: "value",
        occurrence: geometryValueOccurrenceForRecordField(target.record, target.fieldPath ?? [target.field], currentPath),
        geometryType: target.valueType.kind === "point" ? "point" : "line",
        interfaceType: target.valueType.kind
      }, target.pointKey);
    }
    if (expression.kind === "collection" && target.collectionIndex !== undefined && expression.value && typeof expression.value === "object" && "kind" in expression.value && expression.value.kind === "literal") {
      const member = (expression.value as Extract<import("./geometryArraySemantics").DslArraySemanticValue<unknown>, { kind: "literal" }>).members[target.collectionIndex];
      const memberTarget = member?.target;
      if (memberTarget && typeof memberTarget === "object" && "kind" in memberTarget && typeof memberTarget.kind === "string") {
        const alias = sourceAliasForTarget(memberTarget as ModuleGeometrySourceTarget, currentPath, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
        return alias ? lowerAliasWithPointKey(alias, target.pointKey) : undefined;
      }
    }
    return undefined;
  }
  if (target.kind === "collectionIndex" || target.kind === "geometryValueForBinder") return undefined;
  const child = childContextFor(target.instanceStatementId, target.instanceIdentity?.documentId);
  const alias = child ? exportsByPath.get(pathKey(child.path))?.get(target.exportName)?.alias : undefined;
  return alias ? lowerAliasWithPointKey(alias, target.pointKey) : undefined;
};

export const lowerReference = (
  reference: ModuleGeometryReferenceSemantic,
  currentPath: readonly string[],
  statement: DslStatement,
  contextsByPath: ReadonlyMap<string, InstanceContext>,
  materialization: ModuleMaterialization,
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>,
  rootRecordValuesByStatementId: ReadonlyMap<string, ModuleRecordValueSemantic> = new Map()
): GeometryAlias | undefined => {
  if (reference.coordinate) return { kind: "point", anchor: coordinateAnchor(reference.coordinate, statement), coordinate: reference.coordinate };
  if (!reference.target) return undefined;
  const base = sourceAliasForTarget(reference.target, currentPath, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
  return base;
};

export const resolverForBody = ({
  statement,
  sites,
  currentPath,
  statementIndex,
  contextsByPath,
  materialization,
  exportsByPath,
  rootRecordValuesByStatementId,
  resolveLineReferenceTargetAt,
  resolvePointReferenceAt
}: {
  statement: DslStatement;
  sites: readonly ModuleGeometryReferenceSite[];
  currentPath: readonly string[];
  statementIndex: number;
  contextsByPath: ReadonlyMap<string, InstanceContext>;
  materialization: ModuleMaterialization;
  exportsByPath: ReadonlyMap<string, ReadonlyMap<string, ExportEntry>>;
  rootRecordValuesByStatementId?: ReadonlyMap<string, ModuleRecordValueSemantic>;
  resolveLineReferenceTargetAt?: (token: string, statementIndex: number, currentPath: readonly string[], target?: ModuleGeometrySourceTarget) => RuntimeGeometryInputTarget | null;
  resolvePointReferenceAt?: (token: string, statementIndex: number, currentPath: readonly string[], target?: ModuleGeometrySourceTarget) => PointAnchor | RuntimeGeometryInputTarget | null;
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
    resolveLineReferenceTarget: (token) => {
      const site = siteFor(token, "lineReference") ?? siteFor(token, "lineReferenceList");
      const indexed = resolveLineReferenceTargetAt?.(token, statementIndex, currentPath, site?.reference.target ?? undefined);
      if (indexed) return indexed;
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      const loweredTarget = lowered ? geometryInputTargetSourceForAlias(lowered) : null;
      if (loweredTarget?.kind === "collectionIndex") return { ...loweredTarget, currentPath };
      if (loweredTarget?.kind === "forGroupOccurrenceSource") return { ...loweredTarget, currentPath };
      if (loweredTarget?.kind === "geometryValueMapPending") return { ...loweredTarget, currentPath };
      if (lowered?.kind === "line") {
        return { kind: "drawable", elementId: lowered.elementId, geometryType: "line" } satisfies GeometryInputTarget;
      }
      if (lowered?.kind === "value" && lowered.geometryType === "line") {
        return {
          kind: "geometryValue",
          occurrence: lowered.occurrence,
          geometryType: lowered.interfaceType === "path" ? "path" : "line"
        } satisfies GeometryInputTarget;
      }
      return null;
    },
    resolveLineEndpointTarget: (token) => {
      const site = siteFor(token, "lineEndpointReference");
      const indexed = resolvePointReferenceAt?.(token, statementIndex, currentPath, site?.reference.target ?? undefined);
      if (indexed && "kind" in indexed) return indexed;
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      const loweredTarget = lowered ? geometryInputTargetSourceForAlias(lowered) : null;
      if (loweredTarget?.kind === "geometryValueMapPending") return { ...loweredTarget, currentPath };
      if (loweredTarget?.kind === "forGroupOccurrenceSource") return { ...loweredTarget, currentPath };
      if (lowered?.kind === "line") {
        return { kind: "drawable", elementId: lowered.elementId, geometryType: "line" } satisfies GeometryInputTarget;
      }
      if (lowered?.kind === "value" && lowered.geometryType === "line") {
        return {
          kind: "geometryValue",
          occurrence: lowered.occurrence,
          geometryType: lowered.interfaceType === "path" ? "path" : "line"
        } satisfies GeometryInputTarget;
      }
      return null;
    },
    resolveId: (token, index, line, diagnostics, currentElement) => {
      const site = siteFor(token, "lineReference") ?? siteFor(token, "lineReferenceList");
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      return lowered?.kind === "line" ? lowered.elementId : fallback.resolveId(token, index, line, diagnostics, currentElement);
    },
    resolveAnchor: (token, index, line, diagnostics, numeric, currentElement) => {
      const site = siteFor(token, "pointReference") ?? siteFor(token, "derivedPoint") ?? siteFor(token, "coordinatePoint");
      const indexed = resolvePointReferenceAt?.(token, statementIndex, currentPath, site?.reference.target ?? undefined);
      if (indexed) return indexed;
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      const loweredTarget = lowered ? geometryInputTargetSourceForAlias(lowered) : null;
      if (loweredTarget?.kind === "collectionIndex") return { ...loweredTarget, currentPath };
      if (loweredTarget?.kind === "forGroupOccurrenceSource") return { ...loweredTarget, currentPath };
      if (lowered?.kind === "point") return lowered.anchor;
      if (lowered?.kind === "value" && lowered.geometryType === "point") {
        return { mode: "geometryValue", occurrence: lowered.occurrence, ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}) };
      }
      return fallback.resolveAnchor(token, index, line, diagnostics, numeric, currentElement);
    },
    resolveEndpoint: (token, index, line, diagnostics, currentElement) => {
      const site = siteFor(token, "lineEndpointReference");
      const lowered = site && lowerReference(site.reference, currentPath, statement, contextsByPath, materialization, exportsByPath, rootRecordValuesByStatementId);
      if (lowered?.kind === "point" && lowered.anchor.mode === "derived") {
        return { lineId: lowered.anchor.elementId, endpointKey: lowered.anchor.pointKey === "end" ? "end" : "start" };
      }
      if (lowered?.kind === "line") {
        const pointKey = site?.reference.target && "pointKey" in site.reference.target ? site.reference.target.pointKey : undefined;
        return { lineId: lowered.elementId, endpointKey: pointKey === "end" ? "end" : "start" };
      }
      if (lowered?.kind === "value" && lowered.geometryType === "line") {
        const pointKey = site?.reference.target && "pointKey" in site.reference.target ? site.reference.target.pointKey : undefined;
        return { lineId: token.trim(), endpointKey: pointKey === "end" ? "end" : "start" };
      }
      return fallback.resolveEndpoint(token, index, line, diagnostics, currentElement);
    }
  };
};
