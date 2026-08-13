import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { applyLineSplices } from "./textPatch";
import { analyzeTypedBindingRenameInDocument } from "./typedRenameAnalysis";
import { buildTypedRenameSplices, type TypedRenameSpliceEntry } from "./typedRenameSplice";
import type { BindingId } from "../scalars/bindingCatalog";

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

/** Mirrors the real command layer: declaration entry + every occurrence from an "ok" verdict. */
const entriesForRename = (
  compiled: ReturnType<typeof compile>,
  targetName: string,
  newName: string
): readonly TypedRenameSpliceEntry[] => {
  const targetId = typedBindingIdByName(compiled, targetName);
  const analysis = analyzeTypedBindingRenameInDocument({ compiled, targetBindingId: targetId, newName });
  if (analysis.verdict !== "ok") throw new Error(`fixture rename was not safe: ${analysis.reason}`);
  const target = compiled.bindingAnalysis!.catalog.bindingsById.get(targetId)!;
  return [
    { statementIndex: target.statementIndex, span: analysis.declarationSpan!, oldName: target.name, newName: analysis.newName },
    ...analysis.occurrences
  ];
};

describe("buildTypedRenameSplices", () => {
  it("produces one splice per touched physical line, in ascending order", () => {
    const source = ["nui 4", "const base: number = 1", "let derived: number = @base"].join("\n");
    const compiled = compile(source);
    const result = buildTypedRenameSplices(source, compiled, entriesForRename(compiled, "base", "renamed"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.splices.map((splice) => splice.startLine)).toEqual([2, 3]);
    expect(result.splices).toEqual([...result.splices].sort((a, b) => a.startLine - b.startLine));
    const patched = applyLineSplices(source, result.splices);
    expect(patched).toBe(["nui 4", "const renamed: number = 1", "let derived: number = @renamed"].join("\n"));
  });

  it("merges two occurrences of the same binding on one physical line into a single splice", () => {
    const source = ["nui 4", "let a: number = 1", "let total: number = @a + @a"].join("\n");
    const compiled = compile(source);
    const result = buildTypedRenameSplices(source, compiled, entriesForRename(compiled, "a", "renamed"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.splices.map((splice) => splice.startLine)).toEqual([2, 3]);
    const patched = applyLineSplices(source, result.splices);
    expect(patched).toBe(["nui 4", "let renamed: number = 1", "let total: number = @renamed + @renamed"].join("\n"));
  });

  it("leaves comments, blank lines, and unrelated statements byte-identical", () => {
    const source = [
      "nui 4",
      "# a leading comment",
      "const base: number = 1",
      "",
      "const untouched: number = 99 # trailing comment",
      "",
      "let derived: number = @base"
    ].join("\n");
    const compiled = compile(source);
    const result = buildTypedRenameSplices(source, compiled, entriesForRename(compiled, "base", "renamed"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.splices.map((splice) => splice.startLine)).toEqual([3, 7]);
    const patched = applyLineSplices(source, result.splices);
    const patchedLines = patched.split("\n");
    const originalLines = source.split("\n");
    for (const untouchedLine of [0, 1, 3, 4, 5]) {
      expect(patchedLines[untouchedLine]).toBe(originalLines[untouchedLine]);
    }
  });

  it("patches only the declaration line for a rename with zero referencing occurrences", () => {
    const source = ["nui 4", "const lonely: number = 1"].join("\n");
    const compiled = compile(source);
    const result = buildTypedRenameSplices(source, compiled, entriesForRename(compiled, "lonely", "renamed"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.splices).toEqual([{ startLine: 2, endLine: 2, replacementLines: ["const renamed: number = 1"] }]);
  });

  it("returns no splices when the entry list is empty", () => {
    const source = ["nui 4", "const lonely: number = 1"].join("\n");
    const compiled = compile(source);
    expect(buildTypedRenameSplices(source, compiled, [])).toEqual({ ok: true, splices: [] });
  });

  it("rejects atomically when a projected span does not match the expected old name", () => {
    const source = ["nui 4", "const base: number = 1", "let derived: number = @base"].join("\n");
    const compiled = compile(source);
    const entries = entriesForRename(compiled, "base", "renamed").map((entry) =>
      entry.oldName === "base" ? { ...entry, oldName: "wrong" } : entry
    );
    const result = buildTypedRenameSplices(source, compiled, entries);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("does not match the live source text") });
  });

  it("rejects atomically on duplicate/overlapping projected spans", () => {
    const source = ["nui 4", "const base: number = 1", "let derived: number = @base"].join("\n");
    const compiled = compile(source);
    const entries = entriesForRename(compiled, "base", "renamed");
    const duplicated = [...entries, entries[entries.length - 1]];
    const result = buildTypedRenameSplices(source, compiled, duplicated);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("duplicate or overlapping") });
  });

  it("rejects atomically on a non-contiguous (out-of-range) projection", () => {
    const source = ["nui 4", "const base: number = 1"].join("\n");
    const compiled = compile(source);
    const target = compiled.bindingAnalysis!.catalog.bindingsById.get(typedBindingIdByName(compiled, "base"))!;
    const entries: TypedRenameSpliceEntry[] = [
      {
        statementIndex: target.statementIndex,
        span: { start: 0, end: 10_000 },
        oldName: "base",
        newName: "renamed"
      }
    ];
    const result = buildTypedRenameSplices(source, compiled, entries);
    expect(result.ok).toBe(false);
  });

  it("rejects atomically when statementIndex is out of range", () => {
    const source = ["nui 4", "const base: number = 1"].join("\n");
    const compiled = compile(source);
    const entries: TypedRenameSpliceEntry[] = [
      { statementIndex: 999, span: { start: 0, end: 4 }, oldName: "base", newName: "renamed" }
    ];
    const result = buildTypedRenameSplices(source, compiled, entries);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("out of range") });
  });
});
