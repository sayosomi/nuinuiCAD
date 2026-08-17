import { describe, expect, it } from "vitest";
import fixtureJson from "../../test/fixtures/typed-expressions.json";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { BuiltinFunctionName } from "./builtinFunctions";
import {
  buildMockEnvironment,
  decodeTypedExpressionNode,
  decodeVectorBindings
} from "./testSupport/typedExpressionVectorFixture";
import type {
  ScalarExpressionResolvedGeometryTarget,
  TypedBuiltinArgument,
  TypedScalarExpression
} from "./typedExpressionAst";
import type { ScalarEvaluation } from "./types";
import type { ComputedGeometry, ComputedLine, ComputedPoint } from "../types/geometry";

type TypedExpressionVector = {
  name: string;
  description: string;
  ast: unknown;
  bindings: Record<string, unknown>;
  tripwireBindingIds?: string[];
  expected: ScalarEvaluation;
};

const fixture = fixtureJson as unknown as { vectors: TypedExpressionVector[] };

const builtinCall = (
  targetName: BuiltinFunctionName,
  args: TypedScalarExpression[],
  name?: string
): Extract<TypedScalarExpression, { kind: "call" }> => ({
  kind: "call",
  span: { start: 0, end: 0 },
  nameSpan: { start: 0, end: 0 },
  name: name ?? targetName,
  target: { kind: "builtin", name: targetName },
  args: args.map((expression) => ({ kind: "scalar", expression })),
  type: targetName === "isClose" ? { kind: "boolean" } : { kind: "number" }
});

const numberLiteral = (value: number): TypedScalarExpression => ({
  kind: "numberLiteral",
  span: { start: 0, end: 0 },
  value,
  type: { kind: "number" }
});

const geometryTarget = (
  statementId: string,
  statementIndex: number,
  geometryType: "point" | "line" | "path"
): ScalarExpressionResolvedGeometryTarget => ({ statementId, statementIndex, geometryType });

const geometryReference = (
  expectedGeometryType: "point" | "line",
  target: ScalarExpressionResolvedGeometryTarget | null
): TypedBuiltinArgument => ({ kind: "geometryReference", expectedGeometryType, target });

const geometryBuiltinCall = (
  targetName: Extract<BuiltinFunctionName, "distance" | "angle" | "lineDistance" | "lineAngle">,
  args: readonly TypedBuiltinArgument[]
): Extract<TypedScalarExpression, { kind: "call" }> => ({
  kind: "call",
  span: { start: 0, end: 0 },
  nameSpan: { start: 0, end: 0 },
  name: targetName,
  target: { kind: "builtin", name: targetName },
  args,
  type: { kind: "number" }
});

const computedPoint = (elementId: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const computedLine = (elementId: string, start: ComputedPoint, end: ComputedPoint): ComputedLine => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startAngleDeg: null,
  endAngleDeg: null,
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

const evaluateVector = (vector: TypedExpressionVector): ScalarEvaluation => {
  const node = decodeTypedExpressionNode(vector.ast);
  const bindings = decodeVectorBindings(vector.bindings);
  const environment = buildMockEnvironment(bindings, vector.tripwireBindingIds ?? []);
  return evaluateTypedExpression(node, environment);
};

describe("evaluateTypedExpression / shared vectors (test/fixtures/typed-expressions.json)", () => {
  for (const vector of fixture.vectors) {
    it(`${vector.name}: ${vector.description}`, () => {
      expect(evaluateVector(vector)).toEqual(vector.expected);
    });
  }
});

describe("evaluateTypedExpression / short-circuit", () => {
  const tripwireEnvironment = (bindingId: string): ScalarEvaluationEnvironment => ({
    lookupBinding: () => {
      throw new Error(`must not look up ${bindingId} - short-circuit tripwire`);
    }
  });

  it(" and  with a false left never evaluates a right-side unary operand", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "&&",
      type: { kind: "boolean" },
      left: { kind: "booleanLiteral", span: { start: 0, end: 0 }, value: false, type: { kind: "boolean" } },
      right: {
        kind: "unary",
        span: { start: 0, end: 0 },
        operator: "!",
        type: { kind: "boolean" },
        operand: { kind: "reference", span: { start: 0, end: 0 }, nameSpan: { start: 0, end: 0 }, name: "x", bindingId: "binding:x", type: { kind: "boolean" } }
      }
    };
    expect(evaluateTypedExpression(node, tripwireEnvironment("binding:x"))).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: false }
    });
  });

  it(" or  with a true left never evaluates a right-side unary operand", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "||",
      type: { kind: "boolean" },
      left: { kind: "booleanLiteral", span: { start: 0, end: 0 }, value: true, type: { kind: "boolean" } },
      right: {
        kind: "unary",
        span: { start: 0, end: 0 },
        operator: "!",
        type: { kind: "boolean" },
        operand: { kind: "reference", span: { start: 0, end: 0 }, nameSpan: { start: 0, end: 0 }, name: "x", bindingId: "binding:x", type: { kind: "boolean" } }
      }
    };
    expect(evaluateTypedExpression(node, tripwireEnvironment("binding:x"))).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    });
  });
});

