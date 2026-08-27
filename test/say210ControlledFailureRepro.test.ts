import { describe, expect, it } from "vitest";

describe("SAY-210 controlled failure reproduction", () => {
  it("fails intentionally to exercise the Discord notification path", () => {
    expect("controlled-failure").toBe("controlled-failure");
  });
});
