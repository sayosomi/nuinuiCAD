import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 75;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract-array:${index}`]));
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: REVISION,
    assignedElementIds: ids,
    assignedStatementIds: ids
  });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.bindingIssueDiagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? []).toEqual([]);
  expect(compiled.statementMap).not.toBeNull();
  return compiled;
};

const statementIdAt = (compiled: CompiledDslDocument, index: number): string => {
  const id = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  if (!id) throw new Error(`missing statement id at ${index}`);
  return id;
};

const plan = (source: string, selectedIndexes: readonly number[]) => {
  const compiled = compileCurrent(source);
  return planExtractModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    statementIds: selectedIndexes.map((index) => statementIdAt(compiled, index)),
    moduleName: "Extracted",
    instanceName: "Part"
  });
};

describe("planExtractModule checkpoint 3 geometry arrays", () => {
  it("preserves the exact array dependency type, exports the moved array, and rewrites an outside array reference", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const source: line[] = [@A]",
      "const moved: path[] = @source",
      "const after: path[] = @moved"
    ].join("\n");

    const result = plan(source, [3]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["source", "line[]", "@source"]
    ]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["moved"]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const source: line[] = [@A]",
      "module Extracted(source: line[]) {",
      "  export const moved: path[] = @source",
      "}",
      "instance Part = Extracted(source: @source)",
      "const after: path[] = @Part::moved"
    ].join("\n"));
  });

  it("extracts a direct point-array literal without inventing runtime scalar semantics when authored identity is available", () => {
    const source = [
      "nui 1",
      "line IdentityAnchor = segment(start: (0, 0), end: (1, 0))",
      "const points: point[] = [(0, 0), (10, 5)]"
    ].join("\n");

    const result = plan(source, [2]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 1",
      "line IdentityAnchor = segment(start: (0, 0), end: (1, 0))",
      "module Extracted() {",
      "  const points: point[] = [(0, 0), (10, 5)]",
      "}",
      "instance Part = Extracted()"
    ].join("\n"));
  });

  it("uses the existing singular geometry interface for geometry referenced inside an array literal", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const moved: path[] = [@A]"
    ].join("\n");

    const result = plan(source, [2]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["A", "line", "@A"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain("module Extracted(A: line) {");
    expect(applyLineSplices(source, result.splices)).toContain("  const moved: path[] = [@A]");
  });

  it("keeps a selected array-to-array reference internal while preserving outside singular geometry parameterization", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const first: line[] = [@A]",
      "const second: path[] = @first"
    ].join("\n");

    const result = plan(source, [2, 3]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["A", "line"]
    ]);
    expect(result.exports).toEqual([]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("module Extracted(A: line) {");
    expect(next).toContain("  const first: line[] = [@A]");
    expect(next).toContain("  const second: path[] = @first");
  });
});
