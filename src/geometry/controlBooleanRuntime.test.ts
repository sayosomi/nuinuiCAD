import { describe, expect, it } from "vitest";
import type { ScalarEvaluation } from "../scalars/types";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";
import {
  resolveConditionalGroupBranch,
  resolveForGroupEffectiveShowGenerated
} from "./controlBooleanRuntime";

const booleanEvaluation = (value: boolean): ScalarEvaluation => ({
  status: "ok",
  type: { kind: "boolean" },
  value: { kind: "boolean", value }
});

const entry: PropertyBindingRuntimeEntry = {
  elementId: "loop",
  parameterKey: "showGenerated",
  bindingId: "binding:x",
  expectedType: { kind: "boolean" }
};

describe("resolveForGroupEffectiveShowGenerated", () => {
  it("returns the literal unchanged when unbound", () => {
    expect(resolveForGroupEffectiveShowGenerated(undefined, true, () => booleanEvaluation(true))).toBe(true);
    expect(resolveForGroupEffectiveShowGenerated(undefined, false, () => booleanEvaluation(true))).toBe(false);
  });

  it("resolves a bound entry that evaluates ok/true", () => {
    expect(resolveForGroupEffectiveShowGenerated(entry, false, () => booleanEvaluation(true))).toBe(true);
  });

  it("resolves a bound entry that evaluates ok/false", () => {
    expect(resolveForGroupEffectiveShowGenerated(entry, true, () => booleanEvaluation(false))).toBe(false);
  });

  it("fails closed to false when the bound binding is poisoned", () => {
    expect(
      resolveForGroupEffectiveShowGenerated(entry, true, () => ({
        status: "error",
        type: { kind: "boolean" },
        issueCode: "poisoned-binding"
      }))
    ).toBe(false);
  });

  it("fails closed to false when the resolved evaluation has an unexpected type", () => {
    expect(
      resolveForGroupEffectiveShowGenerated(entry, true, () => ({
        status: "ok",
        type: { kind: "number" },
        value: { kind: "number", value: 1 }
      }))
    ).toBe(false);
  });
});

describe("resolveConditionalGroupBranch", () => {
  const booleanLiteral = (value: boolean): TypedScalarExpression => ({
    kind: "booleanLiteral",
    span: { start: 0, end: 4 },
    value,
    type: { kind: "boolean" }
  });

  it("resolves an expression that evaluates ok/true as then", () => {
    expect(resolveConditionalGroupBranch(booleanLiteral(true), () => booleanEvaluation(true))).toBe("then");
  });

  it("resolves an expression that evaluates ok/false as else", () => {
    expect(resolveConditionalGroupBranch(booleanLiteral(false), () => booleanEvaluation(false))).toBe("else");
  });

  it("resolves to null (poisoned) when a referenced binding errors", () => {
    const reference: TypedScalarExpression = {
      kind: "reference",
      span: { start: 0, end: 5 },
      nameSpan: { start: 1, end: 5 },
      name: "flag",
      bindingId: "binding:flag",
      type: { kind: "boolean" }
    };
    expect(
      resolveConditionalGroupBranch(reference, () => ({
        status: "error",
        type: { kind: "boolean" },
        issueCode: "poisoned-binding"
      }))
    ).toBeNull();
  });

  it("resolves to null when the evaluation has an unexpected non-boolean type", () => {
    const reference: TypedScalarExpression = {
      kind: "reference",
      span: { start: 0, end: 5 },
      nameSpan: { start: 1, end: 5 },
      name: "n",
      bindingId: "binding:n",
      type: { kind: "boolean" }
    };
    expect(
      resolveConditionalGroupBranch(reference, () => ({
        status: "ok",
        type: { kind: "number" },
        value: { kind: "number", value: 1 }
      }))
    ).toBeNull();
  });
});
