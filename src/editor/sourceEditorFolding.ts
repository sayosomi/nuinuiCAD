import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { ElementId } from "../types/geometry";
import { isFoldTargetExpanded, type FoldTargetBranch, type GroupFoldById } from "@nuinuicad/nui-language";
import type { CadElement } from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";
import type { ModuleSemanticRangeIndex, ModuleDefinitionFoldRange } from "@nuinuicad/nui-language";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";
import { queryDslFolding, type CompiledDslDocument } from "@nuinuicad/nui-language";

export type ExpressionFoldTarget = { statementId: StatementIdentity; lineFrom: number; from: number; to: number };

/** Project canonical language folds into CM coordinates; source-only collapse
 * state uses reconciled statement identities, just like Module folds. */
export const createExpressionFoldTargets = (
  doc: EditorState["doc"],
  compiled: CompiledDslDocument
): Map<StatementIdentity, ExpressionFoldTarget> => {
  const sourceMap = compiled.spans.sourceMap;
  const ranges = queryDslFolding({
    source: { normalizedSource: doc.toString(), sourceRevision: sourceMap.sourceRevision },
    statements: compiled.statements,
    sourceMap
  });
  const targets = new Map<StatementIdentity, ExpressionFoldTarget>();
  for (const [index, statement] of compiled.statements.entries()) {
    if (statement.kind !== "typedDeclaration" && statement.kind !== "next") continue;
    const range = ranges.find(range => range.kind === "syntax" && range.startLine === statement.line && range.endLine === statement.endLine);
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(index);
    if (!range || !statementId) continue;
    targets.set(statementId, { statementId, lineFrom: doc.line(range.startLine).from, from: doc.line(range.startLine).to, to: doc.line(range.endLine).to });
  }
  return targets;
};

export type FoldTarget = {
  elementId: ElementId;
  branch: FoldTargetBranch;
  gutterLineFrom: number;
  from: number;
  to: number;
};

export type ModuleDefinitionFoldTarget = Omit<ModuleDefinitionFoldRange, "foldFrom" | "foldTo"> & {
  kind: "moduleDefinition";
  from: number;
  to: number;
};

const elementById = (elements: readonly CadElement[]) => new Map(elements.map((element) => [element.id, element]));

export const foldTargets = (
  ranges: StatementRangeIndex,
  elements: readonly CadElement[],
  folds: GroupFoldById
): FoldTarget[] => {
  const byId = elementById(elements);
  const targets: FoldTarget[] = [];
  for (const [elementId, range] of ranges) {
    const element = byId.get(elementId);
    if (!element) continue;
    for (const target of range.foldTargets) {
      if (!isFoldTargetExpanded(target, folds)) {
        targets.push({
          elementId,
          branch: target.branch,
          gutterLineFrom: target.gutterLineFrom,
          from: target.foldFrom,
          to: target.foldTo
        });
      }
    }
  }
  return targets;
};

export const foldTargetAtLine = (
  ranges: StatementRangeIndex,
  elements: readonly CadElement[],
  lineFrom: number
): FoldTarget | null => {
  const byId = elementById(elements);
  for (const range of ranges.values()) {
    const element = byId.get(range.elementId);
    if (!element) continue;
    const target = range.foldTargets.find((candidate) => candidate.gutterLineFrom === lineFrom);
    if (target) {
      return {
        elementId: element.id,
        branch: target.branch,
        gutterLineFrom: target.gutterLineFrom,
        from: target.foldFrom,
        to: target.foldTo
      };
    }
  }
  return null;
};

/**
 * Finds a currently collapsed fold from either of its visible structural rows.
 * CodeMirror hides the text strictly between those rows, so Option+Up/Down on
 * either row must operate on the owning element rather than on a lone brace.
 */
export const collapsedFoldTargetAtLine = (
  ranges: StatementRangeIndex,
  elements: readonly CadElement[],
  folds: GroupFoldById,
  lineFrom: number
): FoldTarget | null => {
  const byId = elementById(elements);
  for (const range of ranges.values()) {
    const element = byId.get(range.elementId);
    if (!element) continue;
    for (const target of range.foldTargets) {
      if (isFoldTargetExpanded(target, folds)) continue;
      const terminalLineFrom = target.anchors.at(-1)?.from;
      if (target.gutterLineFrom !== lineFrom && terminalLineFrom !== lineFrom) continue;
      return {
        elementId: element.id,
        branch: target.branch,
        gutterLineFrom: target.gutterLineFrom,
        from: target.foldFrom,
        to: target.foldTo
      };
    }
  }
  return null;
};

const moduleDefinitionFoldTarget = (range: ModuleDefinitionFoldRange): ModuleDefinitionFoldTarget => ({
  kind: "moduleDefinition",
  statementId: range.statementId,
  branch: range.branch,
  gutterLineFrom: range.gutterLineFrom,
  from: range.foldFrom,
  to: range.foldTo,
  anchors: range.anchors
});

export const moduleDefinitionFoldTargets = (
  ranges: ModuleSemanticRangeIndex,
  collapsedStatementIds: ReadonlySet<StatementIdentity>,
  collapsedParameterStatementIds: ReadonlySet<StatementIdentity> = new Set()
): ModuleDefinitionFoldTarget[] => [
  ...[...(ranges.moduleDefinitionFoldRanges ?? [])]
    .filter(([statementId]) => collapsedStatementIds.has(statementId))
    .map(([, range]) => moduleDefinitionFoldTarget(range)),
  ...[...(ranges.moduleDefinitionParameterFoldRanges ?? [])]
    .filter(([statementId]) => collapsedParameterStatementIds.has(statementId))
    .map(([, range]) => moduleDefinitionFoldTarget(range))
];

export const moduleDefinitionFoldTargetAtLine = (
  ranges: ModuleSemanticRangeIndex,
  lineFrom: number
): ModuleDefinitionFoldTarget | null => {
  for (const range of ranges.moduleDefinitionFoldRanges?.values() ?? []) {
    if (range.gutterLineFrom === lineFrom) return moduleDefinitionFoldTarget(range);
  }
  for (const range of ranges.moduleDefinitionParameterFoldRanges?.values() ?? []) {
    if (range.gutterLineFrom === lineFrom) return moduleDefinitionFoldTarget(range);
  }
  return null;
};

/** This module's final range resolution is deliberately supplied by the controller's current CM doc. */
export const foldProjectionTransaction = (
  state: EditorState,
  desired: readonly { from: number; to: number }[]
): TransactionSpec | null => {
  const existing: { from: number; to: number }[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    existing.push({ from, to });
  });
  const normalizedDesired = desired.filter((range) => range.to > range.from);
  const same = existing.length === normalizedDesired.length && existing.every((range, index) =>
    range.from === normalizedDesired[index].from && range.to === normalizedDesired[index].to
  );
  if (same) return null;
  return {
    effects: [
      ...existing.map((range) => unfoldEffect.of(range)),
      ...normalizedDesired.map((range) => foldEffect.of(range))
    ]
  };
};
