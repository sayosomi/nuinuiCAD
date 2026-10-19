// Task 48: integration-level assertions that don't belong to any one
// compiler's own unit test file - the compileDslDocument-level contract for
// how BindingIssue diagnostics are exposed without changing pass/fail
// compilation behavior.
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

describe("compileDslDocument: scalar analysis prerequisites for Module lowering", () => {
  it.each([
    "lineAngle(@Horizontal., @Arc.start)",
    "lineAngle(@Horizontal.start, @Arc.)"
  ])("preserves syntax diagnostics before Module scalar lowering for %s", (initializer) => {
    const source = [
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      `const value: number = ${initializer}`
    ].join("\n");
    const compiled = compile(source);

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unexpected-token", severity: "error", line: 4 })
    ]));
    expect(compiled.spans.sourceMap.source).toBe(source);
    expect(compiled.scalarProgram).toBeUndefined();
  });

  it("still lowers valid Module scalars without document scalar declarations", () => {
    const compiled = compile([
      "nui 1",
      "module Pattern() {",
      "  const amount: number = 3",
      "  line L = segment(start: (0, 0), end: (@amount, 0))",
      "}",
      "instance Use = Pattern()"
    ].join("\n"));

    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    const amount = compiled.bindingAnalysis!.catalog.bindings.find(binding => binding.name === "amount")!;
    expect(compiled.scalarProgram!.statements.some(statement => statement.bindingId === amount.id)).toBe(true);
  });
});

describe("compileDslDocument: BindingIssue diagnostics stay non-gating", () => {
  it("still compiles (document !== null) when the only problem is a duplicate-binding BindingIssue", () => {
    const compiled = compile(["nui 1", "const x: number = 1", "const x: number = 2"].join("\n"));
    // The pre-existing, unchanged fail-closed contract: a BindingIssue alone
    // degrades only the affected binding, not the whole document.
    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-binding")).toBe(false);
    expect(compiled.bindingIssueDiagnostics?.some((diagnostic) => diagnostic.code === "duplicate-binding")).toBe(true);
  });

  it("excludes only the invalid binding from the scalar program; an independent valid binding still lowers", () => {
    const compiled = compile([
      "nui 1",
      "const x: number = 1",
      "const x: number = 2",
      "const y: number = 5"
    ].join("\n"));
    expect(compiled.document).not.toBeNull();
    const yBindingId = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "y")!.id;
    expect(compiled.scalarProgram!.statements.some((statement) => statement.bindingId === yBindingId)).toBe(true);
    const xBindingIds = compiled.bindingAnalysis!.catalog.bindings.filter((binding) => binding.kind === "typed" && binding.name === "x").map((binding) => binding.id);
    for (const bindingId of xBindingIds) {
      expect(compiled.scalarProgram!.statements.some((statement) => statement.bindingId === bindingId)).toBe(false);
    }
  });

  it("a document with a genuine compile-time typecheck error still fails to compile (document === null), unaffected by this change", () => {
    const compiled = compile(["nui 1", 'const x: number = "not a number"'].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "scalar-type-mismatch")).toBe(true);
  });
});
