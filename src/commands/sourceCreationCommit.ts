import { documentDslRefs } from "../dsl/dslSerializer";
import { layoutElementTree } from "../dsl/dslDocument";
import { buildTextPatch, type LineSplice } from "../document/textPatch";
import { useCadDocumentStore, type DocumentMutationResult } from "../state/cadDocumentStore";
import type { CadElement, ElementId } from "../types/geometry";

export type SourceCreationCommit = {
  result: DocumentMutationResult;
  insertedElementIds: ElementId[];
  selectedElementId: ElementId | null;
};

/**
 * Builds the existing statement-level edits needed to persist direct unnamed
 * source promotion. The creation append is added by the caller so both edits
 * can be submitted through one document mutation boundary.
 */
export const sourceCreationPromotionSplices = ({
  promotedElements,
  promotedElementIds
}: {
  promotedElements: CadElement[];
  promotedElementIds: readonly ElementId[];
}): LineSplice[] | null => {
  if (promotedElementIds.length === 0) return [];
  const document = useCadDocumentStore.getState();
  try {
    return buildTextPatch({
      old: document.doc,
      newDocument: { ...document.doc.document, elements: promotedElements }
    });
  } catch {
    return null;
  }
};

/**
 * Inserts a contiguous newly-created element run at one physical source
 * boundary. Layout comes from the complete post-insertion tree so containers
 * receive their braces && nested template elements retain correct indent.
 */
export const commitSourceCreationInsertion = ({
  elements,
  insertionIndex,
  insertedElements,
  sourceInsertionLine,
  promotedElementIds = [],
  selectedElementOffset = 0
}: {
  elements: CadElement[];
  insertionIndex: number;
  insertedElements: CadElement[];
  sourceInsertionLine: number;
  promotedElementIds?: readonly ElementId[];
  selectedElementOffset?: number;
}): SourceCreationCommit => {
  const document = useCadDocumentStore.getState();
  const allElements = [
    ...elements.slice(0, insertionIndex),
    ...insertedElements,
    ...elements.slice(insertionIndex)
  ];
  const insertedIds = new Set(insertedElements.map((element) => element.id));
  const replacementLines = layoutElementTree(
    allElements,
    documentDslRefs(allElements),
    undefined
  )
    .filter((row) => row.elementId !== undefined && insertedIds.has(row.elementId))
    .flatMap((row) => row.lines);
  const promotionSplices = sourceCreationPromotionSplices({
    promotedElements: elements,
    promotedElementIds
  });
  if (promotionSplices === null) {
    return {
      result: { status: "rejected", reason: "invalid-change" },
      insertedElementIds: [],
      selectedElementId: null
    };
  }
  const result = document.commitLineSplices([
    ...promotionSplices,
    {
      startLine: sourceInsertionLine,
      endLine: sourceInsertionLine - 1,
      replacementLines
    }
  ], { createdElementIds: insertedElements.map((element) => element.id) });
  if (result.status !== "applied") {
    return { result, insertedElementIds: [], selectedElementId: null };
  }

  const committed = useCadDocumentStore.getState().elements.slice(
    insertionIndex,
    insertionIndex + insertedElements.length
  );
  return {
    result,
    insertedElementIds: committed.map((element) => element.id),
    selectedElementId: committed[selectedElementOffset]?.id ?? null
  };
};
