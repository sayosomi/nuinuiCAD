import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslCompletion } from "./dslCompletionQuery";
import { parseDsl } from "./dslParser";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `completion-doc:${index}`] as const))
  });
};

const semanticFor = (source: string) => {
  const compiled = compileSource(source);
  return {
    compiled,
    snapshot: {
      sourceRevision: compiled.spans.sourceMap.sourceRevision,
      sourceText: source,
      compiled
    }
  };
};

const base = [
  "nui 4",
  "/// @ja",
  "/// ポケット。",
  "/// @en",
  "/// Pocket.",
  "module Pocket(",
  "  /// @ja",
  "  /// 幅。",
  "  /// @en",
  "  /// Width.",
  "  width: number",
  ") {",
  "  /// @ja",
  "  /// 公開点。",
  "  /// @en",
  "  /// Public point.",
  "  export point Public = coordinate(x: 0, y: 0)",
  "}"
];

describe("DSL completion Module documentation metadata", () => {
  it("attaches docs to Module callees", () => {
    const source = [...base, "instance Use = Poc"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position: source.length,
      semantic: snapshot
    });
    const candidate = result?.candidates.find((entry) => entry.kind === "module" && entry.label === "Pocket");
    expect(candidate?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "ポケット。" },
      { locale: "en", markdown: "Pocket." }
    ]);
  });

  it("attaches docs to explicit Module argument labels", () => {
    const source = [...base, "instance Use = Pocket("].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position: source.length,
      semantic: snapshot
    });
    const candidate = result?.candidates.find((entry) => entry.kind === "argumentName" && entry.label === "width");
    expect(candidate?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "幅。" },
      { locale: "en", markdown: "Width." }
    ]);
  });

  it("attaches docs to qualified Module exports", () => {
    const source = [...base, "instance Use = Pocket(width: 20)", "point Copy = offset(from: @Use.Pub, dx: 1, dy: 0)"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const position = source.lastIndexOf("Pub") + 3;
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position,
      semantic: snapshot
    });
    const candidate = result?.candidates.find((entry) => entry.label === "Public");
    expect(candidate?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "公開点。" },
      { locale: "en", markdown: "Public point." }
    ]);
  });

  it("does not project docs from a stale semantic snapshot", () => {
    const source = [...base, "instance Use = Poc"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const live = `${source}k`;
    const result = queryDslCompletion({
      source: { normalizedSource: live, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position: live.length,
      semantic: snapshot
    });
    expect(result?.candidates.some((entry) => entry.documentation) ?? false).toBe(false);
  });
});
