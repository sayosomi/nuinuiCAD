import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit,
  creationPlacementForTarget
} from "../model/elementCreationPlacement";
import { createCadElement } from "../model/elementFactory";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElementType } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import { focusCanvasAfterCreation } from "./postCreationFocus";
import { commitSourceCreationInsertion } from "./sourceCreationCommit";
import {
  resolveSourceCreationInsertion,
  sourceCreationInsertionUnsafeError
} from "./sourceCreationInsertion";

type ContainerType = Extract<CadElementType, "group" | "conditionalGroup" | "forGroup">;

const sourceCommitError = "現在のDSLテキストにはこの操作を適用できません。";

/** Creates an empty container at the current Source Editor insertion point when available. */
export const addContainer = (type: ContainerType, context?: CommandContext) => {
  const document = useCadDocumentStore.getState();
  const sourceResolution = resolveSourceCreationInsertion({
    cursor: context?.currentSourceCursor?.() ?? null,
    sourceRevision: document.sourceRevision,
    elements: document.elements,
    statementMap: document.doc.statementMap
  });
  if (sourceResolution.kind === "unsafe") {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return { status: "rejected" as const, reason: "invalid-change" as const };
  }
  const sourceInsertion = sourceResolution.kind === "safe" ? sourceResolution.insertion : null;
  const placement = sourceInsertion
    ? creationPlacementForTarget(document.elements, sourceInsertion.insertionTarget, document.evaluationLimitIndex)
    : creationPlacementForEvaluationLimit(document.elements, document.evaluationLimitIndex);
  const group = applyCreationPlacement(createCadElement(type, document.elements), placement);

  if (sourceInsertion) {
    const sourceCommit = commitSourceCreationInsertion({
      elements: document.elements,
      insertionIndex: placement.insertionIndex,
      insertedElements: [group],
      sourceInsertionLine: sourceInsertion.sourceInsertionLine
    });
    if (sourceCommit.result.status !== "applied" || !sourceCommit.selectedElementId) {
      useCadUiStore.getState().setCommandErrorMessage(sourceCommitError);
      return sourceCommit.result;
    }
    useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, {
      selectedElementId: sourceCommit.selectedElementId,
      selectedElementIds: sourceCommit.insertedElementIds,
      selectionAnchorElementId: sourceCommit.selectedElementId
    });
  } else {
    const result = commitDocumentChangeAndSelect({
      elements: [
        ...document.elements.slice(0, placement.insertionIndex),
        group,
        ...document.elements.slice(placement.insertionIndex)
      ],
      evaluationLimitIndex: adjustEvaluationLimitForInsertion({
        elements: document.elements,
        evaluationLimitIndex: document.evaluationLimitIndex,
        insertionIndex: placement.insertionIndex,
        insertedCount: 1
      })
    }, {
      selectedElementId: group.id,
      selectedElementIds: [group.id],
      selectionAnchorElementId: group.id
    });
    if (result.status !== "applied") return result;
  }

  useCadUiStore.getState().setCommandErrorMessage(null);
  focusCanvasAfterCreation(context);
  return { status: "applied" as const };
};
