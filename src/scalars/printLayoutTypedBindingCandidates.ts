// Task 53: the shared low-level owner for "which typed number const/let
// bindings are visible to this printLayout block's numeric fields" -
// consumed by both PrintLayoutView's own React popover
// (src/components/PrintLayoutView.tsx) and CodeMirror's printLayoutBlock
// completion (src/editor/cmAutocomplete.ts), so the two surfaces can never
// silently drift apart on scope/visibility rules.
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingReferenceSite } from "./bindingResolution";
import { typedBindingReferenceCandidates } from "./typedValueCandidates";
import type { StatementInfo } from "../dsl/dslDocument";
import type { NumericReferenceOption } from "../geometry/numericReferenceOptions";

/**
 * Resolves the BindingReferenceSite shared by a printLayout block's header
 * attributes (columns=/rows=/overlap=/scale=/canvas=) and every one of its
 * `place` members' at=/angle=. printLayout has no lexical scope of its own
 * (lexicalScopeIndex.ts transparently delegates it to the parent/root
 * scope), so a single site - keyed by the block's own `printLayout:<id>`
 * StatementMap entry - is correct for every field in the block; there is no
 * need to resolve each `place` statement's own (later) statementIndex
 * separately here the way numericBindingCompiler.ts does for compile-time
 * diagnostics.
 */
export const printLayoutTypedBindingSite = (
  layoutId: string | undefined,
  statementInfoByKey: ReadonlyMap<string, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis
): BindingReferenceSite | null => {
  const statementIndex = layoutId ? statementInfoByKey?.get(`printLayout:${layoutId}`)?.statementIndex : undefined;
  if (statementIndex === undefined) return null;
  const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
  return { scopeId, statementIndex };
};

/** Visible typed `number` const/let candidates for a printLayout block's
 * numeric fields, as `NumericReferenceOption`s - the shape both the React
 * PrintNumberInput popover and CodeMirror's own `Completion` mapping
 * consume as their input. */
export const printLayoutTypedBindingReferenceOptions = (
  layoutId: string | undefined,
  statementInfoByKey: ReadonlyMap<string, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis | undefined
): NumericReferenceOption[] => {
  if (!bindingAnalysis) return [];
  const site = printLayoutTypedBindingSite(layoutId, statementInfoByKey, bindingAnalysis);
  if (!site) return [];
  return typedBindingReferenceCandidates({
    catalog: bindingAnalysis.catalog,
    entriesById: bindingAnalysis.entriesById,
    site,
    accepts: (type) => type?.kind === "number"
  }).map((candidate) => ({
    expression: `@${candidate.name}`,
    displayExpression: `@${candidate.name}`,
    label: `@${candidate.name}`,
    detail: "型付き変数",
    source: "typed" as const
  }));
};