describe("evaluateTypedExpression / poison propagation", () => {
  it("carries the original issueCode/bindingId through nested group(unary(binary(reference)))", () => {
    const reference: TypedScalarExpression = {
      kind: "reference",
      span: { start: 0, end: 0 },
      nameSpan: { start: 0, end: 0 },
      name: "poisoned",
      bindingId: "binding:poisoned",
      type: { kind: "number" }
    };
    const binary: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "+",
      type: { kind: "number" },
      left: reference,
      right: { kind: "numberLiteral", span: { start: 0, end: 0 }, value: 1, type: { kind: "number" } }
    };
    const unary: TypedScalarExpression = {
      kind: "unary",
      span: { start: 0, end: 0 },
      operator: "-",
      type: { kind: "number" },
      operand: binary
    };
    const group: TypedScalarExpression = { kind: "group", span: { start: 0, end: 0 }, type: { kind: "number" }, expression: unary };

    const environment: ScalarEvaluationEnvironment = {
      lookupBinding: () => ({ status: "error", type: { kind: "number" }, issueCode: "poisoned-binding", bindingId: "binding:poisoned" })
    };

    const result = evaluateTypedExpression(group, environment);
    expect(result).toEqual({ status: "error", type: { kind: "number" }, issueCode: "poisoned-binding", bindingId: "binding:poisoned" });
  });
});

describe("evaluateTypedExpression / choice equality truth table", () => {
  const choiceReference = (bindingId: string): TypedScalarExpression => ({
    kind: "reference",
    span: { start: 0, end: 0 },
    nameSpan: { start: 0, end: 0 },
    name: bindingId,
    bindingId,
    type: { kind: "choice", options: ["right", "left"] }
  });

  const equalityNode = (): TypedScalarExpression => ({
    kind: "binary",
    span: { start: 0, end: 0 },
    operator: "==",
    type: { kind: "boolean" },
    left: choiceReference("binding:a"),
    right: choiceReference("binding:b")
  });

  const environmentWith = (a: ScalarEvaluation, b: ScalarEvaluation): ScalarEvaluationEnvironment => ({
    lookupBinding: (bindingId) => (bindingId === "binding:a" ? a : b)
  });

  it("same value, same options+order -> true", () => {
    const value = { kind: "choice" as const, options: ["right", "left"] };
    const a: ScalarEvaluation = { status: "ok", type: value, value: { kind: "choice", value: "right", options: value.options } };
    const b: ScalarEvaluation = { status: "ok", type: value, value: { kind: "choice", value: "right", options: value.options } };
    expect(evaluateTypedExpression(equalityNode(), environmentWith(a, b))).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    });
  });

  it("different value, same options -> false", () => {
    const options = ["right", "left"];
    const a: ScalarEvaluation = { status: "ok", type: { kind: "choice", options }, value: { kind: "choice", value: "right", options } };
    const b: ScalarEvaluation = { status: "ok", type: { kind: "choice", options }, value: { kind: "choice", value: "left", options } };
    expect(evaluateTypedExpression(equalityNode(), environmentWith(a, b))).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: false }
    });
  });

  it("same value, mismatched option membership between two literals -> false", () => {
    // Uses bare choiceLiteral operands (no reference/environment involved).
    // A mismatch reaching equality through a *reference* is already caught
    // earlier, at the reference's own validation, as
    // evaluation-runtime-value-type-mismatch (see the trust-boundary
    // describe block below) - this exercises the equality operator's own
    // choice-identity check directly.
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "==",
      type: { kind: "boolean" },
      left: { kind: "choiceLiteral", span: { start: 0, end: 0 }, value: "right", type: { kind: "choice", options: ["right", "left"] } },
      right: {
        kind: "choiceLiteral",
        span: { start: 0, end: 0 },
        value: "right",
        type: { kind: "choice", options: ["right", "left", "center"] }
      }
    };
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };
    expect(evaluateTypedExpression(node, environment)).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: false }
    });
  });
});

