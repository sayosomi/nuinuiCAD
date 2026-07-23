import { describe, expect, it } from "vitest";
import { createLazyScalarProgramEvaluator, evaluateScalarProgram, type ResolveExternalScalarBinding } from "./declarationEvaluator";
import type { ScalarProgram, ScalarProgramStatement } from "./scalarProgram";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarEvaluation, ScalarType } from "./types";

const DUMMY_SPAN = { start: 0, end: 0 };

const numberLiteral = (value: number): TypedScalarExpression => ({
  kind: "numberLiteral",
  span: DUMMY_SPAN,
  value,
  type: { kind: "number" }
});
const stringLiteral = (value: string): TypedScalarExpression => ({
  kind: "stringLiteral",
  span: DUMMY_SPAN,
  value,
  type: { kind: "string" }
});
const booleanLiteral = (value: boolean): TypedScalarExpression => ({
  kind: "booleanLiteral",
  span: DUMMY_SPAN,
  value,
  type: { kind: "boolean" }
});
const choiceLiteral = (value: string, options: readonly string[]): TypedScalarExpression => ({
  kind: "choiceLiteral",
  span: DUMMY_SPAN,
  value,
  type: { kind: "choice", options }
});
const reference = (name: string, bindingId: string, type: ScalarType): TypedScalarExpression => ({
  kind: "reference",
  span: DUMMY_SPAN,
  nameSpan: DUMMY_SPAN,
  name,
  bindingId,
  type
});

const declare = (
  bindingId: string,
  sourceOrder: number,
  bindingKind: "const" | "let",
  declaredType: ScalarType,
  initializer: TypedScalarExpression
): ScalarProgramStatement => ({
  kind: "declare",
  bindingId,
  scopeId: "root",
  sourceOrder,
  declaration: { bindingKind, declaredType, initializer }
});

const program = (statements: readonly ScalarProgramStatement[], evaluationLimitSourceOrder?: number): ScalarProgram =>
  evaluationLimitSourceOrder !== undefined ? { statements, evaluationLimitSourceOrder } : { statements };

const failingResolver: ResolveExternalScalarBinding = (bindingId) => {
  throw new Error(`unexpected external binding lookup: ${bindingId}`);
};

