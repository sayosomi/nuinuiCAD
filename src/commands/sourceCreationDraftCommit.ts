import { documentDslRefs, serializedStatementLines } from "../dsl/dslSerializer";
import { serializeElementStatementBlockWithBlanks } from "../dsl/dslSerializeElement";
import { DSL_INDENT } from "../dsl/dslTokens";
import { useCadDocumentStore, type DocumentMutationResult } from "../state/cadDocumentStore";
import type { CadElement, ElementId } from "../types/geometry";
import { sourceCreationPromotionSplices } from "./sourceCreationCommit";

export type SourceCreationDraftCommit = {
  result: DocumentMutationResult;
  insertedLineCount: number;
};

/** One level per enclosing group/if/for ancestor, matching layoutElementTree's
 * stack.length for the contiguous, non-fallback placement command-line
 * creation always produces. */
const containerNestingDepth = (elements: readonly CadElement[], parentGroupId: ElementId | undefined): number => {
  if (!parentGroupId) return 0;
  const elementById = new Map(elements.map((element) => [element.id, element]));
  let depth = 0;
  let current: ElementId | undefined = parentGroupId;
  while (current) {
    depth += 1;
    current = elementById.get(current)?.parentGroupId;
  }
  return depth;
};

/**
 * Inserts an intentionally incomplete creation-recipe draft as literal DSL
 * text at one physical source boundary. Unlike commitSourceCreationInsertion,
 * this never routes a blank recipe step's field through the normal
 * element serializer - see serializeElementStatementBlockWithBlanks.
 */
export const commitSourceCreationDraftInsertion = ({
  elements,
  sourceInsertionLine,
  element,
  blankParameterKeys,
  parentGroupId,
  promotedElementIds = []
}: {
  elements: CadElement[];
  sourceInsertionLine: number;
  element: CadElement;
  blankParameterKeys: ReadonlySet<string>;
  parentGroupId?: ElementId;
  promotedElementIds?: readonly ElementId[];
}): SourceCreationDraftCommit => {
  const refs = documentDslRefs(elements);
  const statement = serializeElementStatementBlockWithBlanks(element, refs, blankParameterKeys);
  const depth = containerNestingDepth(elements, parentGroupId);
  const replacementLines = serializedStatementLines(statement, DSL_INDENT.repeat(depth));
  const promotionSplices = sourceCreationPromotionSplices({
    promotedElements: elements,
    promotedElementIds
  });
  if (promotionSplices === null) {
    return { result: { status: "rejected", reason: "invalid-change" }, insertedLineCount: 0 };
  }
  const result = useCadDocumentStore.getState().commitLineSplices([
    ...promotionSplices,
    {
      startLine: sourceInsertionLine,
      endLine: sourceInsertionLine - 1,
      replacementLines
    }
  ]);
  return { result, insertedLineCount: replacementLines.length };
};
