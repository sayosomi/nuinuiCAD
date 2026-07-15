import { describe, expect, it } from "vitest";
import { variableIsInScope } from "./variableScope";
import type { CadElement, VariableElement } from "../types/geometry";

const groupElement = (id: string, parentGroupId?: string): CadElement => ({
  id,
  name: id,
  type: "group",
  visible: true,
  enabled: true,
  parentGroupId
}) as CadElement;

describe("variableIsInScope", () => {
  it("treats global variables as always in scope", () => {
    const variable: Pick<VariableElement, "scope" | "parentGroupId"> = { scope: "global" };
    expect(variableIsInScope({ variable, consumer: {}, elementsById: new Map() })).toBe(true);
  });

  it("accepts a relaxed Pick<> pair without a full element and matches full-object results", () => {
    const elementsById = new Map<string, CadElement>([
      ["outer", groupElement("outer")],
      ["inner", groupElement("inner", "outer")]
    ]);
    const relaxedVariable: Pick<VariableElement, "scope" | "parentGroupId"> = {
      scope: "group",
      parentGroupId: "outer"
    };
    const relaxedConsumer: Pick<CadElement, "parentGroupId"> = { parentGroupId: "inner" };

    expect(variableIsInScope({ variable: relaxedVariable, consumer: relaxedConsumer, elementsById })).toBe(true);

    const fullVariable = { ...relaxedVariable, id: "v1", name: "Width" } as VariableElement;
    const fullConsumer = groupElement("consumer", "inner");
    expect(variableIsInScope({ variable: fullVariable, consumer: fullConsumer, elementsById })).toBe(true);
  });

  it("excludes a group-scoped variable when the consumer is outside its group and ancestor chain", () => {
    const elementsById = new Map<string, CadElement>([
      ["groupA", groupElement("groupA")],
      ["groupB", groupElement("groupB")]
    ]);
    const variable: Pick<VariableElement, "scope" | "parentGroupId"> = { scope: "group", parentGroupId: "groupA" };
    const consumer: Pick<CadElement, "parentGroupId"> = { parentGroupId: "groupB" };
    expect(variableIsInScope({ variable, consumer, elementsById })).toBe(false);
  });

  it("includes a group-scoped variable visible to a descendant group via the ancestor chain", () => {
    const elementsById = new Map<string, CadElement>([
      ["outer", groupElement("outer")],
      ["inner", groupElement("inner", "outer")]
    ]);
    const variable: Pick<VariableElement, "scope" | "parentGroupId"> = { scope: "group", parentGroupId: "outer" };
    const consumer: Pick<CadElement, "parentGroupId"> = { parentGroupId: "inner" };
    expect(variableIsInScope({ variable, consumer, elementsById })).toBe(true);
  });
});
