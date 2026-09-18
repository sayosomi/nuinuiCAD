import { describe, expect, it } from "vitest";
import { numericTypeOptionCompletionContextAt } from "@nuinuicad/nui-language";
import { dslCompletionContextAt } from "@nuinuicad/nui-language";

const atEnd = (source: string) => numericTypeOptionCompletionContextAt(source, source.length);

describe("numericTypeOptionCompletionContextAt", () => {
  it("offers all settings immediately inside an incomplete number annotation", () => {
    expect(atEnd("const width: number(")).toEqual({ from: 20, to: 20, options: ["step", "min", "max"] });
  });

  it("replaces a partial key and excludes settings already present", () => {
    const source = "const width: number(step: 5, m";
    expect(atEnd(source)).toEqual({ from: source.length - 1, to: source.length, options: ["min", "max"] });
  });

  it("offers only the remaining setting after a comma", () => {
    expect(atEnd("const width: number(step: 5, min: 0, ")).toEqual({
      from: "const width: number(step: 5, min: 0, ".length,
      to: "const width: number(step: 5, min: 0, ".length,
      options: ["max"]
    });
  });

  it("stays inactive inside a value, initializer, non-number type, or after all settings", () => {
    expect(numericTypeOptionCompletionContextAt("const width: number(step: 5", "const width: number(step: ".length)).toBeNull();
    expect(atEnd("const width: number(step: 5) = 20")).toBeNull();
    expect(atEnd("const label: string = ")).toBeNull();
    expect(atEnd("const width: number(step: 1, min: 0, max: 2")).toBeNull();
  });

  it("does not complete inside a trailing comment", () => {
    const source = "const width: number( // settings";
    expect(dslCompletionContextAt(source, source.length)).toBeNull();
  });
});
