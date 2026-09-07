import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { compileDslDocument } from "../dsl/dslDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { DependencyError } from "../types/geometry";
import { runtimeGeometryDiagnostics } from "./runtimeGeometryDiagnostics";

const source = [
  "nui 1",
  "point C1 = coordinate(x: 0, y: 0)",
  "point C2 = coordinate(x: 20, y: 0)",
  "arc A = arc(center: @C1, radius: 20, start: 0, end: 359)",
  "arc B = arc(center: @C2, radius: 12, start: 0, end: 359)",
  "line T = commonTangent(first: @A, second: @B, kind: internal, side: left)"
].join("\n");

const compiledFixture = () => {
  const compiledDocument = compileDslDocument(source);
  expect(compiledDocument.document).not.toBeNull();
  expect(compiledDocument.statementMap).not.toBeNull();
  const tangent = compiledDocument.document!.elements.find((element) => element.name === "T");
  expect(tangent).toBeTruthy();
  return { compiledDocument, tangent: tangent! };
};

const typedCompiledFixture = (sourceLines: readonly string[]) => {
  const compiled = compileCanonicalText(
    regenerateCanonicalFromModel(emptyDocument(), 1),
    sourceLines.join("\n")
  );
  expect(compiled.status).toBe("valid");
  expect(compiled.doc.statementMap.statementIndexByStatementId).toBeDefined();
  return compiled.doc;
};

describe("runtimeGeometryDiagnostics", () => {
  it("projects a geometry evaluation error onto its authored statement", () => {
    const { compiledDocument, tangent } = compiledFixture();
    const message = "kind: internal の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。";
    const error: DependencyError = {
      elementId: tangent.id,
      elementName: tangent.name,
      missingDependencyId: tangent.id,
      message
    };

    expect(runtimeGeometryDiagnostics({ errors: [error], compiledDocument })).toEqual([
      expect.objectContaining({
        severity: "error",
        line: 6,
        column: 1,
        message,
        origin: "runtime",
        elementId: tangent.id,
        statementIndex: 5,
        navigationTarget: { kind: "element", elementId: tangent.id }
      })
    ]);
  });

  it("does not invent a source location for an unmapped runtime error", () => {
    const { compiledDocument } = compiledFixture();
    const error: DependencyError = {
      elementId: "runtime-only",
      elementName: "runtime-only",
      missingDependencyId: "runtime-only",
      message: "runtime failure"
    };

    expect(runtimeGeometryDiagnostics({ errors: [error], compiledDocument })).toEqual([]);
  });

  it("projects a root geometry value error onto the exact typed declaration name span", () => {
    const compiledDocument = typedCompiledFixture([
      "nui 1",
      "const Value: point = coordinate(x: 0, y: 0)"
    ]);
    const occurrence = compiledDocument.geometryValueProgram![0]!.occurrence;
    const statementIndex = compiledDocument.statementMap.statementIndexByStatementId!.get(occurrence.sourceStatementId)!;
    const statement = compiledDocument.statements[statementIndex];
    expect(statement.kind).toBe("typedDeclaration");
    if (statement.kind !== "typedDeclaration" || !statement.namePhysicalSpan) throw new Error("expected typed declaration name span");
    const error = {
      occurrence,
      message: "Geometry value construction is incompatible with its declared interface type."
    };

    expect(runtimeGeometryDiagnostics({ geometryValueErrors: [error], compiledDocument })).toEqual([{
      severity: "error",
      line: statement.line,
      column: statement.namePhysicalSpan.segments[0]!.from + 1,
      message: error.message,
      sourceRevision: statement.sourceRevision,
      physicalSpan: statement.namePhysicalSpan,
      exactSpanOnly: true,
      origin: "runtime",
      statementIndex,
      navigationTarget: { kind: "sourceSpan", physicalSpan: statement.namePhysicalSpan }
    }]);
  });

  it("projects Module-local and exported geometry value occurrences to their defining declarations", () => {
    const compiledDocument = typedCompiledFixture([
      "nui 1",
      "module M() {",
      "  const Local: point = coordinate(x: 0, y: 0)",
      "  export const Exported: point = coordinate(x: 1, y: 1)",
      "}",
      "instance One = M()"
    ]);
    const program = compiledDocument.geometryValueProgram!;
    expect(program).toHaveLength(2);
    const errors = program.map(({ occurrence }) => ({
      occurrence,
      message: `failure ${occurrence.sourceStatementId}`
    }));
    const diagnostics = runtimeGeometryDiagnostics({ geometryValueErrors: errors, compiledDocument });

    expect(diagnostics).toHaveLength(2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      const statementIndex = compiledDocument.statementMap.statementIndexByStatementId!.get(errors[index]!.occurrence.sourceStatementId)!;
      const statement = compiledDocument.statements[statementIndex];
      expect(statement.kind).toBe("typedDeclaration");
      expect(diagnostic).toMatchObject({
        message: errors[index]!.message,
        statementIndex,
        physicalSpan: statement.namePhysicalSpan,
        navigationTarget: { kind: "sourceSpan", physicalSpan: statement.namePhysicalSpan },
        exactSpanOnly: true
      });
      expect(diagnostic).not.toHaveProperty("elementId");
      expect(diagnostic).not.toHaveProperty("bindingId");
    }
  });

  it("keeps distinct Module occurrences as distinct diagnostics and appends them after drawable errors", () => {
    const compiledDocument = typedCompiledFixture([
      "nui 1",
      "module M() {",
      "  const Value: point = coordinate(x: 0, y: 0)",
      "}",
      "instance One = M()",
      "instance Two = M()"
    ]);
    const [first, second] = compiledDocument.geometryValueProgram!;
    expect(first?.occurrence.sourceStatementId).toBe(second?.occurrence.sourceStatementId);
    expect(first?.occurrence.instancePath).not.toEqual(second?.occurrence.instancePath);
    const drawable = compiledDocument.document!.elements.find((element) => element.name === "One")!;
    const drawableError: DependencyError = {
      elementId: drawable.id,
      elementName: drawable.name,
      missingDependencyId: drawable.id,
      message: "drawable failure"
    };

    const diagnostics = runtimeGeometryDiagnostics({
      errors: [drawableError],
      geometryValueErrors: [first!, second!].map(({ occurrence }) => ({ occurrence, message: "value failure" })),
      compiledDocument
    });

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toMatchObject({ elementId: drawable.id, message: drawableError.message });
    expect(diagnostics.slice(1).map((diagnostic) => diagnostic.message)).toEqual(["value failure", "value failure"]);
    expect(diagnostics.slice(1).map((diagnostic) => diagnostic.navigationTarget)).toEqual(
      [first!, second!].map(({ occurrence }) => ({
        kind: "sourceSpan",
        physicalSpan: compiledDocument.statements[
          compiledDocument.statementMap.statementIndexByStatementId!.get(occurrence.sourceStatementId)!
        ]!.namePhysicalSpan
      }))
    );
  });

  it("fails closed when a geometry value occurrence has no exact current typed declaration owner", () => {
    const { compiledDocument } = compiledFixture();
    expect(runtimeGeometryDiagnostics({
      geometryValueErrors: [{
        occurrence: { sourceStatementId: "missing", instancePath: [] },
        message: "value failure"
      }],
      compiledDocument
    })).toEqual([]);
  });

  it("treats an omitted geometry error layer as empty", () => {
    const { compiledDocument } = compiledFixture();
    expect(runtimeGeometryDiagnostics({ compiledDocument })).toEqual([]);
  });
});
