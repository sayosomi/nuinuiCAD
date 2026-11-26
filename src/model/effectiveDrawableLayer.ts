import { DEFAULT_SOURCE_LAYER_ID } from "@nuinuicad/nui-language";
import type { CadElement, ElementId } from "../types/geometry";

/** Source-owned membership assignment. Omitted drawable assignments are
 * retained with `explicit: false` so an inherited Group assignment can win. */
export type SourceLayerAssignment = {
  layerIdentity: string;
  layerName: string;
  explicit: boolean;
};

export type EffectiveDrawableLayer = Pick<SourceLayerAssignment, "layerIdentity" | "layerName">;

/**
 * Project one effective Layer for each runtime element from canonical source
 * assignments and existing runtime parent/for-occurrence provenance. The
 * nearest explicitly assigned Group is inherited; a drawable's own explicit
 * assignment always wins. This is presentation/output metadata only.
 */
export const projectEffectiveDrawableLayers = ({
  elements,
  assignmentByElementId,
  generatedTemplateById = new Map<ElementId, ElementId>()
}: {
  elements: readonly CadElement[];
  assignmentByElementId: ReadonlyMap<ElementId, SourceLayerAssignment>;
  generatedTemplateById?: ReadonlyMap<ElementId, ElementId>;
}): ReadonlyMap<ElementId, EffectiveDrawableLayer> => {
  const elementsById = new Map(elements.map(element => [element.id, element] as const));
  const resolved = new Map<ElementId, EffectiveDrawableLayer>();
  const resolving = new Set<ElementId>();
  const defaultLayer: EffectiveDrawableLayer = {
    layerIdentity: DEFAULT_SOURCE_LAYER_ID,
    layerName: "default"
  };

  const resolve = (elementId: ElementId): EffectiveDrawableLayer => {
    const known = resolved.get(elementId);
    if (known) return known;
    if (resolving.has(elementId)) return defaultLayer;
    resolving.add(elementId);

    const own = assignmentByElementId.get(elementId);
    if (own?.explicit) {
      const membership = { layerIdentity: own.layerIdentity, layerName: own.layerName };
      resolved.set(elementId, membership);
      resolving.delete(elementId);
      return membership;
    }

    const templateId = generatedTemplateById.get(elementId);
    if (templateId) {
      const membership = resolve(templateId);
      resolved.set(elementId, membership);
      resolving.delete(elementId);
      return membership;
    }

    let parentId = elementsById.get(elementId)?.parentGroupId;
    const visitedParents = new Set<ElementId>();
    while (parentId && !visitedParents.has(parentId)) {
      visitedParents.add(parentId);
      const parent = elementsById.get(parentId);
      if (parent?.type === "group") {
        const groupAssignment = assignmentByElementId.get(parentId);
        if (groupAssignment?.explicit) {
          const membership = { layerIdentity: groupAssignment.layerIdentity, layerName: groupAssignment.layerName };
          resolved.set(elementId, membership);
          resolving.delete(elementId);
          return membership;
        }
      }
      parentId = parent?.parentGroupId;
    }

    resolved.set(elementId, defaultLayer);
    resolving.delete(elementId);
    return defaultLayer;
  };

  for (const element of elements) resolve(element.id);
  for (const generatedId of generatedTemplateById.keys()) resolve(generatedId);
  return resolved;
};
