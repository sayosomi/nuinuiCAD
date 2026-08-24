import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import type { DependencyError } from "../types/geometry";
import { runtimeGeometryDiagnostics } from "./runtimeGeometryDiagnostics";

const source = [
  "nui 4",
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

  it("treats an omitted geometry error layer as empty", () => {
    const { compiledDocument } = compiledFixture();
    expect(runtimeGeometryDiagnostics({ compiledDocument })).toEqual([]);
  });
});
