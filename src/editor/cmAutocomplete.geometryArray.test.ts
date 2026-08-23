import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createDslCompletionSource } from "./cmAutocomplete";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `geometry-array-cm:${index}`]))
  });
};

describe("CodeMirror geometry-array completion", () => {
  it("keeps the source marker while displaying a bare geometry label", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segment(start: @A, end: @B)",
      "const paths: path[] = [@]"
    ].join("\n");
    const compiled = compileWithIds(source);
    const marker = source.lastIndexOf("@");
    const pos = marker + 1;
    const state = EditorState.create({ doc: source, selection: { anchor: pos } });
    const completionSource = createDslCompletionSource({
      elements: () => compiled.document?.elements ?? [],
      statementRanges: () => new Map(),
      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
      moduleSemanticMetadata: () => compiled,
      semanticSourceRevision: () => 0,
      semanticMetadataFresh: () => true
    });

    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).toMatchObject({ from: marker, to: pos });
    const option = result?.options.find((candidate) => candidate.label === "L");
    expect(option).toMatchObject({ label: "L", apply: "@L", type: "constant" });
    expect(typeof option?.apply).toBe("string");
    if (!result || typeof option?.apply !== "string") throw new Error("geometry completion must be applicable");

    const applied = source.slice(0, result.from) + option.apply + source.slice(result.to);
    expect(applied).toContain("const paths: path[] = [@L]");
  });
});
