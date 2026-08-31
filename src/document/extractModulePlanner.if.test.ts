import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 77;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract-if:${index}`]));
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

const containerIndex = (compiled: CompiledDslDocument, type: "conditionalGroup" | "forGroup"): number => {
  const index = compiled.statements.findIndex((statement) =>
    statement.kind === "element" && statement.type === type
  );
  if (index < 0) throw new Error(`missing ${type}`);
  return index;
};

const planContainer = (source: string, type: "conditionalGroup" | "forGroup" = "conditionalGroup") => {
  const compiled = compileCurrent(source);
  const index = containerIndex(compiled, type);
  return planExtractModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    statementIds: [statementIdAt(compiled, index)],
    moduleName: "Extracted",
    instanceName: "Part"
  });
};

const expectRejectedWithoutPatch = (result: ReturnType<typeof planContainer>, code: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

const expectCleanTransformedSource = (
  source: string,
  result: ReturnType<typeof planContainer>
): string => {
  expect(result.status).toBe("planned");
  if (result.status !== "planned") return source;
  const transformed = applyLineSplices(source, result.splices);
  compileCurrent(transformed);
  return transformed;
};

describe("planExtractModule checkpoint 5 root if", () => {
  it("moves a complete root if/else subtree, preserves layout, and parameterizes condition/body dependencies", () => {
    const source = [
      "nui 4",
      "const enabled: boolean = true",
      "const width: number = 10",
      "if (@enabled) {",
      "  const first: number = @width + 1",
      "  // keep the authored branch layout",
      "",
      "  const second: number = @first + 1",
      "} else {",
      "  const fallback: number = @width + 2",
      "}"
    ].join("\n");

    const result = planContainer(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["enabled", "boolean", "@enabled"],
      ["width", "number", "@width"]
    ]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "const enabled: boolean = true",
      "const width: number = 10",
      "module Extracted(enabled: boolean, width: number) {",
      "  if (@enabled) {",
      "    const first: number = @width + 1",
      "    // keep the authored branch layout",
      "",
      "    const second: number = @first + 1",
      "  } else {",
      "    const fallback: number = @width + 2",
      "  }",
      "}",
      "instance Part = Extracted(enabled: @enabled, width: @width)"
    ].join("\n"));
  });

  it("accepts a nested for under a selected root if and parameterizes its header and body dependencies", () => {
    const source = [
      "nui 4",
      "const enabled: boolean = true",
      "const start: number = 1",
      "const count: number = 2",
      "const width: number = 10",
      "if (@enabled) {",
      "  for i in range(from: @start, count: @count, step: 1) {",
      "    const inside: number = @width + @i",
      "  }",
      "} else {",
      "  const fallback: number = 0",
      "}"
    ].join("\n");

    const result = planContainer(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["enabled", "boolean", "@enabled"],
      ["start", "number", "@start"],
      ["count", "number", "@count"],
      ["width", "number", "@width"]
    ]);
    expect(result.dependencies.some((dependency) => dependency.name === "i")).toBe(false);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(enabled: boolean, start: number, count: number, width: number) {",
      "  if (@enabled) {",
      "    for i in range(from: @start, count: @count, step: 1) {",
      "      const inside: number = @width + @i",
      "    }",
      "  } else {",
      "    const fallback: number = 0",
      "  }",
      "}"
    ].join("\n"));
  });

  it("keeps a let/set pair inside the conditional but rejects a write crossing the Extract boundary", () => {
    const internalSource = [
      "nui 4",
      "const enabled: boolean = true",
      "if (@enabled) {",
      "  let total: number = 0",
      "  set total = @total + 1",
      "}"
    ].join("\n");
    const internal = planContainer(internalSource);
    expect(internal.status).toBe("planned");
    if (internal.status === "planned") {
      expect(internal.dependencies.map((dependency) => dependency.name)).toEqual(["enabled"]);
    }

    const crossingSource = [
      "nui 4",
      "const enabled: boolean = true",
      "let total: number = 0",
      "if (@enabled) {",
      "  set total = @total + 1",
      "}"
    ].join("\n");
    expectRejectedWithoutPatch(planContainer(crossingSource), "cross-boundary-mutation");
  });

  it("moves a selected root containing a valid structural record value", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 1)",
      "group Outer {",
      "  if (true) {",
      "    const nested: number = 1",
      "  }",
      "}",
      "if (true) {",
      "  const unsupported: Config = @config",
      "}"
    ].join("\n");
    const compiled = compileCurrent(source);
    const groupIndex = compiled.statements.findIndex((statement) =>
      statement.kind === "group" && statement.enclosing === null
    );
    const conditionalIndex = compiled.statements.findIndex((statement) =>
      statement.kind === "element" &&
      statement.type === "conditionalGroup" &&
      statement.enclosing === null
    );
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    expect(conditionalIndex).toBeGreaterThanOrEqual(0);

    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementIdAt(compiled, groupIndex), statementIdAt(compiled, conditionalIndex)],
      moduleName: "Extracted",
      instanceName: "Part"
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const transformed = expectCleanTransformedSource(source, result);
    expect(transformed).toContain("const unsupported: Config = @config");
  });
});
