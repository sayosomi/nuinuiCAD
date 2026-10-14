import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import { makeNumericExpression } from "../geometry/numericExpressions";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import type { NameIndex } from "./dslReferences";
import { resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import { coordinateComponent } from "./dslParameterSpanScanner";
import type {
  GeometryArraySemanticAnalysis,
  GeometryArraySourceTarget,
  GeometryArrayValueSemantic
} from "./geometryArraySemanticAnalysis";
import type { GeometryArraySemanticValue } from "./geometryArraySemantics";
import type { RuntimeGeometryCollectionNode, RuntimeGeometryInputTarget } from "./moduleGeometryRuntimeLowering";

const valueForId = (
  analysis: GeometryArraySemanticAnalysis,
  valueId: string
): GeometryArrayValueSemantic | null => analysis.valuesByStatementId.get(valueId) ?? null;

const lowerValue = (
  analysis: GeometryArraySemanticAnalysis,
  value: GeometryArraySemanticValue<GeometryArraySourceTarget>,
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>,
  geometryValueByStatementIndex: ReadonlyMap<number, { kind: "value" | "drawable"; occurrence?: { sourceStatementId: string; instancePath: readonly string[] }; declaredInterfaceType: "point" | "line" | "path"; elementId?: ElementId }> | undefined,
  visited: ReadonlySet<string>
): readonly ElementId[] | null => {
  if (value.type.elementType === "point") return null;
  if (value.kind === "none") return null;
  if (value.kind === "alias") {
    if (visited.has(value.targetValueId)) return null;
    const target = valueForId(analysis, value.targetValueId);
    if (!target?.value) return null;
    return lowerValue(
      analysis,
      target.value,
      elementIdByStatementIndex,
      geometryValueByStatementIndex,
      new Set([...visited, value.targetValueId])
    );
  }
  if (value.kind === "map") return null;
  if (value.kind === "if" || value.kind === "match" || value.kind === "coalesce") return null;

  const ids: ElementId[] = [];
  for (const member of value.members) {
    // A pure geometry value has no drawable ElementId and therefore cannot
    // enter a line identity list. The Module runtime may lower it through its
    // geometry-value alias at a value-aware consumer boundary.
    if (member.target.kind !== "geometry") return null;
    const id = elementIdByStatementIndex.get(member.target.statementIndex);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
};

const coordinateAnchor = (source: string): PointAnchor | null => {
  const span = { start: 0, end: source.length };
  const x = coordinateComponent(source, span, "x");
  const y = coordinateComponent(source, span, "y");
  if (!x || !y) return null;
  return {
    mode: "coordinate",
    x: makeNumericExpression(source.slice(x.start, x.end)),
    y: makeNumericExpression(source.slice(y.start, y.end))
  };
};

const lowerPointValue = (
  analysis: GeometryArraySemanticAnalysis,
  value: GeometryArraySemanticValue<GeometryArraySourceTarget>,
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>,
  geometryValueByStatementIndex: ReadonlyMap<number, { kind: "value" | "drawable"; occurrence?: { sourceStatementId: string; instancePath: readonly string[] }; declaredInterfaceType: "point" | "line" | "path"; elementId?: ElementId }> | undefined,
  visited: ReadonlySet<string>
): readonly PointAnchor[] | null => {
  if (value.type.elementType !== "point") return null;
  if (value.kind === "none") return null;
  if (value.kind === "alias") {
    if (visited.has(value.targetValueId)) return null;
    const target = valueForId(analysis, value.targetValueId);
    if (!target?.value) return null;
    return lowerPointValue(analysis, target.value, elementIdByStatementIndex, geometryValueByStatementIndex, new Set([...visited, value.targetValueId]));
  }
  if (value.kind === "map") return null;
  if (value.kind === "if" || value.kind === "match" || value.kind === "coalesce") return null;

  const anchors: PointAnchor[] = [];
  for (const member of value.members) {
    if (member.target.kind === "coordinate") {
      const anchor = coordinateAnchor(member.target.source);
      if (!anchor) return null;
      anchors.push(anchor);
      continue;
    }
    if (member.target.kind === "geometryValue") {
      const geometryValue = geometryValueByStatementIndex?.get(member.target.statementIndex);
      if (geometryValue?.kind !== "value" || !geometryValue.occurrence) return null;
      anchors.push({
        mode: "geometryValue",
        occurrence: geometryValue.occurrence,
        ...(member.target.pointKey ? { pointKey: member.target.pointKey } : {})
      });
      continue;
    }
    if (member.target.kind !== "geometry") return null;
    const id = elementIdByStatementIndex.get(member.target.statementIndex);
    if (!id) return null;
    anchors.push(member.target.pointKey ? derivedAnchor(id, member.target.pointKey) : referenceAnchor(id));
  }
  return anchors;
};

/**
 * Lower a whole source-authored `line[]`/`path[]` reference only at an
 * existing line-list consumer boundary. The source semantic value remains
 * definition-backed and ordered; aliases are dereferenced here, preserving
 * duplicates. Module-parameter/export aliases intentionally fail closed here
 * and are handled by the Module runtime override.
 */
export const lowerSourceGeometryArrayLineReferenceList = (
  token: string,
  index: NameIndex,
  currentElement?: CadElement
): readonly ElementId[] | RuntimeGeometryInputTarget | null => {
  const sourceResolution = index.sourceLexicalResolution;
  const analysis = sourceResolution?.sourceNamespace.geometryArraySemanticAnalysis;
  if (!sourceResolution || !analysis || !currentElement) return null;
  const statementIndex = sourceResolution.statementIndexByElementId.get(currentElement.id);
  if (statementIndex === undefined) return null;

  const parsed = parseDslSourceReference(token.trim());
  if (parsed.kind !== "valid" || parsed.reference.property) return null;
  const path = parseDslReferenceToken(parsed.reference.pathText);
  const lookup = resolveSourceLexicalPath(sourceResolution.sourceNamespace, statementIndex, path);
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration") return null;
  const semantic = analysis.valuesByStatementIndex.get(lookup.declaration.statementIndex);
  if (!semantic?.value || semantic.type.elementType === "point") return null;
  const selectedStageLiteral = (value: GeometryArraySemanticValue<GeometryArraySourceTarget>, seen: ReadonlySet<string>): Extract<GeometryArraySemanticValue<GeometryArraySourceTarget>, { kind: "literal" }> | null => {
    if (value.kind === "literal") return value;
    if (value.kind !== "alias" || seen.has(value.targetValueId)) return null;
    const target = valueForId(analysis, value.targetValueId);
    return target?.value
      ? selectedStageLiteral(target.value, new Set([...seen, value.targetValueId]))
      : null;
  };
  const literal = selectedStageLiteral(semantic.value, new Set([semantic.statementId]));
  if (literal) {
    const aliases: Extract<RuntimeGeometryCollectionNode, { kind: "leaf" }>["aliases"][number][] = [];
    let hasSelectedStage = false;
    for (const member of literal.members) {
      const target = member.target;
      if (target.kind === "geometry") {
        const elementId = sourceResolution.elementIdByStatementIndex.get(target.statementIndex);
        if (!elementId || target.interfaceType === "point") return null;
        hasSelectedStage ||= Boolean(target.stagePath?.length);
        aliases.push({
          kind: "line",
          elementId,
          interfaceType: target.interfaceType,
          ...(target.stagePath ? { stagePath: target.stagePath } : {}),
        });
      } else if (target.kind === "geometryValue") {
        if (target.interfaceType === "point") return null;
        hasSelectedStage ||= Boolean(target.stagePath?.length);
        aliases.push({
          kind: "value",
          occurrence: { sourceStatementId: target.statementId, instancePath: [] },
          geometryType: "line",
          interfaceType: target.interfaceType,
          ...(target.pointKey ? { pointKey: target.pointKey } : {}),
          ...(target.stagePath ? { stagePath: target.stagePath } : {})
        });
      } else {
        return null;
      }
    }
    if (hasSelectedStage) {
      const value: RuntimeGeometryCollectionNode = { kind: "leaf", aliases };
      return {
        kind: "collectionValue",
        collectionValueId: semantic.statementId,
        targetSourceOrder: semantic.statementIndex,
        value,
        currentPath: []
      };
    }
  }
  return lowerValue(
    analysis,
    semantic.value,
    sourceResolution.elementIdByStatementIndex,
    sourceResolution.geometryValueByStatementIndex,
    new Set([semantic.statementId])
  );
};

/** Lower a source-authored point[] value at the polyline construction boundary.
 * The array semantic analysis remains the owner of ordered membership and
 * reference validity; this function only converts its resolved targets into
 * the existing PointAnchor representation consumed by evaluation. */
export const lowerSourceGeometryArrayPointReferenceList = (
  token: string,
  index: NameIndex,
  currentElement?: CadElement
): readonly PointAnchor[] | null => {
  const sourceResolution = index.sourceLexicalResolution;
  const analysis = sourceResolution?.sourceNamespace.geometryArraySemanticAnalysis;
  if (!sourceResolution || !analysis || !currentElement) return null;
  const statementIndex = sourceResolution.statementIndexByElementId.get(currentElement.id);
  if (statementIndex === undefined) return null;

  const parsed = parseDslSourceReference(token.trim());
  if (parsed.kind !== "valid" || parsed.reference.property) return null;
  const path = parseDslReferenceToken(parsed.reference.pathText);
  const lookup = resolveSourceLexicalPath(sourceResolution.sourceNamespace, statementIndex, path);
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration") return null;
  const semantic = analysis.valuesByStatementIndex.get(lookup.declaration.statementIndex);
  if (!semantic?.value || semantic.type.elementType !== "point") return null;
  return lowerPointValue(
    analysis,
    semantic.value,
    sourceResolution.elementIdByStatementIndex,
    sourceResolution.geometryValueByStatementIndex,
    new Set([semantic.statementId])
  );
};

export const lowerSourceGeometryArrayLineReferenceAt = (
  token: string,
  index: NameIndex,
  currentElement: CadElement | undefined,
  memberIndex: number
): ElementId | null => {
  if (!Number.isInteger(memberIndex) || memberIndex < 0) return null;
  const members = lowerSourceGeometryArrayLineReferenceList(token, index, currentElement);
  return Array.isArray(members) ? members[memberIndex] ?? null : null;
};

export const lowerSourceGeometryArrayPointReferenceAt = (
  token: string,
  index: NameIndex,
  currentElement: CadElement | undefined,
  memberIndex: number
): PointAnchor | null => {
  if (!Number.isInteger(memberIndex) || memberIndex < 0) return null;
  const members = lowerSourceGeometryArrayPointReferenceList(token, index, currentElement);
  return members?.[memberIndex] ?? null;
};
