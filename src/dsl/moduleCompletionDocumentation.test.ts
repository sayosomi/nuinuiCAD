import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { moduleCompletionCandidates } from "./moduleCompletionCandidates";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `completion-doc:${index}`] as const))
  });
};

const source = [
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
  "}",
  "instance Use = Pocket(width: 20)",
  "point Copy = offset(from: @Use.Public, dx: 1, dy: 0)"
].join("\n");

describe("Module completion documentation metadata", () => {
  it("attaches authored docs to Module callees and parameter labels", () => {
    const compiled = compileSource(source);
    const instanceIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const instance = compiled.statements[instanceIndex];
    if (!instance || instance.kind !== "moduleInstance") throw new Error("instance missing");

    const callee = moduleCompletionCandidates({
      compiled,
      cursorPosition: instance.documentRange.from,
      statementIndex: instanceIndex,
      kind: "callee",
      sourceText: source
    }).find((candidate) => candidate.label === "Pocket");
    expect(callee?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "ポケット。" },
      { locale: "en", markdown: "Pocket." }
    ]);

    const label = moduleCompletionCandidates({
      compiled,
      cursorPosition: instance.documentRange.from,
      statementIndex: instanceIndex,
      kind: "label",
      sourceText: source,
      liveStatementText: "instance Use = Pocket(",
      logicalCursorPosition: "instance Use = Pocket(".length,
      usedArgumentNames: new Set()
    }).find((candidate) => candidate.kind === "argumentName" && candidate.label === "width");
    expect(label?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "幅。" },
      { locale: "en", markdown: "Width." }
    ]);
  });

  it("attaches export docs to qualified member candidates", () => {
    const compiled = compileSource(source);
    const copyIndex = compiled.statements.findIndex((statement) => statement.name === "Copy");
    const copy = compiled.statements[copyIndex];
    if (!copy) throw new Error("copy missing");
    const logical = compiled.spans.sourceMap.statements.find((statement) => statement.range.from === copy.documentRange.from);
    if (!logical) throw new Error("logical source missing");
    const token = "@Use.Public";
    const start = logical.logicalText.indexOf(token);

    const member = moduleCompletionCandidates({
      compiled,
      cursorPosition: copy.documentRange.from,
      statementIndex: copyIndex,
      kind: "qualifiedMember",
      sourceText: source,
      liveStatementText: logical.logicalText,
      logicalCursorPosition: start + token.length,
      qualifiedInstanceName: "Use"
    }).find((candidate) => candidate.label === "Public");

    expect(member?.documentation?.variants).toEqual([
      { locale: "ja", markdown: "公開点。" },
      { locale: "en", markdown: "Public point." }
    ]);
  });

  it("keeps last-good completion candidates but omits stale documentation", () => {
    const compiled = compileSource(source);
    const instanceIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const instance = compiled.statements[instanceIndex];
    if (!instance || instance.kind !== "moduleInstance") throw new Error("instance missing");

    const candidate = moduleCompletionCandidates({
      compiled,
      cursorPosition: instance.documentRange.from,
      statementIndex: instanceIndex,
      kind: "callee",
      sourceText: `${source}\n// dirty live source`
    }).find((entry) => entry.label === "Pocket");

    expect(candidate?.label).toBe("Pocket");
    expect(candidate?.documentation).toBeUndefined();
  });
});