describe("evaluateScalarProgram", () => {
  it("evaluates a number/string/boolean/choice literal declaration each", () => {
    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(12)),
        declare("binding:b", 1, "const", { kind: "string" }, stringLiteral("前身頃")),
        declare("binding:c", 2, "let", { kind: "boolean" }, booleanLiteral(true)),
        declare("binding:d", 3, "const", { kind: "choice", options: ["right", "left"] }, choiceLiteral("right", ["right", "left"]))
      ]),
      failingResolver
    );

    expect(result.resultsByBindingId.get("binding:a")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 12 } });
    expect(result.resultsByBindingId.get("binding:b")).toEqual({ status: "ok", type: { kind: "string" }, value: { kind: "string", value: "前身頃" } });
    expect(result.resultsByBindingId.get("binding:c")).toEqual({ status: "ok", type: { kind: "boolean" }, value: { kind: "boolean", value: true } });
    expect(result.resultsByBindingId.get("binding:d")).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["right", "left"] },
      value: { kind: "choice", value: "right", options: ["right", "left"] }
    });
  });

  it("resolves a prior number binding reference", () => {
    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(10)),
        declare("binding:b", 1, "const", { kind: "number" }, reference("a", "binding:a", { kind: "number" }))
      ]),
      failingResolver
    );
    expect(result.resultsByBindingId.get("binding:b")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 10 } });
  });

  it("resolves a prior string binding reference", () => {
    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "string" }, stringLiteral("裾")),
        declare("binding:b", 1, "const", { kind: "string" }, reference("a", "binding:a", { kind: "string" }))
      ]),
      failingResolver
    );
    expect(result.resultsByBindingId.get("binding:b")).toEqual({ status: "ok", type: { kind: "string" }, value: { kind: "string", value: "裾" } });
  });

  it("resolves a prior boolean binding reference", () => {
    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "boolean" }, booleanLiteral(false)),
        declare("binding:b", 1, "const", { kind: "boolean" }, reference("a", "binding:a", { kind: "boolean" }))
      ]),
      failingResolver
    );
    expect(result.resultsByBindingId.get("binding:b")).toEqual({ status: "ok", type: { kind: "boolean" }, value: { kind: "boolean", value: false } });
  });

  it("resolves a prior choice binding reference", () => {
    const choiceType: ScalarType = { kind: "choice", options: ["front", "back"] };
    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", choiceType, choiceLiteral("back", ["front", "back"])),
        declare("binding:b", 1, "const", choiceType, reference("a", "binding:a", choiceType))
      ]),
      failingResolver
    );
    expect(result.resultsByBindingId.get("binding:b")).toEqual({
      status: "ok",
      type: choiceType,
      value: { kind: "choice", value: "back", options: ["front", "back"] }
    });
  });

  it("propagates a poisoned external binding reference through a dependent binding", () => {
    const externalError: ScalarEvaluation = {
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-external-binding-unavailable",
      bindingId: "binding:legacy-disabled"
    };
    let externalLookups = 0;
    const resolver: ResolveExternalScalarBinding = (bindingId) => {
      externalLookups += 1;
      expect(bindingId).toBe("binding:legacy-disabled");
      return externalError;
    };

    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, reference("legacy", "binding:legacy-disabled", { kind: "number" })),
        declare("binding:b", 1, "const", { kind: "number" }, {
          kind: "binary",
          span: DUMMY_SPAN,
          operator: "+",
          type: { kind: "number" },
          left: reference("a", "binding:a", { kind: "number" }),
          right: numberLiteral(1)
        })
      ]),
      resolver
    );

    expect(result.resultsByBindingId.get("binding:a")).toEqual(externalError);
    expect(result.resultsByBindingId.get("binding:b")).toMatchObject({ status: "error" });
    // Only statement "a" looks up the external binding; "b" reuses a's cached result.
    expect(externalLookups).toBe(1);
  });

  it("excludes statements at or after the evaluation limit source order", () => {
    const result = evaluateScalarProgram(
      program(
        [
          declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(1)),
          declare("binding:b", 1, "const", { kind: "number" }, numberLiteral(2)),
          declare("binding:c", 4, "const", { kind: "number" }, numberLiteral(3)),
          declare("binding:d", 5, "const", { kind: "number" }, numberLiteral(4))
        ],
        4
      ),
      failingResolver
    );

    expect([...result.resultsByBindingId.keys()]).toEqual(["binding:a", "binding:b"]);
  });

  it("resolves bindings out of array order on demand and still caches each at most once", () => {
    let externalLookups = 0;
    const evaluator = createLazyScalarProgramEvaluator(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(10)),
        declare("binding:b", 1, "const", { kind: "number" }, reference("a", "binding:a", { kind: "number" })),
        declare("binding:c", 2, "const", { kind: "number" }, reference("b", "binding:b", { kind: "number" }))
      ]),
      () => {
        externalLookups += 1;
        throw new Error("no external binding expected");
      }
    );

    // Ask for "c" first - it recurses through "b" into "a" on demand.
    expect(evaluator.resolve("binding:c")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 10 } });
    // Re-asking for "a"/"b" must hit the cache, not re-evaluate.
    expect(evaluator.resolve("binding:a")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 10 } });
    expect(evaluator.resolve("binding:b")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 10 } });
    expect(externalLookups).toBe(0);
  });

  it("evaluateScalarProgram's output order matches program.statements order even when a binding is resolved out of order first", () => {
    const evaluator = createLazyScalarProgramEvaluator(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(1)),
        declare("binding:b", 1, "const", { kind: "number" }, numberLiteral(2)),
        declare("binding:c", 2, "const", { kind: "number" }, numberLiteral(3))
      ]),
      failingResolver
    );
    // Force "c" to be cached before evaluateScalarProgram ever walks the array.
    evaluator.resolve("binding:c");

    const result = evaluateScalarProgram(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, numberLiteral(1)),
        declare("binding:b", 1, "const", { kind: "number" }, numberLiteral(2)),
        declare("binding:c", 2, "const", { kind: "number" }, numberLiteral(3))
      ]),
      failingResolver
    );
    expect([...result.resultsByBindingId.keys()]).toEqual(["binding:a", "binding:b", "binding:c"]);
  });

  it("throws instead of infinite-recursing on a cyclic reference (defense-in-depth against a synthetic, non-compiler-produced program)", () => {
    const evaluator = createLazyScalarProgramEvaluator(
      program([
        declare("binding:a", 0, "const", { kind: "number" }, reference("b", "binding:b", { kind: "number" })),
        declare("binding:b", 1, "const", { kind: "number" }, reference("a", "binding:a", { kind: "number" }))
      ]),
      failingResolver
    );
    expect(() => evaluator.resolve("binding:a")).toThrow(/cyclic reference/);
  });
});
