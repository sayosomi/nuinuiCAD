import { describe, expect, it } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { compileDslDocument, compileDslToElements, nuiDiagnosticsFor } from "@nuinuicad/nui-language";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import { compilerDiagnosticsForState } from "./compilerDiagnostics";
import {
  diagnosticMessageFor,
  diagnosticRelatedTextFor,
  diagnosticTextFor
} from "./diagnosticLocalization";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import { webviewDiagnosticTextFor } from "../../src/vscode/webviewPresentation";

const documentDiagnosticsFor = (source: string) => {
  const compiled = compileDslDocument(source);
  return nuiDiagnosticsFor(source, compiled.diagnostics, []);
};

const automationDiagnosticsFor = (source: string) => {
  const document = AutomationDocument.fromSource(source);
  return compilerDiagnosticsForState(document.getSource(), document.getState());
};

const legacyCompilerDiagnosticsFor = (source: string) => {
  const compiled = compileDslToElements(source, {
    elements: [],
    mode: "document",
    majorVersion: 1
  });
  return nuiDiagnosticsFor(source, compiled.diagnostics, []);
};

const geometryCollectionCatalogInventory = [
  { code: "array-empty-member", parameters: undefined, english: "An array member is empty.", japanese: "array memberが空です。" },
  { code: "array-expression-empty", parameters: undefined, english: "The array expression is empty.", japanese: "array式が空です。" },
  { code: "array-invalid-expression", parameters: undefined, english: "Invalid array expression.", japanese: "array式が不正です。" },
  { code: "array-invalid-member", parameters: undefined, english: "Invalid array member.", japanese: "array memberが不正です。" },
  { code: "array-nested-array", parameters: undefined, english: "Arrays cannot contain nested arrays.", japanese: "arrayを入れ子にできません。" },
  { code: "array-trailing-token", parameters: undefined, english: "Unexpected token after the array.", japanese: "arrayの後に余分なtokenがあります。" },
  { code: "array-unclosed-literal", parameters: undefined, english: "The array literal is not closed.", japanese: "array literalが閉じられていません。" },
  { code: "array-parameter-default", parameters: undefined, english: "Array Module parameters cannot have defaults.", japanese: "array 型 Module parameter に default は指定できません。" },
  { code: "array-invalid-reference", parameters: undefined, english: "Invalid array alias reference.", japanese: "array alias の参照が不正です。" },
  { code: "array-reference-forward", parameters: { reference: "@later" }, english: "Array '@later' is declared later.", japanese: "array「@later」はこの位置より後で宣言されています。" },
  { code: "array-reference-ambiguous", parameters: { reference: "@same" }, english: "Array reference '@same' is ambiguous.", japanese: "array 参照が曖昧です: @same" },
  { code: "array-reference-undefined", parameters: { reference: "@missing" }, english: "Array reference '@missing' could not be resolved.", japanese: "未解決の array 参照です: @missing" },
  { code: "array-reference-invalidTraversal", parameters: { reference: "@value.member" }, english: "Array reference traversal '@value.member' is invalid.", japanese: "array 参照「@value.member」の traversal が不正です。" },
  { code: "array-reference-not-array", parameters: { reference: "@scalar" }, english: "Reference '@scalar' is not an array compatible with this collection type.", japanese: "参照先「@scalar」はこの collection 型と互換性のある array ではありません。" },
  { code: "array-member-forward", parameters: { member: "@later" }, english: "Array member '@later' is declared later.", japanese: "array member「@later」はこの位置より後で宣言されています。" },
  { code: "array-member-ambiguous", parameters: { member: "@same" }, english: "Array member reference '@same' is ambiguous.", japanese: "array member 参照が曖昧です: @same" },
  { code: "array-member-undefined", parameters: { member: "@missing" }, english: "Array member '@missing' could not be resolved.", japanese: "未解決の array member です: @missing" },
  { code: "array-member-invalidTraversal", parameters: { member: "@value.member" }, english: "Array member traversal '@value.member' is invalid.", japanese: "array member「@value.member」の traversal が不正です。" },
  { code: "array-member-invalid-type", parameters: { member: "@broken" }, english: "The type of reference '@broken' could not be resolved.", japanese: "参照先「@broken」の型を解決できません。" },
  { code: "array-member-not-value", parameters: { member: "@Module" }, english: "Reference '@Module' cannot be used as an array member value.", japanese: "参照先「@Module」は array member に使用できる value ではありません。" },
  { code: "array-member-type-mismatch", parameters: { member: "\"wrong\"" }, english: "Array member '\"wrong\"' does not match the declared element type.", japanese: "array member「\"wrong\"」の型が宣言型と一致しません。" },
  { code: "nested-array-member", parameters: undefined, english: "Array literals cannot contain nested arrays.", japanese: "配列を array literal member として入れ子にすることはできません。" },
  { code: "array-argument-invalid", parameters: { parameter: "values" }, english: "Array parameter 'values' requires a compatible whole-value collection reference.", japanese: "array parameter「values」には compatible な whole-value collection reference が必要です。" },
  { code: "array-argument-type-mismatch", parameters: { argument: "@labels", parameter: "values" }, english: "Array argument '@labels' does not match parameter 'values'.", japanese: "array argument「@labels」の型が parameter「values」と一致しません。" },
  { code: "array-assignability-mismatch", parameters: { actual: "string[]", expected: "number[]" }, english: "Array type 'string[]' is not assignable to 'number[]'.", japanese: "array型「string[]」を「number[]」に代入できません。" },
  { code: "array-value-for-unsupported", parameters: undefined, english: "This collection does not support value-for.", japanese: "この collection では value-for を使用できません。" },
  { code: "geometry-array-expected-array", parameters: undefined, english: "The expected geometry-array type is invalid.", japanese: "geometry array の期待型が不正です。" },
  { code: "coalesce-left-not-optional", parameters: undefined, english: "The left operand of ?? must have an optional type.", japanese: "?? の左辺は optional 型である必要があります。" },
  { code: "value-if-missing-else", parameters: undefined, english: "A value-if without else requires an optional result type.", japanese: "else を省略できる value-if の結果型は optional である必要があります。" },
  { code: "geometry-array-value-for-source-invalid", parameters: { source: "@scalar" }, english: "Value-for source '@scalar' must resolve to a whole-value geometry collection.", japanese: "value-for source「@scalar」には解決可能な whole-value geometry collection reference が必要です。" },
  { code: "geometry-array-value-for-source-forward", parameters: { source: "@later" }, english: "Geometry collection value-for source '@later' is declared later.", japanese: "value-for source「@later」はこの位置より後で宣言されています。" },
  { code: "geometry-array-member-undefined", parameters: { member: "@missing" }, english: "Geometry array member '@missing' could not be resolved.", japanese: "geometry array member「@missing」を解決できません。" },
  { code: "geometry-array-reference-undefined", parameters: { reference: "@missing" }, english: "Geometry array reference '@missing' could not be resolved.", japanese: "未解決のgeometry array参照です: @missing" }
] as const;

