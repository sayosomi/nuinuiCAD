import { describe, expect, it } from "vitest";
import { resolveModulePreviewValueStep } from "./modulePreviewValueStep";

const at = (start: number, end = start) => ({ start, end });

describe("resolveModulePreviewValueStep", () => {
  it("uses the default one-unit number step", () => {
    expect(resolveModulePreviewValueStep("1", { kind: "number" }, undefined, at(0), 1)).toEqual({
      expression: "2",
      selection: { start: 0, end: 1 }
    });
  });

  it("uses declaration step metadata", () => {
    expect(resolveModulePreviewValueStep("1.5", { kind: "number" }, { step: 0.5 }, at(2), 1)?.expression).toBe("2");
  });

  it("clamps to declaration-owned bounds", () => {
    const options = { step: 5, min: 0, max: 200 };
    expect(resolveModulePreviewValueStep("199", { kind: "number" }, options, at(1), 1)?.expression).toBe("200");
    expect(resolveModulePreviewValueStep("1", { kind: "number" }, options, at(0), -1)?.expression).toBe("0");
  });

  it("preserves the typed numeric normalization", () => {
    expect(resolveModulePreviewValueStep("12.3400", { kind: "number" }, undefined, at(3), 1)?.expression).toBe("13.34");
  });

  it("steps the numeric literal under the caret inside a larger expression", () => {
    const value = "@scale + 1.50";
    const literalStart = value.indexOf("1.50");
    expect(resolveModulePreviewValueStep(value, { kind: "number" }, undefined, at(literalStart + 2), 1)).toEqual({
      expression: "@scale + 2.5",
      selection: { start: literalStart, end: literalStart + 3 }
    });
  });

  it("steps a selected numeric literal and returns the replacement selection", () => {
    const value = "1.50";
    expect(resolveModulePreviewValueStep(value, { kind: "number" }, undefined, at(0, value.length), -1)).toEqual({
      expression: "0.5",
      selection: { start: 0, end: 3 }
    });
  });

  it("does not step when the selection has no numeric literal", () => {
    expect(resolveModulePreviewValueStep("@scale + 1", { kind: "number" }, undefined, at(1, 3), 1)).toBeNull();
  });

  it("toggles booleans in either direction only for the complete value", () => {
    expect(resolveModulePreviewValueStep("true", { kind: "boolean" }, undefined, at(2), 1)?.expression).toBe("false");
    expect(resolveModulePreviewValueStep("false", { kind: "boolean" }, undefined, at(2), -1)?.expression).toBe("true");
    expect(resolveModulePreviewValueStep("true", { kind: "boolean" }, undefined, at(0, 2), 1)).toBeNull();
  });

  it("wraps choices in declared order and rejects partial selections", () => {
    const type = { kind: "choice" as const, options: ["right", "left", "center"] };
    expect(resolveModulePreviewValueStep("right", type, undefined, at(1), 1)?.expression).toBe("left");
    expect(resolveModulePreviewValueStep("right", type, undefined, at(1), -1)?.expression).toBe("center");
    expect(resolveModulePreviewValueStep("right", type, undefined, at(0, 2), 1)).toBeNull();
    expect(resolveModulePreviewValueStep("center", type, undefined, at(2), 1)?.expression).toBe("right");
  });

  it("returns no-op for strings, geometry, malformed, and empty values", () => {
    expect(resolveModulePreviewValueStep("text", { kind: "string" }, undefined, at(1), 1)).toBeNull();
    expect(resolveModulePreviewValueStep("@point", { kind: "point" }, undefined, at(2), 1)).toBeNull();
    expect(resolveModulePreviewValueStep("", { kind: "number" }, undefined, at(0), 1)).toBeNull();
    expect(resolveModulePreviewValueStep("(", { kind: "number" }, undefined, at(0), 1)).toBeNull();
  });
});
