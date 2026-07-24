import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { afterStatement, beforeStatement } from "./bindingVersions";
import { createIncrementalLinearMutationEvaluator } from "./linearMutationEvaluator";

const compile = (source: string) => {
  const lines = source.split("\n");
  const compiled = compileDslDocument(source, {
    assignedStatementIds: new Map(lines.map((_, index) => [index, `statement:${index}`]))
  });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return compiled.bindingVersions!;
};

const external = (bindingId: string) => ({
  status: "error" as const,
  type: { kind: "number" as const },
  issueCode: "external-unavailable",
  bindingId
});

describe("incremental linear mutation evaluator", () => {
  it("uses before-statement slots for self and cross-binding RHS reads", () => {
    const graph = compile([
      "nui 3",
      "let x: number = 1",
      "let y: number = 10",
      "set x = @x + @y",
      "set y = @x"
    ].join("\n"));
    const [x0, y0, x1, y1] = graph.versions;
    const evaluator = createIncrementalLinearMutationEvaluator(graph, external);

    evaluator.advanceTo(beforeStatement(x1.sourceOrder));
    expect(evaluator.resolveCurrent(x0.bindingId)).toMatchObject({ value: { value: 1 } });
    expect(evaluator.resolveCurrent(y0.bindingId)).toMatchObject({ value: { value: 10 } });
    evaluator.advanceTo(beforeStatement(y1.sourceOrder));
    expect(evaluator.resolveCurrent(x0.bindingId)).toMatchObject({ value: { value: 11 } });
    expect(evaluator.resolveCurrent(y0.bindingId)).toMatchObject({ value: { value: 10 } });
    const final = evaluator.finalize(afterStatement(y1.sourceOrder));
    expect(final.resultsByBindingId.get(y0.bindingId)).toMatchObject({ value: { value: 11 } });
  });

  it("records poisoned versions and recovers the same slot with a later valid set", () => {
    const graph = compile(["nui 3", "let x: number = 1", "set x = 1 / 0", "set x = 3"].join("\n"));
    const [declaration, failed, recovered] = graph.versions;
    const final = createIncrementalLinearMutationEvaluator(graph, external).finalize(afterStatement(recovered.sourceOrder));

    expect(final.historyByVersionId.get(failed.id)).toMatchObject({
      status: "poisoned", versionId: failed.id, statementId: failed.id, bindingId: declaration.bindingId
    });
    expect(final.historyByVersionId.get(recovered.id)).toMatchObject({ status: "executed", bindingId: declaration.bindingId });
    expect(final.resultsByBindingId.get(declaration.bindingId)).toMatchObject({ status: "ok", value: { value: 3 } });
  });

  it("keeps all scalar types in final binding slots", () => {
    const graph = compile([
      "nui 3",
      'let text: string = "old"',
      "let flag: boolean = false",
      "let side: choice(right, left) = right",
      'set text = "new"',
      "set flag = true",
      "set side = left"
    ].join("\n"));
    const final = createIncrementalLinearMutationEvaluator(graph, external).finalize(afterStatement(99));

    expect([...final.resultsByBindingId.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: { kind: "string", value: "new" } }),
      expect.objectContaining({ value: { kind: "boolean", value: true } }),
      expect.objectContaining({ value: { kind: "choice", value: "left", options: ["right", "left"] } })
    ]));
  });

  it("records control-owner versions as skipped without writing a current slot", () => {
    const graph = compile([
      "nui 3",
      "if C (true) {",
      "  let x: number = 1",
      "  set x = 2",
      "}"
    ].join("\n"));
    const [declaration, set] = graph.versions;
    const evaluator = createIncrementalLinearMutationEvaluator(graph, external);
    const final = evaluator.finalize(afterStatement(99));

    expect(final.historyByVersionId.get(declaration.id)).toMatchObject({ status: "skipped-control" });
    expect(final.historyByVersionId.get(set.id)).toMatchObject({ status: "skipped-control" });
    expect(final.resultsByBindingId.has(declaration.bindingId)).toBe(false);
    expect(evaluator.resolveCurrent(declaration.bindingId)).toMatchObject({ issueCode: "evaluation-binding-version-unavailable" });
  });
});
