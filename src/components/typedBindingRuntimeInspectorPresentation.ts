// Task 45: read-only Inspector "実行時値" section for a selected typed
// const/let binding. This module reads only already-computed production
// output - EvaluationResult.computedScalarBindings/computedScalarBindingVersions
// (Tasks 20/21/31/32/33/34/35) && the compiled analysis maps already on
// CompiledDslDocument (propertyBindings/conditionalGroupConditions/textTemplates,
// Tasks 22/25/26) - && never recomputes a scalar program, mutation, ||
// property/condition/template resolution itself. See
// docs/typed-variables/tasks/45-inspector-runtime-values.md.
//
// Consumer rows are extracted directly against the selected bindingId by
// scanning the compiled analysis maps (bounded by how many properties/
// conditions/templates exist in the whole document, never by element count)
// - this deliberately does not call the elements-iterating production entry
// builders (buildPropertyBindingRuntimeEntries && siblings in
// src/geometry/), which exist to materialize every bound property for the
// evaluation loop && would be a full-document scan for a single-binding
// Inspector lookup, unrelated to the current selection.

import type { CompiledDslDocument, StatementMap } from "../dsl/dslDocument";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { BindingId } from "../scalars/bindingCatalog";
import type { BindingVersionGraph } from "../scalars/bindingVersions";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { runtimeIssueMessage } from "../scalars/runtimeIssueMessages";
import type { TextTemplateAst, TextTemplateDependency } from "../scalars/textTemplate";
import { referencesIn } from "../scalars/typedDependencyGraph";
import type { ScalarValue } from "../scalars/types";
import { textNumber } from "../geometry/numericExpressions";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { displayInspectorValue } from "./inspectorPresentation";

/**
 * "poisoned" means the binding's current final ScalarEvaluation is a runtime
 * error (D02: "評価失敗versionはbindingをpoisonする") - any issueCode, not only
 * the literal `"poisoned-binding"` code, which linearMutationEvaluator.ts's
 * poisoned() helper only attaches when a version's *initial* compile-time
 * state was already poisoned || it has no initializer at all. An ordinary
 * runtime failure (divide-by-zero, an unavailable external binding, a cycle
 * guard, ...) is exactly as poisoned in this document's sense - Task 30's
 * BindingVersionRuntimeHistory.status already generalizes this the same way
 * (`"poisoned"` whenever `evaluation.status === "error"`, regardless of
 * issueCode), so this presentation follows the same rule for the final value.
 */
export type TypedBindingRuntimeStatus = "ok" | "poisoned" | "unknown";

export type TypedBindingRuntimeInspectorRow = { key: string; label: string; value: string };

/** Where a consumer row jumps: an exact Task 43 span when one exists for this
 * consumer kind, otherwise a whole-element jump (conditionalGroup.condition
 * has no Task 43 span index of its own). */
export type TypedBindingRuntimeConsumerJump =
  | { kind: "property"; occurrenceKey: string }
  | { kind: "templateHole"; occurrenceKey: string; holeIndex: number }
  | { kind: "element" };

export type TypedBindingRuntimeConsumerRow = {
  key: string;
  elementId: ElementId;
  label: string;
  detail: string;
  jump: TypedBindingRuntimeConsumerJump;
};

export type TypedBindingRuntimeInspectorPresentation = {
  bindingId: BindingId;
  status: TypedBindingRuntimeStatus;
  rows: readonly TypedBindingRuntimeInspectorRow[];
  invalidMessage: string | null;
  consumerRows: readonly TypedBindingRuntimeConsumerRow[];
};

/** The subset of a CompiledDslDocument this module needs, plus the live
 * element list - never the whole store/document object. */
export type TypedBindingRuntimeConsumerSources = {
  propertyBindings: CompiledDslDocument["propertyBindings"];
  conditionalGroupConditions: CompiledDslDocument["conditionalGroupConditions"];
  textTemplates: CompiledDslDocument["textTemplates"];
  statementMap: StatementMap;
  elements: readonly CadElement[];
};

// Task 48: moved to scalars/runtimeIssueMessages.ts so the gutter/Problems
// runtime diagnostic converter shares this exact table - never a second copy.

