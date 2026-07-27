import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { commitLineSplicePatch, type CanonicalDocumentValue, type LastGoodDslDocument } from "./canonicalDocument";

const canonicalFrom = (source: string): CanonicalDocumentValue => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return {
    sourceText: source,
    doc: compiled as LastGoodDslDocument,
    docText: source,
    diagnostics: compiled.diagnostics,
    typedDependencyGraph: compiled.typedDependencyGraph
  };
};

describe("commitLineSplicePatch", () => {
  it("applies given splices and recompiles, preserving the renamed declaration's BindingId", () => {
    const source = ["nui 3", "const base: number = 1", "let derived: number = @base"].join("\n");
    const current = canonicalFrom(source);
    const targetId = current.doc.bindingAnalysis!.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "base"
    )!.id;

    const result = commitLineSplicePatch(current, [
      { startLine: 2, endLine: 2, replacementLines: ["const renamed: number = 1"] },
      { startLine: 3, endLine: 3, replacementLines: ["let derived: number = @renamed"] }
    ]);
    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(result.value.sourceText).toBe(["nui 3", "const renamed: number = 1", "let derived: number = @renamed"].join("\n"));
    expect(result.value.docText).toBe(result.value.sourceText);
    expect(result.splices).toHaveLength(2);

    const renamedBinding = result.value.doc.bindingAnalysis!.catalog.bindingsById.get(targetId);
    expect(renamedBinding?.name).toBe("renamed");
  });

  it("returns noop when the given splices produce text identical to the current source", () => {
    const source = ["nui 3", "const base: number = 1"].join("\n");
    const current = canonicalFrom(source);
    const result = commitLineSplicePatch(current, [
      { startLine: 2, endLine: 2, replacementLines: ["const base: number = 1"] }
    ]);
    expect(result).toEqual({ status: "noop" });
  });

  it("fails closed instead of applying anything when docText/sourceText are already desynced", () => {
    const source = ["nui 3", "const base: number = 1"].join("\n");
    const current = canonicalFrom(source);
    const desynced: CanonicalDocumentValue = { ...current, docText: "different pending text" };
    const result = commitLineSplicePatch(desynced, [
      { startLine: 2, endLine: 2, replacementLines: ["const renamed: number = 1"] }
    ]);
    expect(result.status).toBe("failed");
  });

  it("fails closed when applyLineSplices itself rejects an invalid splice list", () => {
    const source = ["nui 3", "const base: number = 1"].join("\n");
    const current = canonicalFrom(source);
    const result = commitLineSplicePatch(current, [
      { startLine: 2, endLine: 2, replacementLines: ["a"] },
      { startLine: 2, endLine: 2, replacementLines: ["b"] }
    ]);
    expect(result.status).toBe("failed");
  });
});
