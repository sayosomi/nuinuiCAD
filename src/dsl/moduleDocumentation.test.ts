import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import {
  buildModuleDocumentationIndex,
  documentationForModuleDefinition,
  documentationForModuleExport,
  documentationForModuleParameter,
  parseModuleDocumentationGroups
} from "./moduleDocumentation";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `module-doc:${index}`] as const))
  });
  if (!compiled.moduleSemanticAnalysis) throw new Error("module semantic analysis is unavailable");
  return {
    compiled,
    semantic: compiled.moduleSemanticAnalysis,
    index: buildModuleDocumentationIndex({
      statements: compiled.statements,
      spans: compiled.spans,
      semanticAnalysis: compiled.moduleSemanticAnalysis
    })
  };
};

const errorsOf = (compiled: ReturnType<typeof compileSource>["compiled"]) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("Module documentation extraction", () => {
  it("parses only explicit locale sections, preserves Markdown blank lines, and concatenates repeated locales in authored order", () => {
    expect(parseModuleDocumentationGroups([
      [
        "/// ignored before a locale marker",
        "/// @ja",
        "/// 1行目",
        "///",
        "/// **太字**",
        "/// @fr",
        "/// @en",
        "/// English"
      ],
      [
        "/// no implicit locale in this separate group"
      ],
      [
        "/// @ja",
        "/// 追記",
        "/// @pt-br",
        "/// Português"
      ]
    ])).toEqual({
      variants: [
        { locale: "ja", markdown: "1行目\n\n**太字**\n追記" },
        { locale: "en", markdown: "English" },
        { locale: "pt-br", markdown: "Português" }
      ]
    });
  });

  it("associates docs with stable Module, parameter, and resolved export identities without skipping real code", () => {
    const source = [
      "nui 4",
      "/// @ja",
      "/// ポケットを生成する。",
      "///",
      "/// **縫い代**は含まない。",
      "",
      "// ordinary comments do not break forward association",
      "/// @ja",
      "/// 追加説明。",
      "/// @en",
      "/// Creates a pocket.",
      "/// @fr",
      "/// @pt-br",
      "/// Cria um bolso.",
      "module Pocket(",
      "  /// this payload has no implicit locale",
      "  /// @ja",
      "  /// 幅。",
      "  /// @fr",
      "  /// Largeur.",
      "  width: number,",
      "  /* ordinary block comment */",
      "  /// @pt-br",
      "  /// Altura.",
      "  height: number = 10",
      ") {",
      "  /// @ja",
      "  /// 公開点。",
      "  /// @en",
      "  /// Public point.",
      "  export point Public = coordinate(x: 0, y: 0)",
      "",
      "  /// @ja",
      "  /// Private declaration consumes this documentation.",
      "  point Private = coordinate(x: 1, y: 1)",
      "  export point AfterPrivate = coordinate(x: 2, y: 2)",
      "  export point Trailing = coordinate(x: 3, y: 3) /// @ja",
      "  export point AfterTrailing = coordinate(x: 4, y: 4)",
      "}",
      "instance Root = Pocket(width: 20)"
    ].join("\n");

    const { compiled, semantic, index } = compileSource(source);
    expect(errorsOf(compiled)).toEqual([]);

    const definition = semantic.definitions.find((candidate) => candidate.name === "Pocket");
    if (!definition) throw new Error("Pocket definition is missing");
    expect(documentationForModuleDefinition(index, definition)).toEqual({
      variants: [
        { locale: "ja", markdown: "ポケットを生成する。\n\n**縫い代**は含まない。\n追加説明。" },
        { locale: "en", markdown: "Creates a pocket." },
        { locale: "pt-br", markdown: "Cria um bolso." }
      ]
    });

    const width = definition.parameters.find((parameter) => parameter.name === "width");
    const height = definition.parameters.find((parameter) => parameter.name === "height");
    if (!width || !height) throw new Error("Pocket parameters are missing");
    expect(documentationForModuleParameter(index, width)).toEqual({
      variants: [
        { locale: "ja", markdown: "幅。" },
        { locale: "fr", markdown: "Largeur." }
      ]
    });
    expect(documentationForModuleParameter(index, height)).toEqual({
      variants: [{ locale: "pt-br", markdown: "Altura。" }]
    });

    const publicExport = definition.exports.find((candidate) => candidate.name === "Public");
    const afterPrivate = definition.exports.find((candidate) => candidate.name === "AfterPrivate");
    const trailing = definition.exports.find((candidate) => candidate.name === "Trailing");
    const afterTrailing = definition.exports.find((candidate) => candidate.name === "AfterTrailing");
    if (!publicExport || !afterPrivate || !trailing || !afterTrailing) {
      throw new Error("Pocket exports are missing");
    }
    expect(documentationForModuleExport(index, publicExport)).toEqual({
      variants: [
        { locale: "ja", markdown: "公開点。" },
        { locale: "en", markdown: "Public point." }
      ]
    });
    expect(documentationForModuleExport(index, afterPrivate)).toBeNull();
    expect(documentationForModuleExport(index, trailing)).toBeNull();
    expect(documentationForModuleExport(index, afterTrailing)).toBeNull();

    expect(index.definitions.has(definition.statementId)).toBe(true);
    expect(index.parameters.get(definition.statementId)?.has(width.parameterIndex)).toBe(true);
    expect(index.exports.get(definition.statementId)?.has(publicExport.exportedStatementId)).toBe(true);
  });

  it("treats malformed or locale-less documentation as metadata absence without changing DSL validity", () => {
    const source = [
      "nui 4",
      "/// no locale marker",
      "/// @",
      "module Plain() {",
      "  /// @en",
      "  export point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Root = Plain()"
    ].join("\n");
    const { compiled, semantic, index } = compileSource(source);
    expect(errorsOf(compiled)).toEqual([]);
    const definition = semantic.definitions.find((candidate) => candidate.name === "Plain");
    if (!definition) throw new Error("Plain definition is missing");
    expect(documentationForModuleDefinition(index, definition)).toBeNull();
    const exported = definition.exports.find((candidate) => candidate.name === "P");
    if (!exported) throw new Error("Plain export is missing");
    // Empty explicit sections are ignored rather than becoming invalid metadata.
    expect(documentationForModuleExport(index, exported)).toBeNull();
  });
});
