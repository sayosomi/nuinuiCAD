import { describe, expect, it } from "vitest";
import {
  createNuiLanguageSession,
  type NuiQuickFixInput
} from "./nuiLanguageSession";
import { queryDslCompletion } from "./dsl/dslCompletionQuery";

const validSource = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 10)",
  "line L = segment(start: @A, end: @B)"
].join("\n");

const sourceWithModule = [
  "nui 1",
  "Module Box(width: number) {",
  "  point A = coordinate(x: @width, y: 0)",
  "}",
  "Box(width: 10)"
].join("\n");

const fingerprintFor = (session: ReturnType<typeof createNuiLanguageSession>, code: string): NuiQuickFixInput => {
  const diagnostic = session.diagnostics().find((candidate) => candidate.code === code);
  if (!diagnostic || !diagnostic.code) throw new Error(`missing ${code}`);
  return { source: diagnostic.source, code: diagnostic.code, range: diagnostic.range };
};

describe("NuiLanguageSession", () => {
  it("owns source revisions and never serves the previous source after replacement", () => {
    const session = createNuiLanguageSession(validSource);
    const initialRevision = session.getSourceRevision();
    expect(session.getSource()).toBe(validSource);
    expect(session.definition(validSource.indexOf("@A") + 1)).toBeTruthy();

    const nextSource = validSource.replace("point B", "point C");
    session.replaceSource(nextSource);

    expect(session.getSource()).toBe(nextSource);
    expect(session.getSourceRevision()).toBeGreaterThan(initialRevision);
    expect(session.diagnostics().some(({ message }) => message.includes("point B"))).toBe(false);
    expect(session.definition(nextSource.indexOf("@A") + 1)).toBeTruthy();
  });

  it("keeps completion recovery behind the direct completion operation", () => {
    const session = createNuiLanguageSession(sourceWithModule);
    const queryPosition = sourceWithModule.length;
    const expected = queryDslCompletion({
      source: { normalizedSource: sourceWithModule, sourceRevision: session.getSourceRevision() },
      position: queryPosition,
      semantic: {
        sourceRevision: session.getSourceRevision(),
        sourceText: sourceWithModule,
        compiled: session.currentCompiledSemanticBridge()!.compiled
      }
    });
    expect(session.completion(queryPosition)).toEqual(expected);

    const incomplete = `${sourceWithModule.slice(0, sourceWithModule.lastIndexOf("width: 10"))}width: )`;
    session.replaceSource(incomplete);
    expect(session.completion(incomplete.length)).toBeDefined();
  });

  it("projects diagnostics with exact ranges, codes, and typo presentation", () => {
    const session = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = @widht"
    ].join("\n"));
    const diagnostic = session.diagnostics().find((candidate) => candidate.code === "undefined-binding");
    expect(diagnostic).toMatchObject({
      source: "nuinuiCAD",
      code: "undefined-binding",
      range: {
        start: { line: 2, character: 23 },
        end: { line: 2, character: 29 }
      },
      suffixPresentation: {
        key: "typoSuggestion.diagnosticSuffix",
        parameters: { candidate: "width" }
      }
    });
  });

  it("exposes direct navigation, hover, references, rename, and signature queries", () => {
    const session = createNuiLanguageSession(validSource);
    const referenceOffset = validSource.indexOf("@A") + 2;
    expect(session.definition(referenceOffset)).toMatchObject({ referenceRange: expect.any(Object) });
    const elementId = [...session.currentCompiledSemanticBridge()!.compiled.sourceElementsByStatementIndex.values()]
      .find((element) => element.name === "A")!.id;
    expect(session.hover(referenceOffset)).toMatchObject({ elementId });
    expect(session.references(referenceOffset)).toMatchObject({ declarationRange: expect.any(Object) });

    const rename = session.prepareRename(validSource.indexOf("A ="));
    expect(rename).toMatchObject({ oldName: "A" });
    expect(session.rename(validSource.indexOf("A ="), "Shoulder")).toMatchObject({
      status: "ok",
      plan: {
        edits: expect.arrayContaining([
          expect.objectContaining({ expectedText: "A", newText: "Shoulder" })
        ])
      }
    });

    const signatureSource = "nui 1\npoint P = coordinate(";
    const signatureSession = createNuiLanguageSession(signatureSource);
    expect(signatureSession.signatureHelp(signatureSource.length)).toBeTruthy();
  });

  it("projects folding, document symbols, fixed/theme colors, and source value steps", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  color: #336699,",
      "  state: visible,",
      "}",
      "point Count = coordinate(x: 1.50, y: 0)"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    expect(session.foldingRanges().length).toBeGreaterThan(0);
    expect(session.documentSymbols().length).toBeGreaterThan(0);
    expect(session.fixedColors()).toHaveLength(1);
    expect(session.themeRoleColors()).toEqual([]);
    expect(session.sourceValueStep(source.lastIndexOf("1.50"))).toMatchObject({
      forward: { edit: { expectedText: "1.50" } }
    });
  });

  it("returns quick-fix plans with exact expected text for typo, choice, type, and category repairs", () => {
    const typo = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = @widht"
    ].join("\n"));
    const typoPlans = typo.quickFixes(fingerprintFor(typo, "undefined-binding"));
    expect(typoPlans[0]).toMatchObject({
      kind: "typo-suggestion",
      edit: { expectedText: "widht", newText: "width" }
    });

    const choice = createNuiLanguageSession("nui 1\nconst side: choice(left, right) = center\n");
    expect(choice.quickFixes(fingerprintFor(choice, "invalid-choice-literal"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "typed-variable" })])
    );

    const missing = createNuiLanguageSession("nui 1\nlet width = 10\n");
    expect(missing.quickFixes(fingerprintFor(missing, "missing-declared-type"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "typed-variable" })])
    );

    const category = createNuiLanguageSession("nui 1\npoint P = segment(start: @A, end: @B)\n");
    expect(category.quickFixes(fingerprintFor(category, "construction-category-mismatch"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "construction-category" })])
    );
  });

  it("keeps runtime snapshots exact-current and evaluator-free", () => {
    const session = createNuiLanguageSession(validSource);
    expect(session.runtimeEvaluationSnapshot()).toMatchObject({
      sourceText: validSource,
      documentRevision: 0,
      compiledDocumentRevision: 0,
      compiled: expect.any(Object)
    });

    session.replaceSource("nui 1\npoint A = coordinate(");
    expect(session.runtimeEvaluationSnapshot()).toBeNull();
    expect(session.currentCompiledSemanticBridge()?.sourceText).toBe("nui 1\npoint A = coordinate(");
  });
});