/** number uses the same formatting rule text templates already use for
 * numeric holes (textNumber) so the Inspector never invents a second number
 * format; boolean/string reuse the existing literal-Inspector formatter. */
const formatScalarValue = (value: ScalarValue): string => {
  switch (value.kind) {
    case "number":
      return textNumber(value.value);
    case "string":
      return displayInspectorValue(value.value);
    case "boolean":
      return displayInspectorValue(value.value);
    case "choice":
      return value.value;
  }
};

/** Only the selected binding's own static version chain (bounded by how many
 * `set` statements target this one binding, never the whole document's
 * version history) - a short reduced summary, never a per-version list. */
const buildHistorySummaryRow = (
  bindingVersions: BindingVersionGraph | undefined,
  computedScalarBindingVersions: EvaluationResult["computedScalarBindingVersions"],
  bindingId: BindingId,
  finalIsPoisoned: boolean
): TypedBindingRuntimeInspectorRow | null => {
  const versionIds = bindingVersions?.versionIdsByBindingId.get(bindingId);
  if (!versionIds) return null;
  const setVersionIds = versionIds.filter((id) => bindingVersions!.versionsById.get(id)?.kind === "set");
  if (setVersionIds.length === 0) return null;

  const everPoisoned = versionIds.some((id) => computedScalarBindingVersions?.get(id)?.status === "poisoned");
  const summary = finalIsPoisoned
    ? `set ${setVersionIds.length}件・現在無効(poisoned)`
    : everPoisoned
      ? `set ${setVersionIds.length}件・一時無効化後に回復`
      : `set ${setVersionIds.length}件・すべて成功`;

  return { key: "history", label: "set履歴", value: summary };
};

/** The hole segment's position among ast.segments' hole-kind entries (all
 * hole kinds counted, in source order) - matches Task 43's
 * TemplateHoleRangeIndex holeIndex numbering exactly, so no new indexing
 * scheme is introduced. TextTemplateDependency only carries the hole's span,
 * not its index, so this is resolved once per matched dependency. */
const holeIndexForDependency = (ast: TextTemplateAst, dependency: TextTemplateDependency): number | null => {
  let index = 0;
  for (const segment of ast.segments) {
    if (segment.kind !== "hole") continue;
    if (segment.span.start === dependency.holeSpan.start && segment.span.end === dependency.holeSpan.end) return index;
    index += 1;
  }
  return null;
};

const consumerElement = (
  sources: TypedBindingRuntimeConsumerSources,
  elementsById: ReadonlyMap<ElementId, CadElement>,
  statementIndex: number
): CadElement | undefined => {
  const elementId = sources.statementMap.elementIdByStatementIndex.get(statementIndex);
  return elementId ? elementsById.get(elementId) : undefined;
};

