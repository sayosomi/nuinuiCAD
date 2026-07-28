import { describe, expect, it } from "vitest";
import type { ParameterDefinition } from "../parameters/parameterDefinitions";
import { propertyScalarValueCompletionContext } from "./dslPropertyScalarCompletionContext";

const textCapabilityDefinition: ParameterDefinition = {
  key: "text",
  label: "テキスト",
  kind: "text",
  propertyCapability: { propertyType: { kind: "string" } }
};

const choiceCapabilityDefinition: ParameterDefinition = {
  key: "side",
  label: "側",
  kind: "choice",
  choiceOptions: ["right", "left"],
  propertyCapability: { propertyType: { kind: "choice", options: ["right", "left"] } }
};

const booleanCapabilityDefinition: ParameterDefinition = {
  key: "printEnabled",
  label: "印刷",
  kind: "boolean",
  propertyCapability: { propertyType: { kind: "boolean" } }
};

const nonOptedTextDefinition: ParameterDefinition = { key: "name", label: "名前", kind: "text" };
const nonOptedBooleanDefinition: ParameterDefinition = { key: "visible", label: "表示", kind: "boolean" };

describe("propertyScalarValueCompletionContext", () => {
  it("offers a reference context for an in-progress @ value on an opted-in text property", () => {
    const line = 'text: @la';
    const span = { start: "text: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, textCapabilityDefinition);
    expect(context).toEqual({ kind: "reference", from: span.start, to: line.length, capability: textCapabilityDefinition.propertyCapability });
  });

  it("offers a reference context for an opted-in choice property, capability preserved for subset checks", () => {
    const line = "side: @s";
    const span = { start: "side: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, choiceCapabilityDefinition);
    expect(context).toEqual({ kind: "reference", from: span.start, to: line.length, capability: choiceCapabilityDefinition.propertyCapability });
  });

  it("offers nothing for an @ value on a non-opted-in property (Task 22's own diagnostic covers it)", () => {
    const line = "name: @x";
    const span = { start: "name: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, nonOptedTextDefinition)).toBeNull();
  });

  it("offers a boolean literal context for an opted-in boolean property with no @ prefix", () => {
    const line = "printEnabled: ";
    const span = { start: "printEnabled: ".length, end: line.length };
    const context = propertyScalarValueCompletionContext(line, span, line.length, booleanCapabilityDefinition);
    expect(context).toEqual({ kind: "booleanLiteral", from: span.start, to: line.length });
  });

  it("offers nothing for a non-opted-in boolean property (visible/enabled stay activity-only)", () => {
    const line = "visible: ";
    const span = { start: "visible: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, nonOptedBooleanDefinition)).toBeNull();
  });

  it("offers nothing for a choice property with no @ prefix (existing enum-literal branch owns that)", () => {
    const line = "side: r";
    const span = { start: "side: ".length, end: line.length };
    expect(propertyScalarValueCompletionContext(line, span, line.length, choiceCapabilityDefinition)).toBeNull();
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
