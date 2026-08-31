import { describe, expect, it } from "vitest";
import { isSupportedDslMajorVersion } from "../dsl/dslVersion";
import { unsupportedNuiMajorVersion } from "./nuiVersion";

describe("nui 1 file-open boundary", () => {
  it("accepts the centrally supported nui 1 header", () => {
    expect(unsupportedNuiMajorVersion("nui 1\npoint A = coordinate(x: 0, y: 0)")).toBeNull();
  });

  it.each([2, 3, 4, 5])("rejects unsupported major %s using the central predicate", (major) => {
    expect(unsupportedNuiMajorVersion(`nui ${major}\npoint A = coordinate(x: 0, y: 0)`)).toBe(major);
    expect(isSupportedDslMajorVersion(major)).toBe(false);
  });

  it("agrees with the central predicate for accepted and rejected raw headers", () => {
    for (const major of [1, 2, 3, 4, 5]) {
      expect(unsupportedNuiMajorVersion(`nui ${major}\n`)).toBe(
        isSupportedDslMajorVersion(major) ? null : major
      );
    }
  });

  it("rejects malformed and missing headers before any document parser is needed", () => {
    expect(unsupportedNuiMajorVersion("nui nope\npoint A = coordinate(x: 0, y: 0)")).toBe("missing");
    expect(unsupportedNuiMajorVersion("var old = 1")).toBe("missing");
  });
});
