import type { CadElement, ComputedText } from "../types/geometry";
import { getPointAnchorOrError, numericError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { evaluateElementTextTemplate } from "./textTemplateRuntime";

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
    context.elements
  );
  if (fontSize === undefined) return true;

  // Source-authored nui 1 text interpolation is compiled before evaluation.
  // A raw element without that compiled entry is literal text; it is never
  // interpreted through the removed document-variable expression lane.
  const text = context.textTemplate
    ? evaluateElementTextTemplate(
        context.textTemplate,
        {
          computedGeometry: context.computedGeometry,
          elementsById: context.elementsById,
          localVariables: context.localVariables.localVariableValues,
          localVariableNames: context.localVariables.localVariableNames,
          currentElement: element,
          elements: context.elements
        },
        context.resolveScalarBinding!
      )
    : { text: element.text };
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
