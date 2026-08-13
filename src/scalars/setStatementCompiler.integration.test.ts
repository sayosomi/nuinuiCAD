import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { MISSING_SET_STATEMENT_IDENTITY_CODE } from "./setStatementCompiler";
import type { TypedScalarExpression } from "./typedExpressionAst";

// Mirrors scalarProgram.integration.test.ts's own pattern exactly: this is
// the canonical production entry point (compileCanonicalText always runs
// reconcileStatements first, see src/document/canonicalDocument.ts), so
// these tests exercise the real identity contract end to end - not a
// lighter, hand-wired harness.
const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const geometryPropertiesIn = (expression: TypedScalarExpression): readonly Extract<TypedScalarExpression, { kind: "geometryProperty" }>[] => {
  switch (expression.kind) {
    case "geometryProperty":
      return [expression];
    case "unary":
      return geometryPropertiesIn(expression.operand);
    case "binary":
      return [...geometryPropertiesIn(expression.left), ...geometryPropertiesIn(expression.right)];
    case "group":
      return geometryPropertiesIn(expression.expression);
    default:
      return [];
  }
};

describe("compiled set statement analysis (integration)", () => {
  it("resolves a scoped geometry property in set RHS to elementId and source order", () => {
    const compiled = compileCanonical([
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "let x: number = 0",
      "set x = @G::AB.length"
    ].join("\n"));
    const setStatementIndex = compiled.statements.findIndex((statement) => statement.kind === "set");
    const set = compiled.setStatements!.get(setStatementIndex);
    expect(set).toBeDefined();
    const property = geometryPropertiesIn(set!.expression)[0];
    const element = compiled.document.elements.find((candidate) => candidate.name === "AB");
    const elementStatementIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "AB");
    expect(property).toMatchObject({
      elementName: "G::AB",
      property: "length",
      elementId: element?.id,
      targetSourceOrder: elementStatementIndex
    });
  });

  it("carries a real, non-empty reconciler-issued statementId through the canonical pipeline", () => {
    const compiled = compileCanonical(["nui 4", "let x: number = 1", "set x = 2"].join("\n"));
    const setStatementIndex = compiled.statements.findIndex((statement) => statement.kind === "set");
    const entry = compiled.setStatements?.get(setStatementIndex);
    expect(entry).toBeDefined();
    expect(typeof entry!.statementId).toBe("string");
    expect(entry!.statementId.length).toBeGreaterThan(0);
  });

  it("keeps the same set statement's statementId stable across an unrelated edit", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
    const first = compileCanonicalText(
      baseline,
      ["nui 4", "let x: number = 1", "set x = 2", "point A = coordinate(x: 0, y: 0)"].join("\n")
    );
    expect(first.status).not.toBe("fatal");
    const firstSetIndex = first.doc.statements.findIndex((statement) => statement.kind === "set");
    const statementId = first.doc.setStatements!.get(firstSetIndex)!.statementId;

    const edited = compileCanonicalText(
      first,
      ["nui 4", "let x: number = 1", "set x = 2", "point A = coordinate(x: 0, y: 1)"].join("\n")
    );
    expect(edited.status).not.toBe("fatal");
    const editedSetIndex = edited.doc.statements.findIndex((statement) => statement.kind === "set");
    expect(edited.doc.setStatements!.get(editedSetIndex)!.statementId).toBe(statementId);
  });

  it("keeps the same set statement's statementId stable when the RHS itself changes", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
    const first = compileCanonicalText(baseline, ["nui 4", "let x: number = 1", "set x = 2"].join("\n"));
    expect(first.status).not.toBe("fatal");
    const firstSetIndex = first.doc.statements.findIndex((statement) => statement.kind === "set");
    const statementId = first.doc.setStatements!.get(firstSetIndex)!.statementId;

    const edited = compileCanonicalText(first, ["nui 4", "let x: number = 1", "set x = 3"].join("\n"));
    expect(edited.status).not.toBe("fatal");
    const editedSetIndex = edited.doc.statements.findIndex((statement) => statement.kind === "set");
    expect(edited.doc.setStatements!.get(editedSetIndex)!.statementId).toBe(statementId);
  });

  it("errors when reconciled identity is absent - a bare compileDslDocument call fails closed, never fabricating an ID", () => {
    const missingIdentity = compileDslDocument("nui 4\nlet x: number = 1\nset x = 2");
    expect(missingIdentity.document).toBeNull();
    expect(missingIdentity.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: MISSING_SET_STATEMENT_IDENTITY_CODE })
    ]));
  });
});
