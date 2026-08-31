import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { createDslSemanticOccurrenceIndex } from "../dsl/dslSemanticOccurrenceIndex";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 98;

const compileCurrent = (source: string, idPrefix = "extract-module"): CompiledDslDocument => {
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

const planAt = (
  source: string,
  index: number,
  names: { moduleName?: string; instanceName?: string } = {}
) => {
  const compiled = compileCurrent(source);
  return {
    compiled,
    result: planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementIdAt(compiled, index)],
      moduleName: names.moduleName ?? "Extracted",
      instanceName: names.instanceName ?? "Part"
    })
  };
};

const expectRejectedWithoutPatch = (result: ReturnType<typeof planAt>["result"], code?: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  if (code) expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

const expectCleanTransformedSource = (
  source: string,
  result: ReturnType<typeof planAt>["result"]
): string => {
  expect(result.status).toBe("planned");
  if (result.status !== "planned") return source;
  const transformed = applyLineSplices(source, result.splices);
  compileCurrent(transformed, "extract-module-transformed");
  return transformed;
};

describe("planExtractModule checkpoint 8 Module structures", () => {
  it("extracts a complete root module definition without leaking its parameters or public interface", () => {
    const source = [
      "nui 4",
      "module Outer(input: number) {",
      "  export const publicValue: number = @input",
      "  module Inner() {",
      "    const local: number = 1",
      "  }",
      "  instance nested = Inner()",
      "}"
    ].join("\n");
    const { result } = planAt(source, 1);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "module Extracted() {",
      "  module Outer(input: number) {",
      "    export const publicValue: number = @input",
      "    module Inner() {",
      "      const local: number = 1",
      "    }",
      "    instance nested = Inner()",
      "  }",
      "}",
      "instance Part = Extracted()"
    ].join("\n"));
  });

  it("extracts a root module instance, parameterizes ordinary arguments, and keeps its earlier external callee authored", () => {
    const source = [
      "nui 4",
      "module M(anchor: point, width: number) {",
      "  export const result: number = @width",
      "}",
      "point Base = coordinate(x: 0, y: 0)",
      "const width: number = 10",
      "instance Source = M(anchor: @Base, width: @width)"
    ].join("\n");
    const { result } = planAt(source, 6);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["Base", "point"],
      ["width", "number"]
    ]);
    expect(result.dependencies.some((dependency) => dependency.name === "M")).toBe(false);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(Base: point, width: number) {",
      "  instance Source = M(anchor: @Base, width: @width)",
      "}",
      "instance Part = Extracted(Base: @Base, width: @width)"
    ].join("\n"));
  });

  it("keeps an immutable geometry-array argument on the existing generated-parameter path", () => {
    const source = [
      "nui 4",
      "module M(lines: line[]) {",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@Base]",
      "instance Source = M(lines: @lines)"
    ].join("\n");
    const { result } = planAt(source, 5);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["lines", "line[]", "@lines"]
    ]);
    expect(applyLineSplices(source, result.splices)).toContain([
      "module Extracted(lines: line[]) {",
      "  instance Source = M(lines: @lines)",
      "}",
      "instance Part = Extracted(lines: @lines)"
    ].join("\n"));
  });

  it("preserves nested Module definitions, instances, and loop iteration identities inside a moved Module", () => {
    const source = [
      "nui 4",
      "module Outer(count: number) {",
      "  module Inner() {",
      "    for i in range(from: 0, count: 2, step: 1) {",
      "      const local: number = @i",
      "    }",
      "  }",
      "  instance nested = Inner()",
      "}"
    ].join("\n");
    const { result } = planAt(source, 1);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    const transformed = applyLineSplices(source, result.splices);
    expect(transformed).toContain("module Inner() {");
    expect(transformed).toContain("instance nested = Inner()");
    expect(transformed).toContain("const local: number = @i");

    const next = compileCurrent(transformed, "extract-module-next");
    const nextFor = next.statements.findIndex((statement) =>
      statement.kind === "element" && statement.type === "forGroup"
    );
    expect(nextFor).toBeGreaterThanOrEqual(0);
    const nextForId = statementIdAt(next, nextFor);
    expect(createDslSemanticOccurrenceIndex(next).occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.identity.kind === "module" &&
      occurrence.identity.target.kind === "moduleIteration" &&
      occurrence.identity.target.statementId === nextForId
    )).toHaveLength(1);
  });

  it.each([
    ["group", [
      "group G {",
      "  instance Inside = M()",
      "}"
    ]],
    ["if", [
      "if (true) {",
      "  instance Inside = M()",
      "} else {",
      "}"
    ]],
    ["for", [
      "for i in range(from: 0, count: 2, step: 1) {",
      "  instance Inside = M()",
      "}"
    ]]
  ] as const)("moves Module descendants under selected %s structures", (_label, structure) => {
    const source = ["nui 4", "module M() {", "}", ...structure].join("\n");
    const compiled = compileCurrent(source);
    const index = compiled.statements.findIndex((statement) =>
      (_label === "group" && statement.kind === "group") ||
      (_label === "if" && statement.kind === "element" && statement.type === "conditionalGroup") ||
      (_label === "for" && statement.kind === "element" && statement.type === "forGroup")
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementIdAt(compiled, index)],
      moduleName: "Extracted",
      instanceName: "Part"
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain("instance Inside = M()");
  });

  it("rejects outside references to moved Module definitions and instances atomically", () => {
    const definitionSource = [
      "nui 4",
      "module M() {",
      "}",
      "instance Use = M()"
    ].join("\n");
    expectRejectedWithoutPatch(planAt(definitionSource, 1).result, "unrepresentable-export");

    const instanceSource = [
      "nui 4",
      "module M() {",
      "  export const value: number = 1",
      "}",
      "instance Use = M()",
      "const outside: number = @Use::value"
    ].join("\n");
    expectRejectedWithoutPatch(planAt(instanceSource, 4).result, "unsafe-rewrite");
  });

  it("rejects generated names colliding with moved Module declarations", () => {
    const source = [
      "nui 4",
      "group G {",
      "  module Inner() {",
      "  }",
      "  instance Child = Inner()",
      "}"
    ].join("\n");
    expectRejectedWithoutPatch(planAt(source, 1, { moduleName: "Inner" }).result, "name-collision");
    expectRejectedWithoutPatch(planAt(source, 1, { instanceName: "Child" }).result, "name-collision");
  });

  it("accepts a moved Module definition with a record-valued parameter", () => {
    const source = [
      "nui 4",
      "record Config(amount: number)",
      "module M(config: Config) {",
      "}"
    ].join("\n");
    const { result } = planAt(source, 2);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    const transformed = expectCleanTransformedSource(source, result);
    expect(transformed).toContain([
      "module Extracted() {",
      "  module M(config: Config) {",
      "  }",
      "}",
      "instance Part = Extracted()"
    ].join("\n"));
  });

  it("extracts a direct nested Module target inside an existing Module", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  module Inner() {",
      "  }",
      "}"
    ].join("\n");
    const { result } = planAt(source, 2);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    const transformed = applyLineSplices(source, result.splices);
    expect(transformed).toBe([
      "nui 4",
      "module Outer() {",
      "  module Extracted() {",
      "    module Inner() {",
      "    }",
      "  }",
      "  instance Part = Extracted()",
      "}"
    ].join("\n"));
    const next = compileCurrent(transformed, "extract-module-candidate");
    const outerIndex = next.statements.findIndex((statement) =>
      statement.kind === "moduleDefinition" && statement.name === "Outer"
    );
    const extractedIndex = next.statements.findIndex((statement) =>
      statement.kind === "moduleDefinition" && statement.name === "Extracted"
    );
    const partIndex = next.statements.findIndex((statement) =>
      statement.kind === "moduleInstance" && statement.name === "Part"
    );
    const outerId = statementIdAt(next, outerIndex);
    const extractedId = statementIdAt(next, extractedIndex);
    const partId = statementIdAt(next, partIndex);
    expect(next.moduleSemanticAnalysis?.instancesByStatementId.get(partId)).toMatchObject({
      callerModuleDefinitionStatementId: outerId,
      calleeResolution: "resolved",
      callee: { definitionStatementId: extractedId }
    });
  });
});
