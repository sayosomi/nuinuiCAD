import type {
  CadElement,
  ComputedGeometry,
  ComputedVariable,
  DependencyError,
  ElementId,
  EvaluationWarning
} from "../types/geometry";
import type { LocalVariableEvaluation } from "./evaluationContext";

export type ElementEvaluationContext = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  disabledByGroupId: Map<ElementId, ElementId>;
  localVariables: LocalVariableEvaluation;
  computedVariables?: Map<ElementId, ComputedVariable>;
  elements?: CadElement[];
};
