import type { CadElement, ComputedText } from "../types/geometry";
import { getPointAnchorOrError, numericError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { resolveTextReferences } from "./numericExpressions";

export const evaluateTextElement = (
  element: CadElement,
  context: ElementEvaluationContext
) => {
  if (element.type !== "text") return false;

  const fontSize = numericError(
    element,
    element.fontSize,
    context.computedGeometry,
    context.elementsById,
    context.errors,
    context.localVariables.localVariableValues,
    context.localVariables.localVariableNames,
    context.disabledByGroupId,
    context.computedVariables,
    context.elements
  );
  if (fontSize === undefined) return true;

  const text = resolveTextReferences({
    text: element.text,
    computedGeometry: context.computedGeometry,
    elementsById: context.elementsById,
    localVariables: context.localVariables.localVariableValues,
    localVariableNames: context.localVariables.localVariableNames,
    computedVariables: context.computedVariables,
    currentElement: element,
    elements: context.elements
  });
  if (text.error) {
    const disabledGroupId = context.disabledByGroupId?.get(text.error.dependencyId);
    const disabledGroupName = disabledGroupId
      ? context.elementsById.get(disabledGroupId)?.name
      : null;
    context.errors.push({
      elementId: element.id,
      elementName: element.name,
      missingDependencyId: text.error.dependencyId,
      missingDependencyName: text.error.dependencyName,
      message: disabledGroupName
        ? `${element.name} のテキストを評価できません。参照先はグループ ${disabledGroupName} により評価OFFです。${disabledGroupName} を評価ONにするか、テキストを変更してください。`
        : `${element.name} のテキストを評価できません。${text.error.message}`
    });
    return true;
  }

  const anchor = element.anchor
    ? getPointAnchorOrError(
        element,
        element.anchor,
        "anchor",
        context.computedGeometry,
        context.elementsById,
        context.errors,
        context.localVariables.localVariableValues,
        context.localVariables.localVariableNames,
        context.disabledByGroupId,
        context.computedVariables,
        context.elements
      )
    : null;
  if (element.anchor && !anchor) return true;

  const computed: ComputedText = {
    kind: "text",
    elementId: element.id,
    name: element.name,
    text: text.text ?? "",
    anchor: anchor ?? null,
    fontSize
  };
  context.computedGeometry.set(element.id, computed);
  return true;
};
