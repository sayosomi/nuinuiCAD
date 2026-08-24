import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { createDslSemanticOccurrenceIndex } from "../dsl/dslSemanticOccurrenceIndex";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 91;

const compileCurrent = (source: string, idPrefix = "extract-for"): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `${idPrefix}:${index}`]));
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

const rootForIndex = (compiled: CompiledDslDocument): number => {
  const index = compiled.statements.findIndex((statement) =>
    statement.kind === "element" && statement.type === "forGroup" && statement.enclosing === null
  );
  if (index < 0) throw new Error("missing root forGroup");
  return index;
};

const forIndex = (compiled: CompiledDslDocument): number => {
  const index = compiled.statements.findIndex((statement) =>
    statement.kind === "element" && statement.type === "forGroup"
  );
  if (index < 0) throw new Error("missing forGroup");
  return index;
};

const forIndexes = (compiled: CompiledDslDocument): number[] => compiled.statements
  .map((statement, index) => statement.kind === "element" && statement.type === "forGroup" ? index : -1)
  .filter((index) => index >= 0);

const iterationReferenceCount = (compiled: CompiledDslDocument, statementIndex: number): number => {
  const statementId = statementIdAt(compiled, statementIndex);
  return createDslSemanticOccurrenceIndex(compiled).occurrences.filter((occurrence) =>
    occurrence.kind === "reference" &&
    occurrence.identity.kind === "module" &&
    occurrence.identity.target.kind === "moduleIteration" &&
    occurrence.identity.target.statementId === statementId
  ).length;
};

const planRootFor = (source: string) => {
  const compiled = compileCurrent(source);
  return planExtractModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    statementIds: [statementIdAt(compiled, rootForIndex(compiled))],
    moduleName: "Extracted",
    instanceName: "Part"
  });
};

