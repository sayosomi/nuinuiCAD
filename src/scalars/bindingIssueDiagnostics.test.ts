import { describe, expect, it } from "vitest";
import { bindingIssuesToDiagnostics } from "./bindingIssueDiagnostics";
import { typedDeclarationAnalysisFor } from "./testSupport/typedDeclarationAnalysisFixture";

// typedDeclarationAnalysisFor asserts analyzeTypedDeclarations itself produced
// zero diagnostics - true for every BindingIssue-only fixture here, since
// typecheck deliberately stays silent on an unresolved/duplicate/self/forward
// reference (the "cascade-suppression rule": one root cause, not a
// diagnostic per ancestor). BindingIssue is the sole source of these codes.

describe("bindingIssuesToDiagnostics", () => {
  it("converts a declaration-origin duplicate-binding with an exact nameSpan for each duplicate", () => {
    const fixture = typedDeclarationAnalysisFor(["nui 3", "const x: number = 1", "const x: number = 2"].join("\n"));
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe("duplicate-binding");
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.exactSpanOnly).toBe(true);
      expect(diagnostic.message).toContain("複数回宣言");
      expect(diagnostic.physicalSpan).toBeDefined();
      expect(diagnostic.physicalSpan!.segments).toHaveLength(1);
      expect(diagnostic.bindingId).toBeDefined();
      expect(diagnostic.navigationTarget).toEqual({ kind: "binding", bindingId: diagnostic.bindingId });
    }
  });

  it("converts undefined-binding at the exact reference token", () => {
    const source = ["nui 3", "const x: number = @missing"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.code).toBe("undefined-binding");
    expect(diagnostic.message).toContain("未定義の変数");
    expect(diagnostic.physicalSpan).toBeDefined();
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@missing");
  });

  it("converts self-initialization at the exact self-reference token", () => {
    const source = ["nui 3", "const x: number = @x"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("self-initialization");
    const [segment] = diagnostics[0].physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@x");
  });

  it("converts forward-binding-reference at the exact reference token", () => {
    const source = ["nui 3", "const x: number = @y", "const y: number = 1"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("forward-binding-reference");
    const [segment] = diagnostics[0].physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@y");
  });

  it("converts binding-cycle for every cycle member with the shared cycle message", () => {
    const source = ["nui 3", "const x: number = @y", "const y: number = @x"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    const cycleDiagnostics = diagnostics.filter((diagnostic) => diagnostic.code === "binding-cycle");
    expect(cycleDiagnostics).toHaveLength(2);
    for (const diagnostic of cycleDiagnostics) {
      expect(diagnostic.message).toContain("循環参照");
      expect(diagnostic.physicalSpan).toBeDefined();
    }
  });

  it("preserves bindingAnalysis.issues' own deterministic order (never re-sorted)", () => {
    const source = ["nui 3", "const a: number = @missing", "const b: number = @missing2"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics.map((diagnostic) => diagnostic.bindingId)).toEqual(fixture.bindingAnalysis.issues.map((issue) => issue.bindingId));
  });

  it("produces no diagnostics for a document with no BindingIssue at all", () => {
    const fixture = typedDeclarationAnalysisFor(["nui 3", "const x: number = 1", "let y: number = @x + 1"].join("\n"));
    expect(bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans)).toEqual([]);
  });
});
