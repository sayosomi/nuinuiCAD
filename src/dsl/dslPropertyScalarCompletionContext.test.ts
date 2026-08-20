import { describe, expect, it } from "vitest";
import type { ParameterDefinition } from "../parameters/parameterDefinitions";
import { propertyScalarValueCompletionContext } from "./dslPropertyScalarCompletionContext";

const textCapabilityDefinition: ParameterDefinition = {
  key: "text",
  label: "テキスト",
  kind: "text"
};

const choiceCapabilityDefinition: ParameterDefinition = {
  key: "side",
  label: "側",
  kind: "choice",
  choiceOptions: ["right", "left"]
};

const booleanCapabilityDefinition: ParameterDefinition = {
  key: "activity",
  label: "印刷",
  kind: "boolean"
};

const nonOptedTextDefinition: ParameterDefinition = { key: "name", label: "名前", kind: "text" };
const nonOptedBooleanDefinition: ParameterDefinition = { key: "visible", label: "表示", kind: "boolean" };

describe("propertyScalarValueCompletionContext", () => {
  it("offers a reference context for an in-progress @ value on any text property", () => {
    const line = 'text: @la';
    const span = { start: "text: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, textCapabilityDefinition);
    expect(context).toEqual({ kind: "reference", from: span.start, to: line.length, expectedType: { kind: "string" } });
  });

  it("offers a reference context for a choice property with its exact schema type", () => {
    const line = "side: @s";
    const span = { start: "side: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, choiceCapabilityDefinition);
    expect(context).toEqual({ kind: "reference", from: span.start, to: line.length, expectedType: { kind: "choice", options: ["right", "left"] } });
  });

  it("uses the schema type for a text property", () => {
    const line = "name: @x";
    const span = { start: "name: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, nonOptedTextDefinition)).toEqual({
      kind: "reference", from: span.start, to: line.length, expectedType: { kind: "string" }
    });
  });

  it("offers a boolean literal context for a boolean property with no @ prefix", () => {
    const line = "activity: ";
    const span = { start: "activity: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, booleanCapabilityDefinition);
    expect(context).toEqual({ kind: "booleanLiteral", from: span.start, to: line.length });
  });

  it("uses the schema kind for a boolean property", () => {
    const line = "visible: ";
    const span = { start: "visible: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, nonOptedBooleanDefinition)).toEqual({
      kind: "booleanLiteral", from: span.start, to: line.length
    });
  });

  it("offers nothing for a choice property with no @ prefix (existing enum-literal branch owns that)", () => {
    const line = "side: r";
    const span = { start: "side: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, choiceCapabilityDefinition)).toBeNull();
  });

  it("enters the shared expression lane for a boolean builtin call", () => {
    const line = "activity: isClose(1, ";
    const span = { start: "activity: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, booleanCapabilityDefinition)).toMatchObject({
      kind: "expression",
      positionContext: { kind: "operand", expectedType: { kind: "number" } }
    });
  });

  it("never offers expression operators - there is no operator-shaped result kind at all", () => {
    const line = "text: @label ";
    const span = { start: "text: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, textCapabilityDefinition);
    expect(context?.kind).not.toBe("operator");
  });

  it("returns null outside the value span", () => {
    const line = "text: @label";
    const span = { start: "text: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, 0, textCapabilityDefinition)).toBeNull();
  });
});
