import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { buildBindingCatalog, type Binding, type BindingCatalog } from "./bindingCatalog";
import { resolveBindingReferenceForTests, type BindingResolution } from "./bindingResolution";
import { parseScalarExpression } from "./expressionParser";
import type { ScalarExpressionAst } from "./expressionAst";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import type { ScalarExpressionResolvedReference, ScalarExpressionTypecheckResult } from "./typedExpressionAst";
import type { ScalarType } from "./types";
import * as builtinFunctions from "./builtinFunctions";
import type { BuiltinFunctionDefinition, BuiltinFunctionName } from "./builtinFunctions";

// --- shared fixtures -------------------------------------------------------

const fullSpan = (source: string) => ({ start: 0, end: source.length });

const astFor = (expr: string): ScalarExpressionAst => {
  const result = parseScalarExpression(expr, fullSpan(expr));
  if (!result.ast) throw new Error(`expected a successful parse of ${JSON.stringify(expr)}, got ${JSON.stringify(result)}`);
  return result.ast;
};

const check = (
  expr: string,
  expectedType: ScalarType | null = null,
  references: readonly (BindingResolution | ScalarExpressionResolvedReference)[] = []
): ScalarExpressionTypecheckResult => typecheckScalarExpression(astFor(expr), { expectedType, references });

/** Real DSL -> scope index -> binding catalog pipeline, mirroring the
 * `catalogFor` helper already used by bindingResolution.test.ts /
 * bindingAnalysis.test.ts, so this module's tests exercise genuine
 * `BindingResolution` values rather than reinventing binding semantics. */
const catalogFor = (source: string): BindingCatalog => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const statements: readonly DslStatement[] = parsed.statements;
  const stableIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  const scopeIndex = buildLexicalScopeIndex(statements, (index) => stableIds.get(index)!);
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 4 });
  const reconciledContainers = { elements: compiled.elements, elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map() };
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds, reconciledContainers });
  return buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex: stableIds,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });
};

const resolutionAt = (catalog: BindingCatalog, name: string, statementIndex: number, fromBindingId?: string): BindingResolution =>
  resolveBindingReferenceForTests(catalog, name, { scopeId: "root", statementIndex }, fromBindingId);

const choiceType = (options: readonly string[]): ScalarType => ({ kind: "choice", options });

/** Contract from typedExpressionAst.ts: one-way, not "iff". */
const assertInvariant = (result: ScalarExpressionTypecheckResult) => {
  if (result.type !== null) expect(result.diagnostics).toEqual([]);
  if (result.diagnostics.length > 0) expect(result.type).toBeNull();
};

const geometryResolution = (geometryType: "point" | "line" | "path"): ScalarExpressionResolvedReference => ({
  kind: "resolvedGeometry",
  target: { statementId: `stable-${geometryType}`, statementIndex: 0, geometryType }
});

const namedTestDefinition: BuiltinFunctionDefinition = {
  name: "namedTest" as BuiltinFunctionName,
  signatures: [{
    callingStyle: "named",
    parameters: [{ name: "first", type: { kind: "number" } }, { name: "second", type: { kind: "number" } }],
    returnType: { kind: "number" }
  }]
};

const withNamedTestBuiltin = () => {
  const original = builtinFunctions.getBuiltinFunctionDefinition;
  vi.spyOn(builtinFunctions, "getBuiltinFunctionDefinition").mockImplementation((name) =>
    name === "namedTest" ? namedTestDefinition : original(name)
  );
};

afterEach(() => vi.restoreAllMocks());

// --- operator cross product -------------------------------------------------

