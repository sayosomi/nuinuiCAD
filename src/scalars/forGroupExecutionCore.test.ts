import { describe, expect, it } from "vitest";
import { createForGroupExecutionEnvironment } from "@nuinuicad/nui-language";

describe("statement-for execution core", () => {
  it("commits multiple carries from one incoming snapshot", () => {
    const environment = createForGroupExecutionEnvironment(new Map([
      ["a", 1],
      ["b", 2]
    ]));
    environment.run({
      loopScopeId: "scope:loop",
      iterationBindingId: "binding:iteration:i",
      iterationValues: [0],
      generatedStatements: ["body"]
    }, (frame) => {
      const a = frame.read("a");
      const b = frame.read("b");
      frame.commit("a", b as number);
      frame.commit("b", a as number);
    });
    expect(environment.finalValues()).toEqual(new Map([["a", 2], ["b", 1]]));
  });

  it("preserves seeded carries when the source is empty", () => {
    const environment = createForGroupExecutionEnvironment(new Map());
    environment.seed("carry", 7);
    environment.run({
      loopScopeId: "scope:empty",
      iterationBindingId: "binding:iteration:i",
      iterationValues: [],
      generatedStatements: ["body"]
    }, () => undefined);
    expect(environment.finalValues().get("carry")).toBe(7);
  });
});
