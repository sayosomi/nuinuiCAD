import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { applyLineSplices } from "./textPatch";
import { planExtractModule } from "./extractModulePlanner";

const REVISION = 73;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract:${index}`]));
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

const plan = (
  source: string,
  selectedIndexes: readonly number[],
  names: { moduleName?: string; instanceName?: string } = {}
) => {
  const compiled = compileCurrent(source);
  return {
    compiled,
    result: planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: selectedIndexes.map((index) => statementIdAt(compiled, index)),
      moduleName: names.moduleName ?? "Extracted",
      instanceName: names.instanceName ?? "Part"
    })
  };
};

const expectRejectedWithoutPatch = (
  result: ReturnType<typeof plan>["result"],
  code?: string
) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  if (code) expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

describe("planExtractModule checkpoint 1", () => {
  it("extracts one scalar statement, infers ordered scalar parameters, exports a selected declaration, and returns one atomic splice batch", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "const inside: number = @height + @width",
      "const after: number = @inside * 2"
    ].join("\n");
    const { result } = plan(source, [3]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["width", "number", "@width"],
      ["height", "number", "@height"]
    ]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(result.generatedInstance).toMatchObject({ name: "Part", moduleName: "Extracted" });
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "module Extracted(width: number, height: number) {",
      "  export const inside: number = @height + @width",
      "}",
      "instance Part = Extracted(width: @width, height: @height)",
      "const after: number = @Part::inside * 2"
    ].join("\n"));
  });

  it("preserves numeric parameter refinements from the resolved authored declaration", () => {
    const source = [
      "nui 4",
      "const stepper: number(step: 0.5, min: 0, max: 10) = 2",
      "const inside: number = @stepper + 1"
    ].join("\n");
    const { result } = plan(source, [2]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["stepper", "number(step: 0.5, min: 0, max: 10)"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "module Extracted(stepper: number(step: 0.5, min: 0, max: 10)) {"
    );
  });

  it("moves interstitial comments and blank lines with contiguous scalar siblings", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const first: number = @width + 1",
      "// keep between selected statements",
      "",
      "const second: number = @first + 1"
    ].join("\n");
    const { result } = plan(source, [2, 3]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(width: number) {",
      "  const first: number = @width + 1",
      "  // keep between selected statements",
      "",
      "  const second: number = @first + 1",
      "}",
      "instance Part = Extracted(width: @width)"
    ].join("\n"));
  });

  it("keeps internal scalar declarations private when they have no outside references", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const first: number = @width + 1",
      "const second: number = @first + 1"
    ].join("\n");
    const { result } = plan(source, [2, 3]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.exports).toEqual([]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("  const first: number = @width + 1");
    expect(next).toContain("  const second: number = @first + 1");
    expect(next).not.toContain("export const first");
    expect(next).not.toContain("export const second");
  });

  it("rejects non-contiguous authored scalar siblings and reports the intervening statement", () => {
    const source = [
      "nui 4",
      "const first: number = 1",
      "const middle: number = 2",
      "const last: number = 3"
    ].join("\n");
    const { result } = plan(source, [1, 3]);

    expect(result).toMatchObject({
      status: "rejected",
      code: "non-contiguous-target",
      interveningStatementIndex: 2,
      interveningStatementId: "extract:2"
    });
    expect("splices" in result).toBe(false);
  });

  it("rejects statements from different lexical scopes before checkpoint-specific handling", () => {
    const source = [
      "nui 4",
      "group G {",
      "  const inner: number = 1",
      "}",
      "const outer: number = 2"
    ].join("\n");
    const { result } = plan(source, [2, 4]);

    expectRejectedWithoutPatch(result, "cross-scope-target");
  });

  it("rejects import and file re-export statements for local-source v1", () => {
    const importSource = [
      "nui 4",
      "import \"./common.nui\" as common",
      "const value: number = 1"
    ].join("\n");
    expectRejectedWithoutPatch(plan(importSource, [1]).result, "unsupported-statement");

    const reExportSource = [
      "nui 4",
      "import \"./common.nui\" as common",
      "export @common::Pocket",
      "const value: number = 1"
    ].join("\n");
    expectRejectedWithoutPatch(plan(reExportSource, [2]).result, "unsupported-statement");
  });

  it("rejects generated-name collision, duplicate names, and stale source without emitting a patch", () => {
    const collisionSource = [
      "nui 4",
      "module Existing() {",
      "}",
      "const value: number = 1"
    ].join("\n");
    expectRejectedWithoutPatch(
      plan(collisionSource, [3], { moduleName: "Existing" }).result,
      "name-collision"
    );

    const distinctSource = ["nui 4", "const value: number = 1"].join("\n");
    expectRejectedWithoutPatch(
      plan(distinctSource, [1], { moduleName: "Same", instanceName: "Same" }).result,
      "invalid-name"
    );

    const compiled = compileCurrent(distinctSource);
    const stale = planExtractModule({
      source: { normalizedSource: `${distinctSource}\n`, sourceRevision: REVISION + 1 },
      compiled,
      statementIds: [statementIdAt(compiled, 1)],
      moduleName: "Extracted",
      instanceName: "Part"
    });
    expectRejectedWithoutPatch(stale, "stale-semantic-snapshot");
  });

  it("rejects non-authored/materialized-like statement identities without emitting a patch", () => {
    const source = ["nui 4", "const value: number = 1"].join("\n");
    const compiled = compileCurrent(source);
    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: ["materialized:descendant"],
      moduleName: "Extracted",
      instanceName: "Part"
    });

    expectRejectedWithoutPatch(result, "non-authored-target");
  });

  it("rejects cross-boundary set writes but allows a direct moved let/set pair to remain internal", () => {
    const source = [
      "nui 4",
      "let total: number = 0",
      "set total = @total + 1"
    ].join("\n");

    expectRejectedWithoutPatch(plan(source, [2]).result, "cross-boundary-mutation");

    const internal = plan(source, [1, 2]).result;
    expect(internal.status).toBe("planned");
    if (internal.status !== "planned") return;
    expect(internal.dependencies).toEqual([]);
    expect(internal.exports).toEqual([]);
  });

  it("parameterizes a direct point dependency used from a selected scalar expression", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const x: number = @A.x"
    ].join("\n");
    const { result } = plan(source, [2]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["A", "point", "@A"]
    ]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "module Extracted(A: point) {",
      "  const x: number = @A.x",
      "}",
      "instance Part = Extracted(A: @A)"
    ].join("\n"));
  });

  it("plans a root record dependency requiring generated Module field access", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "const inside: number = @config.amount + 1"
    ].join("\n");

    const result = plan(source, [3]).result;
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["config", "Config", "@config"]
    ]);
    const transformed = applyLineSplices(source, result.splices);
    compileCurrent(transformed);
    expect(transformed).toContain([
      "module Extracted(config: Config) {",
      "  const inside: number = @config.amount + 1",
      "}",
      "instance Part = Extracted(config: @config)"
    ].join("\n"));
  });

  it("extracts a nested scalar target with its outer scalar and iteration dependencies", () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "for i in range(from: 0, count: 2) {",
      "  const inside: number = @outer + @i",
      "}"
    ].join("\n");

    const { result } = plan(source, [3]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["outer", "number"],
      ["i", "number"]
    ]);
  });
});