describe("typecheckScalarExpression / arithmetic operators (+ - * / % ^)", () => {
  it.each(["+", "-", "*", "/", "%", "^"])("accepts number %s number and yields number", (op) => {
    const result = check(`1 ${op} 2`);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
    assertInvariant(result);
  });

  it.each(["+", "-", "*", "/", "%", "^"])("rejects string %s string, flagging both operands independently", (op) => {
    const expr = `"a" ${op} "b"`;
    const result = check(expr);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((d) => d.code === "scalar-type-mismatch")).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({ span: { start: expr.indexOf('"a"'), end: expr.indexOf('"a"') + 3 } });
    expect(result.diagnostics[1]).toMatchObject({ span: { start: expr.indexOf('"b"'), end: expr.indexOf('"b"') + 3 } });
    assertInvariant(result);
  });

  it.each(["+", "-", "*", "/", "%", "^"])("flags only the bad operand when the other is valid", (op) => {
    const expr = `1 ${op} "a"`;
    const result = check(expr);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "scalar-type-mismatch",
      expectedType: { kind: "number" },
      actualType: { kind: "string" },
      span: { start: expr.indexOf('"a"'), end: expr.indexOf('"a"') + 3 }
    });
    assertInvariant(result);
  });

  it.each([
    ['"2" ^ 3', { kind: "string" }],
    ["5 % true", { kind: "boolean" }]
  ] as const)("does not implicitly convert non-number operands in %s", (expr, actualType) => {
    const result = check(expr);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "scalar-type-mismatch", actualType })
    ]);
    assertInvariant(result);
  });
});

describe("typecheckScalarExpression / numeric comparison (< <= > >=)", () => {
  it.each(["<", "<=", ">", ">="])("accepts number %s number and yields boolean", (op) => {
    const result = check(`1 ${op} 2`);
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["<", "<=", ">", ">="])("flags only the non-number side for %s", (op) => {
    const expr = `1 ${op} "a"`;
    const result = check(expr);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].actualType).toEqual({ kind: "string" });
  });
});

describe("typecheckScalarExpression / logical operators ( and   or )", () => {
  it.each([" and ", " or "])("accepts boolean %s boolean and yields boolean", (op) => {
    const result = check(`true ${op} false`);
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it.each([" and ", " or "])("flags only the non-boolean left operand for %s, no evaluation/short-circuit performed", (op) => {
    const result = check(`1 ${op} true`);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ expectedType: { kind: "boolean" }, actualType: { kind: "number" } });
  });
});

describe("typecheckScalarExpression / unary operators", () => {
  it("accepts ! on boolean and yields boolean", () => {
    const result = check("!true");
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects ! on a non-boolean operand", () => {
    const result = check("!1");
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "scalar-type-mismatch", expectedType: { kind: "boolean" } })]);
  });

  it.each(["-", "+"])("accepts unary %s on number and yields number", (op) => {
    const result = check(`${op}1`);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["-", "+"])("rejects unary %s on a non-number operand", (op) => {
    const result = check(`${op}true`);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "scalar-type-mismatch", expectedType: { kind: "number" } })]);
  });

  it("flags the exact nested operand span through unary + group + arithmetic wrapping", () => {
    const expr = '!(1 + "a")';
    const result = check(expr);
    // Cascade suppression: only the inner arithmetic's own mismatch is
    // reported; the group && the outer `!` both propagate `null` silently.
    expect(result.diagnostics).toHaveLength(1);
    const start = expr.indexOf('"a"');
    expect(result.diagnostics[0]).toMatchObject({ code: "scalar-type-mismatch", span: { start, end: start + 3 } });
    expect(result.type).toBeNull();
  });
});

