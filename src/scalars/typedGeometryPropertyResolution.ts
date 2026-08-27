// Resolves typed-scalar geometry reads once, while the compiled element names
// && source order are still available. Runtimes consume only this stable IR.
import {
  isKnownNumericComputedGeometryProperty,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import { createElementNameContext, resolveElementName } from "../model/elementNames";
import type { ElementNameContext } from "../model/elementNames";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId } from "../types/geometry";
import type { ScalarExpressionAst } from "./expressionAst";
import type { ScalarExpressionResolvedGeometryProperty } from "./typedExpressionAst";

export type GeometryPropertyResolutionIssue = {
  span: { start: number; end: number };
  message: string;
};

export type TypedGeometryPropertyResolutionContext = {
  currentElement?: Pick<CadElement, "parentGroupId">;
  nameContext?: ElementNameContext;
  /** Source-order position of the expression owner. Geometry reads must point
   * strictly earlier in document order. */
  currentSourceOrder?: number;
  /** Geometry-property occurrences already claimed as direct builtin geometry
   * operands are owned by the geometry builtin resolver, not this numeric
   * property resolver. */
  skipPropertySpanStarts?: ReadonlySet<number>;
};

const normalizedReference = (
  elementName: string,
  property: string,
  elements: readonly CadElement[],
  currentElement: Pick<CadElement, "parentGroupId"> | undefined,
  nameContext: ElementNameContext
) => {
  try {
    const tokens = tokenize(normalizeNumericExpressionInput(
      `@${elementName}.${property}`,
      [...elements],
      currentElement,
      nameContext
    ));
    return tokens.length === 1 && tokens[0].type === "reference" ? tokens[0] : null;
  } catch {
    return null;
  }
};

const choiceGeometryPropertyTypeFor = (
  element: CadElement | undefined,
  property: string
) => {
  const definition = element ? findParameterDefinition(element, property) : undefined;
  const type = scalarTypeForParameterDefinition(definition);
  return type?.kind === "choice" ? type : null;
};

export const resolveGeometryPropertyMetadata = (
  expression: ScalarExpressionAst,
  elements: readonly CadElement[],
  sourceOrderByElementId: ReadonlyMap<ElementId, number>,
  context?: TypedGeometryPropertyResolutionContext
): {
  geometryPropertyReferences: ReadonlyMap<number, ScalarExpressionResolvedGeometryProperty | null>;
  issues: readonly GeometryPropertyResolutionIssue[];
} => {
  const issues: GeometryPropertyResolutionIssue[] = [];
  const geometryPropertyReferences = new Map<number, ScalarExpressionResolvedGeometryProperty | null>();
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const nameContext = context?.nameContext ?? createElementNameContext([...elements]);
  const visit = (node: ScalarExpressionAst): void => {
    if (node.kind === "geometryProperty") {
      if (context?.skipPropertySpanStarts?.has(node.span.start)) return;
      const reference = normalizedReference(
        node.elementName,
        node.property,
        elements,
        context?.currentElement,
        nameContext
      );
      if (!reference) {
        geometryPropertyReferences.set(node.span.start, null);
        issues.push({ span: node.elementNameSpan, message: `要素「${node.elementName}」を一意に解決できません。` });
        return;
      }
      // Numeric normalization is intentionally retained as the canonical
      // property parser, but an authored name can equal a generated/explicit
      // element id (for example `id: AB`). In that case the numeric normalizer's
      // later bare-token pass can produce a stale id; recover the already
      // resolved source name before applying schema typing.
      const targetElement = elementsById.get(reference.elementId) ?? (() => {
        const resolved = resolveElementName({ token: node.elementName, elements: [...elements], currentElement: context?.currentElement, context: nameContext });
        return resolved.status === "resolved" ? resolved.element : undefined;
      })();
      const targetElementId = targetElement?.id ?? reference.elementId;
      const type = isKnownNumericComputedGeometryProperty(reference.property)
        ? { kind: "number" as const }
        : choiceGeometryPropertyTypeFor(targetElement, reference.property);
      if (!type) {
        geometryPropertyReferences.set(node.span.start, null);
        issues.push({ span: node.propertySpan, message: `要素プロパティ「${node.property}」は公開されたgeometry propertyとして使用できません。` });
        return;
      }
      const targetSourceOrder = sourceOrderByElementId.get(targetElementId);
      if (targetSourceOrder === undefined) {
        geometryPropertyReferences.set(node.span.start, null);
        issues.push({ span: node.elementNameSpan, message: `要素「${node.elementName}」のsource orderを解決できません。` });
        return;
      }
      if (context?.currentSourceOrder !== undefined && targetSourceOrder >= context.currentSourceOrder) {
        geometryPropertyReferences.set(node.span.start, null);
        issues.push({ span: node.elementNameSpan, message: `要素「${node.elementName}」はこの式より後、または同じ位置にあるため参照できません。` });
        return;
      }
      geometryPropertyReferences.set(node.span.start, {
        elementId: targetElementId,
        property: reference.property,
        targetSourceOrder,
        type
      });
      return;
    }
    if (node.kind === "unary") { visit(node.operand); return; }
    if (node.kind === "binary") { visit(node.left); visit(node.right); return; }
    if (node.kind === "group") { visit(node.expression); return; }
    if (node.kind === "call") {
      node.args.forEach((argument) => visit(argument.expression));
    }
  };
  visit(expression);
  return { geometryPropertyReferences, issues };
};
