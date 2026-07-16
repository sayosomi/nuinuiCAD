import type { ElementId } from "../types/geometry";
import type { PickCandidate, PickOption } from "./pickCandidates";

export type PickRef =
  | { kind: "point:reference"; candidateElementId: ElementId; pointId: ElementId }
  | { kind: "point:derived"; candidateElementId: ElementId; elementId: ElementId; pointKey: string }
  | { kind: "line"; candidateElementId: ElementId; lineId: ElementId }
  | { kind: "numericReference"; candidateElementId: ElementId; expression: string }
  | { kind: "variableReference"; candidateElementId: ElementId; expression: string };

export const pickRefForOption = (
  candidateElementId: ElementId,
  option: PickOption
): PickRef => {
  if (option.kind === "point") {
    if (option.anchor.mode === "reference") {
      return { kind: "point:reference", candidateElementId, pointId: option.anchor.pointId };
    }
    if (option.anchor.mode === "derived") {
      return {
        kind: "point:derived",
        candidateElementId,
        elementId: option.anchor.elementId,
        pointKey: option.anchor.pointKey
      };
    }
  }
  if (option.kind === "line") return { kind: "line", candidateElementId, lineId: option.lineId };
  if (option.kind === "numericReference") {
    return { kind: "numericReference", candidateElementId, expression: option.expression };
  }
  if (option.kind === "variableReference") {
    return { kind: "variableReference", candidateElementId, expression: option.expression };
  }
  throw new Error("Coordinate point options cannot be persisted as pick references");
};

export const pickRefKey = (ref: PickRef) => {
  switch (ref.kind) {
    case "point:reference":
      return `point:reference:${ref.candidateElementId}:${ref.pointId}`;
    case "point:derived":
      return `point:derived:${ref.candidateElementId}:${ref.elementId}:${ref.pointKey}`;
    case "line":
      return `line:${ref.candidateElementId}:${ref.lineId}`;
    case "numericReference":
      return `numeric:${ref.candidateElementId}:${ref.expression}`;
    case "variableReference":
      return `variable:${ref.candidateElementId}:${ref.expression}`;
  }
};

export const findPickOptionByRef = (candidates: readonly PickCandidate[], ref: PickRef) => {
  const key = pickRefKey(ref);
  for (const candidate of candidates) {
    for (const option of candidate.options) {
      if (option.kind === "point" && option.anchor.mode === "coordinate") continue;
      if (pickRefKey(pickRefForOption(candidate.elementId, option)) === key) {
        return { candidate, option };
      }
    }
  }
  return null;
};
