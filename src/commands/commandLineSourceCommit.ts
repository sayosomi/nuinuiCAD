import { serializedStatementLines, documentDslRefs } from "../dsl/dslSerializer";
import { serializeElementStatementBlock } from "../dsl/dslSerializeElement";
import { DSL_INDENT } from "../dsl/dslTokens";
import { isGroupElement } from "../model/groups";
import { useCadDocumentStore, type DocumentMutationResult } from "../state/cadDocumentStore";
import type { CadElement, ElementId } from "../types/geometry";

const parentDepthFor = (element: CadElement, elements: readonly CadElement[]) => {
  const byId = new Map(elements.map((item) => [item.id, item]));
  let depth = 0;
  let parentId = element.parentGroupId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || !isGroupElement(parent)) break;
    depth += 1;
    parentId = parent.parentGroupId;
  }
  return depth;
};

/** Applies one new declaration at the session's exact physical source boundary. */
export const commitCommandLineSourceInsertion = ({
  element,
  elements,
  insertionIndex,
  sourceInsertionLine
}: {
  element: CadElement;
  elements: CadElement[];
  insertionIndex: number;
  sourceInsertionLine: number;
}): { result: DocumentMutationResult; elementId: ElementId | null } => {
  const document = useCadDocumentStore.getState();
  const allElements = [
    ...elements.slice(0, insertionIndex),
    element,
    ...elements.slice(insertionIndex)
  ];
  const lines = serializedStatementLines(
    serializeElementStatementBlock(element, documentDslRefs(allElements, document.doc.majorVersion)),
    DSL_INDENT.repeat(parentDepthFor(element, elements))
  );
  const result = document.commitLineSplices([{
    startLine: sourceInsertionLine,
    endLine: sourceInsertionLine - 1,
    replacementLines: lines
  }]);
  const committed = useCadDocumentStore.getState().elements[insertionIndex];
  return {
    result,
    elementId: result.status === "applied" && committed?.name === element.name ? committed.id : null
  };
};
