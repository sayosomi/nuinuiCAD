import { describe, expect, it } from "vitest";
import { evaluateTextTemplate, type EvaluateLegacyHole } from "./textTemplateEvaluator";
import type { ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { TextTemplateAst, TextTemplateSegment } from "./textTemplate";
import type { ScalarEvaluation } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";

const span = (start: number, end: number) => ({ start, end });

const literalSegment = (cooked: string): TextTemplateSegment => ({
  kind: "literal",
  span: span(0, cooked.length),
  cookedRange: span(0, cooked.length),
  cooked
});

const stringReference = (name: string, bindingId: string): TypedScalarExpression => ({
  kind: "reference",
  span: span(0, 0),
  nameSpan: span(0, 0),
  name,
  bindingId,
  type: { kind: "string" }
});

const numberReference = (name: string, bindingId: string): TypedScalarExpression => ({
  kind: "reference",
  span: span(0, 0),
  nameSpan: span(0, 0),
  name,
  bindingId,
  type: { kind: "number" }
});

const stringHole = (bindingId: string, holeSpanEnd = 1): TextTemplateSegment => ({
  kind: "hole",
  holeKind: "string",
  span: span(0, holeSpanEnd),
  contentSpan: span(0, holeSpanEnd),
  cookedInsertOffset: 0,
  expression: stringReference(bindingId, bindingId)
});

const numberHole = (bindingId: string, holeSpanEnd = 1): TextTemplateSegment => ({
  kind: "hole",
  holeKind: "number",
  span: span(0, holeSpanEnd),
  contentSpan: span(0, holeSpanEnd),
  cookedInsertOffset: 0,
  expression: numberReference(bindingId, bindingId)
});

const legacyHoleSegment = (raw: string): TextTemplateSegment => ({
  kind: "hole",
  holeKind: "legacy",
  span: span(0, raw.length),
  contentSpan: span(0, raw.length),
  cookedInsertOffset: 0,
  raw
});

const templateOf = (segments: readonly TextTemplateSegment[]): TextTemplateAst => ({
  span: span(0, 0),
  quote: '"',
  raw: "",
  segments,
  dependencies: []
});

// Mirrors src/geometry/numericExpressions.ts's textNumber exactly (integer
// as-is, non-integer max 3 decimals with trailing zeros stripped) - kept
// local so this pure-scalars-layer test never imports the geometry layer.
const formatNumber = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/\.?0+$/, "");

const okEnvironment = (values: Record<string, ScalarEvaluation>): ScalarEvaluationEnvironment => ({
  lookupBinding: (bindingId) => {
    const result = values[bindingId];
    if (!result) throw new Error(`unexpected lookupBinding("${bindingId}")`);
    return result;
  }
});

const okString = (value: string): ScalarEvaluation => ({ status: "ok", type: { kind: "string" }, value: { kind: "string", value } });
const okNumber = (value: number): ScalarEvaluation => ({ status: "ok", type: { kind: "number" }, value: { kind: "number", value } });
const poisoned = (bindingId: string, issueCode = "evaluation-divide-by-zero"): ScalarEvaluation => ({
  status: "error",
  type: { kind: "number" },
  issueCode,
  bindingId
});

const alwaysOkLegacyHole: EvaluateLegacyHole = () => ({ ok: true, text: "12" });

