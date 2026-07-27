import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { analyzeTypedBindingRenameInDocument } from "../document/typedRenameAnalysis";
import type { BindingId } from "./bindingCatalog";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return compiled;
};

const typedBindingIdByName = (compiled: ReturnType<typeof compile>, name: string): BindingId => {
  const binding = compiled.bindingAnalysis!.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === name);
  if (!binding) throw new Error(`fixture missing typed binding ${name}`);
  return binding.id;
};

const rename = (compiled: ReturnType<typeof compile>, targetName: string, newName: string) =>
  analyzeTypedBindingRenameInDocument({ compiled, targetBindingId: typedBindingIdByName(compiled, targetName), newName });

describe("typed binding rename safety analysis", () => {
  it("allows a safe rename with an initializer reference, with a span that excludes the leading @", () => {
    const source = ["nui 3", "const base: number = 1", "let derived: number = @base"].join("\n");
    const compiled = compile(source);
    const analysis = rename(compiled, "base", "renamed");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].kind).toBe("initializer");
    expect(analysis.occurrences[0].oldName).toBe("base");
    expect(analysis.occurrences[0].newName).toBe("renamed");
    expect(analysis.occurrences[0].statementIndex).toBe(2);
    const { span } = analysis.occurrences[0];
    expect(source.split("\n")[2].slice(span.start, span.end)).toBe("base");
  });

  it("allows a safe rename of a set target", () => {
    const compiled = compile(
      ["nui 3", "let counter: number = 0", "let other: number = 1", "set counter = @other + 1"].join("\n")
    );
    const analysis = rename(compiled, "counter", "total");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].kind).toBe("set-target");
    expect(analysis.occurrences[0].oldName).toBe("counter");
    expect(analysis.occurrences[0].statementIndex).toBe(3);
  });

  it("allows a safe rename of a set RHS reference", () => {
    const compiled = compile(
      ["nui 3", "let counter: number = 0", "let other: number = 1", "set counter = @other + 1"].join("\n")
    );
    const analysis = rename(compiled, "other", "renamedOther");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].kind).toBe("set-rhs");
    expect(analysis.occurrences[0].oldName).toBe("other");
    expect(analysis.occurrences[0].statementIndex).toBe(3);
  });

  it("allows a safe rename of a property binding reference", () => {
    const compiled = compile(["nui 3", "let flag: boolean = true", "group G (printEnabled: @flag) {", "}"].join("\n"));
    const analysis = rename(compiled, "flag", "enabled");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].kind).toBe("property-binding");
    expect(analysis.occurrences[0].oldName).toBe("flag");
    expect(analysis.occurrences[0].statementIndex).toBe(2);
  });

  it("allows a safe rename of a typed text template hole reference, with a span that excludes the leading @", () => {
    const source = ["nui 3", "let amount: number = 5", 'text T = label(text: "{@amount}" anchor: none size: 3)'].join("\n");
    const compiled = compile(source);
    const analysis = rename(compiled, "amount", "qty");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].kind).toBe("template-hole");
    expect(analysis.occurrences[0].oldName).toBe("amount");
    expect(analysis.occurrences[0].statementIndex).toBe(2);
    const templateLine = source.split("\n")[2];
    const { span } = analysis.occurrences[0];
    expect(templateLine.slice(span.start, span.end)).toBe("amount");
  });

  it("allows a rename with zero referencing occurrences (declaration only)", () => {
    const compiled = compile(["nui 3", "const lonely: number = 1"].join("\n"));
    const analysis = rename(compiled, "lonely", "renamed");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(0);
  });

  it("rejects a same-scope collision against another typed binding", () => {
    const compiled = compile(["nui 3", "const a: number = 1", "const b: number = 2"].join("\n"));
    const analysis = rename(compiled, "a", "b");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "same-scope-collision" });
    if (analysis.verdict !== "rejected" || analysis.reason !== "same-scope-collision") return;
    expect(analysis.detail.conflictingName).toBe("b");
  });

  it("rejects a same-scope collision against a legacy var (D05 shared namespace)", () => {
    const compiled = compile(["nui 3", "var legacyName = 5", "const a: number = 1"].join("\n"));
    const analysis = rename(compiled, "a", "legacyName");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "same-scope-collision" });
    if (analysis.verdict !== "rejected" || analysis.reason !== "same-scope-collision") return;
    expect(analysis.detail.conflictingKind).toBe("legacy");
  });

  it("rejects an outer rename that would be captured by an existing inner shadow", () => {
    const compiled = compile(
      [
        "nui 3",
        "const outer: number = 1",
        "group G {",
        "const inner: number = 2",
        "let usesOuter: number = @outer",
        "}"
      ].join("\n")
    );
    const analysis = rename(compiled, "outer", "inner");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "capture" });
  });

  it("never treats an already-invalid const set-target as a live, affected occurrence to patch", () => {
    // `set frozen = 2` is already an existing, unrelated compile error
    // (frozen is const) - classifySetTargetResolution must say "invalid",
    // not just "resolves to the renamed binding by id", so this occurrence
    // is never mistaken for a live reference Task 38 should rewrite. It is
    // NOT marked "affected", so its text stays "frozen" post-rename - which
    // then correctly stops resolving at all (reason shifts from
    // const-assignment to unresolved), a genuine before/after difference
    // this rename must still surface rather than silently drop.
    const source = ["nui 3", "const frozen: number = 1", "set frozen = 2"].join("\n");
    const parsed = parseDsl(source);
    const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
    const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
    const analysis = rename(compiled, "frozen", "renamed");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "capture" });
    if (analysis.verdict !== "rejected" || analysis.reason !== "capture") return;
    expect(analysis.detail.kind).toBe("set-target");
  });

  it("does not reject a rename because of an unrelated, already-invalid set target", () => {
    const source = ["nui 3", "const frozen: number = 1", "let counter: number = 0", "set undefinedName = 2"].join("\n");
    const parsed = parseDsl(source);
    const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
    const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
    const analysis = rename(compiled, "frozen", "renamed");
    expect(analysis.verdict).toBe("ok");
  });

  it("allows a safe rename with a Japanese (non-ASCII) name", () => {
    const compiled = compile(["nui 3", "const 元: number = 1", "let 派生: number = @元"].join("\n"));
    const analysis = rename(compiled, "元", "改元");
    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0].newName).toBe("改元");
  });

  it("rejects an empty new name", () => {
    const compiled = compile(["nui 3", "const a: number = 1"].join("\n"));
    const analysis = rename(compiled, "a", "");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "invalid-name" });
  });

  it("rejects a reserved scalar keyword as a new name", () => {
    const compiled = compile(["nui 3", "const a: number = 1"].join("\n"));
    const analysis = rename(compiled, "a", "true");
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "invalid-name" });
  });

  it("rejects an unknown target binding id", () => {
    const compiled = compile(["nui 3", "const a: number = 1"].join("\n"));
    const analysis = analyzeTypedBindingRenameInDocument({ compiled, targetBindingId: "binding:not-real", newName: "renamed" });
    expect(analysis).toMatchObject({ verdict: "rejected", reason: "target-not-found" });
  });
});
