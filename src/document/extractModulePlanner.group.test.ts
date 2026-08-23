import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 76;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract-group:${index}`]));
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

const groupIndexNamed = (compiled: CompiledDslDocument, name: string): number => {
  const index = compiled.statements.findIndex((statement) => statement.kind === "group" && statement.name === name);
  if (index < 0) throw new Error(`missing group ${name}`);
  return index;
};

const planGroup = (source: string, name = "Pocket") => {
  const compiled = compileCurrent(source);
  const index = groupIndexNamed(compiled, name);
  return planExtractModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    statementIds: [statementIdAt(compiled, index)],
    moduleName: "Extracted",
    instanceName: "Part"
  });
};

const expectRejectedWithoutPatch = (result: ReturnType<typeof planGroup>, code: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

describe("planExtractModule checkpoint 4 plain groups", () => {
  it("moves a complete plain group intact, preserves layout, and parameterizes an outer scalar", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "group Pocket {",
      "  const first: number = @width + 1",
      "  // keep inside the authored group",
      "",
      "  group Detail {",
      "    const second: number = @first + 1",
      "  }",
      "}"
    ].join("\n");

    const result = planGroup(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["width", "number", "@width"]
    ]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "const width: number = 10",
      "module Extracted(width: number) {",
      "  group Pocket {",
      "    const first: number = @width + 1",
      "    // keep inside the authored group",
      "",
      "    group Detail {",
      "      const second: number = @first + 1",
      "    }",
      "  }",
      "}",
      "instance Part = Extracted(width: @width)"
    ].join("\n"));
  });

  it("keeps nested scalar, geometry, and geometry-array references internal to the moved group subtree", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "group Pocket {",
      "  point Local = offset(from: @Base, dx: 1, dy: 0)",
      "  line Edge = segment(start: @Local, end: (10, 0))",
      "  const lines: line[] = [@Edge]",
      "  const paths: path[] = @lines",
      "}"
    ].join("\n");

    const result = planGroup(source);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["Base", "point"]
    ]);
    expect(result.exports).toEqual([]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("module Extracted(Base: point) {");
    expect(next).toContain("    const lines: line[] = [@Edge]");
    expect(next).toContain("    const paths: path[] = @lines");
  });

  it("fails closed when a declaration nested inside the selected group is referenced from outside", () => {
    const source = [
      "nui 4",
      "group Pocket {",
      "  const inside: number = 1",
      "}",
      "const after: number = @Pocket::inside + 1"
    ].join("\n");

    expectRejectedWithoutPatch(planGroup(source), "unrepresentable-export");
  });

  it("fails closed for conditional descendants instead of widening Checkpoint 4 into binder semantics", () => {
    const source = [
      "nui 4",
      "const flag: boolean = true",
      "group Pocket {",
      "  if (@flag) {",
      "    const inside: number = 1",
      "  }",
      "}"
    ].join("\n");

    expectRejectedWithoutPatch(planGroup(source), "unsupported-statement");
  });

  it("keeps a let/set pair inside the group but rejects a write crossing the Extract boundary", () => {
    const internalSource = [
      "nui 4",
      "group Pocket {",
      "  let total: number = 0",
      "  set total = @total + 1",
      "}"
    ].join("\n");
    const internal = planGroup(internalSource);
    expect(internal.status).toBe("planned");
    if (internal.status === "planned") expect(internal.dependencies).toEqual([]);

    const crossingSource = [
      "nui 4",
      "let total: number = 0",
      "group Pocket {",
      "  set total = @total + 1",
      "}"
    ].join("\n");
    expectRejectedWithoutPatch(planGroup(crossingSource), "cross-boundary-mutation");
  });
});
