import { describe, expect, it } from "vitest";
import {
  availableNumericVariableReferenceOptions,
  numericVariableReferenceOptionsForPosition
} from "./variableReferenceOptions";
import type { CadElement, ComputedVariable, FreePointElement, VariableElement } from "../types/geometry";

const variableElement = (
  id: string,
  name: string,
  overrides: Partial<VariableElement> = {}
): VariableElement => ({
  id,
  name,
  type: "variable",
  visible: true,
  enabled: true,
  scope: "global",
  valueMode: "expression",
  expression: 0,
  point1: { mode: "reference", pointId: "" },
  point2: { mode: "reference", pointId: "" },
  point: { mode: "reference", pointId: "" },
  lineId: "",
  ...overrides
});

const freePointElement = (id: string, name: string, overrides: Partial<FreePointElement> = {}): FreePointElement => ({
  id,
  name,
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0,
  ...overrides
});

const computed = (...ids: string[]): Map<string, ComputedVariable> =>
  new Map(ids.map((id) => [id, { kind: "variable", elementId: id, name: id, value: 1 }]));

describe("numericVariableReferenceOptionsForPosition", () => {
  it("offers a global variable in referenceElements", () => {
    const width = variableElement("width", "Width");
    const options = numericVariableReferenceOptionsForPosition({
      referenceElements: [width],
      computedVariables: computed("width")
    });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ expression: "@Width", displayExpression: "@Width", source: "global" });
  });

  it("excludes a group-scoped variable outside the consumer's ancestor chain", () => {
    const width = variableElement("width", "Width", { scope: "group", parentGroupId: "groupA" });
    const options = numericVariableReferenceOptionsForPosition({
      referenceElements: [width],
      parentGroupId: "groupB",
      computedVariables: computed("width")
    });
    expect(options).toHaveLength(0);
  });

  it("includes a group-scoped variable visible from the same group", () => {
    const width = variableElement("width", "Width", { scope: "group", parentGroupId: "groupA" });
    const options = numericVariableReferenceOptionsForPosition({
      referenceElements: [width],
      parentGroupId: "groupA",
      computedVariables: computed("width")
    });
    expect(options).toHaveLength(1);
  });

  it("excludes a variable id absent from computedVariables (e.g. past @stop or errored)", () => {
    const width = variableElement("width", "Width");
    const options = numericVariableReferenceOptionsForPosition({
      referenceElements: [width],
      computedVariables: computed("someOtherId")
    });
    expect(options).toHaveLength(0);
  });

  it("includes a variable when computedVariables is omitted entirely", () => {
    const width = variableElement("width", "Width");
    const options = numericVariableReferenceOptionsForPosition({ referenceElements: [width] });
    expect(options).toHaveLength(1);
  });

  it("falls back to @id insertion text only when two candidates share a name", () => {
    const first = variableElement("v1", "Width");
    const second = variableElement("v2", "Width", { scope: "group", parentGroupId: "groupA" });
    const options = numericVariableReferenceOptionsForPosition({
      referenceElements: [first, second],
      parentGroupId: "groupA",
      computedVariables: computed("v1", "v2")
    });
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.expression === "@v1" || option.expression === "@v2")).toBe(true);
    expect(options.every((option) => option.displayExpression === "@Width")).toBe(true);
  });

  it("ignores non-variable elements in referenceElements", () => {
    const point = freePointElement("p1", "P1");
    const options = numericVariableReferenceOptionsForPosition({ referenceElements: [point] });
    expect(options).toHaveLength(0);
  });
});

describe("availableNumericVariableReferenceOptions", () => {
  it("combines local numericVariables with top-level variable candidates unchanged from before the refactor", () => {
    const width = variableElement("width", "Width");
    const consumer = freePointElement("target", "Target", {
      numericVariables: [{ id: "local1", name: "Margin", value: 5 }]
    });
    const elements: CadElement[] = [width, consumer];
    const options = availableNumericVariableReferenceOptions({
      element: consumer,
      elements,
      parameterKey: "x",
      computedVariables: computed("width")
    });
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ source: "local", label: "@Target.Margin" });
    expect(options[1]).toMatchObject({ source: "global", expression: "@Width" });
  });

  it("returns only local options when the consuming element is not yet in elements", () => {
    const consumer = freePointElement("target", "Target", {
      numericVariables: [{ id: "local1", name: "Margin", value: 5 }]
    });
    const options = availableNumericVariableReferenceOptions({
      element: consumer,
      elements: [],
      parameterKey: "x"
    });
    expect(options).toHaveLength(1);
    expect(options[0].source).toBe("local");
  });
});
