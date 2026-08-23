import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 74;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract-geometry:${index}`]));
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

const expectRejectedWithoutPatch = (
  result: ReturnType<typeof plan>,
  code?: string
) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  if (code) expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

describe("planExtractModule checkpoint 2 direct geometry", () => {
  it("parameterizes a direct point dependency, exports selected geometry, and rewrites the outside reference", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 10, y: 20)",
      "point Inside = offset(from: @Base, dx: 1, dy: 2)",
      "point After = offset(from: @Inside, dx: 3, dy: 4)"
    ].join("\n");

    const result = plan(source, [2]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["Base", "point", "@Base"]
    ]);
    expect(result.exports.map((entry) => entry.name)).toEqual(["Inside"]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "point Base = coordinate(x: 10, y: 20)",
      "module Extracted(Base: point) {",
      "  export point Inside = offset(from: @Base, dx: 1, dy: 2)",
      "}",
      "instance Part = Extracted(Base: @Base)",
      "point After = offset(from: @Part::Inside, dx: 3, dy: 4)"
    ].join("\n"));
  });

  it("classifies direct geometry dependencies as strict line or broad path from existing Module semantics", () => {
    const source = [
      "nui 4",
      "line Guide = segment(start: (0, 0), end: (10, 0))",
      "curve Bezier = bezier(start: (0, 0), end: (10, 10))",
      "point FromLine = offset(from: @Guide.start, dx: 1, dy: 0)",
      "line FromPath = offset(sources: [@Bezier], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");

    const result = plan(source, [3, 4]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["Guide", "line", "@Guide"],
      ["Bezier", "path", "@Bezier"]
    ]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "module Extracted(Guide: line, Bezier: path) {"
    );
  });

  it("keeps deterministic source-order parameters across scalar and point dependencies while preserving internal references", () => {
    const source = [
      "nui 4",
      "const dx: number = 2",
      "point Base = coordinate(x: 10, y: 20)",
      "const local: number = @dx + 1",
      "point Moved = offset(from: @Base, dx: @local, dy: 0)"
    ].join("\n");

    const result = plan(source, [3, 4]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["dx", "number", "@dx"],
      ["Base", "point", "@Base"]
    ]);
    expect(result.exports).toEqual([]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("module Extracted(dx: number, Base: point) {");
    expect(next).toContain("  const local: number = @dx + 1");
    expect(next).toContain("  point Moved = offset(from: @Base, dx: @local, dy: 0)");
  });

  it("keeps geometry arrays outside Checkpoint 2 and fails closed without a patch", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const paths: path[] = [@A]"
    ].join("\n");

    expectRejectedWithoutPatch(plan(source, [2]), "unsupported-statement");
  });
});