describe("typecheckScalarExpression / builtin calls", () => {
  it("canonicalizes reversed named arguments while preserving source reference traversal order", () => {
    withNamedTestBuiltin();
    const result = check("namedTest(second: @b, first: @a)", null, [
      { kind: "resolvedType", bindingId: "binding-b", type: { kind: "number" } },
      { kind: "resolvedType", bindingId: "binding-a", type: { kind: "number" } }
    ]);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      kind: "call",
      args: [
        { kind: "scalar", expression: { kind: "reference", bindingId: "binding-a" } },
        { kind: "scalar", expression: { kind: "reference", bindingId: "binding-b" } }
      ]
    });
  });

  it.each([
    ["namedTest(third: 1, first: 2)", "unknown-function-argument"],
    ["namedTest(first: 1, first: 2)", "duplicate-function-argument"],
    ["namedTest(first: 1)", "missing-function-argument"]
  ] as const)("reports named argument diagnostic %s", (source, code) => {
    withNamedTestBuiltin();
    const result = check(source);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
    expect(result.type).toBeNull();
  });

  it("rejects positional and mixed calls for a named-only signature", () => {
    withNamedTestBuiltin();
    expect(check("namedTest(1, second: 2)").diagnostics).toEqual([
      expect.objectContaining({ code: "function-call-style-mismatch" })
    ]);
    expect(check("namedTest(1, 2)").diagnostics).toEqual([
      expect.objectContaining({ code: "function-call-style-mismatch" })
    ]);
  });

  it("rejects named calls for an existing positional-only builtin", () => {
    const result = check("atan2(y: 1, x: 0)");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "function-call-style-mismatch" })
    ]);
  });

  it("checks named argument value types", () => {
    withNamedTestBuiltin();
    const result = check('namedTest(first: "wrong", second: 2)');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "scalar-type-mismatch" })
    ]);
  });

  it("keeps unknown named calls on the unknown-function diagnostic", () => {
    const result = check("unknownFunction(first: @a, second: @b)", null, [
      { kind: "resolvedType", bindingId: "binding-a", type: { kind: "number" } },
      { kind: "resolvedType", bindingId: "binding-b", type: { kind: "number" } }
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unknown-function" })
    ]);
    expect(result.typed).toMatchObject({
      args: [
        { expression: { kind: "reference", bindingId: "binding-a" } },
        { expression: { kind: "reference", bindingId: "binding-b" } }
      ]
    });
  });

  it.each([
    ["distance(@a, @b)", ["point", "point"], "number"],
    ["angle(@a, @b)", ["point", "point"], "number"],
    ["lineDistance(@a, @b)", ["point", "line"], "number"]
  ])("accepts geometry arguments for %s", (source, geometryTypes, resultKind) => {
    const result = check(source, null, geometryTypes.map((type) => geometryResolution(type as "point" | "line" | "path")));
    expect(result.type).toEqual({ kind: resultKind });
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({ kind: "call", type: { kind: resultKind }, args: [
      {
        kind: "geometryReference",
        expectedGeometryType: geometryTypes[0],
        target: { statementId: `stable-${geometryTypes[0]}`, statementIndex: 0, geometryType: geometryTypes[0] }
      },
      {
        kind: "geometryReference",
        expectedGeometryType: geometryTypes[1],
        target: { statementId: `stable-${geometryTypes[1]}`, statementIndex: 0, geometryType: geometryTypes[1] }
      }
    ] });
    const args = (result.typed as Extract<typeof result.typed, { kind: "call" }>).args;
    expect(args.every((argument) => argument.kind === "geometryReference" && !("name" in argument))).toBe(true);
  });

  it.each([
    ["distance(@a, @b)", ["line", "point"]],
    ["lineDistance(@a, @b)", ["point", "path"]]
  ])("fails closed for a geometry interface mismatch in %s", (source, geometryTypes) => {
    const result = check(source, null, geometryTypes.map((type) => geometryResolution(type as "point" | "line" | "path")));
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      kind: "call",
      type: null,
      args: geometryTypes.map((geometryType, index) => ({
        kind: "geometryReference",
        expectedGeometryType: source.startsWith("distance") ? "point" : index === 0 ? "point" : "line",
        target: { geometryType }
      }))
    });
  });

  it("fails closed when a resolved geometry sidecar reaches a scalar parameter", () => {
    const result = check("abs(@a)", null, [geometryResolution("point")]);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      args: [{ kind: "scalar", expression: { kind: "reference", bindingId: null, type: null } }]
    });
  });

  it("preserves a null target for an unresolved geometry argument", () => {
    const result = check("distance(@missing, @b)", null, [
      { kind: "resolvedGeometry", target: null },
      geometryResolution("point")
    ]);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      kind: "call",
      args: [
        { kind: "geometryReference", expectedGeometryType: "point", target: null },
        { kind: "geometryReference", expectedGeometryType: "point", target: { geometryType: "point" } }
      ]
    });
  });

  it("turns a resolved geometryProperty sidecar into a point geometryReference", () => {
    const source = "distance(@AB.start, @C)";
    const result = check(source, null, [geometryResolution("point")]);
    const start = source.indexOf("@AB.start");
    const target = { statementId: "stable-AB", statementIndex: 1, geometryType: "point" as const, pointKey: "start" };
    const withSidecar = typecheckScalarExpression(astFor(source), {
      expectedType: null,
      references: [geometryResolution("point")],
      geometryBuiltinArguments: new Map([[start, target]])
    });

    expect(result.type).toBeNull();
    if (result.typed.kind !== "call") throw new Error("expected call");
    expect(result.typed.args[0]).toMatchObject({ kind: "geometryReference", target: null });
    expect(withSidecar.type).toEqual({ kind: "number" });
    if (withSidecar.typed.kind !== "call") throw new Error("expected call");
    expect(withSidecar.typed.args[0]).toMatchObject({ kind: "geometryReference", expectedGeometryType: "point", target });
  });

  it.each([
    ["abs(-1)", "abs", "number"],
    ["min(1, 2)", "min", "number"],
    ["max(1, 2)", "max", "number"],
    ["sqrt(25)", "sqrt", "number"],
    ["round(1)", "round", "number"],
    ["round(1, 2)", "round", "number"],
    ["floor(1)", "floor", "number"],
    ["floor(1, 2)", "floor", "number"],
    ["ceil(1)", "ceil", "number"],
    ["ceil(1, 2)", "ceil", "number"],
    ["roundTo(1, 0.5)", "roundTo", "number"],
    ["isClose(1, 2, 0.5)", "isClose", "boolean"]
  ])("resolves %s to a typed builtin call", (source, name, resultKind) => {
    const result = check(source);
    expect(result.type).toEqual({ kind: resultKind });
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      kind: "call",
      name,
      target: { kind: "builtin", name },
      type: { kind: resultKind },
      args: expect.arrayContaining([expect.objectContaining({ kind: "scalar" })])
    });
    assertInvariant(result);
  });

  it("typechecks nested builtin calls and preserves argument order", () => {
    const result = check("roundTo(max(abs(1), abs(2)), 0.5)");
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
    expect(result.typed).toMatchObject({
      kind: "call",
      name: "roundTo",
      args: [
        {
          kind: "scalar",
          expression: {
            kind: "call",
            name: "max",
            args: [
              { kind: "scalar", expression: { kind: "call", name: "abs" } },
              { kind: "scalar", expression: { kind: "call", name: "abs" } }
            ]
          }
        },
        { kind: "scalar", expression: { value: 0.5 } }
      ]
    });
  });

  it("reports an unknown function at its name span while still consuming all argument references", () => {
    const source = "unknownFunction(@a, @b)";
    const resolution = (name: string): BindingResolution => ({ kind: "undefined", name, scopeId: "root", statementIndex: 0 });
    const result = check(source, null, [resolution("a"), resolution("b")]);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unknown-function", span: { start: 0, end: "unknownFunction".length } })
    ]);
    expect(result.typed).toMatchObject({
      kind: "call",
      target: null,
      args: [
        { kind: "scalar", expression: { kind: "reference" } },
        { kind: "scalar", expression: { kind: "reference" } }
      ]
    });
    expect(collectScalarExpressionReferences(astFor(source)).map((reference) => reference.name)).toEqual(["a", "b"]);
  });

  it.each([
    "abs()",
    "abs(1, 2)",
    "min(1)",
    "max(1, 2, 3)",
    "round(1, 2, 3)",
    "isClose(1, 2)",
    "distance()",
    "angle()",
    "lineDistance()"
  ])("reports an arity mismatch for %s", (source) => {
    const result = check(source);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "function-arity-mismatch", span: { start: 0 } });
    assertInvariant(result);
  });

  it.each([
    ["abs(\"x\")", { start: 4, end: 7 }],
    ["min(true, 1)", { start: 4, end: 8 }],
    ["round(1, \"2\")", { start: 9, end: 12 }],
    ["isClose(1, 2, false)", { start: 14, end: 19 }]
  ])("reports scalar-type-mismatch for invalid builtin arguments in %s", (source, span) => {
    const result = check(source);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "scalar-type-mismatch", span });
    assertInvariant(result);
  });
});

