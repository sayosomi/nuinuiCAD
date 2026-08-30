import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { buildSourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { parseScalarExpression } from "./expressionParser";
import {
  planRecordScalarLowering,
  prepareRecordScalarExpression,
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

const expression = (source: string) => {
  const parsed = parseScalarExpression(source, { start: 0, end: source.length });
  if (!parsed.ast) throw new Error(parsed.diagnostics[0]?.message ?? "expression parse failed");
  return parsed.ast;
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

  it("reuses externally supplied field backing for a qualified Module record alias", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(left: number, right: string)",
      'const origin: Pair = Pair(left: 10, right: "base")',
      "const alias: Pair = @Source::output"
    ].join("\n"));
    const externalFieldBindings = new Map([[0, "module-field-left"], [1, "module-field-right"]]);

    const plan = planRecordScalarLowering({
      analysis: records,
      sourceNamespace,
      additionalRecordValueResolver: (value) => value.name === "alias"
        ? { typeIdentity: value.typeIdentity!, fieldBindingIdsByFieldIndex: externalFieldBindings }
        : null
    });

    expect(plan.bindingSeeds).toHaveLength(2);
    expect(plan.initializers).toHaveLength(2);
    expect(plan.fieldBindingIdsByValueStatementId.get("stable-3")).toBe(externalFieldBindings);
    expect(plan.fieldBindingIdsByValueStatementId.get("stable-3")?.get(0)).toBe("module-field-left");
    expect(plan.fieldBindingIdsByValueStatementId.get("stable-3")?.get(1)).toBe("module-field-right");
    expect(plan.unresolvedValueStatementIds).toEqual([]);
  });

  it("does not synthesize storage for an incompatible or incomplete external record alias", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(left: number, right: string)",
      'const mismatch: Pair = @Source::wrong',
      'const incomplete: Pair = @Source::partial'
    ].join("\n"));

    const plan = planRecordScalarLowering({
      analysis: records,
      sourceNamespace,
      additionalRecordValueResolver: (value) => value.name === "mismatch"
        ? { typeIdentity: "other-record", fieldBindingIdsByFieldIndex: new Map([[0, "wrong-left"], [1, "wrong-right"]]) }
        : value.name === "incomplete"
          ? { typeIdentity: value.typeIdentity!, fieldBindingIdsByFieldIndex: new Map([[0, "partial-left"]]) }
          : null
    });

    expect(plan.fieldBindingIdsByValueStatementId.has("stable-2")).toBe(false);
    expect(plan.fieldBindingIdsByValueStatementId.has("stable-3")).toBe(false);
    expect(plan.unresolvedValueStatementIds).toEqual(["stable-2", "stable-3"]);
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

  it("prepares a record field as an ordinary typed scalar reference while preserving field identity and spans", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(left: number, label: string)",
      'const pair: Pair = Pair(left: 10, label: "base")',
      'const after: string = "unused"'
    ].join("\n"));
    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    const ast = expression("@pair.label");

    const prepared = prepareRecordScalarExpression({
      ast,
      statementIndex: 3,
      analysis: records,
      sourceNamespace,
      plan,
      referenceResolutions: []
    });

    const definition = records.definitionsByStatementId.get("stable-1")!;
    const expectedBindingId = recordScalarBindingIdFor("stable-2", definition.fields[1]!.identity);
    expect(prepared.issues).toEqual([]);
    expect(prepared.ast).toMatchObject({
      kind: "reference",
      name: "pair.label",
      span: { start: 0, end: 11 },
      nameSpan: { start: 1, end: 11 }
    });
    expect(prepared.references).toEqual([
      { kind: "resolvedType", bindingId: expectedBindingId, type: { kind: "string" } }
    ]);
    expect(prepared.accesses).toEqual([
      {
        recordValueStatementId: "stable-2",
        field: definition.fields[1]!.identity,
        fieldName: "label",
        bindingId: expectedBindingId,
        span: { start: 0, end: 11 },
        baseSpan: { start: 1, end: 5 },
        propertySpan: { start: 6, end: 11 }
      }
    ]);
  });

  it("leaves geometry dotted properties on the existing geometry owner", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "record Pair(x: number)",
      "const pair: Pair = Pair(x: 1)"
    ].join("\n"));
    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    const ast = expression("@A.x");

    const prepared = prepareRecordScalarExpression({
      ast,
      statementIndex: 3,
      analysis: records,
      sourceNamespace,
      plan,
      referenceResolutions: []
    });

    expect(prepared.issues).toEqual([]);
    expect(prepared.references).toEqual([]);
    expect(prepared.ast.kind).toBe("geometryProperty");
  });

  it("claims unknown record fields and fails them without falling through to geometry resolution", () => {
    const { sourceNamespace, records } = analyze([
      "nui 4",
      "record Pair(x: number)",
      "const pair: Pair = Pair(x: 1)",
      "const after: number = 0"
    ].join("\n"));
    const plan = planRecordScalarLowering({ analysis: records, sourceNamespace });
    const prepared = prepareRecordScalarExpression({
      ast: expression("@pair.missing"),
      statementIndex: 3,
      analysis: records,
      sourceNamespace,
      plan,
      referenceResolutions: []
    });

    expect(prepared.issues).toEqual([
      expect.objectContaining({ code: "record-field-unknown", span: { start: 6, end: 13 } })
    ]);
    expect(prepared.ast.kind).toBe("reference");
    expect(prepared.references).toEqual([{ kind: "resolvedType", bindingId: null, type: null }]);
  });

  it("leaves Module-parameter alias storage to the Module runtime owner", () => {
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