const expectRejectedWithoutPatch = (result: ReturnType<typeof planRootFor>, code: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

describe("planExtractModule checkpoint 7 recursive structural descendants", () => {
  it("moves a complete root for subtree, parameterizes range/body dependencies, and keeps the iteration binding internal", () => {
    const source = [
      "nui 4",
      "const start: number = 1",
      "const count: number = 2",
      "const step: number = 1",
      "const width: number = 10",
      "const enabled: boolean = true",
      "for i in range(from: @start, count: @count, step: @step) {",
      "  const scaled: number = @width + @i",
      "  // preserve loop layout",
      "  if (@enabled) {",
      "    const inner: number = @scaled + @i",
      "  }",
      "}"
    ].join("\n");

    const result = planRootFor(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["start", "number", "@start"],
      ["count", "number", "@count"],
      ["step", "number", "@step"],
      ["width", "number", "@width"],
      ["enabled", "boolean", "@enabled"]
    ]);
    expect(result.dependencies.some((dependency) => dependency.name === "i")).toBe(false);
    expect(result.exports).toEqual([]);

    const transformed = applyLineSplices(source, result.splices);
    expect(transformed).toBe([
      "nui 4",
      "const start: number = 1",
      "const count: number = 2",
      "const step: number = 1",
      "const width: number = 10",
      "const enabled: boolean = true",
      "module Extracted(start: number, count: number, step: number, width: number, enabled: boolean) {",
      "  for i in range(from: @start, count: @count, step: @step) {",
      "    const scaled: number = @width + @i",
      "    // preserve loop layout",
      "    if (@enabled) {",
      "      const inner: number = @scaled + @i",
      "    }",
      "  }",
      "}",
      "instance Part = Extracted(start: @start, count: @count, step: @step, width: @width, enabled: @enabled)"
    ].join("\n"));

    const nextCompiled = compileCurrent(transformed, "extract-for-next");
    const nextRootForStatementId = statementIdAt(nextCompiled, forIndex(nextCompiled));
    const iterationReferences = createDslSemanticOccurrenceIndex(nextCompiled).occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.identity.kind === "module" &&
      occurrence.identity.target.kind === "moduleIteration" &&
      occurrence.identity.target.statementId === nextRootForStatementId
    );
    expect(iterationReferences).toHaveLength(2);
    expect(result.dependencies.some((dependency) => dependency.name === "i")).toBe(false);
    expect(result.exports.some((entry) => entry.name === "i")).toBe(false);
  });

  it("recursively moves nested for headers and bodies, parameterizes external dependencies, and proves both iteration owners after recompile", () => {
    const source = [
      "nui 4",
      "const start: number = 1",
      "const count: number = 2",
      "const step: number = 1",
      "const width: number = 10",
      "const nestedStart: number = 3",
      "for i in range(from: @start, count: @count, step: @step) {",
      "  const outerValue: number = @i",
      "  for j in range(from: @nestedStart, count: @count, step: @step) {",
      "    const value: number = @width + @i + @j",
      "  }",
      "}"
    ].join("\n");

    const result = planRootFor(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["start", "number", "@start"],
      ["count", "number", "@count"],
      ["step", "number", "@step"],
      ["width", "number", "@width"],
      ["nestedStart", "number", "@nestedStart"]
    ]);
    expect(result.dependencies.some((dependency) => dependency.name === "i" || dependency.name === "j")).toBe(false);
    expect(result.exports).toEqual([]);

    const transformed = applyLineSplices(source, result.splices);
    expect(transformed).toContain("  for i in range(from: @start, count: @count, step: @step) {");
    expect(transformed).toContain("    for j in range(from: @nestedStart, count: @count, step: @step) {");
    expect(transformed).toContain("      const value: number = @width + @i + @j");

    const nextCompiled = compileCurrent(transformed, "extract-for-recursive-next");
    const nextForIndexes = forIndexes(nextCompiled);
    expect(nextForIndexes).toHaveLength(2);
    expect(iterationReferenceCount(nextCompiled, nextForIndexes[0]!)).toBe(2);
    expect(iterationReferenceCount(nextCompiled, nextForIndexes[1]!)).toBe(1);
  });

  it("keeps iteration ownership exact when a nested for shadows the outer binder", () => {
    const source = [
      "nui 4",
      "const count: number = 2",
      "for i in range(from: 100, count: @count, step: 100) {",
      "  const outerValue: number = @i",
      "  for i in range(from: 0, count: @count, step: 1) {",
      "    const value: number = @i",
      "  }",
      "}"
    ].join("\n");

    const result = planRootFor(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => dependency.name)).toEqual(["count"]);
    expect(result.dependencies.some((dependency) => dependency.name === "i")).toBe(false);

    const nextCompiled = compileCurrent(applyLineSplices(source, result.splices), "extract-for-shadow-next");
    const nextForIndexes = forIndexes(nextCompiled);
    expect(nextForIndexes).toHaveLength(2);
    // The outer body resolves @i to the outer owner; the nested body resolves
    // @i to the shadowing inner owner.
    expect(iterationReferenceCount(nextCompiled, nextForIndexes[0]!)).toBe(1);
    expect(iterationReferenceCount(nextCompiled, nextForIndexes[1]!)).toBe(1);
  });

  it("keeps selected-root validation local when a sibling structural root contains an unsupported record value", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 1)",
      "group Outer {",
      "  for j in range(from: 0, count: 2, step: 1) {",
      "    const nested: number = @j",
      "  }",
      "}",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  const unsupported: Config = @config",
      "}"
    ].join("\n");
    const compiled = compileCurrent(source);
    const groupIndex = compiled.statements.findIndex((statement) =>
      statement.kind === "group" && statement.enclosing === null
    );
    const forIndex = rootForIndex(compiled);
    expect(groupIndex).toBeGreaterThanOrEqual(0);

    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementIdAt(compiled, groupIndex), statementIdAt(compiled, forIndex)],
      moduleName: "Extracted",
      instanceName: "Part"
    });
    expectRejectedWithoutPatch(result, "unsupported-statement");
  });
});
