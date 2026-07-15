import type { DslDocumentData } from "../dsl/dslDocument";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore, type CadElementSelection } from "../state/cadUiStore";

/**
 * Applies a command's intended selection only after its document commit has
 * compiled and the document-store reconciliation subscriber has run.
 */
export const commitDocumentChangeAndSelect = (
  change: Partial<DslDocumentData>,
  selection: Partial<CadElementSelection>
) => {
  const result = useCadDocumentStore.getState().commitDocumentChange(change);
  if (result.status !== "rejected") {
    const ui = useCadUiStore.getState();
    ui.applySelection(useCadDocumentStore.getState().elements, {
      selectedElementId: selection.selectedElementId ?? ui.selectedElementId,
      selectedElementIds: selection.selectedElementIds ?? ui.selectedElementIds,
      selectionAnchorElementId: selection.selectionAnchorElementId ?? ui.selectionAnchorElementId
    });
  }
  return result;
};
