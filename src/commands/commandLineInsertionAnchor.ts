import { descendantIdsForGroup, isGroupElement } from "../model/groups";
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
 * multi-line statements and every child / else branch of a group. Source edits
 * are rejected by the session revision guard before this is used for commit.
 */
export const resolveCommandLineInsertionAnchor = (
  anchor: CommandLineInsertionAnchor,
  elements: CadElement[]
): number | null => {
  if (anchor.kind === "documentEnd") return elements.length;
  const index = elements.findIndex((element) => element.id === anchor.elementId);
  if (index < 0) return null;
  return lastStructuredElementIndex(elements, elements[index], index) + 1;
};
