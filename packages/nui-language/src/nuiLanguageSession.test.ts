import { afterEach, describe, expect, it, vi } from "vitest";
import * as typoSuggestionQuery from "./dsl/dslTypoSuggestionQuery";
import type { DslTypoSuggestionQueryResult } from "./dsl/dslTypoSuggestionQuery";
import {
  createNuiLanguageSession,
  type NuiQuickFixInput
} from "./nuiLanguageSession";

const validSource = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 10)",
  "line L = segment(start: A, end: B)"
].join("\n");

const sourceWithModule = [
  "nui 1",
  "module Box(width: number) {",
  "  point A = coordinate(x: width, y: 0)",
  "}",
  "instance Use = Box(width: 10)"
].join("\n");

const fingerprintFor = (session: ReturnType<typeof createNuiLanguageSession>, code: string): NuiQuickFixInput => {
  const diagnostic = session.diagnostics().find((candidate) => candidate.code === code);
  if (!diagnostic || !diagnostic.code) throw new Error(`missing ${code}`);
  return { source: diagnostic.source, code: diagnostic.code, range: diagnostic.range };
};

describe("NuiLanguageSession", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reuses the exact-current typo query across diagnostics and Quick Fixes", () => {
    const session = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n"));
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");
    const firstDiagnostics = session.diagnostics();
    const diagnostic = firstDiagnostics.find((candidate) => candidate.code === "undefined-binding");
    if (!diagnostic || !diagnostic.code) throw new Error("missing undefined-binding diagnostic");
    const fingerprint: NuiQuickFixInput = {
      source: diagnostic.source,
      code: diagnostic.code,
      range: diagnostic.range
    };

    expect(session.diagnostics()).toEqual(firstDiagnostics);
    expect(session.diagnostics()).toEqual(firstDiagnostics);
    const plans = session.quickFixes(fingerprint);
    expect(session.quickFixes(fingerprint)).toEqual(plans);

    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "typo-suggestion",
        candidate: expect.objectContaining({ label: "width" }),
        edit: { expectedText: "widht", newText: "width", from: expect.any(Number), to: expect.any(Number) }
      })
    ]));
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["zero candidates", {
      targetKind: "bindingReference",
      typedText: "widht",
      replacementRange: { from: 0, to: 5 },
      candidates: []
    }]
  ] as const)("memoizes a %s typo-query result", (_name, result) => {
    const session = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n"));
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");
    querySpy.mockReturnValue(result as DslTypoSuggestionQueryResult | null);

    const diagnostics = session.diagnostics();
    const diagnostic = diagnostics.find((candidate) => candidate.code === "undefined-binding");
    if (!diagnostic || !diagnostic.code) throw new Error("missing undefined-binding diagnostic");
    const fingerprint: NuiQuickFixInput = {
      source: diagnostic.source,
      code: diagnostic.code,
      range: diagnostic.range
    };

    expect(diagnostic.suffixPresentation).toBeUndefined();
    expect(session.quickFixes(fingerprint)).toEqual([]);
    expect(session.quickFixes(fingerprint)).toEqual([]);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it("recomputes after invalid-to-valid edits and undo/redo source revisions", () => {
    const invalidSource = "nui 1\npoint A = coordinate(";
    const typoSource = [
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n");
    const nextTypoSource = typoSource.replace("width", "height").replace("widht", "heigth");
    const session = createNuiLanguageSession(invalidSource);
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");

    expect(session.diagnostics().some((diagnostic) => diagnostic.code === "undefined-binding")).toBe(false);
    expect(querySpy).not.toHaveBeenCalled();

    session.replaceSource(typoSource);
    expect(session.diagnostics().find((diagnostic) => diagnostic.code === "undefined-binding")?.suffixPresentation)
      .toMatchObject({ parameters: { candidate: "width" } });
    session.replaceSource(nextTypoSource);
    expect(session.diagnostics().find((diagnostic) => diagnostic.code === "undefined-binding")?.suffixPresentation)
      .toMatchObject({ parameters: { candidate: "height" } });
    session.replaceSource(typoSource);
    expect(session.diagnostics().find((diagnostic) => diagnostic.code === "undefined-binding")?.suffixPresentation)
      .toMatchObject({ parameters: { candidate: "width" } });
    session.replaceSource(nextTypoSource);
    expect(session.diagnostics().find((diagnostic) => diagnostic.code === "undefined-binding")?.suffixPresentation)
      .toMatchObject({ parameters: { candidate: "height" } });

    expect(querySpy).toHaveBeenCalledTimes(4);
  });

  it("recomputes when typo diagnostics are removed or added", () => {
    const twoTypos = [
      "nui 1",
      "const width: number = 10",
      "const height: number = 20",
      "const first: number = widht",
      "const second: number = heigth"
    ].join("\n");
    const oneTypo = twoTypos.replace("widht", "width");
    const session = createNuiLanguageSession(twoTypos);
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");

    expect(session.diagnostics().filter((diagnostic) => diagnostic.code === "undefined-binding")).toHaveLength(2);
    expect(querySpy).toHaveBeenCalledTimes(2);

    session.replaceSource(oneTypo);
    expect(session.diagnostics().filter((diagnostic) => diagnostic.code === "undefined-binding")).toHaveLength(1);
    expect(querySpy).toHaveBeenCalledTimes(3);

    session.replaceSource(twoTypos);
    expect(session.diagnostics().filter((diagnostic) => diagnostic.code === "undefined-binding")).toHaveLength(2);
    expect(querySpy).toHaveBeenCalledTimes(5);
  });

  it("keeps typo-query cache state per session and replaces it for a new compiled identity", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n");
    const first = createNuiLanguageSession(source);
    const second = createNuiLanguageSession(source);
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");

    first.diagnostics();
    first.diagnostics();
    second.diagnostics();
    expect(querySpy).toHaveBeenCalledTimes(2);

    const internal = first as unknown as {
      document: { state: { currentCompiled: Record<string, unknown> } };
    };
    internal.document.state.currentCompiled = { ...internal.document.state.currentCompiled };

    first.diagnostics();
    expect(querySpy).toHaveBeenCalledTimes(3);
  });

  it("does not expose a cached typo result when exact-current semantic proof fails", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    session.diagnostics();
    const internal = session as unknown as { document: { state: { sourceText: string } } };
    internal.document.state.sourceText = source.replace("widht", "width");

    expect(session.diagnostics().find((diagnostic) => diagnostic.code === "undefined-binding")?.suffixPresentation)
      .toBeUndefined();
  });

  it("rejects a stale diagnostic fingerprint after the source no longer contains that diagnostic", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    const diagnostic = session.diagnostics().find((candidate) => candidate.code === "undefined-binding");
    if (!diagnostic || !diagnostic.code) throw new Error("missing undefined-binding diagnostic");

    session.replaceSource(source.replace("widht", "width"));

    expect(session.quickFixes({
      source: diagnostic.source,
      code: diagnostic.code,
      range: diagnostic.range
    })).toEqual([]);
  });

  it("owns source revisions and never serves the previous source after replacement", () => {
    const session = createNuiLanguageSession(validSource);
    const initialRevision = session.getSourceRevision();
    expect(session.getSource()).toBe(validSource);
    expect(session.definition(validSource.indexOf("start: A") + "start: ".length)).toBeTruthy();

    const nextSource = validSource.replace("point B", "point C");
    session.replaceSource(nextSource);

    expect(session.getSource()).toBe(nextSource);
    expect(session.getSourceRevision()).toBeGreaterThan(initialRevision);
    expect(session.diagnostics().some(({ message }) => message.includes("point B"))).toBe(false);
    expect(session.definition(nextSource.indexOf("start: A") + "start: ".length)).toBeTruthy();
  });

  it("keeps completion recovery behind the direct completion operation", () => {
    const session = createNuiLanguageSession(sourceWithModule);
    const queryPosition = sourceWithModule.length;
    expect(session.completion(queryPosition)?.candidates.length).toBeGreaterThan(0);

    const incomplete = `${sourceWithModule.slice(0, sourceWithModule.lastIndexOf("width: 10"))}width: )`;
    session.replaceSource(incomplete);
    expect(session.completion(incomplete.length)).toBeDefined();
  });

  it("projects diagnostics with exact ranges, codes, and typo presentation", () => {
    const session = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n"));
    const diagnostic = session.diagnostics().find((candidate) => candidate.code === "undefined-binding");
    expect(diagnostic).toMatchObject({
      source: "nuinuiCAD",
      code: "undefined-binding",
      range: {
        start: { line: 2, character: 23 },
        end: { line: 2, character: 28 }
      },
      suffixPresentation: {
        key: "typoSuggestion.diagnosticSuffix",
        parameters: { candidate: "width" }
      }
    });
  });

  it("exposes direct navigation, hover, references, rename, and signature queries", () => {
    const session = createNuiLanguageSession(validSource);
    const referenceOffset = validSource.indexOf("start: A") + "start: A".length;
    expect(session.definition(referenceOffset)).toMatchObject({ referenceRange: expect.any(Object) });
    const elementId = [...session.runtimeEvaluationSnapshot()!.compiled.sourceElementsByStatementIndex.values()]
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
      "style Guide {",
      "  color: #336699,",
      "  ",
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

  it("returns random-number source edits through the exact-current session boundary", () => {
    const source = "nui 1\nconst count: number = 12.34";
    const session = createNuiLanguageSession(source);
    const firstStart = source.indexOf("12.34");
    const first = session.randomNumberSourceEditForSelections(
      [{ start: firstStart + 2, end: firstStart + 2 }],
      "0.625"
    );
    expect(first).toMatchObject({
      edit: { from: firstStart, to: firstStart + 5, expectedText: "12.34", newText: "0.625" }
    });

    const nextSource = source.replace("12.34", "56.78");
    session.replaceSource(nextSource);
    const nextStart = nextSource.indexOf("56.78");
    const next = session.randomNumberSourceEditForSelections(
      [{ start: nextStart + 2, end: nextStart + 2 }],
      "0.125"
    );
    expect(next?.sourceRevision).toBeGreaterThan(first!.sourceRevision);
    expect(next?.edit).toEqual({
      from: nextStart,
      to: nextStart + 5,
      expectedText: "56.78",
      newText: "0.125"
    });
  });

  it("returns quick-fix plans with exact expected text for typo, choice, type, and category repairs", () => {
    const typo = createNuiLanguageSession([
      "nui 1",
      "const width: number = 10",
      "const result: number = widht"
    ].join("\n"));
    const typoPlans = typo.quickFixes(fingerprintFor(typo, "undefined-binding"));
    expect(typoPlans[0]).toMatchObject({
      kind: "typo-suggestion",
      edit: { expectedText: "widht", newText: "width" }
    });

    const choice = createNuiLanguageSession("nui 1\nconst side: choice(left, right) = @center\n");
    expect(choice.quickFixes(fingerprintFor(choice, "invalid-choice-literal"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "typed-variable", edit: expect.objectContaining({
        expectedText: "center", newText: "left"
      }) })])
    );

    const missing = createNuiLanguageSession("nui 1\nconst width = 10\n");
    expect(missing.quickFixes(fingerprintFor(missing, "missing-declared-type"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "typed-variable" })])
    );

    const category = createNuiLanguageSession("nui 1\npoint P = segment(start: A, end: B)\n");
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
  });

  it("keeps an exact-current runtime snapshot for recoverable current errors", () => {
    const source = "nui 1\nconst width: number = missing\npoint A = coordinate(x: 0, y: 0)\n";
    const session = createNuiLanguageSession(source);
    const diagnostics = session.diagnostics();
    const snapshot = session.runtimeEvaluationSnapshot();

    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(snapshot).toMatchObject({
      sourceText: source,
      sourceRevision: session.getSourceRevision(),
      documentRevision: 0,
      compiledDocumentRevision: 0,
      compiled: expect.any(Object)
    });
    expect(snapshot?.compiled.spans.sourceMap).toMatchObject({
      source,
      sourceRevision: session.getSourceRevision()
    });

    session.replaceSource("nui 1\npoint A = coordinate(");
    expect(session.runtimeEvaluationSnapshot()).toBeNull();
    expect(session.runtimeEvaluationSnapshot()?.sourceText).not.toBe(source);
  });
});
