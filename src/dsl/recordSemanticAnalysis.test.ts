import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";

const analyze = (source: string) => {
  const parsed = parseDsl(source);
  const stableIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
  const namespace = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);
  return { parsed, stableIds, namespace, records: namespace.recordSemanticAnalysis! };
};

describe("record nominal semantic analysis", () => {
  it("derives nominal record/field/value identities and preserves declaration field order", () => {
    const { parsed, records, namespace } = analyze([
      "nui 1",
      "record Pair(left: number, right: string)",
      'const pair: Pair = Pair(right: "R", left: 1)'
    ].join("\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(namespace.diagnostics).toEqual([]);
    const definition = records.definitionsByStatementId.get("stable-1");
    expect(definition?.fields.map((field) => ({
      name: field.name,
      identity: field.identity,
      type: field.type.kind
    }))).toEqual([
      { name: "left", identity: { recordStatementId: "stable-1", fieldIndex: 0 }, type: "number" },
      { name: "right", identity: { recordStatementId: "stable-1", fieldIndex: 1 }, type: "string" }
    ]);

    const value = records.valuesByStatementId.get("stable-2");
    expect(value).toMatchObject({
      statementId: "stable-2",
      typeIdentity: "stable-1",
      constructor: { targetTypeIdentity: "stable-1" }
    });
    expect(value?.constructor?.fields.map((field) => field.fieldName)).toEqual(["left", "right"]);
    expect(value?.constructor?.fields.map((field) => field.expectedType.kind)).toEqual(["number", "string"]);
  });

  it("is non-hoisted for record type and constructor names", () => {
    const { namespace } = analyze([
      "nui 1",
      "const before: Later = Later(value: 1)",
      "record Later(value: number)"
    ].join("\n"));

    expect(namespace.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "record-type-forward-reference",
      "record-constructor-forward-reference"
    ]));
  });

  it("validates constructor named arguments and nominal constructor type", () => {
    const { namespace } = analyze([
      "nui 1",
      "record A(x: number, y: string)",
      "record B(x: number)",
      "const bad: A = B(x: 1, x: 2, extra: 3)"
    ].join("\n"));
    const codes = namespace.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining([
      "record-nominal-type-mismatch",
      "record-constructor-duplicate-field",
      "record-constructor-unknown-field"
    ]));
    expect(namespace.diagnostics.filter((diagnostic) => diagnostic.code === "record-constructor-missing-field")).toHaveLength(0);
  });

  it("accepts same-type whole-record references and rejects cross-nominal aliases", () => {
    const { records, namespace } = analyze([
      "nui 1",
      "record A(x: number)",
      "record B(x: number)",
      "const a: A = A(x: 1)",
      "const same: A = @a",
      "const b: B = B(x: 2)",
      "const bad: A = @b"
    ].join("\n"));

    expect(records.valuesByStatementId.get("stable-4")?.reference).toMatchObject({
      name: "a",
      targetTypeIdentity: "stable-1"
    });
    expect(namespace.diagnostics.filter((diagnostic) => diagnostic.code === "record-nominal-type-mismatch")).toHaveLength(1);
  });

  it("rejects record let/set and keeps whole records out of the scalar lexical catalog", () => {
    const { namespace } = analyze([
      "nui 1",
      "record Pair(x: number)",
      "let pair: Pair = Pair(x: 1)",
      "set pair = Pair(x: 2)"
    ].join("\n"));
    const codes = namespace.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining(["record-let-unsupported", "record-set-unsupported"]));
    expect(namespace.allDeclarations.find((declaration) => declaration.name === "pair")?.kind).toBe("recordValue");
    expect(namespace.scopeIndex.allDeclarations.map((declaration) => declaration.name)).not.toContain("pair");
  });

  it("assigns Module record parameter identity and permits same-type whole-record parameter references", () => {
    const { records, namespace } = analyze([
      "nui 1",
      "record Pair(x: number)",
      "module Copy(input: Pair) {",
      "  const copy: Pair = @input",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual([]);
    expect(records.moduleParameters).toEqual([
      expect.objectContaining({
        definitionStatementId: "stable-2",
        parameterIndex: 0,
        name: "input",
        typeIdentity: "stable-1"
      })
    ]);
    expect(records.valuesByStatementId.get("stable-3")?.reference).toMatchObject({
      name: "input",
      targetTypeIdentity: "stable-1"
    });
  });

  it("lets a visible local declaration shadow a record Module parameter", () => {
    const { records, namespace } = analyze([
      "nui 1",
      "record Pair(x: number)",
      "module Copy(input: Pair) {",
      "  const input: number = 1",
      "  const copy: Pair = @input",
      "  set input = 2",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics.map((diagnostic) => diagnostic.code)).toContain("record-reference-not-record");
    expect(namespace.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("record-set-unsupported");
    expect(records.valuesByStatementId.get("stable-4")?.reference).toMatchObject({
      name: "input",
      targetTypeIdentity: null
    });
  });

  it("uses a record Module parameter before a later local shadow becomes visible", () => {
    const { records, namespace } = analyze([
      "nui 1",
      "record Pair(x: number)",
      "module Copy(input: Pair) {",
      "  const copy: Pair = @input",
      "  const input: number = 1",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("record-reference"))).toEqual([]);
    expect(records.valuesByStatementId.get("stable-3")?.reference).toMatchObject({
      name: "input",
      targetTypeIdentity: "stable-1"
    });
  });
});
