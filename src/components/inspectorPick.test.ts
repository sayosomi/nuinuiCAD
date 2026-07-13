import { describe, expect, it } from "vitest";
import { inspectorPickCommandId } from "./inspectorPick";

describe("inspectorPickCommandId", () => {
  it.each([
    ["reference", "startPointPick"],
    ["lineEndpointReference", "startPointPick"],
    ["lineReference", "startLinePick"],
    ["lineReferenceList", "startLinePick"],
    ["number", "startNumericReferencePick"],
  ] as const)("maps %s to the existing %s Canvas-pick command", (kind, commandId) => {
    expect(inspectorPickCommandId(kind)).toBe(commandId);
  });

  it.each(["text", "boolean", "color", "choice"] as const)(
    "does not expose a pick button for %s parameters",
    (kind) => {
      expect(inspectorPickCommandId(kind)).toBeNull();
    },
  );
});
