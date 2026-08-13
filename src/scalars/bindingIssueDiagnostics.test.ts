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
    const fixture = typedDeclarationAnalysisFor(["nui 4", "const x: number = 1", "const x: number = 2"].join("\n"));
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
    const source = ["nui 4", "const x: number = @missing"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.code).toBe("undefined-binding");
    expect(diagnostic.message).toContain("未定義の変数");
    expect(diagnostic.physicalSpan).toBeDefined();
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@missing");
    // Task 48 correction: a reference-position diagnostic must navigate to
    // the same span its own marker highlights, never the owning binding's
    // whole declaration.
    expect(diagnostic.navigationTarget).toEqual({ kind: "sourceSpan", physicalSpan: diagnostic.physicalSpan });
  });

  it("converts self-initialization at the exact self-reference token", () => {
    const source = ["nui 4", "const x: number = @x"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("self-initialization");
    const [segment] = diagnostics[0].physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@x");
    expect(diagnostics[0].navigationTarget).toEqual({ kind: "sourceSpan", physicalSpan: diagnostics[0].physicalSpan });
  });

  it("converts forward-binding-reference at the exact reference token", () => {
    const source = ["nui 4", "const x: number = @y", "const y: number = 1"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("forward-binding-reference");
    const [segment] = diagnostics[0].physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@y");
    expect(diagnostics[0].navigationTarget).toEqual({ kind: "sourceSpan", physicalSpan: diagnostics[0].physicalSpan });
  });

  it("converts binding-cycle for every cycle member with the shared cycle message", () => {
    const source = ["nui 4", "const x: number = @y", "const y: number = @x"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    const cycleDiagnostics = diagnostics.filter((diagnostic) => diagnostic.code === "binding-cycle");
    expect(cycleDiagnostics).toHaveLength(2);
    for (const diagnostic of cycleDiagnostics) {
      expect(diagnostic.message).toContain("循環参照");
      expect(diagnostic.physicalSpan).toBeDefined();
      // Task 48 correction: binding-cycle's span is the binding's own
      // nameSpan here (both x && y have a resolvable declaration name), so
      // navigating to the declaration is correct - unlike the reference-only
      // codes above.
      expect(diagnostic.navigationTarget).toEqual({ kind: "binding", bindingId: diagnostic.bindingId });
    }
  });

  it("a reference-origin duplicate-binding (an @name matching two candidates) navigates to the reference, not either declaration", () => {
    // Two "x" declarations in the same (root) scope are themselves a
    // declaration-origin duplicate-binding pair; a later reference to "x"
    // from that same scope can't pick either one, so it resolves as a
    // second, reference-origin "duplicate" - ambiguous by construction, so
    // there is no single correct declaration to jump to.
    const source = ["nui 4", "const x: number = 1", "const x: number = 2", "const y: number = @x"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const referenceDuplicate = fixture.bindingAnalysis.issues.find(
      (issue) => issue.code === "duplicate-binding" && issue.origin.kind === "reference"
    );
    expect(referenceDuplicate).toBeDefined();
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    const diagnostic = diagnostics.find((item) => item.code === "duplicate-binding" && item.message.includes("一意に解決"));
    expect(diagnostic).toBeDefined();
    const [segment] = diagnostic!.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@x");
    expect(diagnostic!.navigationTarget).toEqual({ kind: "sourceSpan", physicalSpan: diagnostic!.physicalSpan });
  });

  it("preserves bindingAnalysis.issues' own deterministic order (never re-sorted)", () => {
    const source = ["nui 4", "const a: number = @missing", "const b: number = @missing2"].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    expect(diagnostics.map((diagnostic) => diagnostic.bindingId)).toEqual(fixture.bindingAnalysis.issues.map((issue) => issue.bindingId));
  });

  it("produces no diagnostics for a document with no BindingIssue at all", () => {
    const fixture = typedDeclarationAnalysisFor(["nui 4", "const x: number = 1", "let y: number = @x + 1"].join("\n"));
    expect(bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans)).toEqual([]);
  });
});
