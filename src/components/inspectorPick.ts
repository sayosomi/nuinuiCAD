import type { ParameterValueKind } from "../parameters/parameterDefinitions";

export type InspectorPickCommandId =
  | "startPointPick"
  | "startLinePick"
  | "startNumericReferencePick";

/** Maps a read-only Inspector row to an existing Canvas-pick command. */
export const inspectorPickCommandId = (
  kind: ParameterValueKind,
): InspectorPickCommandId | null => {
  if (kind === "reference" || kind === "lineEndpointReference") {
    return "startPointPick";
  }
  if (kind === "lineReference" || kind === "lineReferenceList") {
    return "startLinePick";
  }
  return kind === "number" ? "startNumericReferencePick" : null;
};
