import { encodeIdentityTuple } from "../document/identityTuple";
import type { GeometryValueOccurrence } from "./cadDocumentTypes";

/** Internal key namespace for immutable geometry-value occurrences. It must
 * never be passed to a drawable API as an ElementId. */
export type GeometryValueOccurrenceKey = string & { readonly __geometryValueOccurrenceKey: true };

export const geometryValueOccurrenceKey = (occurrence: GeometryValueOccurrence): GeometryValueOccurrenceKey =>
  encodeIdentityTuple(["geometry-value", occurrence.sourceStatementId, ...occurrence.instancePath]) as GeometryValueOccurrenceKey;