// --- equality: kind pairing && choice identity/order (D07) ----------------

describe("typecheckScalarExpression / equality operand-kind pairing", () => {
  it.each([
    ["number", "1", "2"],
    ["string", '"a"', '"a"'],
    ["boolean", "true", "false"]
  ])("accepts %s == %s and != as boolean", (_label, left, right) => {
    expect(check(`${left} == ${right}`).type).toEqual({ kind: "boolean" });
    expect(check(`${left} != ${right}`).type).toEqual({ kind: "boolean" });
  });

  it("rejects a cross-kind equality, flagging the whole node span", () => {
    const expr = '1 == "a"';
    const result = check(expr);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "scalar-type-mismatch",
        span: fullSpan(expr),
        expectedType: { kind: "number" },
        actualType: { kind: "string" }
      })
    ]);
  });

  it("accepts choice == choice with identical options and order", () => {
    const catalog = catalogFor(["const a: choice(right, left) = right", "const b: choice(right, left) = left", "const use: boolean = true"].join("\n"));
    const references = [resolutionAt(catalog, "a", 2), resolutionAt(catalog, "b", 2)];
    const result = check("@a == @b", null, references);
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects choice == choice with the same members but different order (D07)", () => {
    const catalog = catalogFor(["const a: choice(right, left) = right", "const b: choice(left, right) = left", "const use: boolean = true"].join("\n"));
    const references = [resolutionAt(catalog, "a", 2), resolutionAt(catalog, "b", 2)];
    const expr = "@a == @b";
    const result = check(expr, null, references);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "scalar-type-mismatch", span: fullSpan(expr) })]);
  });

  it("rejects choice == choice with a different option set", () => {
    const catalog = catalogFor([
      "const a: choice(right, left) = right",
      "const b: choice(right, left, center) = left",
      "const use: boolean = true"
    ].join("\n"));
    const references = [resolutionAt(catalog, "a", 2), resolutionAt(catalog, "b", 2)];
    const result = check("@a == @b", null, references);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "scalar-type-mismatch" })]);
  });
});

