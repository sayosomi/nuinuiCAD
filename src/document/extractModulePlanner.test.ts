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

describe("planExtractModule", () => {
  it("extracts one statement, infers scalar parameters in declaration order, exports selected declarations used outside, and returns one atomic splice batch", () => {
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

  it("treats namespace prefixes as path structure rather than independent dependencies", () => {
    const source = [
      "nui 4",
      "group G {",
      "  const width: number = 10",
      "}",
      "const inside: number = @G::width + 1"
    ].join("\n");
    const { result } = plan(source, [4]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.argumentSource])).toEqual([
      ["width", "@G::width"]
    ]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("module Extracted(width: number) {");
    expect(next).toContain("  const inside: number = @width + 1");
    expect(next).toContain("instance Part = Extracted(width: @G::width)");
  });

  it("moves interstitial comments and blank lines with a contiguous sibling selection", () => {
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
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain([
      "module Extracted(width: number) {",
      "  const first: number = @width + 1",
      "  // keep between selected statements",
      "",
      "  const second: number = @first + 1",
      "}",
      "instance Part = Extracted(width: @width)"
    ].join("\n"));
  });

  it("rejects non-contiguous authored siblings and reports the intervening statement", () => {
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
  });

  it("rejects statements from different lexical scopes", () => {
    const source = [
      "nui 4",
      "group G {",
      "  const inner: number = 1",
      "}",
      "const outer: number = 2"
    ].join("\n");
    const { result } = plan(source, [2, 4]);

    expect(result).toMatchObject({ status: "rejected", code: "cross-scope-target" });
  });

  it("rejects import statements in local-source v1", () => {
    const source = [
      "nui 4",
      "import \"./common.nui\" as common",
      "const value: number = 1"
    ].join("\n");
    const { result } = plan(source, [1]);

    expect(result).toMatchObject({ status: "rejected", code: "unsupported-statement", statementIndex: 1 });
  });

  it("rejects target-scope generated-name collisions without suffixing", () => {
    const source = [
      "nui 4",
      "module Existing() {",
      "}",
      "const value: number = 1"
    ].join("\n");
    const { result } = plan(source, [3], { moduleName: "Existing" });

    expect(result).toMatchObject({ status: "rejected", code: "name-collision" });
  });

  it("rejects cross-boundary set writes but allows a moved let/set pair to stay internal", () => {
    const externalSource = [
      "nui 4",
      "let total: number = 0",
      "set total = @total + 1"
    ].join("\n");
    const external = plan(externalSource, [2]).result;
    expect(external).toMatchObject({ status: "rejected", code: "cross-boundary-mutation", statementIndex: 2 });

    const internalSource = [
      "nui 4",
      "let total: number = 0",
      "set total = @total + 1"
    ].join("\n");
    const internal = plan(internalSource, [1, 2]).result;
    expect(internal.status).toBe("planned");
    if (internal.status !== "planned") return;
    expect(internal.dependencies).toEqual([]);
    expect(internal.exports).toEqual([]);
  });

  it("fails closed for stale snapshots and returns no partial source mutation", () => {
    const source = ["nui 4", "const value: number = 1"].join("\n");
    const compiled = compileCurrent(source);
    const result = planExtractModule({
      source: { normalizedSource: `${source}\n`, sourceRevision: REVISION + 1 },
      compiled,
      statementIds: [statementIdAt(compiled, 1)],
      moduleName: "Extracted",
      instanceName: "Part"
    });

    expect(result).toMatchObject({ status: "rejected", code: "stale-semantic-snapshot" });
    expect("splices" in result).toBe(false);
  });
});
