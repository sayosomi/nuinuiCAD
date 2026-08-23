import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { queryDslSignatureHelp } from "./dslSignatureHelpQuery";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `signature-doc:${index}`] as const))
  });
};

const source = [
  "nui 4",
  "/// @ja",
  "/// ポケットを作る。",
  "/// @en",
  "/// Creates a pocket.",
  "module Pocket(",
  "  /// @ja",
  "  /// 幅。",
  "  /// @en",
  "  /// Width.",
  "  width: number",
  ") {",
  "}",
  "instance Use = Pocket(width: "
].join("\n");

describe("Module Signature Help authored documentation", () => {
  it("carries definition and parameter locale variants without changing signature semantics", () => {
    const compiled = compileSource(source);
    const result = queryDslSignatureHelp({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position: source.length,
      semantic: {
        sourceRevision: compiled.spans.sourceMap.sourceRevision,
        sourceText: source,
        compiled
      }
    });

    const signature = result?.signatures[0];
    expect(signature?.name).toBe("Pocket");
    expect(signature?.authoredDocumentation?.variants).toEqual([
      { locale: "ja", markdown: "ポケットを作る。" },
      { locale: "en", markdown: "Creates a pocket." }
    ]);
    expect(signature?.parameters[0]?.authoredDocumentation?.variants).toEqual([
      { locale: "ja", markdown: "幅。" },
      { locale: "en", markdown: "Width." }
    ]);
    expect(result?.activeSignature).toBe(0);
    expect(result?.activeParameter).toBe(0);
  });

  it("fails closed when the semantic source proof is stale", () => {
    const compiled = compileSource(source);
    const staleSource = `${source}1`;
    expect(queryDslSignatureHelp({
      source: { normalizedSource: staleSource, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position: staleSource.length,
      semantic: {
        sourceRevision: compiled.spans.sourceMap.sourceRevision,
        sourceText: source,
        compiled
      }
    })).toBeNull();
  });
});