// --- bare choice literal resolution -----------------------------------------

describe("typecheckScalarExpression / bare choice literal resolution", () => {
  it("resolves a bare choice literal against the top-level expected choice type (plan.md example)", () => {
    const result = check("right", choiceType(["right", "left"]));
    expect(result.type).toEqual(choiceType(["right", "left"]));
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a bare choice literal that is not a member of the expected type", () => {
    const result = check("up", choiceType(["right", "left"]));
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "invalid-choice-literal", expectedType: choiceType(["right", "left"]) })]);
  });

  it("flags a bare choice literal with no expected-type context reaching it at all", () => {
    const result = check("right", null);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "invalid-choice-literal" })]);
    expect(result.diagnostics[0].expectedType).toBeUndefined();
  });

  it("threads the expected type through nested groups", () => {
    const result = check("((right))", choiceType(["right", "left"]));
    expect(result.type).toEqual(choiceType(["right", "left"]));
    expect(result.diagnostics).toEqual([]);
  });

  it("never propagates an expected choice type into an arithmetic/logical/unary operand position", () => {
    // `right` here has no reachable expected type (unary `!`'s operand call
    // always passes null downward), so it fails on its own terms - not
    // because of a spurious "expected boolean" complaint from `!`.
    const result = check("!(right)", choiceType(["right", "left"]));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("invalid-choice-literal");
  });

  it("hints a bare literal on the right from a resolved choice-typed reference on the left", () => {
    const catalog = catalogFor(["const d: choice(right, left) = right", "const use: boolean = true"].join("\n"));
    const dResolution = resolutionAt(catalog, "d", 1);
    expect(dResolution.kind).toBe("resolved");
    const result = check("@d == left", null, [dResolution]);
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it("hints a bare literal on the left from a resolved choice-typed reference on the right", () => {
    const catalog = catalogFor(["const d: choice(right, left) = right", "const use: boolean = true"].join("\n"));
    const dResolution = resolutionAt(catalog, "d", 1);
    const result = check("left == @d", null, [dResolution]);
    expect(result.type).toEqual({ kind: "boolean" });
    expect(result.diagnostics).toEqual([]);
  });

  it("flags both sides when both are bare choice literals with nothing to hint each other", () => {
    const result = check("right == left", null);
    expect(result.type).toBeNull();
    expect(result.diagnostics.filter((d) => d.code === "invalid-choice-literal")).toHaveLength(2);
    expect(result.diagnostics.some((d) => d.code === "scalar-type-mismatch")).toBe(false);
  });
});

