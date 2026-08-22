import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

const compileWithIds = (source: string, sourceRevision = 11): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `preview-target:${index}`]))
  });
};

const queryAt = (
  source: string,
  needle: string,
  sourceRevision = 11,
  compiled = compileWithIds(source, sourceRevision),
  needleOffset = Math.max(1, needle.length - 1)
) => queryModulePreviewTarget({
  source: { normalizedSource: source, sourceRevision },
  position: source.indexOf(needle) + needleOffset,
  semantic: { sourceRevision, compiled }
});

describe("queryModulePreviewTarget", () => {
  it("resolves a top-level Module from its header, body, and closing block line", () => {
    const source = [
      "nui 4",
      "module Pocket(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "point Outside = coordinate(x: 0, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);

    const header = queryAt(source, "Pocket", 11, compiled);
    const body = queryAt(source, "point P", 11, compiled);
    const close = queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision: 11 },
      position: source.indexOf("}\npoint Outside"),
      semantic: { sourceRevision: 11, compiled }
    });

    expect(header?.name).toBe("Pocket");
    expect(body?.definitionStatementId).toBe(header?.definitionStatementId);
    expect(close?.definitionStatementId).toBe(header?.definitionStatementId);
    expect(queryAt(source, "Outside", 11, compiled)).toBeNull();
  });

  it("selects the innermost enclosing Module for nested definitions", () => {
    const source = [
      "nui 4",
      "module Outer(scale: number) {",
      "  module Inner(width: number) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
      "  point Q = coordinate(x: @scale, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);

    expect(queryAt(source, "point P", 11, compiled)?.name).toBe("Inner");
    expect(queryAt(source, "point Q", 11, compiled)?.name).toBe("Outer");
    expect(queryAt(source, "Inner", 11, compiled)?.name).toBe("Inner");
  });

  it("fails closed for stale revisions and same-revision source mismatches", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source, 3);
    const liveSource = source.replace("point P", "point Renamed");

    expect(queryModulePreviewTarget({
      source: { normalizedSource: liveSource, sourceRevision: 4 },
      position: liveSource.indexOf("Renamed") + 1,
      semantic: { sourceRevision: 3, compiled }
    })).toBeNull();
    expect(queryModulePreviewTarget({
      source: { normalizedSource: liveSource, sourceRevision: 3 },
      position: liveSource.indexOf("Renamed") + 1,
      semantic: { sourceRevision: 3, compiled }
    })).toBeNull();
  });

  it("can target a safe Module statement when an unrelated root error prevents a full document", () => {
    const source = [
      "nui 4",
      "module Safe(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "point Broken = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);

    expect(compiled.document).toBeNull();
    expect(queryAt(source, "point P", 11, compiled)?.name).toBe("Safe");
  });
});
