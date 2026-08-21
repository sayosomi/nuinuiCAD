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

const definition = (statementId: string) => ({ statementId }) as ModuleDefinitionSemantic;

const cycleCallSites = (
  cycles: ReadonlyMap<string, readonly ModuleCallEdge[]>,
  primary: string
) => cycles.get(primary)?.map((entry) => entry.instanceStatementId);

describe("moduleRecursionCycles", () => {
  it("returns one deterministic simple cycle per existing recursion primary and excludes outer callers", () => {
    const definitions = ["Outer", "A", "B", "C", "D"].map(definition);
    const edges = [
      edge("Outer", "A", "outer-a"),
      edge("A", "B", "a-b"),
      edge("B", "C", "b-c"),
      edge("B", "D", "b-d"),
      edge("C", "A", "c-a"),
      edge("D", "A", "d-a")
    ];

    const cycles = moduleRecursionCycles(definitions, edges);

    expect([...cycles.keys()]).toEqual(["a-b", "b-c", "b-d", "c-a", "d-a"]);
    expect(cycleCallSites(cycles, "a-b")).toEqual(["a-b", "b-c", "c-a"]);
    expect(cycleCallSites(cycles, "b-d")).toEqual(["a-b", "b-d", "d-a"]);
    expect(cycles.has("outer-a")).toBe(false);
  });

  it("preserves the existing recursion diagnostic primary set in overlapping SCCs", () => {
    const definitions = ["A", "B", "C"].map(definition);
    const edges = [
      edge("A", "B", "a-b"),
      edge("B", "A", "b-a"),
      edge("B", "C", "b-c"),
      edge("C", "B", "c-b"),
      edge("C", "A", "c-a"),
      edge("A", "C", "a-c")
    ];

    const recursive = recursiveModuleInstanceIds(definitions, edges);
    const cycles = moduleRecursionCycles(definitions, edges);

    expect([...recursive]).toEqual(["a-b", "b-a", "b-c", "c-b", "c-a"]);
    expect([...cycles.keys()]).toEqual([...recursive]);
    expect(cycleCallSites(cycles, "c-a")).toEqual(["a-b", "b-c", "c-a"]);
    expect(cycles.has("a-c")).toBe(false);
  });

  it("keeps self recursion as a one-call-site cycle", () => {
    const definitions = [definition("A")];
    const edges = [edge("A", "A", "self")];

    const cycles = moduleRecursionCycles(definitions, edges);

    expect(cycleCallSites(cycles, "self")).toEqual(["self"]);
    expect([...recursiveModuleInstanceIds(definitions, edges)]).toEqual(["self"]);
  });
});
