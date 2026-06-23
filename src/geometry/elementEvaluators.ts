import type { CadElement } from "../types/geometry";
import { evaluateCornerRadiusArcLineElement } from "./cornerRadiusArcEvaluator";
import { evaluateCopyLineElement } from "./copyLineEvaluator";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { evaluateLineElement } from "./lineEvaluators";
import { evaluateModificationElement } from "./modificationEvaluators";
import { evaluateMoveElement } from "./moveEvaluators";
import { evaluateOffsetLineElement } from "./offsetLineEvaluator";
import { evaluatePointElement } from "./pointEvaluators";
import { evaluateSplitLineElement } from "./splitLineEvaluator";
import { evaluateSymmetricCopyLineElement } from "./symmetricCopyLineEvaluator";

export const evaluateElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (evaluatePointElement(element, context)) return;
  if (evaluateCornerRadiusArcLineElement(element, context)) return;
  if (evaluateLineElement(element, context)) return;
  evaluateOffsetLineElement(element, context);
  evaluateSplitLineElement(element, context);
  evaluateCopyLineElement(element, context);
  evaluateSymmetricCopyLineElement(element, context);
  evaluateMoveElement(element, context);
  evaluateModificationElement(element, context);
};
