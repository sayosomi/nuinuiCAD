import { describe, expect, it } from "vitest";
import { AutomationDocument } from "./document/automationDocument";
import { analyzeDslLintDiagnostics } from "./dsl/dslLintDiagnostics";

const compiledFor = (source: string) => AutomationDocument.fromSource(source).getState().currentCompiled;

const lintFor = (source: string) => analyzeDslLintDiagnostics(compiledFor(source));

const rangeText = (source: string, diagnostic: ReturnType<typeof lintFor>[number]): string => {
  const segment = diagnostic.physicalSpan?.segments[0];
  return segment ? source.slice(segment.from, segment.to) : "";
};

describe("DSL lint diagnostics", () => {
  it("warns for an unused source-authored typed const", () => {
    const source = "nui 1\nconst unused: number = 1";
    const diagnostics = lintFor(source);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "warning",
      code: "unused-typed-declaration",
      presentation: { key: "diagnostic.unused-typed-declaration", parameters: { name: "unused" } },
      exactSpanOnly: true
    });
    expect(rangeText(source, diagnostics[0]!)).toBe("unused");
  });

  it("does not warn for a referenced typed const", () => {
    const source = [
      "nui 1",
      "const used: number = 1",
      "point A = coordinate(x: @used, y: 0)"
    ].join("\n");

    expect(lintFor(source).filter((diagnostic) => diagnostic.code === "unused-typed-declaration")).toEqual([]);
  });

  it("does not warn for let or for compiler-generated Module bindings", () => {
    const letSource = "nui 1\nlet notAConst: number = 1";
    expect(lintFor(letSource)).toEqual([]);

    const moduleSource = [
      "nui 1",
      "module M(value: number) {",
      "  const local: number = @value",
      "}",
      "instance Use = M(value: 1)"
    ].join("\n");
    expect(lintFor(moduleSource)).toEqual([]);
  });

  it("warns for an unused Module parameter and not for a referenced parameter", () => {
    const unusedSource = ["nui 1", "export module M(value: number) {", "}"].join("\n");
    expect(lintFor(unusedSource).map((diagnostic) => diagnostic.code)).toEqual(["unused-module-parameter"]);
    expect(rangeText(unusedSource, lintFor(unusedSource)[0]!)).toBe("value");

    const referencedSource = [
      "nui 1",
      "module M(value: number) {",
      "  const local: number = @value",
      "}",
      "instance Use = M(value: 1)"
    ].join("\n");
    expect(lintFor(referencedSource).some((diagnostic) => diagnostic.code === "unused-module-parameter")).toBe(false);
  });

  it("warns for an unused private Module and not for a referenced one", () => {
    const unusedSource = "nui 1\nmodule Private() {\n}\n";
    const unusedDiagnostics = lintFor(unusedSource);
    expect(unusedDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unused-private-module"]);
    expect(rangeText(unusedSource, unusedDiagnostics[0]!)).toBe("Private");

    const referencedSource = [
      "nui 1",
      "module Private() {",
      "}",
      "instance Use = Private()"
    ].join("\n");
    expect(lintFor(referencedSource).some((diagnostic) => diagnostic.code === "unused-private-module")).toBe(false);
  });

  it("does not warn for an exported Module with no local use or for drawable geometry", () => {
    const source = [
      "nui 1",
      "export module Public() {",
      "}",
      "point Standalone = coordinate(x: 0, y: 0)"
    ].join("\n");

    expect(lintFor(source)).toEqual([]);
  });

  it("uses exact declaration ranges and stable rule codes for all three rules", () => {
    const source = [
      "nui 1",
      "const unused: number = 1",
      "export module Public(unusedParameter: number) {",
      "}",
      "module Private() {",
      "}",
      "export module Used() {",
      "}",
      "instance Use = Used()"
    ].join("\n");
    const diagnostics = lintFor(source);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unused-typed-declaration",
      "unused-module-parameter",
      "unused-private-module"
    ]);
    expect(diagnostics.map((diagnostic) => rangeText(source, diagnostic))).toEqual([
      "unused",
      "unusedParameter",
      "Private"
    ]);
  });

  it("fails closed when the exact-current semantic proof is unavailable", () => {
    const source = "nui 1\nconst unused: number = 1";
    const compiled = compiledFor(source);
    expect(analyzeDslLintDiagnostics({ ...compiled, statementMap: null })).toEqual([]);
    expect(analyzeDslLintDiagnostics({
      ...compiled,
      spans: {
        ...compiled.spans,
        sourceMap: { ...compiled.spans.sourceMap, sourceRevision: compiled.spans.sourceMap.sourceRevision + 1 }
      }
    })).toEqual([]);
  });
});
