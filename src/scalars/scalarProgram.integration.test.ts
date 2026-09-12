import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { evaluateScalarProgram } from "./declarationEvaluator";

const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

describe("compiled scalar program", () => {
  it("keeps typed declarations out of elements and preserves source order across nested scopes", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const outer: number = 2",
      "group G {",
      "  const inner: number = @outer + 1",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));

    expect(compiled.document.elements.map((element) => element.name)).toEqual(["G", "A"]);
    expect(compiled.scalarProgram?.statements.map((statement) => statement.sourceOrder)).toEqual([1, 3]);
    expect(compiled.scalarProgram?.statements[1].declaration.initializer).toMatchObject({
      kind: "binary",
      left: { kind: "reference", bindingId: compiled.scalarProgram?.statements[0].bindingId }
    });
    expect(compiled.bindingAnalysis?.compiledProgram.bindingIds).toEqual(
      compiled.scalarProgram?.statements.map((statement) => statement.bindingId)
    );
  });

  it("inherits a reconciler-owned binding identity across an edit without deriving it from source", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
    const first = compileCanonicalText(baseline, "nui 1\nconst width: number = 12\npoint A = coordinate(x: 0, y: 0)");
    expect(first.status).not.toBe("fatal");
    const bindingId = first.doc.scalarProgram!.statements[0].bindingId;

    const edited = compileCanonicalText(first, "nui 1\nconst width: number = 24\npoint A = coordinate(x: 0, y: 0)");
    expect(edited.status).not.toBe("fatal");
    expect(edited.doc.scalarProgram!.statements[0].bindingId).toBe(bindingId);
  });

  it("uses Task 13R eligibility to exclude invalid declarations and their dependents", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const broken: number = @missing",
      "const dependent: number = @broken + 1",
      "const valid: number = 3"
    ].join("\n"));

    expect(compiled.scalarProgram?.statements.map((statement) => statement.bindingId)).toHaveLength(1);
    expect(compiled.scalarProgram?.statements[0].declaration.initializer).toMatchObject({ value: 3 });
    expect(compiled.bindingAnalysis?.entries.map((entry) => entry.programEligibility.kind)).toEqual([
      "ineligible",
      "ineligible",
      "eligible"
    ]);
  });

  it("keeps stop geometry indexing while carrying an explicit source-order scalar limit", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const before: number = 1",
      "point A = coordinate(x: 0, y: 0)",
      "stop",
      "const after: number = 2",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n"));

    expect(compiled.document.evaluationLimitIndex).toBe(1);
    expect(compiled.scalarProgram?.evaluationLimitSourceOrder).toBe(3);
    expect(compiled.scalarProgramPositionMap).toEqual({
      sourceOrderByElementIndex: [2, 5],
      evaluationLimit: { elementIndex: 1, sourceOrder: 3 }
    });
  });

  it("omits the optional program for a document with no typed declarations", () => {
    const noTyped = compileDslDocument("nui 1\npoint A = coordinate(x: 0, y: 0)");
    expect(noTyped.document?.elements.map((element) => element.type)).toEqual(["freePoint"]);
    expect(noTyped.scalarProgram).toBeUndefined();
  });

  it("errors when typed identity is absent", () => {
    const missingIdentity = compileDslDocument("nui 1\nconst width: number = 12");
    expect(missingIdentity.document).toBeNull();
    expect(missingIdentity.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-stable-statement-identity", line: 2 })
    ]));
  });

  it("compiles and evaluates scalar and choice value-if declarations, including canonical multiline framing", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const flag: boolean = true",
      "const amount: number =",
      "  if (@flag) {",
      "  10",
      "} else {",
      "  1 / 0",
      "}",
      "const side: choice(left, right) = if (@flag) { left } else { right }",
      "const after: number = 30"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const scalarProgram = compiled.scalarProgram!;
    const byName = new Map(scalarProgram.statements.map((statement) => [
      compiled.bindingAnalysis!.catalog.bindingsById.get(statement.bindingId)!.name,
      statement.bindingId
    ]));
    const evaluated = evaluateScalarProgram(scalarProgram).resultsByBindingId;
    expect(evaluated.get(byName.get("amount")!)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 10 }
    });
    expect(evaluated.get(byName.get("side")!)).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["left", "right"] },
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
    expect(evaluated.get(byName.get("after")!)).toMatchObject({ status: "ok", value: { value: 30 } });
  });

  it("compiles and evaluates exhaustive choice matches through the canonical scalar program", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const size: choice(small, large) = small",
      "const amount: number = match @size { small => 5 large => 10 }",
      "const side: choice(left, right) =",
      "  match @size {",
      "    small => left",
      "    large => right",
      "  }",
      "const after: number = 30"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const scalarProgram = compiled.scalarProgram!;
    const byName = new Map(scalarProgram.statements.map((statement) => [
      compiled.bindingAnalysis!.catalog.bindingsById.get(statement.bindingId)!.name,
      statement.bindingId
    ]));
    const evaluated = evaluateScalarProgram(scalarProgram).resultsByBindingId;
    expect(evaluated.get(byName.get("amount")!)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 5 }
    });
    expect(evaluated.get(byName.get("side")!)).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["left", "right"] },
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
  });

  it("preserves match as a choice literal and supports it in labels and results", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const c: choice(match, other) = match",
      "const size: choice(match, other) = match",
      "const amount: number = match @size { match => 10 other => 20 }",
      "const selector: choice(first, second) = first",
      "const selected: choice(match, other) =",
      "  match @selector {",
      "    first => match",
      "    second => other",
      "  }"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const scalarProgram = compiled.scalarProgram!;
    const byName = new Map(scalarProgram.statements.map((statement) => [
      compiled.bindingAnalysis!.catalog.bindingsById.get(statement.bindingId)!.name,
      statement.bindingId
    ]));
    const evaluated = evaluateScalarProgram(scalarProgram).resultsByBindingId;
    expect(evaluated.get(byName.get("c")!)).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["match", "other"] },
      value: { kind: "choice", value: "match", options: ["match", "other"] }
    });
    expect(evaluated.get(byName.get("amount")!)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 10 }
    });
    expect(evaluated.get(byName.get("selected")!)).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["match", "other"] },
      value: { kind: "choice", value: "match", options: ["match", "other"] }
    });
  });

  it("compiles and evaluates optional declarations, none, and both coalescing branches", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const present: number? = 10",
      "const missing: string? = none",
      "const presentResult: number = @present ?? 20",
      "const missingResult: string = @missing ?? \"fallback\""
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const scalarProgram = compiled.scalarProgram!;
    const byName = new Map(scalarProgram.statements.map((statement) => [
      compiled.bindingAnalysis!.catalog.bindingsById.get(statement.bindingId)!.name,
      statement.bindingId
    ]));
    const evaluated = evaluateScalarProgram(scalarProgram).resultsByBindingId;
    expect(evaluated.get(byName.get("present")!)).toEqual({
      status: "ok",
      type: { kind: "optional", valueType: { kind: "number" } },
      value: { kind: "number", value: 10 }
    });
    expect(evaluated.get(byName.get("missing")!)).toEqual({
      status: "ok",
      type: { kind: "optional", valueType: { kind: "string" } },
      value: { kind: "none" }
    });
    expect(evaluated.get(byName.get("presentResult")!)).toMatchObject({ status: "ok", type: { kind: "number" }, value: { value: 10 } });
    expect(evaluated.get(byName.get("missingResult")!)).toMatchObject({ status: "ok", type: { kind: "string" }, value: { value: "fallback" } });
  });
});
