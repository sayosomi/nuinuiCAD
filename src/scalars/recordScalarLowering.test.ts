import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { buildSourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import {
  planRecordScalarLowering,
  recordScalarBindingIdFor,
  recordScalarDeclarationVersionIdFor
} from "./recordScalarLowering";

const analyze = (source: string) => {
  const parsed = parseDsl(source);
  const stableIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
  const sourceNamespace = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);
  return {
    parsed,
    sourceNamespace,
    records: sourceNamespace.recordSemanticAnalysis!
  };
};

describe("record scalar lowering planner", () => {
  it("creates hidden constructor field bindings in record declaration order", () => {
    const { parsed, sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(left: number, right: string)",
      'const pair: Pair = Pair(right: "R", left: 1)'
    ].join("\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(sourceNamespace.diagnostics).toEqual([]);

    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    expect(plan.unresolvedValueStatementIds).toEqual([]);
    expect(plan.bindingSeeds).toHaveLength(2);
    expect(plan.bindingSeeds.map((binding) => ({
      name: binding.name,
      sourceOrder: binding.sourceOrder,
      type: binding.declaredType?.kind,
      resolutionMode: binding.resolutionMode
    }))).toEqual([
      { name: "pair.left", sourceOrder: 0, type: "number", resolutionMode: "preResolvedOnly" },
      { name: "pair.right", sourceOrder: 1, type: "string", resolutionMode: "preResolvedOnly" }
    ]);
    expect(plan.initializers.map((initializer) => ({
      fieldName: initializer.fieldName,
      raw: initializer.raw,
      sourceOrder: initializer.sourceOrder,
      type: initializer.expectedType.kind
    }))).toEqual([
      { fieldName: "left", raw: "1", sourceOrder: 0, type: "number" },
      { fieldName: "right", raw: '"R"', sourceOrder: 1, type: "string" }
    ]);

    const definition = records.definitionsByStatementId.get("stable-1")!;
    expect(plan.bindingSeeds.map((binding) => binding.id)).toEqual([
      recordScalarBindingIdFor("stable-2", definition.fields[0]!.identity),
      recordScalarBindingIdFor("stable-2", definition.fields[1]!.identity)
    ]);
    expect(plan.bindingSeeds.map((binding) => binding.declarationVersionId)).toEqual([
      recordScalarDeclarationVersionIdFor("stable-2", definition.fields[0]!.identity),
      recordScalarDeclarationVersionIdFor("stable-2", definition.fields[1]!.identity)
    ]);
  });

  it("reuses constructor-owned backing slots for exact-type record aliases", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(left: number, right: string)",
      'const origin: Pair = Pair(left: 10, right: "base")',
      "const alias: Pair = @origin",
      "const alias2: Pair = @alias"
    ].join("\n"));

    expect(sourceNamespace.diagnostics).toEqual([]);
    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });

    expect(plan.bindingSeeds).toHaveLength(2);
    expect(plan.initializers).toHaveLength(2);
    expect(plan.unresolvedValueStatementIds).toEqual([]);
    const origin = plan.fieldBindingIdsByValueStatementId.get("stable-2");
    const alias = plan.fieldBindingIdsByValueStatementId.get("stable-3");
    const alias2 = plan.fieldBindingIdsByValueStatementId.get("stable-4");
    expect(origin).toBeDefined();
    expect(alias).toBe(origin);
    expect(alias2).toBe(origin);
  });

  it("keeps constructor storage identity distinct across record values", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(x: number)",
      "const first: Pair = Pair(x: 1)",
      "const second: Pair = Pair(x: 2)"
    ].join("\n"));

    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    const first = plan.fieldBindingIdsByValueStatementId.get("stable-2")?.get(0);
    const second = plan.fieldBindingIdsByValueStatementId.get("stable-3")?.get(0);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it("fails closed for Module-parameter aliases because Module record integration is outside SAY-128", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(x: number)",
      "module Copy(input: Pair) {",
      "  const copy: Pair = @input",
      "}"
    ].join("\n"));

    expect(sourceNamespace.diagnostics).toEqual([]);
    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    expect(plan.bindingSeeds).toEqual([]);
    expect(plan.fieldBindingIdsByValueStatementId.has("stable-3")).toBe(false);
    expect(plan.unresolvedValueStatementIds).toEqual(["stable-3"]);
  });
});
