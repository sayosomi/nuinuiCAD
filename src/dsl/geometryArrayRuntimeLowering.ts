import type { CadElement, ElementId } from "../types/geometry";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import type { NameIndex } from "./dslReferences";
import { resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import type {
  GeometryArraySemanticAnalysis,
  GeometryArraySourceTarget,
  GeometryArrayValueSemantic
} from "./geometryArraySemanticAnalysis";
import type { GeometryArraySemanticValue } from "./geometryArraySemantics";

const valueForId = (
  analysis: GeometryArraySemanticAnalysis,
  valueId: string
): GeometryArrayValueSemantic | null => analysis.valuesByStatementId.get(valueId) ?? null;

const lowerValue = (
  analysis: GeometryArraySemanticAnalysis,
  value: GeometryArraySemanticValue<GeometryArraySourceTarget>,
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>,
  visited: ReadonlySet<string>
): readonly ElementId[] | null => {
  if (value.type.elementType === "point") return null;
  if (value.kind === "alias") {
    if (visited.has(value.targetValueId)) return null;
    const target = valueForId(analysis, value.targetValueId);
    if (!target?.value) return null;
    return lowerValue(
      analysis,
      target.value,
      elementIdByStatementIndex,
      new Set([...visited, value.targetValueId])
    );
  }

  const ids: ElementId[] = [];
  for (const member of value.members) {
    if (member.target.kind !== "geometry") return null;
    const id = elementIdByStatementIndex.get(member.target.statementIndex);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
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
): readonly ElementId[] | null => {
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
  return lowerValue(
    analysis,
    semantic.value,
    sourceResolution.elementIdByStatementIndex,
    new Set([semantic.statementId])
  );
};
