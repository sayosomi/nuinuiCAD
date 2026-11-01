import { describe, expect, it } from "vitest";
import { dslCallAuthoringContextAt } from "./dslCallAuthoringContext";

describe("call authoring physical label spans", () => {
  it("keeps the exact D1 reduced label before whitespace and a colon", () => {
    // Same frozen D1 source as the public query matrix; no additional exploration unit.
    const source = "nui 1\nconst a: number = spreadAngle(spread : 1, length: 1)";
    const from = source.indexOf("spread :");
    const context = dslCallAuthoringContextAt(
      { normalizedSource: source, sourceRevision: 7 },
      source.indexOf("1, length")
    );
    expect(context?.argument.label).toEqual({ from, to: from + 6 });
    expect(source.slice(context!.argument.label!.from, context!.argument.label!.to)).toBe("spread");
    expect(context?.sourceRevision).toBe(7);
  });
});
