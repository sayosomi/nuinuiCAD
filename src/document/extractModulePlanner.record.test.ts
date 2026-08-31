import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 219;

const compileCurrent = (source: string, idPrefix = "extract-record"): CompiledDslDocument => {
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
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  if (!statementId) throw new Error(`missing statement id at ${index}`);
  return statementId;
};

const statementIndexNamed = (compiled: CompiledDslDocument, name: string): number => {
  const index = compiled.statements.findIndex((statement) => statement.name === name);
  if (index < 0) throw new Error(`missing statement named ${name}`);
  return index;
};

const plan = (
  source: string,
  selectedNames: readonly string[],
  compiled = compileCurrent(source)
) => planExtractModule({
  source: { normalizedSource: source, sourceRevision: REVISION },
  compiled,
  statementIds: selectedNames.map((name) => statementIdAt(compiled, statementIndexNamed(compiled, name))),
  moduleName: "Extracted",
  instanceName: "Part"
});

const expectRejectedWithoutPatch = (result: ReturnType<typeof plan>, code?: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  if (code) expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

const withOuterRecordParameterIdentity = (
  compiled: CompiledDslDocument,
  recordTypeIdentity: string | null
): CompiledDslDocument => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) throw new Error("missing Module semantic analysis");
  const definitions = analysis.definitions.map((definition) =>
    definition.name === "Outer"
      ? {
          ...definition,
          parameters: definition.parameters.map((parameter, index) =>
            index === 0 ? { ...parameter, recordTypeIdentity } : parameter
          )
        }
      : definition
  );
  return {
    ...compiled,
    moduleSemanticAnalysis: {
      ...analysis,
      definitions,
      definitionsByStatementId: new Map(definitions.map((definition) => [definition.statementId, definition]))
    }
  };
};

describe("planExtractModule record-valued interfaces", () => {
  it("parameterizes a root record value through field access as one nominal dependency", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "const inside: number = @config.amount + 1"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [
      dependency.name,
      dependency.type,
      dependency.recordTypeIdentity,
      dependency.typeText,
      dependency.argumentSource
    ])).toEqual([["config", null, "extract-record:1", "Config", "@config"]]);
    expect(result.dependencies).toHaveLength(1);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(config: Config) {",
      "  const inside: number = @config.amount + 1",
      "}",
      "instance Part = Extracted(config: @config)"
    ].join("\n"));
  });

  it("parameterizes an outer Module-local record value through its field access", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module Outer() {",
      "  const config: Config = Config(amount: 12)",
      "  const inside: number = @config.amount + 1",
      "}"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["config", "Config", "@config"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(config__extract: Config) {",
      "    const inside: number = @config__extract.amount + 1",
      "  }",
      "  instance Part = Extracted(config__extract: @config)"
    ].join("\n"));
  });

  it("preserves a whole-record alias source without splitting its fields", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "const inside: Config = @config"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["config", "Config", "@config"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "  const inside: Config = @config"
    );
  });

  it("parameterizes a qualified existing Module record export through a field", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module Provider() {",
      "  export const output: Config = Config(amount: 7)",
      "}",
      "instance Source = Provider()",
      "const inside: number = @Source::output.amount + 1"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.type, dependency.typeText, dependency.argumentSource])).toEqual([
      ["output", null, "Config", "@Source::output"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(output: Config) {",
      "  const inside: number = @output.amount + 1",
      "}",
      "instance Part = Extracted(output: @Source::output)"
    ].join("\n"));
  });

  it("exports a selected record const and rewrites an outside field reference through the generated instance", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const inside: Config = Config(amount: 12)",
      "const after: number = @inside.amount"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "const after: number = @Part::inside.amount"
    );
  });

  it("combines a record dependency with a direct record export", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "const inside: Config = @config",
      "const after: number = @inside.amount"
    ].join("\n");
    const result = plan(source, ["inside"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["config", "Config"]
    ]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(config: Config) {",
      "  export const inside: Config = @config",
      "}",
      "instance Part = Extracted(config: @config)",
      "const after: number = @Part::inside.amount"
    ].join("\n"));
  });

  it("accepts a moved external-callee Module instance with a record argument", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module M(config: Config) {",
      "}",
      "const config: Config = Config(amount: 1)",
      "instance Use = M(config: @config)"
    ].join("\n");
    const result = plan(source, ["Use"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["config", "Config", "@config"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "  instance Use = M(config: @config)"
    );
  });

  it("keeps record definitions non-movable", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "const value: number = 1"
    ].join("\n");
    expectRejectedWithoutPatch(plan(source, ["Config"]), "unsupported-statement");
  });

  it("fails closed when a Module record parameter has missing nominal identity", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module Outer(config: Config) {",
      "  const inside: number = @config.amount + 1",
      "}"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = plan(source, ["inside"], withOuterRecordParameterIdentity(compiled, null));
    expectRejectedWithoutPatch(result, "unrepresentable-dependency");
  });

  it("fails closed when record field and whole-record base identities disagree", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module Outer(config: Config) {",
      "  const inside: number = @config.amount + 1",
      "}"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = plan(source, ["inside"], withOuterRecordParameterIdentity(compiled, "tampered-record-type"));
    expectRejectedWithoutPatch(result, "unrepresentable-dependency");
  });
});