const semanticOwnerCatalogInventory = [
  { code: "invalid-boolean-parameter-value", parameters: { parameter: "visible" }, english: "Parameter 'visible' must be true or false.", japanese: "visible は true/false で指定してください。" },
  { code: "invalid-numeric-parameter-steps", parameters: undefined, english: "steps must be a list of parameter:positiveNumber entries.", japanese: "steps は parameter:positiveNumber の一覧で指定してください。" },
  { code: "none-requires-optional-type", parameters: undefined, english: "The 'none' value requires a known optional type context.", japanese: "none は基底型が確定した optional 型の文脈でのみ使用できます。" },
  { code: "geometry-value-mutation-target-unsupported", parameters: undefined, english: "An immutable geometry value cannot be used as a mutation target.", japanese: "immutable geometry value は mutation target にできません。" },
  { code: "join-empty-paths", parameters: undefined, english: "The join paths argument must contain at least one path.", japanese: "join の paths には少なくとも1つの path を指定してください。" },
  { code: "coalesce-type-mismatch", parameters: undefined, english: "The ?? record operands must be the same optional nominal record type and its underlying record type.", japanese: "?? の record operands は optional な同一 nominal record 型と、その underlying record 型である必要があります。" },
  { code: "unterminated-index", parameters: undefined, english: "A collection index is missing its closing ']'.", japanese: "閉じ括弧 ']' がありません。" },
  { code: "empty-index", parameters: undefined, english: "A collection index requires an expression.", japanese: "collection index の式が必要です。" },
  { code: "unterminated-string", parameters: undefined, english: "A string literal is missing its closing quote.", japanese: "string literalの閉じ引用符がありません。" },
  { code: "physical-newline-in-string", parameters: undefined, english: "String literals cannot contain a physical newline; use \\n or \\r.", japanese: "string literalには物理的な改行を含められません。\\n または \\r を使用してください。" }
] as const;

