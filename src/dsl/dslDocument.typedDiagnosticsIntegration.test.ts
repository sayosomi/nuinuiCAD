// Task 48: integration-level assertions that don't belong to any one
// compiler's own unit test file - the compileDslDocument-level contract for
// how BindingIssue diagnostics are exposed without changing pass/fail
// compilation behavior, and a representative pre-nui3 sanity check.
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

describe("compileDslDocument: BindingIssue diagnostics stay non-gating", () => {
  it("still compiles (document !== null) when the only problem is a duplicate-binding BindingIssue", () => {
    const compiled = compile(["nui 3", "const x: number = 1", "const x: number = 2"].join("\n"));
    // The pre-existing, unchanged fail-closed contract: a BindingIssue alone
    // degrades only the affected binding, not the whole document.
    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "duplicate-binding")).toBe(false);
    expect(compiled.bindingIssueDiagnostics?.some((diagnostic) => diagnostic.code === "duplicate-binding")).toBe(true);
  });

  it("excludes only the invalid binding from the scalar program; an independent valid binding still lowers", () => {
    const compiled = compile([
      "nui 3",
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
    const compiled = compile(["nui 3", 'const x: number = "not a number"'].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "scalar-type-mismatch")).toBe(true);
  });
});

describe("compileDslDocument: representative pre-nui3 diagnostic stays actionable", () => {
  it("a nui 2 document using v3-only typed syntax still reports a positioned, actionable diagnostic", () => {
    const compiled = compile(["nui 2", "const x: number = 1"].join("\n"));
    expect(compiled.document).toBeNull();
    const versionDiagnostic = compiled.diagnostics.find((diagnostic) => diagnostic.code === "typed-syntax-requires-nui3");
    expect(versionDiagnostic).toBeDefined();
    expect(versionDiagnostic!.line).toBeGreaterThan(0);
  });
});
