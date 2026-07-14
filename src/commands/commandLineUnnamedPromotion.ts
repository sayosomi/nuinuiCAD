import { extractNumericExpressionReferences } from "../geometry/numericExpressions";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { anchorReferenceElementId } from "../model/pointAnchors";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import type { CreationArgumentValue } from "./creationRecipes";
import type { CommandLineSession } from "./commandLineSession";

const numericReferenceIds = (value: NumericValue) =>
  extractNumericExpressionReferences(value).map((reference) => reference.elementId);

const pointReferenceIds = (anchor: PointAnchor) => {
  const anchorId = anchorReferenceElementId(anchor);
  if (anchorId) return [anchorId];
  return anchor.mode === "coordinate"
    ? [...numericReferenceIds(anchor.x), ...numericReferenceIds(anchor.y)]
    : [];
};

const referenceIdsForStepValue = (
  kind: "point" | "endpoint" | "line" | "lineList" | "number",
  value: CreationArgumentValue | undefined
): ElementId[] => {
  if (value === undefined) return [];
  if (kind === "point") return pointReferenceIds(value as PointAnchor);
  if (kind === "endpoint") return [(value as LineEndpointReference).lineId];
  if (kind === "line") return typeof value === "string" ? [value] : [];
  if (kind === "lineList") return Array.isArray(value) ? value : [];
  return numericReferenceIds(value as NumericValue);
};

/**
 * Lists only direct, extant element references from accepted session arguments.
 * Recipe step order is the naming order; numeric references retain the existing
 * tokenizer's source order. This deliberately does not inspect emitted elements
 * or traverse their dependencies.
 */
export const directCommandLineReferenceIds = (
  session: CommandLineSession,
  elements: CadElement[]
): ElementId[] => {
  const existingIds = new Set(elements.map((element) => element.id));
  const seen = new Set<ElementId>();
  const references: ElementId[] = [];

  for (const step of session.recipe.steps) {
    if (step.kind === "name") continue;
    for (const id of referenceIdsForStepValue(step.kind, session.args[step.key])) {
      if (existingIds.has(id) && !seen.has(id)) {
        seen.add(id);
        references.push(id);
      }
    }
  }
  return references;
};

/**
 * Names only unnamed elements directly referenced by the current session. The
 * returned array is detached from store state so callers can include it with a
 * final insertion in one document commit.
 */
export const promoteDirectlyReferencedUnnamedElements = (
  session: CommandLineSession,
  elements: CadElement[]
) => {
  let promotedElements = elements;
  const promotedElementIds: ElementId[] = [];

  for (const elementId of directCommandLineReferenceIds(session, elements)) {
    const element = promotedElements.find((item) => item.id === elementId);
    if (!element || element.name.trim()) continue;

    const fallbackBaseName = fallbackElementName(element.type);
    const name = makeUniqueElementName({
      elements: promotedElements,
      elementId,
      requestedName: fallbackBaseName,
      fallbackBaseName,
      parentGroupId: element.parentGroupId
    });
    promotedElements = promotedElements.map((item) =>
      item.id === elementId ? { ...item, name } : item
    );
    promotedElementIds.push(elementId);
  }

  return { elements: promotedElements, promotedElementIds };
};
