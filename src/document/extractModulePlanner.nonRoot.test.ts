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

  it("extracts targets owned by an existing Module definition through its parameters", () => {
    const source = [
      "nui 4",
      "module Outer(width: number) {",
      "  const local: number = @width + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "local")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["width", "number", "@width"]
    ]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "module Outer(width: number) {",
      "  module Extracted(width: number) {",
      "    const local: number = @width + 1",
      "  }",
      "  instance Part = Extracted(width: @width)",
      "}"
    ].join("\n"));
  });

  it("parameterizes an outer Module-local scalar", () => {
    const source = [
      "nui 4",
      "module Outer(width: number) {",
      "  const local: number = @width + 1",
      "  const inside: number = @local + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["local", "number", "@local"]
    ]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "module Outer(width: number) {",
      "  const local: number = @width + 1",
      "  module Extracted(local: number) {",
      "    const inside: number = @local + 1",
      "  }",
      "  instance Part = Extracted(local: @local)",
      "}"
    ].join("\n"));
  });

  it("parameterizes an outer Module geometry value", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  point Base = coordinate(x: 0, y: 0)",
      "  point inside = offset(from: @Base, dx: 1, dy: 0)",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["Base", "point", "@Base"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(Base: point) {",
      "    point inside = offset(from: @Base, dx: 1, dy: 0)",
      "  }",
      "  instance Part = Extracted(Base: @Base)"
    ].join("\n"));
  });

  it("parameterizes an outer Module immutable geometry-array value", () => {
    const source = [
      "nui 4",
      "module Outer(source: line[]) {",
      "  const moved: path[] = @source",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "moved")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["source", "line[]", "@source"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(source: line[]) {",
      "    const moved: path[] = @source",
      "  }",
      "  instance Part = Extracted(source: @source)"
    ].join("\n"));
  });

  it("exports a selected Module-local scalar and rewrites a later outer Module consumer", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  const inside: number = 1",
      "  const after: number = @inside + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "module Outer() {",
      "  module Extracted() {",
      "    export const inside: number = 1",
      "  }",
      "  instance Part = Extracted()",
      "  const after: number = @Part::inside + 1",
      "}"
    ].join("\n"));
  });

  it("exports a selected Module-local geometry and rewrites its later consumer", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  point inside = coordinate(x: 0, y: 0)",
      "  point after = offset(from: @inside, dx: 1, dy: 0)",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "point after = offset(from: @Part::inside, dx: 1, dy: 0)"
    );
  });

  it("exports a selected Module-local geometry array and rewrites its later consumer", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  line base = segment(start: (0, 0), end: (10, 0))",
      "  const inside: line[] = [@base]",
      "  const after: path[] = @inside",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.exports.map((entry) => entry.name)).toEqual(["inside"]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "const after: path[] = @Part::inside"
    );
  });

  it("supports a target inside a nested group/conditional/for scope owned by a Module", () => {
    const cases = [
      [
        "group G {",
        "  const inside: number = @width + 1",
        "}"
      ],
      [
        "if (@enabled) {",
        "  const inside: number = @width + 1",
        "} else {",
        "}"
      ],
      [
        "for i in range(from: 0, count: 2, step: 1) {",
        "  const inside: number = @i + 1",
        "}"
      ]
    ] as const;

    for (const structure of cases) {
      const source = [
        "nui 4",
        "module Outer(width: number, enabled: boolean) {",
        ...structure,
        "}"
      ].join("\n");
      const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
      expect(result.status).toBe("planned");
      if (result.status !== "planned") continue;
      expect(applyLineSplices(source, result.splices)).toContain("instance Part = Extracted(");
    }
  });

  it("rejects moving an existing outer Module export", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  export const publicValue: number = 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "publicValue")]);
    expect(result).toMatchObject({ status: "rejected", code: "existing-public-interface" });
    if (result.status === "rejected") expect("splices" in result).toBe(false);
  });

  it("keeps Module-local cross-boundary mutation rejection intact", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  let total: number = 0",
      "  set total = @total + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "total") + 1]);
    expect(result).toMatchObject({ status: "rejected", code: "cross-boundary-mutation" });
    if (result.status === "rejected") expect("splices" in result).toBe(false);
  });

  it("keeps record-valued Module-owned dependencies fail closed", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module Outer(config: Config) {",
      "  const inside: number = @config.amount + 1",
      "}"
    ].join("\n");

    const { result } = plan(source, (compiled) => [statementIndexNamed(compiled, "inside")]);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect("splices" in result).toBe(false);
  });
});
