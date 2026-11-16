import { encodeIdentityTuple } from "../document/identityTuple";
import type { GeometryValueOccurrence } from "./cadDocumentTypes";

/** Internal key namespace for immutable geometry-value occurrences. It must
 * never be passed to a drawable API as an ElementId. */
export type GeometryValueOccurrenceKey = string & { readonly __geometryValueOccurrenceKey: true };

export const geometryValueOccurrenceKey = (occurrence: GeometryValueOccurrence): GeometryValueOccurrenceKey => {
  const parts = occurrence.mappedMemberIndex === undefined
    ? ["geometry-value", occurrence.sourceStatementId, ...occurrence.instancePath]
    : [
        occurrence.runtimeGeneration === undefined ? "geometry-value-map-member" : "geometry-value-map-generation",
        occurrence.sourceStatementId,
        ...occurrence.instancePath,
        ...(occurrence.runtimeGeneration === undefined ? [] : [String(occurrence.runtimeGeneration)]),
        String(occurrence.mappedMemberIndex)
      ];
  return encodeIdentityTuple(parts) as GeometryValueOccurrenceKey;
};

/** Stable identity ordering for runtime-only values after static program entries.
 * Kept aligned with the Rust evaluation payload serializer. */
export const compareGeometryValueOccurrences = (left: GeometryValueOccurrence, right: GeometryValueOccurrence): number => {
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const sourceOrder = compareText(left.sourceStatementId, right.sourceStatementId);
  if (sourceOrder) return sourceOrder;
  for (let index = 0; index < Math.min(left.instancePath.length, right.instancePath.length); index += 1) {
    const order = compareText(left.instancePath[index], right.instancePath[index]);
    if (order) return order;
  }
  return left.instancePath.length - right.instancePath.length ||
    (left.mappedMemberIndex ?? -1) - (right.mappedMemberIndex ?? -1) ||
    (left.runtimeGeneration ?? -1) - (right.runtimeGeneration ?? -1);
};
