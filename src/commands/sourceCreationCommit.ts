import { documentDslRefs } from "../dsl/dslSerializer";
import { layoutElementTree } from "../dsl/dslDocument";
import { useCadDocumentStore, type DocumentMutationResult } from "../state/cadDocumentStore";
import type { CadElement, ElementId } from "../types/geometry";

export type SourceCreationCommit = {
  result: DocumentMutationResult;
  insertedElementIds: ElementId[];
  selectedElementId: ElementId | null;
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
  selectedElementOffset = 0
}: {
  elements: CadElement[];
  insertionIndex: number;
  insertedElements: CadElement[];
  sourceInsertionLine: number;
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
  const result = document.commitLineSplices([{
    startLine: sourceInsertionLine,
    endLine: sourceInsertionLine - 1,
    replacementLines
  }]);
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
