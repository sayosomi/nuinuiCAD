import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { parseDslSnapshot } from "./dslParser";
import { planDslRenameEditsResult } from "./dslRenameQuery";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

const applyEdits = (source: string, edits: readonly { from: number; to: number; newText: string }[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((text, edit) => `${text.slice(0, edit.from)}${edit.newText}${text.slice(edit.to)}`, source);

const source = [
  "nui 1",
  "module Pocket(width: number) {",
  "}",
  "module Consumer(width: number) {",
  "  instance child = Pocket(@width)",
  "}",
  "instance consumer = Consumer(width: 10)"
].join("\n");

describe("nested Module same-name argument shorthand", () => {
  it("treats Definition on shorthand as the caller-side outer parameter", () => {
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const shorthandStart = source.indexOf("@width", source.indexOf("instance child")) + 1;
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 0 },
      position: shorthandStart + 1,
      semantic: { sourceRevision: 0, sourceText: source, compiled }
    });

    expect(result).not.toBeNull();
    const consumerParameter = source.indexOf("width", source.indexOf("module Consumer"));
    expect(result!.declarationRange).toEqual({
      from: consumerParameter,
      to: consumerParameter + "width".length
    });
  });

  it("expands shorthand when the caller-side outer Module parameter is renamed", () => {
    const compiled = compileWithIds(source);
    const consumerParameter = source.indexOf("width", source.indexOf("module Consumer"));
    const result = planDslRenameEditsResult(
      {
        source: { normalizedSource: source, sourceRevision: 0 },
        semantic: { sourceRevision: 0, sourceText: source, compiled }
      },
      consumerParameter + 1,
      "outerWidth"
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const renamed = applyEdits(source, result.plan.edits);
    expect(renamed).toContain("module Consumer(outerWidth: number)");
    expect(renamed).toContain("Pocket(width: @outerWidth)");
    expect(renamed).toContain("Consumer(outerWidth: 10)");
  });
});