import { describe, expect, it } from "vitest";
import { AutomationDocument } from "../../src/document/automationDocument";
import type { DslDiagnostic } from "../../src/dsl/dslTypes";
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
