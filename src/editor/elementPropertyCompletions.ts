import type { Completion } from "@codemirror/autocomplete";
import { dslElementParameterCompletionOptions } from "../dsl/dslElementParameterCompletionCandidates";
import type { DslLiveStatementIdentity } from "../dsl/dslCompletionCandidates";
import type { CadElement, ComputedGeometry, DependencyError, ElementId } from "../types/geometry";

/** Editor adapter shared by numeric and typed expression property completion. */
export const elementPropertyCompletions = ({
  source,
  cursorLine,
  statementElementIds,
  elements,
  elementToken,
  computedGeometry,
  effectiveEnabledElementIds,
  errors,
  evaluationIsCurrent
}: {
  source: string;
  cursorLine: number;
  statementElementIds: DslLiveStatementIdentity;
  elements: readonly CadElement[];
  elementToken: string;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  effectiveEnabledElementIds?: Set<ElementId>;
  errors: DependencyError[];
  evaluationIsCurrent: boolean;
}): Completion[] => {
  if (!evaluationIsCurrent) return [];
  return dslElementParameterCompletionOptions({
    source,
    cursorLine,
    statementElementIds,
    elements,
    elementToken,
    computedGeometry,
    effectiveEnabledElementIds,
    errors
  }).map((option) => ({ label: option.label, apply: option.path, detail: option.detail, type: "constant" }));
};