describe("evaluateTextTemplate", () => {
  it("literal-only template (including escaped braces already cooked into the segment) returns the cooked text verbatim", () => {
    const ast = templateOf([literalSegment("cost {5} yen")]);
    expect(evaluateTextTemplate(ast, okEnvironment({}), alwaysOkLegacyHole, formatNumber)).toEqual({
      status: "ok",
      text: "cost {5} yen"
    });
  });

  it("典型的な string hole: 前身頃を2枚カット", () => {
    const ast = templateOf([stringHole("binding:label"), literalSegment("を2枚カット")]);
    const environment = okEnvironment({ "binding:label": okString("前身頃") });
    expect(evaluateTextTemplate(ast, environment, alwaysOkLegacyHole, formatNumber)).toEqual({
      status: "ok",
      text: "前身頃を2枚カット"
    });
  });

  it("number hole formats an integer as-is", () => {
    const ast = templateOf([numberHole("binding:count")]);
    const environment = okEnvironment({ "binding:count": okNumber(12) });
    expect(evaluateTextTemplate(ast, environment, alwaysOkLegacyHole, formatNumber)).toEqual({ status: "ok", text: "12" });
  });

  it("number hole formats a non-integer to max 3 decimals with trailing zeros stripped", () => {
    const ast = templateOf([numberHole("binding:length")]);
    const environment = okEnvironment({ "binding:length": okNumber(30.41421356) });
    expect(evaluateTextTemplate(ast, environment, alwaysOkLegacyHole, formatNumber)).toEqual({ status: "ok", text: "30.414" });
  });

  it("delegates legacy holes to the injected callback and splices its text in", () => {
    const ast = templateOf([literalSegment("前中心 "), legacyHoleSegment("直線AB.length")]);
    const legacy: EvaluateLegacyHole = (raw) => {
      expect(raw).toBe("直線AB.length");
      return { ok: true, text: "30.414" };
    };
    expect(evaluateTextTemplate(ast, okEnvironment({}), legacy, formatNumber)).toEqual({
      status: "ok",
      text: "前中心 30.414"
    });
  });

  it("interleaves literal, typed, and legacy holes in source order", () => {
    const ast = templateOf([
      literalSegment("A="),
      numberHole("binding:a"),
      literalSegment(", B="),
      legacyHoleSegment("直線AB.length"),
      literalSegment(", name="),
      stringHole("binding:name")
    ]);
    const environment = okEnvironment({ "binding:a": okNumber(2), "binding:name": okString("x") });
    const legacy: EvaluateLegacyHole = () => ({ ok: true, text: "30.414" });
    expect(evaluateTextTemplate(ast, environment, legacy, formatNumber)).toEqual({
      status: "ok",
      text: "A=2, B=30.414, name=x"
    });
  });

  it("fails closed on a poisoned typed binding, carrying the bindingId and issueCode into the message", () => {
    const ast = templateOf([numberHole("binding:poisoned")]);
    const environment = okEnvironment({ "binding:poisoned": poisoned("binding:poisoned") });
    const result = evaluateTextTemplate(ast, environment, alwaysOkLegacyHole, formatNumber);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.origin).toBe("typed");
      expect(result.error.dependencyId).toBe("binding:poisoned");
      expect(result.error.message).toContain("evaluation-divide-by-zero");
    }
  });

  it("fails closed on a failing legacy hole, passing the dependency id/name/message through unchanged", () => {
    const ast = templateOf([legacyHoleSegment("missing.length")]);
    const legacy: EvaluateLegacyHole = () => ({
      ok: false,
      message: "missing はこの要素より後にあるか、存在しません。",
      dependencyId: "missing",
      dependencyName: "missing"
    });
    const result = evaluateTextTemplate(ast, okEnvironment({}), legacy, formatNumber);
    expect(result).toEqual({
      status: "error",
      error: {
        holeSpan: span(0, "missing.length".length),
        origin: "legacy",
        message: "missing はこの要素より後にあるか、存在しません。",
        dependencyId: "missing",
        dependencyName: "missing"
      }
    });
  });

  it("stops at the first failing hole in source order and never evaluates a later one", () => {
    const ast = templateOf([numberHole("binding:first"), literalSegment(","), numberHole("binding:second")]);
    const environment: ScalarEvaluationEnvironment = {
      lookupBinding: (bindingId) => {
        if (bindingId === "binding:first") return poisoned("binding:first");
        throw new Error(`must not evaluate "${bindingId}" after an earlier hole already failed`);
      }
    };
    const result = evaluateTextTemplate(ast, environment, alwaysOkLegacyHole, formatNumber);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.dependencyId).toBe("binding:first");
  });

  it("fails closed if a typed evaluation somehow returns a value kind that doesn't match the hole's own kind (defensive - not reachable given Task 15's compile-time guarantee)", () => {
    const malformedStringHole: TextTemplateSegment = {
      kind: "hole",
      holeKind: "string",
      span: span(0, 1),
      contentSpan: span(0, 1),
      cookedInsertOffset: 0,
      // A well-typed compiler never produces this: a numberLiteral node
      // whose declared `type` claims "string".
      expression: { kind: "numberLiteral", span: span(0, 0), value: 5, type: { kind: "string" } } as unknown as TypedScalarExpression
    };
    const ast = templateOf([malformedStringHole]);
    const result = evaluateTextTemplate(ast, okEnvironment({}), alwaysOkLegacyHole, formatNumber);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.origin).toBe("typed");
  });
});
