import { describe, expect, it } from "vitest";
import { unsupportedNuiMajorVersion } from "./nuiVersion";

describe("nui 4 file-open boundary", () => {
  it("accepts only a nui 4 header", () => {
    expect(unsupportedNuiMajorVersion("nui 4\npoint A = coordinate(x: 0, y: 0)")).toBeNull();
  });

  it("rejects pre-nui 4 and missing headers before any document parser is needed", () => {
    expect(unsupportedNuiMajorVersion("nui 2\nvar old = 1")).toBe(2);
    expect(unsupportedNuiMajorVersion("var old = 1")).toBe("missing");
  });
});
