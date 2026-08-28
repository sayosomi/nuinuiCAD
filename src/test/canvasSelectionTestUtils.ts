import { isContainerElement } from "../model/containers";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";

/** Publishes the minimal Canvas authority needed by direct command tests. */
export const publishTestCanvasSelectionEligibility = (
  elements: readonly CadElement[] = useCadDocumentStore.getState().elements,
  elementIds?: ReadonlySet<ElementId>
) => {
  const eligibleIds = elementIds ?? new Set(
    elements
      .filter((element) => element.activity === "visible" && !isContainerElement(element))
      .map((element) => element.id)
  );
  useCadUiStore.getState().setCanvasSelectionEligibility(elements, eligibleIds);
};
