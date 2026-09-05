import type { ParameterValueKind } from "../parameters/parameterDefinitions";

export type ParameterPickCommandId =
  | "startPointPick"
  | "startLinePick"
  | "startNumericReferencePick";

/** Maps an editable parameter kind to the existing Canvas-pick command. */
export const parameterPickCommandId = (
  kind: ParameterValueKind,
): ParameterPickCommandId | null => {
  if (kind === "reference" || kind === "lineEndpointReference" || kind === "pointReferenceList") {
    return "startPointPick";
  }
  if (kind === "lineReference" || kind === "lineReferenceList") {
    return "startLinePick";
  }
  return kind === "number" ? "startNumericReferencePick" : null;
};
