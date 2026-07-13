import { describe, expect, it } from "vitest";
import { parameterPickCommandId } from "./parameterPickCommand";

describe("parameterPickCommandId", () => {
  it.each([
    ["reference", "startPointPick"],
    ["lineEndpointReference", "startPointPick"],
    ["lineReference", "startLinePick"],
    ["lineReferenceList", "startLinePick"],
    ["number", "startNumericReferencePick"],
  ] as const)("maps %s to the existing %s Canvas-pick command", (kind, commandId) => {
    expect(parameterPickCommandId(kind)).toBe(commandId);
  });

  it.each(["text", "boolean", "color", "choice"] as const)(
    "does not expose a Canvas picker for %s parameters",
    (kind) => {
      expect(parameterPickCommandId(kind)).toBeNull();
    },
  );
});