describe("diagnostic presentation localization", () => {
  it("keeps the current geometry and collection diagnostic owner inventory cataloged", () => {
    for (const entry of geometryCollectionCatalogInventory) {
      const diagnostic = {
        message: "owner fallback",
        presentation: {
          key: `diagnostic.${entry.code}`,
          ...(entry.parameters ? { parameters: entry.parameters } : {})
        }
      };
      expect(diagnosticTextFor(diagnostic, "en")).toBe(entry.english);
      expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(entry.japanese);
    }
  });

  it("keeps the remaining semantic owner identities and mechanically forwarded parser identities cataloged", () => {
    for (const entry of semanticOwnerCatalogInventory) {
      const diagnostic = {
        message: "owner fallback",
        presentation: {
          key: `diagnostic.${entry.code}`,
          ...(entry.parameters ? { parameters: entry.parameters } : {})
        }
      };
      expect(diagnosticTextFor(diagnostic, "en")).toBe(entry.english);
      expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(entry.japanese);
    }
  });

  it("localizes parameterized geometry and collection diagnostics without changing producer identity", () => {
    const cases = [
      {
        family: "array member mismatch",
        source: "nui 1\nconst mismatch: number[] = [\"wrong\"]",
        code: "array-member-type-mismatch",
        parameters: { member: "\"wrong\"" },
        fallback: "array member「\"wrong\"」の型が宣言型と一致しません。",
        english: "Array member '\"wrong\"' does not match the declared element type.",
        japanese: "array member「\"wrong\"」の型が宣言型と一致しません。"
      },
      {
        family: "array reference undefined",
        source: "nui 1\nconst alias: number[] = @missing",
        code: "array-reference-undefined",
        parameters: { reference: "@missing" },
        fallback: "未解決の array 参照です: @missing",
        english: "Array reference '@missing' could not be resolved.",
        japanese: "未解決の array 参照です: @missing"
      },
      {
        family: "array reference not array",
        source: "nui 1\nconst scalar: number = 1\nconst bad: number[] = @scalar",
        code: "array-reference-not-array",
        parameters: { reference: "@scalar" },
        fallback: "参照先「@scalar」はこの collection 型と互換性のある array ではありません。",
        english: "Reference '@scalar' is not an array compatible with this collection type.",
        japanese: "参照先「@scalar」はこの collection 型と互換性のある array ではありません。"
      },
      {
        family: "array argument invalid",
        source: "nui 1\nmodule M(values: number[]) {\n}\ninstance use = M(values: 1)",
        code: "array-argument-invalid",
        parameters: { parameter: "values" },
        fallback: "array parameter「values」には compatible な whole-value collection reference が必要です。",
        english: "Array parameter 'values' requires a compatible whole-value collection reference.",
        japanese: "array parameter「values」には compatible な whole-value collection reference が必要です。"
      },
      {
        family: "array argument type mismatch",
        source: "nui 1\nconst labels: string[] = [\"a\"]\nmodule M(values: number[]) {\n}\ninstance use = M(values: @labels)",
        code: "array-argument-type-mismatch",
        parameters: { argument: "@labels", parameter: "values" },
        fallback: "array argument「@labels」の型が parameter「values」と一致しません。",
        english: "Array argument '@labels' does not match parameter 'values'.",
        japanese: "array argument「@labels」の型が parameter「values」と一致しません。"
      },
      {
        family: "geometry value-for source",
        source: "nui 1\nconst scalar: number = 1\nconst bad: point[] = for item in @scalar { @item }",
        code: "geometry-array-value-for-source-invalid",
        parameters: { source: "@scalar" },
        fallback: "value-for source「@scalar」は解決できない geometry collection です。",
        english: "Value-for source '@scalar' must resolve to a whole-value geometry collection.",
        japanese: "value-for source「@scalar」には解決可能な whole-value geometry collection reference が必要です。"
      },
      {
        family: "geometry array member undefined",
        source: "nui 1\nconst bad: point[] = [@missing]",
        code: "geometry-array-member-undefined",
        parameters: { member: "@missing" },
        fallback: "未解決の geometry array member です: @missing",
        english: "Geometry array member '@missing' could not be resolved.",
        japanese: "geometry array member「@missing」を解決できません。"
      },
      {
        family: "geometry array reference undefined",
        source: "nui 1\nconst bad: point[] = @missing",
        code: "geometry-array-reference-undefined",
        parameters: { reference: "@missing" },
        fallback: "未解決の geometry array 参照です: @missing",
        english: "Geometry array reference '@missing' could not be resolved.",
        japanese: "未解決のgeometry array参照です: @missing"
      },
    ] as const;

    for (const testCase of cases) {
      const document = AutomationDocument.fromSource(testCase.source);
      const diagnostic = compilerDiagnosticsForState(document.getSource(), document.getState()).find(
        (candidate) => candidate.code === testCase.code
      );
      if (!diagnostic) throw new Error(`missing production ${testCase.family} diagnostic ${testCase.code}`);
      expect(diagnostic.message).toBe(testCase.fallback);
      expect(diagnostic.presentation).toEqual({ key: `diagnostic.${testCase.code}`, parameters: testCase.parameters });
      const identity = { severity: diagnostic.severity, code: diagnostic.code, source: diagnostic.source, range: diagnostic.range };
      expect(diagnosticTextFor(diagnostic, "en")).toBe(testCase.english);
      expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(testCase.japanese);
      expect({ severity: diagnostic.severity, code: diagnostic.code, source: diagnostic.source, range: diagnostic.range }).toEqual(identity);
    }
  });

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

  it.each([
    {
      family: "empty document",
      source: "",
      code: "missing-version-declaration",
      fallback: "文書が空です。先頭に `nui 1` が必要です。",
      english: "The document is empty. Add `nui 1` at the beginning.",
      japanese: "文書が空です。先頭に `nui 1` が必要です。",
      diagnostics: documentDiagnosticsFor
    },
    {
      family: "version not first",
      source: "point A = coordinate(x: 0, y: 0)",
      code: "version-declaration-not-first",
      fallback: "文書の先頭は `nui <バージョン>` である必要があります。",
      english: "The document must begin with `nui <version>`.",
      japanese: "文書の先頭は `nui <バージョン>` である必要があります。",
      diagnostics: documentDiagnosticsFor
    },
    {
      family: "invalid DSL version",
      source: "nui nope",
      code: "invalid-dsl-version",
      parameters: { version: "nope" },
      fallback: "不正なDSLバージョンです: nope",
      english: "Invalid DSL version: nope",
      japanese: "不正なDSLバージョンです: nope",
      diagnostics: documentDiagnosticsFor
    },
    {
      family: "unsupported DSL version",
      source: "nui 2",
      code: "unsupported-dsl-version",
      parameters: { version: "2", supported: "1" },
      fallback: "未対応のDSLバージョンです: 2(対応: 1)",
      english: "Unsupported DSL version: 2 (supported: 1)",
      japanese: "未対応のDSLバージョンです: 2(対応: 1)",
      diagnostics: documentDiagnosticsFor
    },
    {
      family: "duplicate version",
      source: "nui 1\nnui 1",
      code: "duplicate-version-declaration",
      fallback: "`nui` は文書の先頭に1つだけ書けます。",
      english: "The `nui` declaration may appear only once at the beginning of the document.",
      japanese: "`nui` は文書の先頭に1つだけ書けます。",
      diagnostics: documentDiagnosticsFor
    },
    {
      family: "invalid statement-for source",
      source: "nui 1\nfor item in scalar {\n}",
      code: "invalid-for-source-reference",
      fallback: "statement-for の collection source は通常の @reference で指定してください。",
      english: "A statement-for collection source must use an ordinary @reference.",
      japanese: "statement-for の collection source は通常の @reference で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "geometry carry initializer",
      source: [
        "nui 1",
        "curve C = bezier(start: (0, 0), end: (10, 0))",
        "for i in range(min: 0, max: 1, step: 1) carry lineValue: line = @C {",
        "  next lineValue = @C",
        "}"
      ].join("\n"),
      code: "carry-geometry-type-mismatch",
      parameters: { name: "lineValue", position: "initializer" },
      fallback: "carry「lineValue」の geometry initializer は宣言された型と一致する必要があります。",
      english: "carry 'lineValue' geometry initializer must match the declared type.",
      japanese: "carry「lineValue」の geometry initializer は宣言された型と一致する必要があります。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "geometry carry next",
      source: [
        "nui 1",
        "curve C = bezier(start: (0, 0), end: (10, 0))",
        "for i in range(min: 0, max: 1, step: 1) carry lineValue: line = @C {",
        "  next lineValue = @C",
        "}"
      ].join("\n"),
      code: "carry-geometry-type-mismatch",
      parameters: { name: "lineValue", position: "next" },
      fallback: "carry「lineValue」の geometry next は宣言された型と一致する必要があります。",
      english: "carry 'lineValue' geometry next must match the declared type.",
      japanese: "carry「lineValue」の geometry next は宣言された型と一致する必要があります。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "geometry collection carry",
      source: [
        "nui 1",
        "curve C = bezier(start: (0, 0), end: (10, 0))",
        "const paths: path[] = [@C]",
        "for i in range(min: 0, max: 1, step: 1) carry lines: line[] = @paths {",
        "  next lines = @paths",
        "}"
      ].join("\n"),
      code: "carry-collection-expression-invalid",
      parameters: { name: "lines", collectionKind: "geometry collection" },
      fallback: "carry「lines」の geometry collection initializer/next は宣言された collection 型と一致する必要があります。",
      english: "carry 'lines' geometry collection initializer/next must match the declared collection type.",
      japanese: "carry「lines」の geometry collection initializer/next は宣言された collection 型と一致する必要があります。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "dependency cycle",
      source: "nui 1\nconst a: number = @b\nconst b: number = @a",
      code: "dependency-cycle",
      parameters: { names: "a -> b -> a" },
      fallback: "依存関係 cycle: a -> b -> a",
      english: "Dependency cycle: a -> b -> a",
      japanese: "依存関係 cycle: a -> b -> a",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid source reference",
      source: "nui 1\nlayout L {\n  place @G.foo(at: (0, 0))\n}",
      code: "invalid-source-reference",
      parameters: { reference: "@G.foo" },
      fallback: "参照が不正です: @G.foo",
      english: "Invalid source reference '@G.foo'.",
      japanese: "参照「@G.foo」が不正です。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "source reference ambiguous",
      source: "nui 1\npoint P = coordinate(x: 0, y: 0)\nlayout L {\n  place @P(at: (0, 0))\n}",
      code: "source-reference-kind-mismatch",
      parameters: { reference: "@P", expected: "group" },
      fallback: "参照先「@P」は group ではありません。",
      english: "Reference '@P' is not one of the expected declaration kinds: group.",
      japanese: "参照先「@P」は group ではありません。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "source reference invalid traversal",
      source: "nui 1\npoint P = coordinate(x: 0, y: 0)\nlayout L {\n  place @P::X(at: (0, 0))\n}",
      code: "source-reference-invalid-traversal",
      parameters: { reference: "@P::X" },
      fallback: "参照先「@P::X」はこの種類の宣言を辿れません。",
      english: "Reference '@P::X' cannot traverse this kind of declaration.",
      japanese: "参照先「@P::X」はこの種類の宣言を辿れません。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "source reference undefined",
      source: "nui 1\nlayout L {\n  place @Missing(at: (0, 0))\n}",
      code: "source-reference-undefined",
      parameters: { reference: "@Missing" },
      fallback: "未定義の参照です: @Missing",
      english: "Reference '@Missing' is undefined.",
      japanese: "未定義の参照です: @Missing",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "undefined visibility role",
      source: "nui 1\nview Draft (default: true, ghost: nope)",
      code: "undefined-visibility-role",
      parameters: { role: "ghost" },
      fallback: "未定義の表示ロールです: ghost",
      english: "Visibility role 'ghost' is undefined.",
      japanese: "未定義の表示ロールです: ghost",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid visibility role value",
      source: "nui 1\nview Draft (default: true, ghost: nope)",
      code: "invalid-visibility-role-value",
      parameters: { role: "ghost" },
      fallback: "ghost は true/false で指定してください。",
      english: "Visibility role 'ghost' must be true or false.",
      japanese: "ghost は true/false で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "undefined visibility profile",
      source: "nui 1\nactiveView Missing",
      code: "undefined-visibility-profile",
      parameters: { profile: "Missing" },
      fallback: "未定義の表示プロファイルです: Missing",
      english: "Visibility profile 'Missing' is undefined.",
      japanese: "未定義の表示プロファイルです: Missing",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "place target not group",
      source: "nui 1\npoint P = coordinate(x: 0, y: 0)\nlayout L {\n  place @P(at: (0, 0))\n}",
      code: "place-target-not-group",
      parameters: { reference: "@P" },
      fallback: "place の参照先はグループではありません: @P",
      english: "Place target '@P' is not a group.",
      japanese: "place の参照先はグループではありません: @P",
      diagnostics: legacyCompilerDiagnosticsFor
    },
    {
      family: "place origin namespace unavailable",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(origin: @G, at: (0, 0))\n}",
      code: "place-origin-namespace-unavailable",
      parameters: { reference: "@G" },
      fallback: "place origin は source lexical namespace で解決できません: @G",
      english: "Place origin '@G' cannot be resolved without the source lexical namespace.",
      japanese: "place origin は source lexical namespace で解決できません: @G",
      diagnostics: legacyCompilerDiagnosticsFor
    },
    {
      family: "place origin unresolved",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(origin: @Missing, at: (0, 0))\n}",
      code: "place-origin-unresolved",
      parameters: { reference: "@Missing" },
      fallback: "origin の参照先を解決できません: @Missing",
      english: "Place origin reference '@Missing' could not be resolved.",
      japanese: "origin の参照先を解決できません: @Missing",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "place origin not point",
      source: "nui 1\ngroup G {\n}\ngroup H {\n}\nlayout L {\n  place @G(origin: @H, at: (0, 0))\n}",
      code: "place-origin-not-point",
      parameters: { reference: "@H" },
      fallback: "origin の参照先は点ではありません: @H",
      english: "Place origin reference '@H' is not a point.",
      japanese: "origin の参照先は点ではありません: @H",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "place origin outside group",
      source: "nui 1\ngroup G {\n  point P = coordinate(x: 0, y: 0)\n}\npoint Q = coordinate(x: 1, y: 1)\nlayout L {\n  place @G(origin: @Q, at: (0, 0))\n}",
      code: "place-origin-outside-target-group",
      parameters: { reference: "@Q" },
      fallback: "origin の点は配置対象グループの内部にありません: @Q",
      english: "Place origin point '@Q' is not inside the placed group.",
      japanese: "origin の点は配置対象グループの内部にありません: @Q",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid layout scale",
      source: "nui 1\nlayout L(scale: 0) {\n}",
      code: "invalid-layout-scale",
      fallback: "layout scale は有限の正の値で指定してください。",
      english: "Layout scale must be a finite positive value.",
      japanese: "layout scale は有限の正の値で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "place position required",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(at: nope)\n}",
      code: "place-position-required",
      fallback: "place には `at: (x, y)` が必要です。",
      english: "Place requires `at: (x, y)`.",
      japanese: "place には `at: (x, y)` が必要です。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid place mirror",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(at: (0, 0), mirror: maybe)\n}",
      code: "invalid-place-mirror",
      fallback: "place mirror は true / false で指定してください。",
      english: "Place mirror must be true or false.",
      japanese: "place mirror は true / false で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid place scale",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(at: (0, 0), scale: 0)\n}",
      code: "invalid-place-scale",
      fallback: "place scale は有限の正の値で指定してください。",
      english: "Place scale must be a finite positive value.",
      japanese: "place scale は有限の正の値で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid place angle",
      source: "nui 1\ngroup G {\n}\nlayout L {\n  place @G(at: (0, 0), angle: 1e9999)\n}",
      code: "invalid-place-angle",
      fallback: "place angle は有限の値で指定してください。",
      english: "Place angle must be finite.",
      japanese: "place angle は有限の値で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid print paper",
      source: "nui 1\nprint P(layout: @Missing, paper: a5, overlap: 0)",
      code: "invalid-print-paper",
      fallback: "print paper は a4 または a3 で指定してください。",
      english: "Print paper must be a4 or a3.",
      japanese: "print paper は a4 または a3 で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid print orientation",
      source: "nui 1\nprint P(layout: @Missing, paper: a4, orientation: side, overlap: 0)",
      code: "invalid-print-orientation",
      fallback: "orientation は portrait / landscape で指定してください。",
      english: "Orientation must be portrait or landscape.",
      japanese: "orientation は portrait / landscape で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid print overlap",
      source: "nui 1\nprint P(layout: @Missing, paper: a4, overlap: -1)",
      code: "invalid-print-overlap",
      fallback: "print overlap は 0 以上で指定してください。",
      english: "Print overlap must be at least 0.",
      japanese: "print overlap は 0 以上で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "print overlap too large",
      source: "nui 1\ngroup G {\n}\nlayout L {\n}\nprint P(layout: @L, paper: a4, orientation: portrait, overlap: 200)",
      code: "print-overlap-too-large",
      parameters: { paper: "A4", orientation: "portrait", maximum: 105 },
      fallback: "print の overlap が大きすぎます。A4 portrait では overlap を 105mm 未満にしてください。",
      english: "Print overlap is too large. For A4 portrait, overlap must be less than 105mm.",
      japanese: "print の overlap が大きすぎます。A4 portrait では overlap を 105mm 未満にしてください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid SVG margin",
      source: "nui 1\nsvg S(layout: @Missing, margin: -1)",
      code: "invalid-svg-margin",
      fallback: "svg margin は 0 以上で指定してください。",
      english: "SVG margin must be at least 0.",
      japanese: "svg margin は 0 以上で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "undefined drawing style",
      source: "nui 1\npoint P [Missing] = coordinate(x: 0, y: 0)",
      code: "undefined-drawing-style",
      parameters: { name: "Missing" },
      fallback: "未定義の style です: Missing",
      english: "Style 'Missing' is undefined.",
      japanese: "未定義の style です: Missing",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid boolean parameter value",
      source: "nui 1\npoint P = coordinate(x: 0, y: 0, visible: maybe)",
      code: "invalid-boolean-parameter-value",
      parameters: { parameter: "visible" },
      fallback: "visible は true/false で指定してください。",
      english: "Parameter 'visible' must be true or false.",
      japanese: "visible は true/false で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "invalid numeric parameter steps",
      source: "nui 1\npoint P = coordinate(x: 0, y: 0, steps: [x: 0])",
      code: "invalid-numeric-parameter-steps",
      fallback: "steps は parameter:positiveNumber の一覧で指定してください。",
      english: "steps must be a list of parameter:positiveNumber entries.",
      japanese: "steps は parameter:positiveNumber の一覧で指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "none without an optional numeric type",
      source: "nui 1\npoint P = coordinate(x: 1 ?? none, y: 0)",
      code: "none-requires-optional-type",
      fallback: "none は基底型が確定した optional 型の文脈でのみ使用できます。",
      english: "The 'none' value requires a known optional type context.",
      japanese: "none は基底型が確定した optional 型の文脈でのみ使用できます。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "join empty paths",
      source: "nui 1\nline Joined = join(paths: [])",
      code: "join-empty-paths",
      fallback: "join の paths には少なくとも1つの path を指定してください。",
      english: "The join paths argument must contain at least one path.",
      japanese: "join の paths には少なくとも1つの path を指定してください。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "record coalesce type mismatch",
      source: [
        "nui 1",
        "record Pair(value: number)",
        "record Other(value: number)",
        "const maybe: Pair? = none",
        "const other: Other = Other(value: 1)",
        "const bad: Pair = @maybe ?? @other"
      ].join("\n"),
      code: "coalesce-type-mismatch",
      fallback: "?? の record operands は optional な同一 nominal record 型と、その underlying record 型である必要があります。",
      english: "The ?? record operands must be the same optional nominal record type and its underlying record type.",
      japanese: "?? の record operands は optional な同一 nominal record 型と、その underlying record 型である必要があります。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "source reference invalid traversal",
      source: "nui 1\nconst Scalar: number = 1\npoint Use = offset(from: @Scalar::member, dx: 1, dy: 0)",
      code: "source-reference-invalid-traversal",
      parameters: { reference: "@Scalar::member", declaration: "Scalar" },
      fallback: "参照先「Scalar」はnamespace/containerではありません: @Scalar::member",
      english: "Reference '@Scalar::member' cannot traverse this kind of declaration.",
      japanese: "参照先「@Scalar::member」はこの種類の宣言を辿れません。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "ignored parent in block",
      source: "nui 1\nif (true) {\n  point P = coordinate(x: 0, y: 0, parent: @G)\n}",
      code: "ignored-parent-in-block",
      fallback: "ブロック内の parent= 属性は無視されます。",
      english: "The parent= attribute is ignored inside a block.",
      japanese: "ブロック内の parent= 属性は無視されます。",
      diagnostics: automationDiagnosticsFor
    },
    {
      family: "ignored parent in materialized module block",
      source: "nui 1\nmodule M() {\n  if (true) {\n    point P = coordinate(x: 10, y: 20, parent: @IgnoredParent)\n  }\n}\ninstance A = M()",
      code: "ignored-parent-in-block",
      fallback: "ブロック内の parent= 属性は無視されます。",
      english: "The parent= attribute is ignored inside a block.",
      japanese: "ブロック内の parent= 属性は無視されます。",
      diagnostics: automationDiagnosticsFor
    }
  ] as const)("localizes the $family document/compiler owner identity", (testCase) => {
    const diagnostic = testCase.diagnostics(testCase.source).find(
      (candidate) => candidate.code === testCase.code &&
        JSON.stringify(candidate.presentation?.parameters) === JSON.stringify(testCase.parameters)
    );
    if (!diagnostic) throw new Error(`missing production ${testCase.family} diagnostic ${testCase.code}`);

    expect(diagnostic.message).toBe(testCase.fallback);
    expect(diagnostic.presentation).toEqual({
      key: `diagnostic.${testCase.code}`,
      ...(testCase.parameters ? { parameters: testCase.parameters } : {})
    });
    const identity = {
      severity: diagnostic.severity,
      code: diagnostic.code,
      source: diagnostic.source,
      range: diagnostic.range
    };
    const english = diagnosticTextFor(diagnostic, "en");
    const japanese = diagnosticTextFor(diagnostic, "ja-JP");
    expect(english).toBe(testCase.english);
    expect(japanese).toBe(testCase.japanese);
    expect({ ...identity, message: english }).toMatchObject(identity);
    expect({ ...identity, message: japanese }).toMatchObject(identity);
  });

  it.each([
    {
      code: "source-reference-ambiguous",
      parameters: { reference: "@Same" },
      english: "Reference '@Same' is ambiguous.",
      japanese: "参照が曖昧です: @Same"
    },
    {
      code: "source-reference-forward",
      parameters: { reference: "@Later" },
      english: "Reference '@Later' is declared later and is not available here.",
      japanese: "参照先「@Later」はこの位置より後で宣言されています。"
    },
    {
      code: "source-reference-undefined",
      parameters: { reference: "@Missing" },
      english: "Reference '@Missing' is undefined.",
      japanese: "未定義の参照です: @Missing"
    },
    {
      code: "output-layout-unavailable",
      parameters: undefined,
      english: "The print/svg layout declaration could not be resolved.",
      japanese: "print/svg layout の宣言を取得できません。"
    }
  ] as const)("keeps the $code catalog entry available for deferred compiler branches", (testCase) => {
    const diagnostic = {
      message: "legacy compiler fallback",
      presentation: {
        key: `diagnostic.${testCase.code}`,
        ...(testCase.parameters ? { parameters: testCase.parameters } : {})
      }
    };
    expect(diagnosticTextFor(diagnostic, "en")).toBe(testCase.english);
    expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe(testCase.japanese);
  });
});
