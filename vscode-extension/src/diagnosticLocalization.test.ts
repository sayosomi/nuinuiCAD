import { describe, expect, it } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import { compilerDiagnosticsForState } from "./compilerDiagnostics";
import {
  diagnosticMessageFor,
  diagnosticRelatedTextFor,
  diagnosticTextFor
} from "./diagnosticLocalization";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import { webviewDiagnosticTextFor } from "../../src/vscode/webviewPresentation";

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

  it("localizes an incomplete layout through the production parser/compiler path without changing identity or range", () => {
    const source = "nui 1\nlayout A4 (scale: 1)\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "settings-layout-block-required"
    );
    if (!diagnostic) throw new Error("missing production settings diagnostic");

    expect(diagnostic.message).toBe("layout にはブロックが必要です。");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.settings-layout-block-required",
      parameters: { keyword: "layout" }
    });

    const identity = { code: diagnostic.code, source: diagnostic.source, range: diagnostic.range };
    expect(diagnosticTextFor(diagnostic, "en")).toBe("The layout statement requires a block.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("layout にはブロックが必要です。");
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "en") }).toMatchObject(identity);
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "ja-JP") }).toMatchObject(identity);
    expect(diagnostic.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 6 }
    });
  });

  it("localizes an unnamed layout block through Problems and the existing Webview path", () => {
    const source = "nui 1\nlayout {\n}\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "settings-missing-statement-name"
    );
    if (!diagnostic) throw new Error("missing production unnamed layout diagnostic");

    expect(diagnostic.message).toBe("layoutには名前が必要です。");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.settings-missing-statement-name",
      parameters: { keyword: "layout" }
    });
    expect(diagnostic.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 6 }
    });

    const identity = { code: diagnostic.code, source: diagnostic.source, range: diagnostic.range };
    expect(identity).toEqual({
      code: "settings-missing-statement-name",
      source: "nuinuiCAD",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 6 }
      }
    });
    const englishProblems = diagnosticTextFor(diagnostic, "en");
    const japaneseProblems = diagnosticTextFor(diagnostic, "ja-JP");
    expect(englishProblems).toBe("The layout statement requires a name.");
    expect(japaneseProblems).toBe("layoutには名前が必要です。");
    expect({ ...identity, message: englishProblems }).toEqual({ ...identity, message: "The layout statement requires a name." });
    expect({ ...identity, message: japaneseProblems }).toEqual({ ...identity, message: "layoutには名前が必要です。" });

    expect(webviewDiagnosticTextFor(webviewPresentationFor("en"), diagnostic)).toBe("The layout statement requires a name.");
    expect(webviewDiagnosticTextFor(webviewPresentationFor("ja-JP"), diagnostic)).toBe("layoutには名前が必要です。");
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

  it("keeps a producer-owned Style name in translated Problems text", () => {
    const source = "nui 1\nstyle TailoredStyle {\n  visible: true,\n}\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "unused-drawing-style"
    );
    if (!diagnostic) throw new Error("missing production Style diagnostic");
    expect(diagnostic.presentation).toEqual({
      key: "diagnostic.unused-drawing-style",
      parameters: { name: "TailoredStyle" }
    });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Style 'TailoredStyle' is not used anywhere.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("Style「TailoredStyle」はどこからも使用されていません。");
  });

  it("localizes source lint declaration names", () => {
    const source = "nui 1\nconst Unused: number = 1\n";
    const document = AutomationDocument.fromSource(source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "unused-typed-declaration"
    );
    if (!diagnostic) throw new Error("missing production lint diagnostic");
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Declaration 'Unused' is not used anywhere.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("宣言「Unused」はどこからも使用されていません。");
  });

  it("keeps a Module parameter name through semantic projection in both display languages", () => {
    const source = [
      "nui 1",
      "record TailoredRecord(amount: number)",
      "module TailoredModule(value: TailoredRecord?) {",
      "  const copy: number = @value.amount",
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
    expect(diagnosticTextFor(diagnostic, "en")).toBe("Resolve optional Module value 'value' before using it.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("optional Module value「value」を解決してから使用してください。");
  });

  it("localizes construction none rejection through the general optional diagnostic", () => {
    const document = AutomationDocument.fromSource([
      "nui 1",
      "point Rejected = offset(from: none, dx: 1, dy: 1)"
    ].join("\n"));
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "optional-value-required"
    );
    if (!diagnostic) throw new Error("missing construction optional diagnostic");
    expect(diagnostic.presentation).toEqual({ key: "diagnostic.optional-value-required" });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("The absence literal 'none' is only valid where an optional value is expected.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("absence値「none」はoptional valueが期待される場所でのみ使用できます。");
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

  it("localizes scalar collection value-for diagnostics through the production compiler path", () => {
    const document = AutomationDocument.fromSource([
      "nui 1",
      "const scalar: number = 1",
      "const bad: number[] = for item in @scalar { @item }"
    ].join("\n"));
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === "array-value-for-source-invalid"
    );
    if (!diagnostic) throw new Error("missing production diagnostic array-value-for-source-invalid");
    expect(diagnostic.presentation).toEqual({ key: "diagnostic.array-value-for-source-invalid" });
    expect(diagnosticTextFor(diagnostic, "en")).toBe("The value-for source must be a visible whole-value collection.");
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("value-forのsourceには可視のwhole-value collectionが必要です。");
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

  it.each([
    {
      family: "Module parser",
      source: "nui 1\nmodule (A: number) {\n}",
      code: "module-definition-missing-name",
      english: "A Module definition requires a name.",
      japanese: "module definition には名前が必要です。"
    },
    {
      family: "call parser",
      source: "nui 1\nmove (from: @A, to: @B)",
      code: "malformed-transformation-target",
      english: "The transformation target syntax is invalid.",
      japanese: "transformation targetの形式が不正です。"
    },
    {
      family: "declaration parser",
      source: "nui 1\nconst : number = 1",
      code: "missing-declaration-name",
      english: "A declaration requires a name.",
      japanese: "const には名前が必要です。"
    },
    {
      family: "next parser",
      source: "nui 1\nnext",
      code: "missing-next-target",
      english: "The next statement requires a carry target.",
      japanese: "next には対象の carry 名が必要です。"
    },
    {
      family: "type parser",
      source: "nui 1\nconst x: choice(none, left) = left",
      code: "reserved-none-choice-option",
      english: "The reserved word 'none' cannot be used as a choice option.",
      japanese: "予約語 none は choice option に使用できません。"
    },
    {
      family: "export parser",
      source: "nui 1\nexport nope",
      code: "invalid-export-statement",
      english: "An export must be followed by a geometry or typed scalar declaration.",
      japanese: "export の後には geometry または typed scalar declaration が必要です。"
    },
    {
      family: "geometry-array expression",
      source: "nui 1\nconst xs: point[] = if (@condition) @point",
      code: "value-if-malformed-branch",
      english: "A value-if branch must use the form `{ expression }`.",
      japanese: "value-if のbranchは「{ 式 }」の形で指定してください。"
    }
  ] as const)("localizes the $family identity through the production parser/compiler path", (testCase) => {
    const document = AutomationDocument.fromSource(testCase.source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === testCase.code
    );
    if (!diagnostic) throw new Error(`missing production ${testCase.family} diagnostic ${testCase.code}`);

    expect(diagnostic.presentation?.key).toBe(`diagnostic.${testCase.code}`);
    const identity = { code: diagnostic.code, source: diagnostic.source, range: diagnostic.range };
    expect(diagnosticTextFor(diagnostic, "en")).toBe(testCase.english);
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(testCase.japanese);
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "en") }).toMatchObject(identity);
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "ja-JP") }).toMatchObject(identity);
  });

  it.each([
    {
      family: "style missing name",
      source: "nui 1\nstyle {\n}\n",
      code: "style-missing-name",
      english: "A style definition requires a name.",
      japanese: "style には名前が必要です。"
    },
    {
      family: "style invalid name",
      source: "nui 1\nstyle bad name {\n  width: 1px,\n}\n",
      code: "style-invalid-name",
      english: "The style name is invalid. Quote names containing spaces or syntax punctuation.",
      japanese: "style の名前が不正です。空白や構文記号を含める場合は引用符で囲んでください。"
    },
    {
      family: "style missing block",
      source: "nui 1\nstyle Guide\n",
      code: "missing-block",
      parameters: { category: "style" },
      english: "The style statement requires a block.",
      japanese: "style にはブロックが必要です。"
    },
    {
      family: "style property missing comma",
      source: "nui 1\nstyle Guide {\n  width: 1px\n}\n",
      code: "style-property-missing-trailing-comma",
      english: "Style properties require a trailing comma.",
      japanese: "style のプロパティには末尾の「,」が必要です。"
    },
    {
      family: "style property multiple per line",
      source: "nui 1\nstyle Guide {\n  width: 1px, color: accent,\n}\n",
      code: "style-property-multiple-per-line",
      english: "Only one style property may be specified on each line.",
      japanese: "style ブロックでは1行に1つのプロパティだけ指定できます。"
    },
    {
      family: "style property missing value",
      source: "nui 1\nstyle Guide {\n  width: ,\n}\n",
      code: "style-property-missing-value",
      parameters: { property: "width" },
      english: "Style property 'width' has no value.",
      japanese: "style プロパティ「width」の値がありません。"
    },
    {
      family: "style width",
      source: "nui 1\nstyle Guide {\n  width: 0px,\n}\n",
      code: "style-width-invalid",
      english: "Style width must be a positive finite decimal px literal (for example, 1.5px).",
      japanese: "style の width は正の有限な10進数pxリテラルで指定してください(例: 1.5px)。"
    },
    {
      family: "style lineType",
      source: "nui 1\nstyle Guide {\n  lineType: stripe,\n}\n",
      code: "style-line-type-invalid",
      english: "Style lineType must be solid, dashed, or dotted.",
      japanese: "style の lineType は solid / dashed / dotted のいずれかで指定してください。"
    },
    {
      family: "style visible",
      source: "nui 1\nstyle Guide {\n  visible: maybe,\n}\n",
      code: "style-visible-invalid",
      english: "Style visible must be true or false.",
      japanese: "style の visible は true / false のいずれかで指定してください。"
    },
    {
      family: "style fixed color",
      source: "nui 1\nstyle Guide {\n  color: #12,\n}\n",
      code: "style-color-fixed-invalid",
      english: "A fixed style color must use the form #RRGGBB.",
      japanese: "style の color 固定色は #RRGGBB の形式で指定してください。"
    },
    {
      family: "style color",
      source: "nui 1\nstyle Guide {\n  color: brand,\n}\n",
      code: "style-color-invalid",
      english: "Style color must be foreground, muted, accent, info, warning, error, or #RRGGBB.",
      japanese: "style の color は foreground / muted / accent / info / warning / error または #RRGGBB で指定してください。"
    },
    {
      family: "style fill",
      source: "nui 1\nstyle Guide {\n  fill: brand,\n}\n",
      code: "style-fill-invalid",
      english: "Style fill must be foreground, muted, accent, info, warning, error, #RRGGBB, or none.",
      japanese: "style の fill は foreground / muted / accent / info / warning / error、#RRGGBB、または none で指定してください。"
    },
    {
      family: "style fillOpacity number",
      source: "nui 1\nstyle Guide {\n  fillOpacity: nope,\n}\n",
      code: "style-fill-opacity-invalid-number",
      english: "Style fillOpacity must be a finite number.",
      japanese: "style の fillOpacity は有限な数値で指定してください。"
    },
    {
      family: "style fillOpacity range",
      source: "nui 1\nstyle Guide {\n  fillOpacity: 1.1,\n}\n",
      code: "style-fill-opacity-out-of-range",
      english: "Style fillOpacity must be between 0 and 1 inclusive.",
      japanese: "style の fillOpacity は 0 以上 1 以下で指定してください。"
    },
    {
      family: "style profile reference",
      source: "nui 1\nstyle Guide {\n  for @ {\n  }\n}\n",
      code: "style-profile-reference-invalid",
      parameters: { reference: "@" },
      english: "Style for reference '@' must be an @profile reference.",
      japanese: "style の for 参照「@」が不正です。@profile 参照で指定してください。"
    },
    {
      family: "style profile property reference",
      source: "nui 1\nstyle Guide {\n  for @Print.width {\n    width: 1px,\n  }\n}\n",
      code: "style-profile-reference-property-not-allowed",
      english: "A style for reference cannot specify a property.",
      japanese: "style の for 参照には property を指定できません。"
    },
    {
      family: "style profile missing block",
      source: "nui 1\nstyle Guide {\n  for @Print\n}\n",
      code: "missing-block",
      parameters: { category: "style for @profile" },
      english: "The style for @profile statement requires a block.",
      japanese: "style for @profile にはブロックが必要です。"
    },
    {
      family: "profile missing name",
      source: "nui 1\nprofile\n",
      code: "profile-missing-name",
      english: "A profile definition requires a name.",
      japanese: "profile には名前が必要です。"
    },
    {
      family: "profile invalid name",
      source: "nui 1\nprofile bad name\n",
      code: "profile-invalid-name",
      english: "The profile name is invalid. Quote names containing spaces or syntax punctuation.",
      japanese: "profile の名前が不正です。空白や構文記号を含める場合は引用符で囲んでください。"
    },
    {
      family: "missing statement keyword",
      source: "nui 1\n= nope\n",
      code: "missing-statement-keyword",
      english: "A statement must begin with a keyword.",
      japanese: "文はキーワードから始めてください。"
    },
    {
      family: "invalid else placement",
      source: "nui 1\n} else {\n",
      code: "invalid-else-placement",
      english: "`else` is allowed only immediately after the then branch of an if block.",
      japanese: "「} else {」は if ブロックの then 部の直後にのみ書けます。"
    },
    {
      family: "unmatched block end",
      source: "nui 1\n}\n",
      code: "unmatched-block-end",
      english: "This closing brace has no matching block opener.",
      japanese: "対応するブロックの開きがない「}」です。"
    },
    {
      family: "statement top level",
      source: "nui 1\ngroup G {\n  layout L {\n  }\n}\n",
      code: "statement-top-level-only",
      parameters: { keyword: "layout" },
      english: "layout statements are allowed only at the document top level.",
      japanese: "layout は文書のトップレベルにのみ書けます。"
    },
    {
      family: "profile top level",
      source: "nui 1\ngroup G {\n  profile P\n}\n",
      code: "profile-top-level-only",
      english: "Profile definitions are allowed only at the document top level.",
      japanese: "profile 定義は文書のトップレベルにのみ書けます。"
    },
    {
      family: "style property outside style",
      source: "nui 1\nwidth: 1px,\n",
      code: "style-property-outside-style",
      english: "Style properties are allowed only inside a style or style for @profile block.",
      japanese: "style プロパティは style または for @profile ブロック内にのみ書けます。"
    },
    {
      family: "style profile outside style",
      source: "nui 1\nfor @Print {\n}\n",
      code: "style-profile-outside-style",
      english: "A style for @profile block is allowed only inside a style block.",
      japanese: "style の for @profile ブロックは style ブロック内にのみ書けます。"
    },
    {
      family: "nested style",
      source: "nui 1\nstyle Outer {\n  style Guide {\n    width: 1px,\n  }\n  width: 1px,\n}\n",
      code: "style-nested-definition",
      english: "A style definition cannot be nested inside another block.",
      japanese: "style 定義を別のブロック内にネストできません。"
    },
    {
      family: "style top level",
      source: "nui 1\ngroup G {\n  style Guide {\n    width: 1px,\n  }\n}\n",
      code: "style-top-level-only",
      english: "Style definitions are allowed only at the document top level.",
      japanese: "style 定義は文書のトップレベルにのみ書けます。"
    },
    {
      family: "style block statement",
      source: "nui 1\nstyle Guide {\n  point A = coordinate(x: 0, y: 0)\n}\n",
      code: "style-block-invalid-statement",
      english: "A style block may contain only visible, width, lineType, color, fill, fillOpacity, or for @profile.",
      japanese: "style ブロック内には visible / width / lineType / color / fill / fillOpacity または for @profile だけを書けます。"
    },
    {
      family: "layout block statement",
      source: "nui 1\nlayout L {\n  point A = coordinate(x: 0, y: 0)\n}\n",
      code: "layout-block-invalid-statement",
      english: "A layout block may contain only place statements.",
      japanese: "layout ブロック内には place のみ書けます。"
    },
    {
      family: "place outside layout",
      source: "nui 1\nplace @G(at: (0, 0))\n",
      code: "place-outside-layout",
      english: "Place statements are allowed only inside a layout block.",
      japanese: "place は layout ブロック内にのみ書けます。"
    },
    {
      family: "unclosed block",
      source: "nui 1\ngroup G {\n",
      code: "unclosed-block",
      english: "The block is not closed. Close it with '}'.",
      japanese: "ブロックが閉じられていません。「}」で閉じてください。"
    },
    {
      family: "duplicate style name",
      source: "nui 1\nstyle Guide {\n  width: 1px,\n}\nstyle Guide {\n  width: 2px,\n}\n",
      code: "style-duplicate-name",
      parameters: { name: "Guide", previousLine: 2 },
      english: "Style name 'Guide' is duplicated (also declared on line 2).",
      japanese: "style 名「Guide」が重複しています（行 2 と重複）。"
    },
    {
      family: "duplicate style property",
      source: "nui 1\nstyle Guide {\n  width: 1px,\n  width: 2px,\n}\n",
      code: "style-duplicate-property",
      parameters: { property: "width" },
      english: "Style property 'width' may be specified only once.",
      japanese: "style の width プロパティは1つだけ指定できます。"
    },
    {
      family: "unknown style property",
      source: "nui 1\nstyle Guide {\n  mystery: 1,\n}\n",
      code: "style-unknown-property",
      parameters: { property: "mystery" },
      english: "Style has an unknown property 'mystery'.",
      japanese: "style に未知のプロパティ「mystery」があります。"
    },
    {
      family: "duplicate style profile property",
      source: "nui 1\nstyle Guide {\n  for @Print {\n    width: 1px,\n    width: 2px,\n  }\n}\n",
      code: "style-profile-duplicate-property",
      parameters: { profile: "Print", property: "width" },
      english: "Style for @Print property 'width' may be specified only once.",
      japanese: "style の for @Print 内の width プロパティは1つだけ指定できます。"
    },
    {
      family: "unknown style profile property",
      source: "nui 1\nstyle Guide {\n  for @Print {\n    mystery: 1,\n  }\n}\n",
      code: "style-profile-unknown-property",
      parameters: { profile: "Print", property: "mystery" },
      english: "Style for @Print has an unknown property 'mystery'.",
      japanese: "style の for @Print に未知のプロパティ「mystery」があります。"
    },
    {
      family: "empty style profile",
      source: "nui 1\nstyle Guide {\n  for @Print {\n  }\n}\n",
      code: "style-profile-empty",
      parameters: { profile: "Print" },
      english: "Style for @Print requires at least one property.",
      japanese: "style の for @Print にはプロパティが1つ以上必要です。"
    },
    {
      family: "empty style",
      source: "nui 1\nstyle Guide {\n}\n",
      code: "style-empty",
      english: "A style requires at least one property or profile block.",
      japanese: "style には visible / width / lineType / color / fill / fillOpacity または for @profile が1つ以上必要です。"
    },
    {
      family: "duplicate element name",
      source: "nui 1\npoint A = coordinate(x: 0, y: 0)\npoint A = coordinate(x: 1, y: 1)\n",
      code: "duplicate-element-name",
      parameters: { name: "A", previousLine: 2 },
      english: "Element name 'A' is duplicated in the same scope (also declared on line 2).",
      japanese: "同名の要素が同じスコープにあります: A(行 2 と重複)"
    },
    {
      family: "unterminated block comment",
      source: "nui 1\n/* not closed",
      code: "unterminated-block-comment",
      english: "The block comment is not closed. Close it with '*/'.",
      japanese: "ブロックコメントが閉じられていません。「*/」で閉じてください。"
    },
    {
      family: "next outside for",
      source: "nui 1\nnext total = 1\n",
      code: "next-outside-for",
      english: "next is allowed only inside a statement-for carry scope.",
      japanese: "next は statement-for の carry scope 内でのみ使用できます。"
    }
  ] as const)("localizes the $family parser-core identity through the production compiler path", (testCase) => {
    const document = AutomationDocument.fromSource(testCase.source);
    const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
      (candidate) => candidate.code === testCase.code && candidate.presentation?.key === `diagnostic.${testCase.code}`
    );
    if (!diagnostic) throw new Error(`missing production ${testCase.family} diagnostic ${testCase.code}`);

    expect(diagnostic.presentation).toEqual({
      key: `diagnostic.${testCase.code}`,
      ...(testCase.parameters ? { parameters: testCase.parameters } : {})
    });
    const identity = { code: diagnostic.code, source: diagnostic.source, range: diagnostic.range };
    expect(diagnosticTextFor(diagnostic, "en")).toBe(testCase.english);
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(testCase.japanese);
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "en") }).toMatchObject(identity);
    expect({ ...identity, message: diagnosticTextFor(diagnostic, "ja-JP") }).toMatchObject(identity);
  });
});
