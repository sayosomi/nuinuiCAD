import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";
import { applyLineSplices } from "./textPatch";

const REVISION = 169;

const compileCurrent = (source: string, idPrefix = "extract-mutation"): CompiledDslDocument => {
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

const plan = (source: string, selectedIndexes: readonly number[]) => {
  const compiled = compileCurrent(source);
  return {
    compiled,
    result: planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: selectedIndexes.map((index) => statementIdAt(compiled, index)),
      moduleName: "Extracted",
      instanceName: "Part"
    })
  };
};

const expectRejectedWithoutPatch = (result: ReturnType<typeof plan>["result"], code: string) => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  expect(result.code).toBe(code);
  expect("splices" in result).toBe(false);
};

describe("planExtractModule checkpoint 9 bare mutations", () => {
  it("extracts reverse with its mutated line and does not create a mutation export", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "reverse(target: @AB)"
    ].join("\n");

    const { result } = plan(source, [1, 2]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toBe([
      "nui 4",
      "module Extracted() {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "  reverse(target: @AB)",
      "}",
      "instance Part = Extracted()"
    ].join("\n"));
  });

  it("extracts extend with its target line while parameterizing only the read-only point", () => {
    const source = [
      "nui 4",
      "point To = coordinate(x: 20, y: 0)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "extend(end: @AB.end, to: @To)"
    ].join("\n");

    const { result } = plan(source, [2, 3]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText, dependency.argumentSource])).toEqual([
      ["To", "point", "@To"]
    ]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain(
      "module Extracted(To: point) {\n  line AB = segment(start: (0, 0), end: (10, 0))\n  extend(end: @AB.end, to: @To)"
    );
  });

  it("requires every move target to move and preserves multiple target owners", () => {
    const source = [
      "nui 4",
      "const Scale: number = 2",
      "point From = coordinate(x: 0, y: 0)",
      "point To = coordinate(x: 10, y: 0)",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "line B = segment(start: (1, 0), end: (2, 0))",
      "move(targets: [@A, @B], from: @From, to: @To, scale: @Scale)"
    ].join("\n");

    const complete = plan(source, [4, 5, 6]).result;
    expect(complete.status).toBe("planned");
    if (complete.status === "planned") {
      expect(complete.dependencies.map((dependency) => dependency.name)).toEqual(["Scale", "From", "To"]);
      expect(complete.exports).toEqual([]);
    }

    expectRejectedWithoutPatch(plan(source, [5, 6]).result, "cross-boundary-mutation");
  });

  it("keeps mirrorMove axis geometry as ordinary read-only dependencies", () => {
    const source = [
      "nui 4",
      "point Axis1 = coordinate(x: 0, y: 0)",
      "point Axis2 = coordinate(x: 0, y: 10)",
      "line A = segment(start: (1, 0), end: (2, 0))",
      "mirrorMove(targets: [@A], axis1: @Axis1, axis2: @Axis2)"
    ].join("\n");

    const { result } = plan(source, [3, 4]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => [dependency.name, dependency.typeText])).toEqual([
      ["Axis1", "point"],
      ["Axis2", "point"]
    ]);
    expect(result.exports).toEqual([]);
  });

  it("preserves both edge endpoint owners when they move with the mutation", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "line B = segment(start: (1, 0), end: (2, 0))",
      "edge(end1: @A.end, end2: @B.start)"
    ].join("\n");

    const { result } = plan(source, [1, 2, 3]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies).toEqual([]);
    expect(result.exports).toEqual([]);
  });

  it("rejects either direction of a bare mutation boundary without partial mutation", () => {
    const mutationOutside = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "reverse(target: @A)"
    ].join("\n");
    expectRejectedWithoutPatch(plan(mutationOutside, [2]).result, "cross-boundary-mutation");

    const ownerOutside = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "reverse(target: @A)"
    ].join("\n");
    expectRejectedWithoutPatch(plan(ownerOutside, [1]).result, "cross-boundary-mutation");
  });

  it("accepts bare mutations recursively under a selected group, if, and for", () => {
    const source = [
      "nui 4",
      "point To = coordinate(x: 20, y: 0)",
      "group Pocket {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  if (true) {",
      "    for i in range(from: 0, count: 1, step: 1) {",
      "      extend(end: @A.end, to: @To)",
      "    }",
      "  }",
      "}"
    ].join("\n");

    const compiled = compileCurrent(source);
    const groupIndex = compiled.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Pocket");
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementIdAt(compiled, groupIndex)],
      moduleName: "Extracted",
      instanceName: "Part"
    });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.dependencies.map((dependency) => dependency.name)).toEqual(["To"]);
    expect(result.exports).toEqual([]);
    expect(applyLineSplices(source, result.splices)).toContain("      extend(end: @A.end, to: @To)");
  });

  it("keeps a bare mutation valid inside a moved Module definition", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  reverse(target: @A)",
      "}"
    ].join("\n");

    const { result } = plan(source, [1]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const transformed = applyLineSplices(source, result.splices);
    expect(transformed).toContain("  reverse(target: @A)");
    expect(compileCurrent(transformed, "extract-mutation-next").diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("retains the cross-boundary mutation guard for a nested bare mutation", () => {
    const source = [
      "nui 4",
      "group Pocket {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  reverse(target: @A)",
      "}"
    ].join("\n");
    expectRejectedWithoutPatch(plan(source, [3]).result, "cross-boundary-mutation");
  });
});
