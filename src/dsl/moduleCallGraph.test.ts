import { describe, expect, it } from "vitest";
import { moduleRecursionCycles, recursiveModuleInstanceIds } from "./moduleCallGraph";
import type { ModuleCallEdge, ModuleDefinitionSemantic } from "./moduleSemanticTypes";

const edge = (
  callerModuleDefinitionStatementId: string,
  calleeModuleDefinitionStatementId: string,
  instanceStatementId: string
): ModuleCallEdge => ({
  callerModuleDefinitionStatementId,
  calleeModuleDefinitionStatementId,
  instanceStatementId
});

const cycleCallSites = (
  cycles: ReadonlyMap<string, readonly ModuleCallEdge[]>,
  primary: string
) => cycles.get(primary)?.map((entry) => entry.instanceStatementId);

describe("moduleRecursionCycles", () => {
  it("returns one deterministic simple cycle per recursive call site and excludes outer callers", () => {
    const edges = [
      edge("Outer", "A", "outer-a"),
      edge("A", "B", "a-b"),
      edge("B", "C", "b-c"),
      edge("B", "D", "b-d"),
      edge("C", "A", "c-a"),
      edge("D", "A", "d-a")
    ];

    const cycles = moduleRecursionCycles(edges);

    expect([...cycles.keys()]).toEqual(["a-b", "b-c", "b-d", "c-a", "d-a"]);
    expect(cycleCallSites(cycles, "a-b")).toEqual(["a-b", "b-c", "c-a"]);
    expect(cycleCallSites(cycles, "b-d")).toEqual(["a-b", "b-d", "d-a"]);
    expect(cycles.has("outer-a")).toBe(false);
  });

  it("keeps self recursion as a one-call-site cycle", () => {
    const edges = [edge("A", "A", "self")];

    const cycles = moduleRecursionCycles(edges);

    expect(cycleCallSites(cycles, "self")).toEqual(["self"]);
    expect([...recursiveModuleInstanceIds([] as ModuleDefinitionSemantic[], edges)]).toEqual(["self"]);
  });
});
