import { describe, expect, it } from "vitest";
import { isStaleHostDocumentVersion } from "./hostDocumentVersion";

describe("host document version ordering", () => {
  it("accepts the first, same, and newer host versions", () => {
    expect(isStaleHostDocumentVersion(null, 1)).toBe(false);
    expect(isStaleHostDocumentVersion(2, 2)).toBe(false);
    expect(isStaleHostDocumentVersion(2, 3)).toBe(false);
  });

  it("rejects an older host message", () => {
    expect(isStaleHostDocumentVersion(3, 2)).toBe(true);
  });
});