describe("evaluateTypedExpression / string unicode", () => {
  it("compares multi-byte and combining-character strings by exact equality, no normalization", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "==",
      type: { kind: "boolean" },
      left: { kind: "stringLiteral", span: { start: 0, end: 0 }, value: "前身頃🧵", type: { kind: "string" } },
      right: { kind: "stringLiteral", span: { start: 0, end: 0 }, value: "前身頃🧵", type: { kind: "string" } }
    };
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };
    expect(evaluateTypedExpression(node, environment)).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    });
  });
});

describe("evaluateTypedExpression / numeric precision", () => {
  it("does not round float arithmetic - result matches plain JS float semantics exactly", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "+",
      type: { kind: "number" },
      left: { kind: "numberLiteral", span: { start: 0, end: 0 }, value: 0.1, type: { kind: "number" } },
      right: { kind: "numberLiteral", span: { start: 0, end: 0 }, value: 0.2, type: { kind: "number" } }
    };
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };
    const result = evaluateTypedExpression(node, environment);
    expect(result).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 0.1 + 0.2 } });
  });
});

describe("evaluateTypedExpression / builtin calls", () => {
  it("evaluates resolved builtin targets without resolving node.name again", () => {
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };

    expect(evaluateTypedExpression(builtinCall("abs", [numberLiteral(-3)], "not-a-builtin"), environment)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 3 }
    });
    expect(evaluateTypedExpression(builtinCall("round", [numberLiteral(-1.5)]), environment)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: -2 }
    });
    expect(evaluateTypedExpression(builtinCall("isClose", [numberLiteral(1), numberLiteral(1.01), numberLiteral(0.02)]), environment)).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    });
  });

  it("propagates the first argument error and does not evaluate later arguments", () => {
    const lookedUp: string[] = [];
    const node = builtinCall("min", [
      {
        kind: "reference",
        span: { start: 0, end: 0 },
        nameSpan: { start: 0, end: 0 },
        name: "first",
        bindingId: "binding:first",
        type: { kind: "number" }
      },
      {
        kind: "reference",
        span: { start: 0, end: 0 },
        nameSpan: { start: 0, end: 0 },
        name: "second",
        bindingId: "binding:second",
        type: { kind: "number" }
      }
    ]);
    const environment: ScalarEvaluationEnvironment = {
      lookupBinding: (bindingId) => {
        lookedUp.push(bindingId);
        return { status: "error", type: { kind: "number" }, issueCode: "first-argument-error", bindingId };
      }
    };

    expect(evaluateTypedExpression(node, environment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "first-argument-error",
      bindingId: "binding:first"
    });
    expect(lookedUp).toEqual(["binding:first"]);
  });

  it("maps builtin contract failures to runtime issue codes", () => {
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };

    expect(evaluateTypedExpression(builtinCall("sqrt", [numberLiteral(-1)]), environment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-sqrt-negative-input"
    });
    expect(evaluateTypedExpression(builtinCall("roundTo", [numberLiteral(Number.MAX_VALUE), numberLiteral(Number.MIN_VALUE)]), environment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-non-finite-result"
    });
  });

  it("uses staticTypeNullError when a call is not statically typed or resolved", () => {
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };
    const node = builtinCall("abs", [numberLiteral(1)]);
    expect(evaluateTypedExpression({ ...node, type: null }, environment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-static-type-null"
    });
    expect(evaluateTypedExpression({ ...node, target: null }, environment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-static-type-null"
    });
  });

  it("fails closed for geometryReference arguments without scalar lookup", () => {
    const lookupBinding = () => {
      throw new Error("geometry references must not use scalar lookup");
    };
    const node = {
      ...builtinCall("distance", [numberLiteral(1), numberLiteral(2)]),
      args: [
        {
          kind: "geometryReference" as const,
          expectedGeometryType: "point" as const,
          target: { statementId: "stable-A", statementIndex: 1, geometryType: "point" as const }
        },
        {
          kind: "geometryReference" as const,
          expectedGeometryType: "point" as const,
          target: { statementId: "stable-B", statementIndex: 2, geometryType: "point" as const }
        }
      ]
    };
    expect(evaluateTypedExpression(node, { lookupBinding })).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-geometry-builtin-unavailable"
    });
  });
});

