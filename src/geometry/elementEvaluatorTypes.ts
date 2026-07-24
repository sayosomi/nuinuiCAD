import type {
  CadElement,
  ComputedGeometry,
  ComputedVariable,
  DependencyError,
  ElementId,
  EvaluationWarning
} from "../types/geometry";
import type { LocalVariableEvaluation } from "./evaluationContext";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarEvaluation } from "../scalars/types";
import type { TextTemplateAst } from "../scalars/textTemplate";

export type ElementEvaluationContext = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  disabledByGroupId: Map<ElementId, ElementId>;
  localVariables: LocalVariableEvaluation;
  computedVariables?: Map<ElementId, ComputedVariable>;
  elements?: CadElement[];
  /**
   * Task 27: this text element's compiled TextTemplateAst, when one exists -
   * set together with `resolveScalarBinding` or not at all. Its presence,
   * not the element's own `text` field, decides whether textEvaluator.ts
   * uses the AST path or the legacy regex path - a compiled AST is always
   * used when present, since a typed string literal's escape processing
   * already unescaped `\{`/`\}` into literal braces before storage, and
   * re-running the old regex over that cooked string would wrongly
   * reinterpret an escaped brace as a hole.
   */
  textTemplate?: TextTemplateAst;
  resolveScalarBinding?: (bindingId: BindingId) => ScalarEvaluation;
};