// --- declaration expected type ----------------------------------------------

describe("typecheckScalarExpression / declaration expected type", () => {
  it("reports a mismatch once at the whole expression span, preserving the literal's own honest type", () => {
    const expr = "5";
    const result = check(expr, { kind: "string" });
    expect(result.typed).toMatchObject({ kind: "numberLiteral", type: { kind: "number" } });
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "scalar-type-mismatch",
        span: fullSpan(expr),
        expectedType: { kind: "string" },
        actualType: { kind: "number" }
      })
    ]);
  });

  it("never reports a top-level mismatch when there is no expected type", () => {
    expect(check("5", null).diagnostics).toEqual([]);
  });
});

// --- reference binding ID attachment ----------------------------------------

describe("typecheckScalarExpression / reference binding ID attachment", () => {
  it("attaches a typed binding's declared type and stable ID", () => {
    const catalog = catalogFor(["const width: number = 12", "const use: number = @width"].join("\n"));
    const resolution = resolutionAt(catalog, "width", 1);
    expect(resolution.kind).toBe("resolved");
    const result = check("@width", { kind: "number" }, [resolution]);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.typed).toMatchObject({ kind: "reference", bindingId: "binding:stable-0", type: { kind: "number" } });
  });

  it("infers an implicit number type for a resolved iteration binding (null declaredType)", () => {
    const catalog = catalogFor(["for i in range(from: 0, count: 2) {", "  const use: number = @i", "}"].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "i", { scopeId: "for:stable-0", statementIndex: 1 });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind === "resolved") expect(resolution.binding.kind).toBe("iteration");
    const result = check("@i", { kind: "number" }, [resolution]);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves interleaved references across a tree in correct left-to-right order", () => {
    const catalog = catalogFor([
      "for a in range(from: 0, count: 1) {",
      "  for b in range(from: 0, count: 1) {",
      "    for c in range(from: 0, count: 1) {",
      "      const use: number = @a",
      "    }",
      "  }",
      "}"
    ].join("\n"));
    const site = { scopeId: "for:stable-2", statementIndex: 3 };
    const [aRes, bRes, cRes] = [
      resolveBindingReferenceForTests(catalog, "a", site),
      resolveBindingReferenceForTests(catalog, "b", site),
      resolveBindingReferenceForTests(catalog, "c", site)
    ];
    const result = check("@a + @b * @c", { kind: "number" }, [aRes, bRes, cRes]);
    expect(result.type).toEqual({ kind: "number" });
    expect(result.diagnostics).toEqual([]);
    if (result.typed.kind !== "binary" || result.typed.right.kind !== "binary") throw new Error("expected + over (b * c)");
    expect(result.typed.left).toMatchObject({ name: "a", bindingId: "binding:iteration:stable-0" });
    expect(result.typed.right.left).toMatchObject({ name: "b", bindingId: "binding:iteration:stable-1" });
    expect(result.typed.right.right).toMatchObject({ name: "c", bindingId: "binding:iteration:stable-2" });
  });
});

