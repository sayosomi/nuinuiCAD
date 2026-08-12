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
 * attributes (columns=/rows=/overlap=/scale=/canvas=) and a `place` member.
 * The header site is the printLayout statement itself; a place site is the
 * place statement's own position, so earlier local declarations are visible
 * and later declarations are not.
 */
export const printLayoutTypedBindingSite = (
  layoutId: string | undefined,
  statementInfoByKey: ReadonlyMap<string, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis,
  statementIndex?: number
): BindingReferenceSite | null => {
  const resolvedStatementIndex = statementIndex ?? (layoutId ? statementInfoByKey?.get(`printLayout:${layoutId}`)?.statementIndex : undefined);
  if (resolvedStatementIndex === undefined) return null;
  const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(resolvedStatementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
  return { scopeId, statementIndex: resolvedStatementIndex };
};

/** Visible typed `number` const/let candidates for a printLayout block's
 * numeric fields, as `NumericReferenceOption`s - the shape both the React
 * PrintNumberInput popover and CodeMirror's own `Completion` mapping
 * consume as their input. */
export const printLayoutTypedBindingReferenceOptions = (
  layoutId: string | undefined,
  statementInfoByKey: ReadonlyMap<string, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis | undefined,
  statementIndex?: number
): NumericReferenceOption[] => {
  if (!bindingAnalysis) return [];
  const site = printLayoutTypedBindingSite(layoutId, statementInfoByKey, bindingAnalysis, statementIndex);
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
