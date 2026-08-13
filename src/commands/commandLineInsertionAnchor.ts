import { descendantIdsForGroup, isGroupElement } from "../model/groups";
import type { ElementCreationTarget } from "../model/elementCreationPlacement";
import type { CadElement, ElementId } from "../types/geometry";

/**
 * A stable semantic insertion target for a command-line creation session.
 *
 * The session also caches an index for its live preview, but final creation
 * must resolve this anchor again after the source-revision stale guard passes.
 */
export type CommandLineInsertionAnchor =
  | { kind: "afterElement"; elementId: ElementId }
  | { kind: "documentEnd" };

export const insertionAnchorForCommandLineCreation = (
  cursorElementId: ElementId | null | undefined
): CommandLineInsertionAnchor => (
  cursorElementId ? { kind: "afterElement", elementId: cursorElementId } : { kind: "documentEnd" }
);

const lastStructuredElementIndex = (elements: CadElement[], element: CadElement, index: number) => {
  if (!isGroupElement(element)) return index;
  const memberIds = new Set([element.id, ...descendantIdsForGroup(elements, element.id)]);
  for (let candidate = elements.length - 1; candidate > index; candidate -= 1) {
    if (memberIds.has(elements[candidate].id)) return candidate;
  }
  return index;
};

/**
 * Resolves "after element" after its complete serialized structure, including
 * multi-line statements && every child / else branch of a group. Source edits
 * are rejected by the session revision guard before this is used for commit.
 */
export const resolveCommandLineInsertionAnchor = (
  anchor: CommandLineInsertionAnchor,
  elements: CadElement[]
): ElementCreationTarget | null => {
  if (anchor.kind === "documentEnd") return { insertionIndex: elements.length };
  const index = elements.findIndex((element) => element.id === anchor.elementId);
  if (index < 0) return null;
  const element = elements[index];
  return {
    insertionIndex: lastStructuredElementIndex(elements, element, index) + 1,
    ...(element.parentGroupId ? { parentGroupId: element.parentGroupId } : {}),
    ...(element.conditionalBranch ? { conditionalBranch: element.conditionalBranch } : {})
  };
};