// --- poisoned/invalid reference propagation ---------------------------------

describe("typecheckScalarExpression / poisoned or unresolved references", () => {
  it("propagates an undefined reference as invalid without a new diagnostic, and cascades silently", () => {
    const catalog = catalogFor("const a: number = 1");
    const resolution = resolutionAt(catalog, "missing", 0);
    expect(resolution.kind).toBe("undefined");
    const result = check("@missing + 1", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
    if (result.typed.kind !== "binary") throw new Error("expected binary");
    expect(result.typed.left).toMatchObject({ kind: "reference", bindingId: null, type: null });
  });

  it("propagates a forward reference as invalid without a new diagnostic", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = 1"].join("\n"));
    const resolution = resolutionAt(catalog, "b", 0);
    expect(resolution.kind).toBe("forward");
    const result = check("@missing + 1", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
  });

  it("propagates a self-initialization reference as invalid without a new diagnostic", () => {
    const catalog = catalogFor("const x: number = @x");
    const resolution = resolutionAt(catalog, "x", 0, "binding:stable-0");
    expect(resolution.kind).toBe("self");
    const result = check("@missing + 1", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
  });

  it("propagates a duplicate reference as invalid without a new diagnostic", () => {
    const catalog = catalogFor(["const x: number = 1", "let x: number = 2", "const use: number = @x"].join("\n"));
    const resolution = resolutionAt(catalog, "x", 2);
    expect(resolution.kind).toBe("duplicate");
    const result = check("@missing + 1", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
  });

  it("propagates a resolved typed binding with a null declaredType (malformed annotation) as invalid, without a new diagnostic", () => {
    const binding: Binding = {
      id: "binding:malformed",
      kind: "typed",
      name: "bad",
      nameSpan: null,
      statementIndex: 0,
      effectiveScopeId: "root",
      visibility: { kind: "typed", scopeId: "root" },
      mutability: "const",
      declaredType: null,
      rank: 0
    };
    const resolution: BindingResolution = { kind: "resolved", binding };
    const result = check("@bad", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
    expect(result.typed).toMatchObject({ kind: "reference", bindingId: "binding:malformed", type: null });
  });

  it("cascades nested poisoning through group/arithmetic/equality without diagnostic pileup", () => {
    const catalog = catalogFor("const a: number = 1");
    const resolution = resolutionAt(catalog, "missing", 0);
    const result = check("(@missing + 1) == 2", null, [resolution]);
    expect(result.diagnostics).toEqual([]);
    expect(result.type).toBeNull();
  });
});

// --- reference cursor contract ----------------------------------------------

describe("typecheckScalarExpression / reference cursor contract", () => {
  it("throws when fewer BindingResolutions are supplied than reference nodes", () => {
    expect(() => typecheckScalarExpression(astFor("@a + @b"), { expectedType: null, references: [] })).toThrow(/expressionTypecheck/);
  });

  it("throws when more BindingResolutions are supplied than reference nodes", () => {
    const resolution: BindingResolution = { kind: "undefined", name: "a", scopeId: "root", statementIndex: 0 };
    expect(() => typecheckScalarExpression(astFor("@a"), { expectedType: null, references: [resolution, resolution] })).toThrow(/expressionTypecheck/);
  });
});

// --- invariant --------------------------------------------------------------

describe("typecheckScalarExpression / type-vs-diagnostics invariant", () => {
  it("type !== null implies zero diagnostics", () => {
    assertInvariant(check("1 + 2"));
  });

  it("diagnostics.length > 0 implies type === null", () => {
    assertInvariant(check('1 + "a"'));
  });

  it("allows type === null with zero diagnostics for silent binding-invalidity propagation", () => {
    const catalog = catalogFor("const a: number = 1");
    const resolution = resolutionAt(catalog, "missing", 0);
    const result = check("@missing", null, [resolution]);
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });
});
