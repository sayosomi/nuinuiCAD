import { describe, expect, it } from "vitest";
import { parseDslModuleStatement } from "./dslModuleParser";

describe("Module geometry-array argument parsing", () => {
  it("keeps coordinate tuples nested inside an array argument", () => {
    const source = "instance Use = M(points: [@L.start, @L.end, (1, 2)])";
    const parsed = parseDslModuleStatement(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statement?.kind).toBe("moduleInstance");
    if (parsed.statement?.kind !== "moduleInstance") throw new Error("expected module instance");
    expect(parsed.statement.arguments).toHaveLength(1);
    expect(parsed.statement.arguments[0]?.label).toBe("points");
    expect(parsed.statement.arguments[0]?.value).toBe("[@L.start, @L.end, (1, 2)]");
  });
});
