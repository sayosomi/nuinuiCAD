import { describe, expect, it, vi } from "vitest";
import { evaluateConditionExpressionWithTrace, parseConditionEvaluationTraceJson } from "./conditionEvaluationTrace";
import type { ScalarEvaluation } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";

const span = (start: number, end = start + 1) => ({ start, end });
const bool = (value: boolean, at: number): TypedScalarExpression => ({
  kind: "booleanLiteral",
  span: span(at),
  value,
  type: { kind: "boolean" }
});
const number = (value: number, at: number): TypedScalarExpression => ({
  kind: "numberLiteral",
  span: span(at),
  value,
  type: { kind: "number" }
});
const reference = (name: string, bindingId: string, type: "boolean" | "number", at: number): TypedScalarExpression => ({
  kind: "reference",
  span: span(at),
  nameSpan: span(at),
  name,
  bindingId,
  type: { kind: type }
});
const binary = (
  operator: "&&" | "||" | ">",
  left: TypedScalarExpression,
  right: TypedScalarExpression,
  at: number
): TypedScalarExpression => ({
  kind: "binary",
  span: span(at, at + 3),
  operator,
  left,
  right,
  type: { kind: "boolean" }
});

const okBoolean = (value: boolean): ScalarEvaluation => ({
  status: "ok",
  type: { kind: "boolean" },
  value: { kind: "boolean", value }
});

const childRoles = (trace: ReturnType<typeof evaluateConditionExpressionWithTrace>["trace"], nodeIndex: number) =>
  trace.nodes[nodeIndex]!.children.map((child) => child.role);

describe("condition evaluation trace", () => {
  it("omits a short-circuited && right side entirely", () => {
    const lookupBinding = vi.fn(() => okBoolean(true));
    const expression = binary("&&", bool(false, 0), reference("unused", "binding:unused", "boolean", 4), 0);

    const { evaluation, trace } = evaluateConditionExpressionWithTrace(expression, { lookupBinding });

    expect(evaluation).toEqual(okBoolean(false));
    expect(lookupBinding).not.toHaveBeenCalled();
    expect(trace.nodes.map((node) => node.kind)).toEqual(["booleanLiteral", "binary"]);
    expect(childRoles(trace, trace.rootNodeIndex)).toEqual(["left"]);
    expect(trace.finalEvaluation).toEqual(okBoolean(false));
  });

  it("preserves group, !, || and reached comparison structure with operand values", () => {
    const comparison = binary(">", number(42, 8), number(45, 13), 8);
    const grouped: TypedScalarExpression = {
      kind: "group",
      span: span(7, 15),
      expression: comparison,
      type: { kind: "boolean" }
    };
    const disjunction = binary("||", bool(false, 1), grouped, 1);
    const expression: TypedScalarExpression = {
      kind: "unary",
      span: span(0, 15),
      operator: "!",
      operand: disjunction,
      type: { kind: "boolean" }
    };

    const { trace } = evaluateConditionExpressionWithTrace(expression, {
      lookupBinding: () => { throw new Error("no binding lookup expected"); }
    });

    const comparisonNode = trace.nodes.find((node) => node.kind === "binary" && node.operator === ">");
    expect(comparisonNode?.comparisonOperands).toEqual({
      left: { kind: "number", value: 42 },
      right: { kind: "number", value: 45 }
    });
    expect(trace.nodes.some((node) => node.kind === "group")).toBe(true);
    expect(trace.nodes[trace.rootNodeIndex]).toMatchObject({ kind: "unary", operator: "!" });
    expect(trace.finalEvaluation).toEqual(okBoolean(true));
  });

  it("keeps reached error states without fabricating comparison values", () => {
    const failed: ScalarEvaluation = {
      status: "error",
      type: { kind: "number" },
      issueCode: "poisoned-binding",
      bindingId: "binding:bad"
    };
    const expression = binary(">", number(42, 0), reference("bad", "binding:bad", "number", 5), 0);

    const { trace } = evaluateConditionExpressionWithTrace(expression, {
      lookupBinding: () => failed
    });

    const root = trace.nodes[trace.rootNodeIndex]!;
    expect(root.evaluation).toEqual({
      status: "error",
      type: { kind: "boolean" },
      issueCode: "poisoned-binding",
      bindingId: "binding:bad"
    });
    expect(root.comparisonOperands).toEqual({ left: { kind: "number", value: 42 } });
    expect(root.comparisonOperands).not.toHaveProperty("right");
    expect(trace.finalEvaluation).toEqual(root.evaluation);
  });

  it("validates the flat JSON shape used by the Rust payload", () => {
    const expression = binary("&&", bool(true, 0), bool(false, 4), 0);
    const { trace } = evaluateConditionExpressionWithTrace(expression, {
      lookupBinding: () => okBoolean(true)
    });

    expect(parseConditionEvaluationTraceJson(JSON.parse(JSON.stringify(trace)))).toEqual(trace);
    const invalid = JSON.parse(JSON.stringify(trace));
    invalid.nodes[0].children = [{ role: "left", nodeIndex: 99 }];
    expect(() => parseConditionEvaluationTraceJson(invalid)).toThrow(/condition evaluation trace/);
  });
});
