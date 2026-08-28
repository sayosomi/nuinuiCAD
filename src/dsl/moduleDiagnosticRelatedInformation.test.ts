import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import type { DslDiagnostic } from "./dslTypes";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:related:${index}`]));
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

const byCode = (diagnostics: readonly DslDiagnostic[], code: string) => {
  const matches = diagnostics.filter((diagnostic) => diagnostic.code === code);
  expect(matches).toHaveLength(1);
  return matches[0]!;
};

const spanText = (source: string, diagnostic: DslDiagnostic) =>
  diagnostic.physicalSpan?.segments.map((segment) => source.slice(segment.from, segment.to)).join("") ?? null;

const relatedTexts = (source: string, diagnostic: DslDiagnostic) =>
  (diagnostic.relatedInformation ?? []).map((related) =>
    related.physicalSpan.segments.map((segment) => source.slice(segment.from, segment.to)).join("")
  );

describe("Module diagnostic related source information", () => {
  it("points a missing argument back to its required parameter declaration", () => {
    const source = [
      "nui 4",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\n");
    const diagnostic = byCode(compileWithIds(source).diagnostics, "module-missing-argument");

    expect(spanText(source, diagnostic)).toBe("M");
    expect(relatedTexts(source, diagnostic)).toEqual(["required"]);
  });

  it("points a duplicate public export collision back to the first export name only", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  export const Output: number = 1",
      "  export point Output = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const diagnostics = compileWithIds(source).diagnostics;
    const diagnostic = byCode(diagnostics, "source-namespace-collision");

    expect(spanText(source, diagnostic)).toBe("Output");
    expect(diagnostic.message).toBe("同じlexical scopeで名前「Output」が衝突しています: typedDeclaration(行 3) と geometry。");
    expect(diagnostic.severity).toBe("error");
    expect(relatedTexts(source, diagnostic)).toEqual(["Output"]);
    expect(diagnostic.relatedInformation?.map((related) => related.message)).toEqual(["First export with this name"]);
    expect(diagnostics.filter((candidate) => candidate.code === "module-duplicate-export")).toHaveLength(0);

    const ordinarySource = [
      "nui 4",
      "const Output: number = 1",
      "point Output = coordinate(x: 0, y: 0)"
    ].join("\n");
    const ordinary = byCode(compileWithIds(ordinarySource).diagnostics, "source-namespace-collision");
    expect(ordinary.relatedInformation).toBeUndefined();
  });

  it("points scalar and geometry call mismatches to the expected parameter type", () => {
    const scalarSource = [
      "nui 4",
      "module M(value: number) {",
      "}",
      "instance Use = M(value: \"bad\")"
    ].join("\n");
    const scalar = byCode(compileWithIds(scalarSource).diagnostics, "module-scalar-type-mismatch");
    expect(relatedTexts(scalarSource, scalar)).toEqual(["number"]);

    const geometrySource = [
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "module M(anchor: point) {",
      "}",
      "instance Use = M(anchor: @L)"
    ].join("\n");
    const geometry = byCode(compileWithIds(geometrySource).diagnostics, "module-geometry-type-mismatch");
    expect(relatedTexts(geometrySource, geometry)).toEqual(["point"]);
  });

  it("points optional-value errors and parameter collisions to the parameter declaration", () => {
    const optionalSource = [
      "nui 4",
      "module M(value?: number) {",
      "  const copy: number = @value",
      "}",
      "instance Use = M()"
    ].join("\n");
    const optional = byCode(compileWithIds(optionalSource).diagnostics, "module-optional-value-required");
    expect(relatedTexts(optionalSource, optional)).toEqual(["value"]);

    const collisionSource = [
      "nui 4",
      "module M(x: number) {",
      "  const x: number = 1",
      "}"
    ].join("\n");
    const collision = byCode(compileWithIds(collisionSource).diagnostics, "module-parameter-collision");
    expect(relatedTexts(collisionSource, collision)).toEqual(["x"]);
  });

  it("points an optional path[] list-consumer error to the parameter declaration", () => {
    const source = [
      "nui 4",
      "module M(paths?: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}"
    ].join("\n");
    const diagnostics = compileWithIds(source).diagnostics;
    const matches = diagnostics.filter((diagnostic) => diagnostic.code === "module-optional-value-required");

    expect(matches).toHaveLength(1);
    const diagnostic = matches[0]!;
    expect(spanText(source, diagnostic)).toBe("paths");
    expect(diagnostic.code).toBe("module-optional-value-required");
    expect(diagnostic.message).toBe("optional module parameter「paths」は hasValue(@paths) で存在を確認してから参照してください。");
    expect(diagnostic.severity).toBe("error");
    expect(relatedTexts(source, diagnostic)).toEqual(["paths"]);
    expect(diagnostic.relatedInformation?.map((related) => related.message)).toEqual(["Related parameter declaration"]);
  });

  it("points a forward callee to the later module definition", () => {
    const source = [
      "nui 4",
      "instance Before = Later()",
      "module Later() {",
      "}"
    ].join("\n");
    const diagnostic = byCode(compileWithIds(source).diagnostics, "module-forward-callee");

    expect(spanText(source, diagnostic)).toBe("Later");
    expect(relatedTexts(source, diagnostic)).toEqual(["Later"]);
  });

  it("points private members and outer captures to the proven source declaration", () => {
    const privateSource = [
      "nui 4",
      "module Child() {",
      "  const secret: number = 1",
      "}",
      "module Outer() {",
      "  instance child = Child()",
      "  const leaked: number = @child::secret",
      "}",
      "instance Use = Outer()"
    ].join("\n");
    const privateDiagnostic = byCode(compileWithIds(privateSource).diagnostics, "module-private-member");
    expect(relatedTexts(privateSource, privateDiagnostic)).toEqual(["secret"]);

    const captureSource = [
      "nui 4",
      "const outer: number = 1",
      "module M() {",
      "  const copy: number = @outer",
      "}"
    ].join("\n");
    const capture = byCode(compileWithIds(captureSource).diagnostics, "module-outer-capture");
    expect(relatedTexts(captureSource, capture)).toEqual(["outer"]);
  });

  it("explains an indirect recursion cycle with only the other cycle call sites", () => {
    const source = [
      "nui 4",
      "module A() {",
      "  module B() {",
      "    instance toA = A()",
      "  }",
      "  instance toB = B()",
      "}",
      "instance Use = A()"
    ].join("\n");
    const recursion = compileWithIds(source).diagnostics.filter((diagnostic) => diagnostic.code === "module-recursion");

    expect(recursion).toHaveLength(2);
    expect(recursion.map((diagnostic) => spanText(source, diagnostic))).toEqual(["A", "B"]);
    expect(recursion.map((diagnostic) => relatedTexts(source, diagnostic))).toEqual([["B"], ["A"]]);
  });

  it("does not duplicate the primary call site for self recursion", () => {
    const source = [
      "nui 4",
      "module Self() {",
      "  instance again = Self()",
      "}",
      "instance Use = Self()"
    ].join("\n");
    const diagnostic = byCode(compileWithIds(source).diagnostics, "module-recursion");

    expect(spanText(source, diagnostic)).toBe("Self");
    expect(relatedTexts(source, diagnostic)).toEqual([]);
  });

  it("omits related information when there is no exact current cause span", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  const copy: number = @missing",
      "}"
    ].join("\n");
    const diagnostic = byCode(compileWithIds(source).diagnostics, "module-undefined-reference");

    expect(diagnostic.relatedInformation).toBeUndefined();
  });
});
