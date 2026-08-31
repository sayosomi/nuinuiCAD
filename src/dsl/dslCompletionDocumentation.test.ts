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
  "nui 1",
  "/// @ja",
  "/// ポケット。",
  "/// @en",
  "/// Pocket.",
  "module Pocket(",
  "  /// @ja",
  "  /// 幅。",
  "  /// @en",
  "  /// Width.",
  "  width: number = 10",
  ") {",
  "  /// @ja",
  "  /// 公開点。",
  "  /// @en",
  "  /// Public point.",
  "  export point Public = coordinate(x: 0, y: 0)",
  "}"
];

describe("DSL completion Module documentation metadata", () => {
  it("attaches docs to Module callees from exact-current semantics", () => {
    const source = [...base, "instance Use = Pocket()"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const position = source.lastIndexOf("Pocket") + 3;
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position,
      semantic: snapshot
    });
    const candidate = result?.candidates.find((entry) => entry.kind === "module" && entry.label === "Pocket");
    expect(candidate?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "ポケット。" },
      { locale: "en", markdown: "Pocket." }
    ]);
  });

  it("attaches docs to explicit Module argument labels from exact-current semantics", () => {
    const source = [...base, "instance Use = Pocket()"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const position = source.lastIndexOf("Pocket(") + "Pocket(".length;
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position,
      semantic: snapshot
    });
    const candidate = result?.candidates.find((entry) => entry.kind === "argumentName" && entry.label === "width");
    expect(candidate?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "幅。" },
      { locale: "en", markdown: "Width." }
    ]);
  });

  it("attaches docs to qualified Module exports from exact-current semantics", () => {
    const source = [...base, "instance Use = Pocket()", "point Copy = offset(from: @Use::Public, dx: 1, dy: 0)"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const position = source.lastIndexOf("Public") + 3;
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
    const source = [...base, "instance Use = Pocket()"].join("\n");
    const { compiled, snapshot } = semanticFor(source);
    const live = `${source} // live edit`;
    const position = source.lastIndexOf("Pocket") + 3;
    const result = queryDslCompletion({
      source: { normalizedSource: live, sourceRevision: compiled.spans.sourceMap.sourceRevision },
      position,
      semantic: snapshot
    });
    expect(result?.candidates.some((entry) => entry.documentation) ?? false).toBe(false);
  });
});
