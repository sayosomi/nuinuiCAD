import { EditorSelection, type ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ElementId } from "../types/geometry";

export type SourceEditorViewportSnapshot = {
  scrollTop: number;
  scrollLeft: number;
  hadFocus: boolean;
  primaryElementId: ElementId | null;
  cursorLine: number;
  cursorColumn: number;
};

export const captureSourceEditorViewport = (
  view: EditorView,
  primaryElementId: ElementId | null
): SourceEditorViewportSnapshot => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return {
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
    hadFocus: view.hasFocus,
    primaryElementId,
    cursorLine: line.number,
    cursorColumn: view.state.selection.main.head - line.from
  };
};

export const selectionAfterModelPatch = (view: EditorView, changes: ChangeSet) => {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1) return null;
  const head = selection.main.head;
  let mappedHead = changes.mapPos(head);
  changes.iterChanges((fromA, toA, fromB, toB) => {
    if (fromA <= head && head <= toA && toA > fromA) {
      mappedHead = fromB + Math.min(head - fromA, toB - fromB);
    }
  });
  return EditorSelection.create([EditorSelection.cursor(mappedHead)]);
};

/** Restore pixels only after CM has measured the replacement document. */
export const restoreSourceEditorViewport = (
  view: EditorView,
  snapshot: Pick<SourceEditorViewportSnapshot, "scrollTop" | "scrollLeft">
) => {
  view.requestMeasure({
    read: () => null,
    write: () => {
      const maxTop = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      const maxLeft = Math.max(0, view.scrollDOM.scrollWidth - view.scrollDOM.clientWidth);
      view.scrollDOM.scrollTop = Math.min(snapshot.scrollTop, maxTop);
      view.scrollDOM.scrollLeft = Math.min(snapshot.scrollLeft, maxLeft);
    }
  });
};

export const cursorAtSnapshotLocation = (view: EditorView, snapshot: SourceEditorViewportSnapshot) => {
  const lineNumber = Math.min(Math.max(snapshot.cursorLine, 1), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  return EditorSelection.cursor(Math.min(line.from + snapshot.cursorColumn, line.to));
};
