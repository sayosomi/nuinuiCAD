import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { ElementId } from "../types/geometry";
import type { StatementRangeIndex } from "./statementRangeIndex";

const setSecondarySelection = StateEffect.define<readonly number[]>();

const secondarySelectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSecondarySelection)) continue;
      const builder = new RangeSetBuilder<Decoration>();
      for (const lineFrom of effect.value) {
        builder.add(lineFrom, lineFrom, Decoration.line({ class: "cm-secondary-selection" }));
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const sourceEditorSelectionExtension: Extension = secondarySelectionField;

export const secondarySelectionEffect = (
  selectedIds: readonly ElementId[],
  primaryId: ElementId | null,
  ranges: StatementRangeIndex
) => {
  const lineStarts = selectedIds
    .filter((id) => id !== primaryId)
    .map((id) => ranges.get(id)?.from)
    .filter((from): from is number => from !== undefined)
    .sort((left, right) => left - right);
  return setSecondarySelection.of(lineStarts);
};
