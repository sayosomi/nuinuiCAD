import { describe, expect, it } from "vitest";
import { queryDslCompletion } from "./dslCompletionQuery";
import { queryDslSignatureHelp } from "./dslSignatureHelpQuery";

const snapshotFor = (source: string) => ({ normalizedSource: source, sourceRevision: 1 });

const arcDirectionSource =
  "nui 4\narc A = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: ";

describe("nui4 arc direction language service", () => {
  it("offers counterclockwise and clockwise through parameter-value completion", () => {
    const result = queryDslCompletion({
      source: snapshotFor(arcDirectionSource),
      position: arcDirectionSource.length
    });

    expect(result?.category).toBe("parameter");
    expect(result?.candidates.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining(["counterclockwise", "clockwise"])
    );
  });

  it("projects the optional choice contract and default through Signature Help", () => {
    const result = queryDslSignatureHelp({
      source: snapshotFor(arcDirectionSource),
      position: arcDirectionSource.length
    });
    const parameters = result?.signatures[0]?.parameters ?? [];
    const directionIndex = parameters.findIndex((parameter) => parameter.name === "direction");

    expect(result?.signatures[0]?.name).toBe("arc");
    expect(directionIndex).toBeGreaterThanOrEqual(0);
    expect(parameters[directionIndex]).toMatchObject({
      name: "direction",
      type: "choice(counterclockwise, clockwise)",
      optional: true,
      defaultValue: "counterclockwise",
      allowedValues: ["counterclockwise", "clockwise"]
    });
    expect(result?.activeParameter).toBe(directionIndex);
  });
});
