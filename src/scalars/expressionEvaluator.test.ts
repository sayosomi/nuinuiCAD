import { describe, expect, it } from "vitest";
import fixtureJson from "../../test/fixtures/typed-expressions.json";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { BuiltinFunctionName } from "./builtinFunctions";
import {
  buildMockEnvironment,
  decodeTypedExpressionNode,
  decodeVectorBindings
} from "./testSupport/typedExpressionVectorFixture";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarEvaluation } from "./types";

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
      issueCode: "evaluation-invalid-builtin-argument"
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
