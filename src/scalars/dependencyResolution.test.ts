import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { createLazyScalarProgramEvaluator, finalizeScalarProgramEvaluation } from "./declarationEvaluator";
import * as expressions from "./expressionEvaluator";
import type { ScalarEvaluation } from "@nuinuicad/nui-language";
import reducer from "../../test/fixtures/issue-1474/continuation-2/R1-oracle.json";

const compiledProgram = (lines: string[]) => {
  const result = compileFreshCanonicalText(["nui 1", ...lines].join("\n"));
  expect(result.status, JSON.stringify(result.diagnostics)).not.toBe("fatal");
  const compiled = result.doc;
  expect(compiled.diagnostics).toEqual([]);
  const program = compiled.scalarProgram!;
  const id = (name: string) => compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === name)!.id;
  return { program, id };
};

afterEach(() => vi.restoreAllMocks());

describe("dependency resolution native stack safety", () => {
  it("resolves the independently sealed eight diamonds with bounded native resolver depth", () => {
    const source = readFileSync("test/fixtures/issue-1474/continuation-2/R1.nui", "utf8");
    expect(createHash("sha256").update(source).digest("hex")).toBe(reducer.sourceSha256);
    const compiled = compileFreshCanonicalText(source).doc;
    const program = compiled.scalarProgram!;
    expect(compiled.diagnostics).toEqual([]);
    let peak = 0;
    const measure = () => {
      const trace = new Error().stack ?? "";
      const depth = trace.split("\n").filter(line => /\bat (?:Object\.)?resolve\b/.test(line) && line.includes("declarationEvaluator")).length;
      peak = Math.max(peak, depth);
    };
    const originalLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 1000;
    const original = expressions.evaluateTypedExpression;
    vi.spyOn(expressions, "evaluateTypedExpression").mockImplementation((...args) => { measure(); return original(...args); });
    const originalContinuation = expressions.createTypedExpressionEvaluation;
    // The optional hooks also let the same small discriminator run against
    // the unmodified owner during a safe repair-removal experiment.
    if (originalContinuation) vi.spyOn(expressions, "createTypedExpressionEvaluation").mockImplementation((...args) => { measure(); return originalContinuation(...args); });
    const OriginalDemand = expressions.ScalarBindingDemand;
    if (OriginalDemand) {
      const demandConstructor = vi.spyOn(expressions, "ScalarBindingDemand");
      if (demandConstructor.prototype !== OriginalDemand.prototype) Object.setPrototypeOf(demandConstructor.prototype, OriginalDemand.prototype);
      demandConstructor.mockImplementation(function(bindingId: string) {
        measure();
        // Preserve instanceof for both the imported spy and the original
        // module-local marker while observing the nested resolve entry.
        const demand = new OriginalDemand(bindingId);
        Object.setPrototypeOf(demand, demandConstructor.prototype);
        return demand;
      });
    }
    try {
      const evaluator = createLazyScalarProgramEvaluator(program);
      const sink = program.statements.find(s => compiled.bindingAnalysis!.catalog.bindingsById.get(s.bindingId)?.name === "Join7")!;
      expect(evaluator.resolve(sink.bindingId)).toMatchObject({ status: "ok", value: { kind: "number", value: 31 } });
      const finalized = finalizeScalarProgramEvaluation(program, evaluator).resultsByBindingId;
      expect(finalized.size).toBe(25);
      for (const [name, value] of Object.entries(reducer.scalars)) {
        const binding = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === name)!;
        expect(finalized.get(binding.id)).toMatchObject({ status: "ok", value: { kind: "number", value } });
      }
      console.log(`#1474 TS eight-diamond native resolver depth=${peak}`);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(2);
    } finally { Error.stackTraceLimit = originalLimit; }
  });

  it("resolves a longer chain, memoizes shared prerequisites, and preserves final insertion order", () => {
    const { program, id } = compiledProgram([
      "const Root: number = 13",
      ...Array.from({ length: 64 }, (_, i) => `const Chain${i}: number = @${i ? `Chain${i - 1}` : "Root"} + 1`),
      "const Shared: number = @Chain63 + @Chain63"
    ]);
    const starts = vi.spyOn(expressions, "createTypedExpressionEvaluation");
    const evaluator = createLazyScalarProgramEvaluator(program);
    expect(evaluator.resolve(id("Shared"))).toMatchObject({ status: "ok", value: { value: 154 } });
    const count = starts.mock.calls.length;
    expect(count).toBe(66);
    const finalized = finalizeScalarProgramEvaluation(program, evaluator);
    expect([...finalized.resultsByBindingId.keys()]).toEqual(program.statements.map(s => s.bindingId));
    expect(starts).toHaveBeenCalledTimes(count);
    const other = compiledProgram(["const Root: number = 29"]);
    expect(createLazyScalarProgramEvaluator(other.program).resolve(other.id("Root"))).toMatchObject({ status: "ok", value: { value: 29 } });
  });

  it("preserves selected cycles, inactive branches, missing errors and short circuit selection", () => {
    for (const controller of [true, false]) {
      const { program, id } = compiledProgram([
        `const flag: boolean = ${controller}`,
        "const selected: number = if (@flag) { @other } else { 10 }",
        "const other: number = @selected",
        "const short: boolean = false && (@selected == 100)"
      ]);
      const evaluator = createLazyScalarProgramEvaluator(program);
      expect(evaluator.resolve(id("selected"))).toMatchObject(controller
        ? { status: "error", issueCode: "evaluation-binding-cycle-guard" }
        : { status: "ok", value: { value: 10 } });
      expect(evaluator.resolve(id("short"))).toMatchObject({ status: "ok", value: { value: false } });
      expect(evaluator.resolve("missing")).toMatchObject({ status: "error", issueCode: "evaluation-binding-unavailable", bindingId: "missing" });
    }
  });

  it("retries transient geometry values after progress and retains source-specific lookup context", () => {
    const { program, id } = compiledProgram([
      "line Base = segment(start: (0, 0), end: (17, 0))",
      "const length: number = @Base.length",
      "const result: number = @length + @length"
    ]);
    let ready = false;
    const orders: number[] = [];
    const lookup = vi.fn((_reference, sourceOrder: number): ScalarEvaluation => {
      orders.push(sourceOrder);
      return ready ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 17 } }
        : { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
    });
    const evaluator = createLazyScalarProgramEvaluator(program, lookup);
    expect(evaluator.resolve(id("result"))).toMatchObject({ status: "error", issueCode: "evaluation-geometry-property-unavailable" });
    ready = true;
    expect(evaluator.resolve(id("result"))).toMatchObject({ status: "ok", value: { value: 34 } });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(orders).toEqual([program.statements[0].sourceOrder, program.statements[0].sourceOrder]);
  });

  it("records reached expression observations once in order across a suspended lookup", () => {
    const { program } = compiledProgram(["const a: number = 7", "const b: number = @a + 2"]);
    const node = program.statements[1].declaration.initializer;
    let ready = false;
    const observed: string[] = [];
    const expression = expressions.createTypedExpressionEvaluation(node, {
      lookupBinding: bindingId => {
        if (!ready) throw new expressions.ScalarBindingDemand(bindingId);
        return { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 7 } };
      },
      onExpressionEvaluated: reached => observed.push(reached.kind)
    });
    expect(expression.next().done).toBe(false);
    expect(observed).toEqual([]);
    ready = true;
    expect(expression.next()).toMatchObject({ done: true, value: { status: "ok", value: { value: 9 } } });
    expect(observed).toEqual(["reference", "numberLiteral", "binary"]);
  });

  it("retains local optional-match and record-map binders across deferred document dependencies", () => {
    const { program, id } = compiledProgram([
      "record Pair(x: number)",
      "const Root: number = 7",
      "const a: Pair = Pair(x: @Root)",
      "const b: Pair = Pair(x: @Root + 3)",
      "const pairs: Pair[] = [@a, @b]",
      "const mapped: Pair[] = for p in @pairs { Pair(x: @p.x + @Root) }",
      "const optional: number? = @Root",
      "const result: number = match @optional { none => 0 some n => @n + @mapped[1].x }"
    ]);
    const evaluator = createLazyScalarProgramEvaluator(program);
    expect(evaluator.resolve(id("result"))).toMatchObject({ status: "ok", value: { value: 24 } });
    expect(evaluator.resolve(id("Root"))).toMatchObject({ status: "ok", value: { value: 7 } });
    expect(evaluator.resolve(id("a.x"))).toMatchObject({ status: "ok", value: { value: 7 } });
    expect(evaluator.resolve(id("b.x"))).toMatchObject({ status: "ok", value: { value: 10 } });
  });
});
