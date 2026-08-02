import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { ElementId } from "../types/geometry";
import { isFoldTargetExpanded, type FoldTargetBranch, type GroupFoldById } from "../model/groups";
import type { CadElement } from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";

export type FoldTarget = {
  elementId: ElementId;
  branch: FoldTargetBranch;
  gutterLineFrom: number;
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

/** This module's final range resolution is deliberately supplied by the controller's current CM doc. */
export const foldProjectionTransaction = (
  state: EditorState,
  desired: readonly FoldTarget[]
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
