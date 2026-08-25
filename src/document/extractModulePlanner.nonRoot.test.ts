import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 170;

const compileCurrent = (source: string, idPrefix = "extract-non-root"): CompiledDslDocument => {
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

const statementIndexNamed = (compiled: CompiledDslDocument, name: string): number => {
  const index = compiled.statements.findIndex((statement) => statement.name === name);
  if (index < 0) throw new Error(`missing statement named ${name}`);
  return index;
};

const plan = (
  source: string,
  select: (compiled: CompiledDslDocument) => readonly number[],
  names: { moduleName?: string; instanceName?: string } = {}
) => {
  const compiled = compileCurrent(source);
  return {
    compiled,
    result: planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: select(compiled).map((index) => statementIdAt(compiled, index)),
      moduleName: names.moduleName ?? "Extracted",
      instanceName: names.instanceName ?? "Part"
    })
  };
};

describe("planExtractModule checkpoint 10 non-root source scopes", () => {
  it("extracts a group-local declaration with scalar/geometry dependencies and rewrites its same-scope export", () => {
    const source = [
      "nui 4",
      "point Root = coordinate(x: 0, y: 0)",
      "group Pocket {",
      "  const length: number = 10",
      "  line AB = segment(start: @Root, end: (@length, 0))",
      "  point After = offset(from: @AB.start, dx: 1, dy: 0)",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "AB")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["Root", "point", "@Root"],
      ["length", "number", "@length"]
    ]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["AB"]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "point Root = coordinate(x: 0, y: 0)",
      "group Pocket {",
      "  const length: number = 10",
      "  module Extracted(Root: point, length: number) {",
      "    export line AB = segment(start: @Root, end: (@length, 0))",
      "  }",
      "  instance Part = Extracted(Root: @Root, length: @length)",
      "  point After = offset(from: @Part::AB.start, dx: 1, dy: 0)",
      "}"
    ].join("\n"));
  });

  it("extracts a conditional-local declaration using an earlier sibling dependency", () => {
    const source = [
      "nui 4",
      "if (true) {",
      "  const base: number = 3",
      "  const doubled: number = @base * 2",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "doubled")]);
    expect(result).toMatchObject({ status: "planned" });
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([["base", "number"]]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "  module Extracted(base: number) {\n    const doubled: number = @base * 2\n  }\n  instance Part = Extracted(base: @base)"
    );
  });

  it("parameterizes the existing enclosing for iteration binding", () => {
    const source = [
      "nui 4",
      "for i in range(from: 0, count: 3, step: 1) {",
      "  const doubled: number = @i * 2",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "doubled")]);
    expect(result).toMatchObject({ status: "planned" });
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["i", "number", "@i"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "  module Extracted(i: number) {\n    const doubled: number = @i * 2\n  }\n  instance Part = Extracted(i: @i)"
    );
  });

  it("parameterizes a geometry-array dependency declared in the same nested source scope", () => {
    const source = [
      "nui 4",
      "group Pocket {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  const source: line[] = [@A]",
      "  const moved: path[] = @source",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "moved")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([["source", "line[]"]]);
  });

  it("keeps cross-scope selections and same-scope generated-name collisions fail closed", () => {
    const source = [
      "nui 4",
      "group First {",
      "  const A: number = 1",
      "}",
      "group Second {",
      "  module Extracted() {",
      "  }",
      "  const B: number = 2",
      "}"
    ].join("\n");

    const crossScope = plan(source, (compiled) => [
      statementIndexNamed(compiled, "A"),
      statementIndexNamed(compiled, "B")
    ]).result;
    expect(crossScope).toMatchObject({ status: "rejected", code: "cross-scope-target" });

    const collision = plan(source, (compiled) => [statementIndexNamed(compiled, "B")]).result;
    expect(collision).toMatchObject({ status: "rejected", code: "name-collision" });
  });

  it("keeps targets owned by an existing Module definition fail closed", () => {
    const source = [
      "nui 4",
      "module Outer(width: number) {",
      "  const local: number = @width + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "local")]);
    expect(result).toMatchObject({ status: "rejected", code: "unsupported-statement" });
    if (result.status === "rejected") expect("splices" in result).toBe(false);
  });
});
