import { describe, expect, it } from "vitest";
import fixtures from "../../test/fixtures/scalars/for_group_mutation_core.json";
import { createForGroupMutationEnvironment, ForGroupMutationError, type ForGroupMutationFrame } from "./forGroupMutationCore";

type Fixture = { name: string; iterations: number[]; initial: Record<string, number>; expected: Record<string, number> };

const number = (value: number | "poisoned" | undefined): number => {
  if (value === undefined || typeof value !== "number") throw new Error("expected numeric loop slot");
  return value;
};

const runFixture = (fixture: Fixture) => {
  const environment = createForGroupMutationEnvironment<number | "poisoned">(new Map(Object.entries(fixture.initial)));
  environment.run({
    loopScopeId: "scope:loop", iterationBindingId: "binding:iteration:i", iterationValues: fixture.iterations,
    generatedStatements: [fixture.name]
  }, (frame, context) => {
    if (context.statement === "local_reset") {
      frame.declareLocal("binding:local", 0);
      frame.set("binding:local", number(frame.read("binding:local")) + 1);
      frame.set("sum", number(frame.read("binding:local")));
      return;
    }
    if (context.statement === "poison_recovery") {
      frame.set("sum", "poisoned");
      frame.set("sum", frame.iterationValue);
      return;
    }
    frame.set("sum", number(frame.read("sum")) + frame.iterationValue);
  });
  return environment.finalSlots();
};

describe("forGroup sequential mutation core", () => {
  it.each(fixtures as Fixture[])("matches shared fixture $name", (fixture) => {
    expect(Object.fromEntries(runFixture(fixture))).toEqual(fixture.expected);
  });

  it("retires loop locals while carrying outer slots through nested active control and loops", () => {
    const environment = createForGroupMutationEnvironment<number>(new Map([["sum", 0]]));
    environment.run({ loopScopeId: "scope:outer", iterationBindingId: "binding:iteration:i", iterationValues: [1, 2], generatedStatements: ["if", "nested"] }, (frame, context) => {
      if (context.statement === "if") {
        // Task 33 semantics: an inactive branch never declares, writes, or poisons.
        const activeBranch = context.iterationIndex === 0 ? "then" : "else";
        if (activeBranch === "then") frame.set("sum", number(frame.read("sum")) + frame.iterationValue);
        return;
      }
      environment.run({ loopScopeId: "scope:inner", iterationBindingId: "binding:iteration:j", iterationValues: [10], generatedStatements: ["body"] }, (inner) => {
        inner.declareLocal("binding:local", inner.iterationValue);
        inner.set("sum", number(inner.read("sum")) + number(inner.read("binding:local")));
      });
    });

    expect(environment.finalSlots()).toEqual(new Map([["sum", 21]]));
    expect(environment.read("binding:local")).toBeUndefined();
    expect(environment.read("binding:iteration:i")).toBeUndefined();
  });

  it("rejects mutation of every active iteration binding", () => {
    const environment = createForGroupMutationEnvironment<number>(new Map());
    expect(() => environment.run({ loopScopeId: "scope:loop", iterationBindingId: "binding:iteration:i", iterationValues: [0], generatedStatements: ["set"] }, (frame) => {
      frame.set("binding:iteration:i", 1);
    })).toThrow(ForGroupMutationError);
  });

  it("allows a poisoned outer slot to recover in a later body statement", () => {
    const environment = createForGroupMutationEnvironment<number | "poisoned">(new Map([["sum", 0]]));
    environment.run({ loopScopeId: "scope:loop", iterationBindingId: "binding:iteration:i", iterationValues: [4], generatedStatements: ["poison", "recover"] }, (frame, context) => {
      if (context.statement === "poison") frame.set("sum", "poisoned");
      else frame.set("sum", frame.iterationValue);
    });
    expect(environment.finalSlots().get("sum")).toBe(4);
  });

  it("retires a frame when a callback fails", () => {
    const environment = createForGroupMutationEnvironment<number>(new Map());
    expect(() => environment.run({ loopScopeId: "scope:loop", iterationBindingId: "binding:iteration:i", iterationValues: [0], generatedStatements: ["throw"] }, (frame: ForGroupMutationFrame<number>) => {
      frame.declareLocal("binding:local", 1);
      throw new Error("callback failed");
    })).toThrow("callback failed");
    expect(environment.read("binding:local")).toBeUndefined();
  });
});
