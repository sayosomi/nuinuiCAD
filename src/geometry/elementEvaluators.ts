import type { CadElement } from "../types/geometry";
import { evaluateCornerRadiusArcLineElement } from "./cornerRadiusArcEvaluator";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { evaluateLineElement } from "./lineEvaluators";
import { evaluateOffsetLineElement } from "./offsetLineEvaluator";
import { evaluatePointElement } from "./pointEvaluators";

export const evaluateElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (evaluatePointElement(element, context)) return;
  if (evaluateCornerRadiusArcLineElement(element, context)) return;
  if (evaluateLineElement(element, context)) return;
  evaluateOffsetLineElement(element, context);
};