const typedBindingConsumerRows = (
  sources: TypedBindingRuntimeConsumerSources,
  bindingId: BindingId
): TypedBindingRuntimeConsumerRow[] => {
  const rows: TypedBindingRuntimeConsumerRow[] = [];
  const elementsById = new Map(sources.elements.map((element) => [element.id, element]));

  // All seven opt-in single-`@name` properties (offsetLine.side/closed/
  // suppressTrimWarnings, intersectionPoint.useExtensions, copyLine/move/
  // image.mirrorX, group.printEnabled, forGroup.showGenerated, text.text bare
  // binding) live in this one compiled map (Task 22's compilePropertyBindings
  // opts them all in generically) - one scan covers every one of them.
  if (sources.propertyBindings) {
    for (const [occurrenceKey, source] of sources.propertyBindings) {
      if (source.kind !== "binding" || source.bindingId !== bindingId) continue;
      const parsed = parsePropertyBindingOccurrenceKey(occurrenceKey);
      if (!parsed) continue;
      const element = consumerElement(sources, elementsById, parsed.statementIndex);
      if (!element) continue;
      const label = getParameterDefinitions(element).find((definition) => definition.key === parsed.parameterKey)?.label ?? parsed.parameterKey;
      rows.push({
        key: `property:${occurrenceKey}`,
        elementId: element.id,
        label: element.name || elementTypeLabels[element.type],
        detail: `${elementTypeLabels[element.type]}・${label}`,
        jump: { kind: "property", occurrenceKey }
      });
    }
  }

  // conditionalGroup.condition is a whole expression, not a single `@name` -
  // no Task 43 span index exists for it, so its row falls back to a
  // whole-element jump.
  if (sources.conditionalGroupConditions) {
    for (const [occurrenceKey, expression] of sources.conditionalGroupConditions) {
      if (!referencesIn(expression).some((reference) => reference.bindingId === bindingId)) continue;
      const parsed = parsePropertyBindingOccurrenceKey(occurrenceKey);
      if (!parsed) continue;
      const element = consumerElement(sources, elementsById, parsed.statementIndex);
      if (!element) continue;
      rows.push({
        key: `condition:${occurrenceKey}`,
        elementId: element.id,
        label: element.name || elementTypeLabels[element.type],
        detail: `${elementTypeLabels[element.type]}・条件式`,
        jump: { kind: "element" }
      });
    }
  }

  if (sources.textTemplates) {
    for (const [occurrenceKey, ast] of sources.textTemplates) {
      const matches = ast.dependencies.filter((dependency) => dependency.bindingId === bindingId);
      if (matches.length === 0) continue;
      const parsed = parsePropertyBindingOccurrenceKey(occurrenceKey);
      if (!parsed) continue;
      const element = consumerElement(sources, elementsById, parsed.statementIndex);
      if (!element) continue;
      for (const dependency of matches) {
        const holeIndex = holeIndexForDependency(ast, dependency);
        rows.push({
          key: `template:${occurrenceKey}:${dependency.span.start}`,
          elementId: element.id,
          label: element.name,
          detail: `${elementTypeLabels[element.type]}・テキスト内 \${@${dependency.name}}`,
          jump: holeIndex === null ? { kind: "element" } : { kind: "templateHole", occurrenceKey, holeIndex }
        });
      }
    }
  }

  return rows;
};

/**
 * Projects one selected typed binding's runtime state into a small read-only
 * row set. Returns null under the same guard as Task 42's declaration
 * presentation (the binding must currently resolve to a typed const/let
 * declaration) - callers treat null the same as "nothing selected".
 *
 * `isFresh` must be false whenever the caller cannot currently prove the
 * compiled document/evaluation pairing is fresh for the live source (see
 * runtimeBindingFreshness.ts) - the function then returns an explicit
 * "unknown" status instead of the last computed value, never a stale one.
 */
export const typedBindingRuntimeInspectorPresentation = (
  bindingAnalysis: BindingAnalysis,
  bindingVersions: BindingVersionGraph | undefined,
  evaluation: Pick<EvaluationResult, "computedScalarBindings" | "computedScalarBindingVersions">,
  consumers: TypedBindingRuntimeConsumerSources,
  bindingId: BindingId,
  isFresh: boolean
): TypedBindingRuntimeInspectorPresentation | null => {
  const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
  if (!binding || binding.kind !== "typed" || (binding.mutability !== "const" && binding.mutability !== "let")) {
    return null;
  }

  if (!isFresh) {
    return {
      bindingId,
      status: "unknown",
      rows: [{ key: "value", label: "最終値", value: "不明(評価待ち)" }],
      invalidMessage: null,
      consumerRows: []
    };
  }

  const scalarEvaluation = evaluation.computedScalarBindings?.get(bindingId);
  const rows: TypedBindingRuntimeInspectorRow[] = [];
  let status: TypedBindingRuntimeStatus;
  let invalidMessage: string | null = null;

  if (!scalarEvaluation) {
    status = "unknown";
    rows.push({ key: "value", label: "最終値", value: "不明(この評価には含まれていません)" });
  } else if (scalarEvaluation.status === "ok") {
    status = "ok";
    rows.push({ key: "value", label: "最終値", value: formatScalarValue(scalarEvaluation.value) });
  } else {
    status = "poisoned";
    invalidMessage = runtimeIssueMessage(scalarEvaluation.issueCode);
    rows.push({ key: "value", label: "最終値", value: "無効(poisoned)" });
  }

  const historyRow = buildHistorySummaryRow(bindingVersions, evaluation.computedScalarBindingVersions, bindingId, status === "poisoned");
  if (historyRow) rows.push(historyRow);

  return {
    bindingId,
    status,
    rows,
    invalidMessage,
    consumerRows: typedBindingConsumerRows(consumers, bindingId)
  };
};
