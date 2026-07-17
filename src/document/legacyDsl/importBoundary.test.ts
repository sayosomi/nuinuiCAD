import { describe, expect, it } from "vitest";
import dslCompilerSource from "./dslCompiler.ts?raw";
import dslParserSource from "./dslParser.ts?raw";
import dslPrintLayoutAttributesSource from "./dslPrintLayoutAttributes.ts?raw";
import dslReferencesSource from "./dslReferences.ts?raw";
import dslReferenceTokensSource from "./dslReferenceTokens.ts?raw";
import dslTokensSource from "./dslTokens.ts?raw";
import dslTypesSource from "./dslTypes.ts?raw";
import logicalStatementSourceMapSource from "./logicalStatementSourceMap.ts?raw";
import parseLegacyV1DocumentSource from "./parseLegacyV1Document.ts?raw";

// legacyDsl は C1 が live `src/dsl/` の v1 parser/compiler を削除する前の凍結
// コピーであり、以後 live 側の変更に追従してはならない。この境界を機械的に
// 保証する: ディレクトリ内の全実装ファイル(facade を含む。テストは対象外)が
// どれも live `src/dsl/` を import していないことを検査する。

const implementationFiles: Record<string, string> = {
  "dslCompiler.ts": dslCompilerSource,
  "dslParser.ts": dslParserSource,
  "dslPrintLayoutAttributes.ts": dslPrintLayoutAttributesSource,
  "dslReferences.ts": dslReferencesSource,
  "dslReferenceTokens.ts": dslReferenceTokensSource,
  "dslTokens.ts": dslTokensSource,
  "dslTypes.ts": dslTypesSource,
  "logicalStatementSourceMap.ts": logicalStatementSourceMapSource,
  "parseLegacyV1Document.ts": parseLegacyV1DocumentSource
};

const importSpecifiersOf = (source: string): string[] => {
  const specifiers: string[] = [];
  const pattern = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) specifiers.push(match[1]);
  return specifiers;
};

// live `src/dsl/` への import は必ずどこかの経路セグメントに `dsl` を含む
// (`../../dsl/...` や `../dsl/...`)。凍結コピー自身の同ディレクトリ import
// (`./dslParser` 等)はファイル名であり、パスセグメントとしての `dsl` には
// ならないため誤検知しない。
const importsLiveDslDirectory = (specifier: string) =>
  specifier.split("/").some((segment) => segment === "dsl");

describe("legacyDsl import boundary", () => {
  it.each(Object.entries(implementationFiles))("%s は live src/dsl/ を import しない", (_fileName, source) => {
    const relativeSpecifiers = importSpecifiersOf(source).filter((specifier) => specifier.startsWith("."));
    const offenders = relativeSpecifiers.filter(importsLiveDslDirectory);
    expect(offenders).toEqual([]);
  });

  it("凍結対象ファイルが揃っている", () => {
    expect(Object.keys(implementationFiles).sort()).toEqual(
      [
        "dslCompiler.ts",
        "dslParser.ts",
        "dslPrintLayoutAttributes.ts",
        "dslReferenceTokens.ts",
        "dslReferences.ts",
        "dslTokens.ts",
        "dslTypes.ts",
        "logicalStatementSourceMap.ts",
        "parseLegacyV1Document.ts"
      ].sort()
    );
  });
});
