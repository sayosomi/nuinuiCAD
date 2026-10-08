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
