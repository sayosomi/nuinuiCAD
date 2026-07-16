import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { ElementId } from "../types/geometry";
import { isConditionalGroupElement, isGroupElement, type GroupFoldById } from "../model/groups";
import type { CadElement } from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";

export type FoldTarget = { elementId: ElementId; branch: "group" | "else"; from: number; to: number };

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
    if (!element || !isGroupElement(element)) continue;
    const groupFold = folds.get(elementId);
    if (groupFold?.expanded ?? false) {
      if (isConditionalGroupElement(element) && !(groupFold?.elseExpanded ?? true) && range.elseFoldRange) {
        targets.push({ elementId, branch: "else", ...range.elseFoldRange });
      }
    } else if (range.groupFoldRange) {
      targets.push({ elementId, branch: "group", ...range.groupFoldRange });
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
    if (!element || !isGroupElement(element)) continue;
    if (range.openBraceLineFrom === lineFrom && range.groupFoldRange) {
      return { elementId: element.id, branch: "group", ...range.groupFoldRange };
    }
    if (isConditionalGroupElement(element) && range.elseFoldRange) {
      if (range.elseLineFrom === lineFrom) {
        return { elementId: element.id, branch: "else", ...range.elseFoldRange };
      }
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