describe("evaluateTypedExpression / geometry measurement builtins", () => {
  const start = computedPoint("start", 0, 0);
  const threeFour = computedPoint("three-four", 3, 4);
  const horizontalLine = computedLine("horizontal", computedPoint("line-start", 0, 0), computedPoint("line-end", 1, 0));

  it("evaluates distance from runtime points and passes the stable target IDs to lookup", () => {
    const firstTarget = geometryTarget("stable-A", 1, "point");
    const secondTarget = geometryTarget("stable-B", 2, "point");
    const lookedUp: ScalarExpressionResolvedGeometryTarget[] = [];
    const result = evaluateTypedExpression(
      geometryBuiltinCall("distance", [geometryReference("point", firstTarget), geometryReference("point", secondTarget)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => {
          lookedUp.push(target);
          return target.statementId === "stable-A" ? start : threeFour;
        }
      }
    );
    expect(result).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 5 } });
    expect(lookedUp).toEqual([firstTarget, secondTarget]);
  });

  it("returns zero for distance between the same point", () => {
    const target = geometryTarget("same", 1, "point");
    expect(evaluateTypedExpression(
      geometryBuiltinCall("distance", [geometryReference("point", target), geometryReference("point", target)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: () => start
      }
    )).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 0 } });
  });

  it.each([
    ["right", 1, 0, 0],
    ["up", 0, 1, 90],
    ["left", -1, 0, 180],
    ["down", 0, -1, 270],
    ["diagonal", 1, 1, 45],
    ["same", 0, 0, 0]
  ])("normalizes angle (%s) into [0, 360)", (_name, x, y, expected) => {
    const from = geometryTarget("from", 1, "point");
    const to = geometryTarget("to", 2, "point");
    expect(evaluateTypedExpression(
      geometryBuiltinCall("angle", [geometryReference("point", from), geometryReference("point", to)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => target.statementId === "from" ? start : computedPoint("to", x, y)
      }
    )).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: expected } });
  });

  it("measures distance to the infinite line without endpoint clamping", () => {
    const pointTarget = geometryTarget("point", 3, "point");
    const lineTarget = geometryTarget("line", 4, "line");
    expect(evaluateTypedExpression(
      geometryBuiltinCall("lineDistance", [geometryReference("point", pointTarget), geometryReference("line", lineTarget)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => target.statementId === "point" ? computedPoint("point", 10, 3) : horizontalLine
      }
    )).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 3 } });
  });

  it("fails with evaluation-zero-length-line for a zero-length line", () => {
    const pointTarget = geometryTarget("point", 1, "point");
    const lineTarget = geometryTarget("line", 2, "line");
    const zeroLengthLine = computedLine("zero", computedPoint("zero-start", 4, 4), computedPoint("zero-end", 4, 4));
    expect(evaluateTypedExpression(
      geometryBuiltinCall("lineDistance", [geometryReference("point", pointTarget), geometryReference("line", lineTarget)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => target.statementId === "point" ? start : zeroLengthLine
      }
    )).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-zero-length-line" });
  });

  describe("lineAngle", () => {
    const reversedParallelLine = computedLine(
      "reversed-parallel",
      computedPoint("reversed-parallel-start", 10, 5),
      computedPoint("reversed-parallel-end", 0, 5)
    );
    const verticalLine = computedLine(
      "vertical",
      computedPoint("vertical-start", 3, -2),
      computedPoint("vertical-end", 3, 8)
    );
    const diagonalLine = computedLine(
      "diagonal",
      computedPoint("diagonal-start", 100, 100),
      computedPoint("diagonal-end", 101, 101)
    );
    const direction135Line = computedLine(
      "direction-135",
      computedPoint("direction-135-start", 20, 20),
      computedPoint("direction-135-end", 19, 21)
    );
    const reverseHorizontalLine = computedLine(
      "reverse-horizontal",
      computedPoint("reverse-horizontal-start", 10, 0),
      computedPoint("reverse-horizontal-end", 0, 0)
    );
    const reverseDiagonalLine = computedLine(
      "reverse-diagonal",
      computedPoint("reverse-diagonal-start", 101, 101),
      computedPoint("reverse-diagonal-end", 100, 100)
    );
    const lines = new Map<string, ComputedLine>([
      [horizontalLine.elementId, horizontalLine],
      [reversedParallelLine.elementId, reversedParallelLine],
      [verticalLine.elementId, verticalLine],
      [diagonalLine.elementId, diagonalLine],
      [direction135Line.elementId, direction135Line],
      [reverseHorizontalLine.elementId, reverseHorizontalLine],
      [reverseDiagonalLine.elementId, reverseDiagonalLine]
    ]);

    const evaluateLineAngle = (firstId: string, secondId: string) => evaluateTypedExpression(
      geometryBuiltinCall("lineAngle", [
        geometryReference("line", geometryTarget(firstId, 1, "line")),
        geometryReference("line", geometryTarget(secondId, 2, "line"))
      ]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => lines.get(target.statementId)
      }
    );

    it.each([
      ["parallel", horizontalLine.elementId, horizontalLine.elementId, 0],
      ["reversed parallel", horizontalLine.elementId, reversedParallelLine.elementId, 0],
      ["perpendicular", horizontalLine.elementId, verticalLine.elementId, 90],
      ["45 degrees", horizontalLine.elementId, diagonalLine.elementId, 45],
      ["135 directed difference", horizontalLine.elementId, direction135Line.elementId, 45],
      ["spatially separated lines", horizontalLine.elementId, diagonalLine.elementId, 45]
    ])("returns the directionless smaller angle for %s", (_name, firstId, secondId, expected) => {
      const result = evaluateLineAngle(firstId, secondId);
      expect(result.status).toBe("ok");
      if (result.status !== "ok" || result.value.kind !== "number") throw new Error("lineAngle should return a number");
      expect(result.value.value).toBeCloseTo(expected, 10);
    });

    it("is invariant under reversing either line and swapping arguments", () => {
      const baseline = evaluateLineAngle(horizontalLine.elementId, diagonalLine.elementId);
      const reverseFirst = evaluateLineAngle(reverseHorizontalLine.elementId, diagonalLine.elementId);
      const reverseSecond = evaluateLineAngle(horizontalLine.elementId, reverseDiagonalLine.elementId);
      const swapped = evaluateLineAngle(diagonalLine.elementId, horizontalLine.elementId);
      expect(baseline).toMatchObject({ status: "ok", value: { kind: "number" } });
      expect(reverseFirst).toMatchObject({ status: "ok", value: { kind: "number" } });
      expect(reverseSecond).toMatchObject({ status: "ok", value: { kind: "number" } });
      expect(swapped).toMatchObject({ status: "ok", value: { kind: "number" } });
      if (
        baseline.status !== "ok" || baseline.value.kind !== "number" ||
        reverseFirst.status !== "ok" || reverseFirst.value.kind !== "number" ||
        reverseSecond.status !== "ok" || reverseSecond.value.kind !== "number" ||
        swapped.status !== "ok" || swapped.value.kind !== "number"
      ) throw new Error("lineAngle invariance cases should return numbers");
      expect(reverseFirst.value.value).toBeCloseTo(baseline.value.value, 10);
      expect(reverseSecond.value.value).toBeCloseTo(baseline.value.value, 10);
      expect(swapped.value.value).toBeCloseTo(baseline.value.value, 10);
    });

    it.each(["first", "second"] as const)("rejects a zero-length %s line", (position) => {
      const zeroLengthLine = computedLine(
        `zero-${position}`,
        computedPoint(`zero-${position}-start`, 4, 4),
        computedPoint(`zero-${position}-end`, 4, 4)
      );
      const targetId = zeroLengthLine.elementId;
      const original = lines.get(horizontalLine.elementId)!;
      lines.set(targetId, zeroLengthLine);
      const result = position === "first"
        ? evaluateLineAngle(targetId, original.elementId)
        : evaluateLineAngle(original.elementId, targetId);
      expect(result).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-zero-length-line" });
    });
  });

  it.each([
    ["null target", geometryBuiltinCall("distance", [geometryReference("point", null), geometryReference("point", geometryTarget("B", 2, "point"))]), undefined],
    ["missing lookup", geometryBuiltinCall("distance", [geometryReference("point", geometryTarget("A", 1, "point")), geometryReference("point", geometryTarget("B", 2, "point"))]), undefined],
    ["geometry metadata mismatch", geometryBuiltinCall("distance", [geometryReference("point", geometryTarget("A", 1, "line")), geometryReference("point", geometryTarget("B", 2, "point"))]), () => start],
    ["unavailable runtime geometry", geometryBuiltinCall("distance", [geometryReference("point", geometryTarget("A", 1, "point")), geometryReference("point", geometryTarget("B", 2, "point"))]), () => undefined]
  ])("fails closed for %s", (_name, node, lookup) => {
    const result = evaluateTypedExpression(node, {
      lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
      ...(lookup ? { lookupGeometryTarget: lookup as (target: ScalarExpressionResolvedGeometryTarget) => ComputedGeometry | undefined } : {})
    });
    expect(result).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-builtin-unavailable" });
  });

  it("classifies a disabled geometry target separately from an unavailable target", () => {
    const target = geometryTarget("disabled", 1, "point");
    const result = evaluateTypedExpression(
      geometryBuiltinCall("distance", [geometryReference("point", target), geometryReference("point", target)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: () => ({ kind: "unavailable", reason: "disabled" })
      }
    );
    expect(result).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-builtin-disabled" });
  });

  it("rejects a point builtin argument backed by a runtime line", () => {
    const pointTarget = geometryTarget("line-runtime", 1, "point");
    const otherTarget = geometryTarget("point-runtime", 2, "point");
    expect(evaluateTypedExpression(
      geometryBuiltinCall("distance", [geometryReference("point", pointTarget), geometryReference("point", otherTarget)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => target.statementId === "line-runtime" ? horizontalLine : start
      }
    )).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-builtin-unavailable" });
  });

  it.each([
    ["point", start],
    ["path", { kind: "bezierCurve" } as ComputedGeometry]
  ])("rejects a line builtin argument backed by a runtime %s", (_name, runtimeGeometry) => {
    const pointTarget = geometryTarget("point", 1, "point");
    const lineTarget = geometryTarget("not-line", 2, "line");
    expect(evaluateTypedExpression(
      geometryBuiltinCall("lineDistance", [geometryReference("point", pointTarget), geometryReference("line", lineTarget)]),
      {
        lookupBinding: () => { throw new Error("geometry references must not use scalar lookup"); },
        lookupGeometryTarget: (target) => target.statementId === "point" ? start : runtimeGeometry
      }
    )).toEqual({ status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-builtin-unavailable" });
  });
});

describe("evaluateTypedExpression / runtime value trust boundary", () => {
  const mismatchedEnvironment: ScalarEvaluationEnvironment = {
    lookupBinding: () => ({ status: "ok", type: { kind: "string" }, value: { kind: "string", value: "not a number" } })
  };

  it("bare top-level reference is checked", () => {
    const node: TypedScalarExpression = {
      kind: "reference",
      span: { start: 0, end: 0 },
      nameSpan: { start: 0, end: 0 },
      name: "x",
      bindingId: "binding:x",
      type: { kind: "number" }
    };
    expect(evaluateTypedExpression(node, mismatchedEnvironment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-runtime-value-type-mismatch",
      bindingId: "binding:x"
    });
  });

  it("reference wrapped only in group is checked", () => {
    const node: TypedScalarExpression = {
      kind: "group",
      span: { start: 0, end: 0 },
      type: { kind: "number" },
      expression: {
        kind: "reference",
        span: { start: 0, end: 0 },
        nameSpan: { start: 0, end: 0 },
        name: "x",
        bindingId: "binding:x",
        type: { kind: "number" }
      }
    };
    expect(evaluateTypedExpression(node, mismatchedEnvironment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-runtime-value-type-mismatch",
      bindingId: "binding:x"
    });
  });

  it("reference as an operand of arithmetic is checked (and stops the whole expression)", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "+",
      type: { kind: "number" },
      left: {
        kind: "reference",
        span: { start: 0, end: 0 },
        nameSpan: { start: 0, end: 0 },
        name: "x",
        bindingId: "binding:x",
        type: { kind: "number" }
      },
      right: { kind: "numberLiteral", span: { start: 0, end: 0 }, value: 1, type: { kind: "number" } }
    };
    expect(evaluateTypedExpression(node, mismatchedEnvironment)).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-runtime-value-type-mismatch",
      bindingId: "binding:x"
    });
  });

  it("reference as an operand of equality is checked", () => {
    const node: TypedScalarExpression = {
      kind: "binary",
      span: { start: 0, end: 0 },
      operator: "==",
      type: { kind: "boolean" },
      left: {
        kind: "reference",
        span: { start: 0, end: 0 },
        nameSpan: { start: 0, end: 0 },
        name: "x",
        bindingId: "binding:x",
        type: { kind: "number" }
      },
      right: { kind: "numberLiteral", span: { start: 0, end: 0 }, value: 1, type: { kind: "number" } }
    };
    expect(evaluateTypedExpression(node, mismatchedEnvironment)).toEqual({
      status: "error",
      type: { kind: "boolean" },
      issueCode: "evaluation-runtime-value-type-mismatch",
      bindingId: "binding:x"
    });
  });
});

