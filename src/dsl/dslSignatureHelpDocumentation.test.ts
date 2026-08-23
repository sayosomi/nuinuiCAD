import { describe, expect, it } from "vitest";
import { createLanguageAnalysisSession } from "../../vscode-extension/src/languageAnalysisSession";
import { queryDslSignatureHelp } from "./dslSignatureHelpQuery";

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
  "instance Use = Pocket(width: 1)"
].join("\n");

const query = () => {
  const session = createLanguageAnalysisSession(source);
  const snapshot = { normalizedSource: source, sourceRevision: session.getSourceRevision() };
  const position = source.indexOf("instance Use") + "instance Use = Pocket(width: ".length;
  return {
    session,
    snapshot,
    position,
    semantic: session.signatureHelpSemanticSnapshot(snapshot)
  };
};

describe("Module Signature Help authored documentation", () => {
  it("carries definition and parameter locale variants without changing signature semantics", () => {
    const { snapshot, position, semantic } = query();
    const result = queryDslSignatureHelp({ source: snapshot, position, semantic });

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
    const { snapshot, position, semantic } = query();
    if (!semantic) throw new Error("semantic snapshot missing");
    const stale = { ...snapshot, normalizedSource: `${source}\n` };
    expect(queryDslSignatureHelp({ source: stale, position, semantic })).toBeNull();
  });
});
