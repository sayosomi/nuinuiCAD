import type {
  CadElement,
  ComputedGeometry,
  DependencyError,
  ElementId,
  EvaluationWarning
} from "../types/geometry";
import type { GeometryInputTarget } from "../types/geometry";
import type { BindingId } from "@nuinuicad/nui-language";
import type { ScalarEvaluation } from "@nuinuicad/nui-language";
import type { TextTemplateAst } from "@nuinuicad/nui-language";
import type { ComputedGeometryValueEntry } from "./evaluationTypes";
import type { GeometryValueOccurrenceKey } from "@nuinuicad/nui-language";

export type LocalVariableEvaluation = {
  localVariableValues: Map<string, number>;
  localVariableNames: Map<string, string>;
};

export type ElementEvaluationContext = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  resolveGeometrySnapshot?: (
    elementId: ElementId,
    stagePath?: readonly string[]
  ) => ComputedGeometry | undefined;
  computedGeometryValues?: Map<GeometryValueOccurrenceKey, ComputedGeometryValueEntry>;
  geometryInputTargets?: ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>;
  elementsById: Map<ElementId, CadElement>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  disabledByGroupId: Map<ElementId, ElementId>;
  localVariables: LocalVariableEvaluation;
  elements?: CadElement[];
  /**
   * Task 27: this text element's compiled TextTemplateAst, when one exists -
   * set together with `resolveScalarBinding` || not at all. Its presence,
   * not the element's own `text` field, decides whether textEvaluator.ts
   * uses the AST path; a raw element without an AST is literal text.
   * used when present, since a typed string literal's escape processing
   * already unescaped `\{`/`\}` into literal braces before storage, &&
   * re-running the old regex over that cooked string would wrongly
   * reinterpret an escaped brace as a hole.
   */
  textTemplate?: TextTemplateAst;
  resolveScalarBinding?: (bindingId: BindingId) => ScalarEvaluation;
};
