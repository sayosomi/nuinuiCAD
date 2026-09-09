import { describe, expect, it } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import { compilerDiagnosticsForState } from "./compilerDiagnostics";
import {
  diagnosticMessageFor,
  diagnosticRelatedTextFor,
  diagnosticTextFor
} from "./diagnosticLocalization";

describe("diagnostic presentation localization", () => {
  const missingValue = () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: )\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "missing-attribute-value"
    );
    if (!diagnostic) throw new Error("missing production diagnostic");
    return diagnostic;
  };

  it("renders a production diagnostic in English, Japanese, and English for unsupported locales", () => {
    const diagnostic = missingValue();
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Argument 'y' has no value.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("引数「y」の値がありません。");
    expect(diagnosticTextFor(diagnostic, "fr-FR")).toBe("Argument 'y' has no value.");
  });

  it("interpolates structured parameters without inspecting the fallback message", () => {
    const diagnostic = {
      severity: "error" as const,
      message: "旧メッセージ",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 }
      },
      source: "nuinuiCAD",
      presentation: {
        key: "diagnostic.unknown-type",
        parameters: { type: "TailoredRecord" }
      }
    };
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Unknown type annotation 'TailoredRecord'.");
    expect(diagnosticTextFor(diagnostic, "ja")).toBe("不明な型注釈です: TailoredRecord");
  });

  it("interpolates dynamic import facts in both display languages", () => {
    const diagnostic = {
      message: "legacy import fallback",
      presentation: {
        key: "diagnostic.import-missing",
        parameters: { path: "./tailored.nui" }
      }
    };
    expect(diagnosticTextFor(diagnostic, "en")).toBe("The imported file './tailored.nui' was not found.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("import先「./tailored.nui」が見つかりません。");
  });

  it("keeps a producer-owned Drawing Modifier name in translated Problems text", () => {
    const source = "nui 1\nmodifier TailoredModifier {\n  state: visible,\n}\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "unused-drawing-modifier"
    );
    if (!diagnostic) throw new Error("missing production Drawing Modifier diagnostic");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.unused-drawing-modifier",
      parameters: { name: "TailoredModifier" }
    });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Drawing Modifier 'TailoredModifier' is not used anywhere.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("Drawing Modifier「TailoredModifier」はどこからも使用されていません。");
  });

  it("keeps a Module parameter name through semantic projection in both display languages", () => {
    const source = [
      "nui 1",
      "module TailoredModule(value?: number) {",
      "  const copy: number = @value",
      "}"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "module-optional-value-required"
    );
    if (!diagnostic) throw new Error("missing production Module diagnostic");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.module-optional-value-required",
      parameters: { name: "value" }
    });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Check optional Module parameter 'value' before using it.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("optional Module parameter「value」を確認してから使用してください。");
  });

  it("localizes exhaustive match diagnostics through the production compiler path", () => {
    const invalidMatch = AutomationDocument.fromSource([
      "nui 1",
      "const size: choice(small, large) = small",
      "const amount: number = match @size { small => 1 small => 2 extra => 3 }"
    ].join("\n"));
    const invalidDiagnostics = compilerDiagnosticsForState(invalidMatch.getSource(), invalidMatch.getState());
    const find = (key: string) => {
      const diagnostic = invalidDiagnostics.find((candidate) => candidate.presentation?.key === key);
      if (!diagnostic) throw new Error(`missing production diagnostic ${key}`);
      return diagnostic;
    };

    const impossible = find("diagnostic.impossible-match-case");
    expect(impossible.presentation).toEqual({
      key: "diagnostic.impossible-match-case",
      parameters: { option: "extra", expected: "choice(small, large)" }
    });
    expect(diagnosticTextFor(impossible, "en")).toBe("Match case 'extra' does not exist in choice(small, large).");
    expect(diagnosticTextFor(impossible, "ja-JP")).toBe("match ケース「extra」はchoice(small, large)には存在しません。");

    const duplicate = find("diagnostic.duplicate-match-case");
    expect(diagnosticTextFor(duplicate, "en")).toBe("Match case 'small' is duplicated.");
    expect(diagnosticTextFor(duplicate, "ja-JP")).toBe("match ケース「small」が重複しています。");

    const missing = find("diagnostic.missing-match-case");
    expect(diagnosticTextFor(missing, "en")).toBe("Match is missing required choice cases: large.");
    expect(diagnosticTextFor(missing, "ja-JP")).toBe("match に必要なchoiceケースがありません: large。");

    const nonChoice = AutomationDocument.fromSource([
      "nui 1",
      "const flag: boolean = true",
      "const amount: number = match @flag { yes => 1 no => 2 }"
    ].join("\n"));
    const nonChoiceDiagnostic = compilerDiagnosticsForState(nonChoice.getSource(), nonChoice.getState()).find(
      (candidate) => candidate.presentation?.key === "diagnostic.non-choice-match-scrutinee"
    );
    if (!nonChoiceDiagnostic) throw new Error("missing production diagnostic diagnostic.non-choice-match-scrutinee");
    expect(nonChoiceDiagnostic.presentation).toEqual({
      key: "diagnostic.non-choice-match-scrutinee",
      parameters: { actual: "boolean" }
    });
    expect(diagnosticTextFor(nonChoiceDiagnostic, "en")).toBe("Match scrutinee must have a choice(...) type (got boolean).");
    expect(diagnosticTextFor(nonChoiceDiagnostic, "ja-JP")).toBe("match のscrutineeはchoice(...)型である必要があります（実際: boolean）。");
  });

  it("keeps a property binding reference name through the production compiler path", () => {
    const source = [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1, showGenerated: @Missing) {",
      "}"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "property-binding-unresolved"
    );
    if (!diagnostic) throw new Error("missing production property binding diagnostic");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.property-binding-unresolved",
      parameters: { name: "Missing" }
    });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Property binding reference 'Missing' could not be resolved.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("property bindingの参照「Missing」を解決できません。");
  });

  it("uses the raw message when metadata is absent or not supported", () => {
    const raw: Pick<DslDiagnostic, "message"> = { message: "そのままのfallback" };
    expect(diagnosticTextFor(raw, "en")).toBe("そのままのfallback");
    expect(diagnosticTextFor({
      message: "別のfallback",
      presentation: { key: "diagnostic.not-yet-migrated" }
    }, "ja")).toBe("別のfallback");
  });

  it("localizes related information and composes the typo suffix after the base text", () => {
    expect(diagnosticRelatedTextFor({
      message: "First export with this name",
      presentation: { key: "diagnostic.related.first-export" }
    }, "en")).toBe("First export with this name");
    expect(diagnosticRelatedTextFor({
      message: "First export with this name",
      presentation: { key: "diagnostic.related.first-export" }
    }, "ja")).toBe("この名前の最初のexport");

    const diagnostic = {
      message: "fallback base",
      presentation: { key: "diagnostic.undefined-binding", parameters: { referencedName: "widht" } },
      suffixPresentation: {
        key: "typoSuggestion.diagnosticSuffix",
        parameters: { candidate: "width" }
      }
    };
    expect(diagnosticMessageFor(diagnostic, "en")).toBe("Undefined binding 'widht'. Did you mean 'width'?");
    expect(diagnosticMessageFor(diagnostic, "ja")).toBe("未定義の変数「widht」を参照しています。 「width」のことですか？");
  });

  it("keeps diagnostic identity independent from the display locale", () => {
    const diagnostic = missingValue();
    const identity = {
      severity: diagnostic.severity,
      code: diagnostic.code,
      source: diagnostic.source,
      range: diagnostic.range
    };
    expect({
      ...identity,
      message: diagnosticTextFor(diagnostic, "en")
    }).toMatchObject(identity);
    expect({
      ...identity,
      message: diagnosticTextFor(diagnostic, "ja")
    }).toMatchObject(identity);
    expect(diagnosticTextFor(diagnostic, "en")).not.toBe(diagnosticTextFor(diagnostic, "ja"));
  });
});