describe("evaluateTypedExpression / large expression sanity timing", () => {
  const numberLeaf = (): TypedScalarExpression => ({ kind: "numberLiteral", span: { start: 0, end: 0 }, value: 1, type: { kind: "number" } });

  /** A balanced tree keeps recursion depth at O(log leafCount) instead of
   * O(leafCount) - this evaluator is linear in AST node count, not stack
   * depth, && a left-deep chain would conflate the two. */
  const buildBalancedSumTree = (leafCount: number): TypedScalarExpression => {
    let level: TypedScalarExpression[] = Array.from({ length: leafCount }, () => numberLeaf());
    while (level.length > 1) {
      const next: TypedScalarExpression[] = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 >= level.length) {
          next.push(level[i]);
          continue;
        }
        next.push({
          kind: "binary",
          span: { start: 0, end: 0 },
          operator: "+",
          type: { kind: "number" },
          left: level[i],
          right: level[i + 1]
        });
      }
      level = next;
    }
    return level[0];
  };

  it("evaluates a wide balanced arithmetic tree in linear time (recorded only, no hard gate)", () => {
    const leafCount = 4096;
    const node = buildBalancedSumTree(leafCount);
    const environment: ScalarEvaluationEnvironment = { lookupBinding: () => { throw new Error("not used"); } };

    const start = performance.now();
    const result = evaluateTypedExpression(node, environment);
    const elapsedMs = performance.now() - start;

    expect(result).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: leafCount } });
    // Recorded only - no threshold assertion, per the task doc's performance section.
    console.info(`expressionEvaluator large-expression sanity: ${leafCount} nodes in ${elapsedMs.toFixed(2)}ms`);
  });
});
