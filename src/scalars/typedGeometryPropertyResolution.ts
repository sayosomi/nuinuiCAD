// Resolves typed-scalar geometry reads once, while the compiled element names
// and source order are still available. Runtimes consume only this stable IR.
import {
  isKnownNumericComputedGeometryProperty,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import type { CadElement, ElementId } from "../types/geometry";
import type { TypedScalarExpression } from "./typedExpressionAst";

export type GeometryPropertyResolutionIssue = {
  span: { start: number; end: number };
  message: string;
};

const normalizedReference = (elementName: string, property: string, elements: readonly CadElement[]) => {
  try {
    const tokens = tokenize(normalizeNumericExpressionInput(`@${elementName}.${property}`, [...elements]));
    return tokens.length === 1 && tokens[0].type === "reference" ? tokens[0] : null;
  } catch {
    return null;
  }
};

export const resolveTypedGeometryProperties = (
  expression: TypedScalarExpression,
  elements: readonly CadElement[],
  sourceOrderByElementId: ReadonlyMap<ElementId, number>
): { expression: TypedScalarExpression; issues: readonly GeometryPropertyResolutionIssue[] } => {
  const issues: GeometryPropertyResolutionIssue[] = [];
  const visit = (node: TypedScalarExpression): TypedScalarExpression => {
    if (node.kind === "geometryProperty") {
      const reference = normalizedReference(node.elementName, node.property, elements);
      if (!reference) {
        issues.push({ span: node.elementNameSpan, message: `要素「${node.elementName}」を一意に解決できません。` });
        return { ...node, elementId: null, targetSourceOrder: null };
      }
      if (!isKnownNumericComputedGeometryProperty(reference.property)) {
        issues.push({ span: node.propertySpan, message: `要素プロパティ「${node.property}」は数値参照として使用できません。` });
        return { ...node, property: reference.property, elementId: null, targetSourceOrder: null };
      }
      return {
        ...node,
        property: reference.property,
        elementId: reference.elementId,
        targetSourceOrder: sourceOrderByElementId.get(reference.elementId) ?? null
      };
    }
    if (node.kind === "unary") return { ...node, operand: visit(node.operand) };
    if (node.kind === "binary") return { ...node, left: visit(node.left), right: visit(node.right) };
    if (node.kind === "group") return { ...node, expression: visit(node.expression) };
    return node;
  };
  return { expression: visit(expression), issues };
};
