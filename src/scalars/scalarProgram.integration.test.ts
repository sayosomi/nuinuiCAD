import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";

const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

describe("compiled scalar program", () => {
  it("keeps typed declarations out of elements and preserves source order across nested scopes", () => {
    const compiled = compileCanonical([
      "nui 4",
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
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
    const first = compileCanonicalText(baseline, "nui 4\nconst width: number = 12\npoint A = coordinate(x: 0, y: 0)");
    expect(first.status).not.toBe("fatal");
    const bindingId = first.doc.scalarProgram!.statements[0].bindingId;

    const edited = compileCanonicalText(first, "nui 4\nconst width: number = 24\npoint A = coordinate(x: 0, y: 0)");
    expect(edited.status).not.toBe("fatal");
    expect(edited.doc.scalarProgram!.statements[0].bindingId).toBe(bindingId);
  });

  it("uses Task 13R eligibility to exclude invalid declarations and their dependents", () => {
    const compiled = compileCanonical([
      "nui 4",
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
      "nui 4",
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
    const noTyped = compileDslDocument("nui 4\npoint A = coordinate(x: 0, y: 0)");
    expect(noTyped.document?.elements.map((element) => element.type)).toEqual(["freePoint"]);
    expect(noTyped.scalarProgram).toBeUndefined();
  });

  it("errors when typed identity is absent", () => {
    const missingIdentity = compileDslDocument("nui 4\nconst width: number = 12");
    expect(missingIdentity.document).toBeNull();
    expect(missingIdentity.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-stable-statement-identity", line: 2 })
    ]));
  });
});
