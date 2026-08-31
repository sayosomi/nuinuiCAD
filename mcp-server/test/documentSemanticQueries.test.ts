import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { queryDslDefinition } from "../../src/dsl/dslDefinitionQuery";
import { queryDslReferences } from "../../src/dsl/dslReferencesQuery";
import {
  loadFreshNuiDocumentSnapshot,
  type SourceRangeDto
} from "../src/documentSnapshot";
import {
  queryNuiDocumentDefinition,
  queryNuiDocumentReferences
} from "../src/documentSemanticQueries";

const temporaryDirectories: string[] = [];

const makeTempDocument = async (source: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-semantic-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "sample.nui");
  await writeFile(filePath, source, "utf8");
  return filePath;
};

const normalizedSourceFor = (source: string) => source.replace(/\r\n/g, "\n");

const rangeText = (source: string, range: SourceRangeDto): string => {
  const normalized = normalizedSourceFor(source);
  return range.segments
    .map((segment) => normalized.slice(segment.from.offset, segment.to.offset))
    .join("");
};

const firstOffset = (range: SourceRangeDto) => range.segments[0]!.from.offset;

const semanticFor = (snapshot: Awaited<ReturnType<typeof loadFreshNuiDocumentSnapshot>>) => ({
  sourceRevision: snapshot.source.sourceRevision,
  sourceText: snapshot.source.normalizedSource,
  compiled: snapshot.currentCompiled
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("headless MCP semantic document queries", () => {
  it("projects Definition ranges from the shared exact-current query", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const filePath = await makeTempDocument(source);
    const position = source.indexOf("@A") + "@A".length;
    const snapshot = await loadFreshNuiDocumentSnapshot(filePath);
    const shared = queryDslDefinition({
      source: snapshot.source,
      position,
      semantic: semanticFor(snapshot)
    });

    const result = await queryNuiDocumentDefinition(filePath, position);

    expect(shared).not.toBeNull();
    expect(result.status).toBe("resolved");
    expect(result.indexing.offset).toContain("zero-based UTF-16");
    expect(rangeText(source, result.referenceRange!)).toBe("A");
    expect(rangeText(source, result.declarationRange!)).toBe("A");
    expect(firstOffset(result.referenceRange!)).toBe(shared!.referenceRange.from);
    expect(firstOffset(result.declarationRange!)).toBe(shared!.declarationRange.from);
  });

  it("returns explicit no-result for a valid snapshot position without a semantic target", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const filePath = await makeTempDocument(source);

    const result = await queryNuiDocumentDefinition(filePath, 1);

    expect(result).toMatchObject({ status: "no-result" });
    expect(result.referenceRange).toBeUndefined();
    expect(result.declarationRange).toBeUndefined();
  });

  it("fails closed with explicit unavailable status for fatal current source", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "this is not valid nui syntax"
    ].join("\n");
    const filePath = await makeTempDocument(source);

    const definition = await queryNuiDocumentDefinition(filePath, source.indexOf("A"));
    const references = await queryNuiDocumentReferences(filePath, source.indexOf("A"));

    expect(definition).toMatchObject({
      status: "unavailable",
      reason: "current-semantics-unavailable"
    });
    expect(references).toMatchObject({
      status: "unavailable",
      reason: "current-semantics-unavailable"
    });
  });

  it("preserves shared References source order and exact ranges", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "point C = offset(from: @A, dx: 2, dy: 0)"
    ].join("\n");
    const filePath = await makeTempDocument(source);
    const position = source.indexOf("point A") + "point ".length + 1;
    const snapshot = await loadFreshNuiDocumentSnapshot(filePath);
    const shared = queryDslReferences({
      source: snapshot.source,
      position,
      semantic: semanticFor(snapshot)
    });

    const result = await queryNuiDocumentReferences(filePath, position);

    expect(shared).not.toBeNull();
    expect(result.status).toBe("resolved");
    expect(rangeText(source, result.declarationRange!)).toBe("A");
    expect(result.referenceRanges?.map((range) => rangeText(source, range))).toEqual(["A", "A"]);
    expect(result.referenceRanges?.map(firstOffset)).toEqual(shared!.referenceRanges.map((range) => range.from));
    expect(result.referenceRanges?.map(firstOffset)).toEqual([
      source.indexOf("@A") + 1,
      source.lastIndexOf("@A") + 1
    ]);
  });

  it("keeps CRLF source coherent through normalized UTF-16 offsets", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\r\n");
    const normalized = normalizedSourceFor(source);
    const filePath = await makeTempDocument(source);
    const position = normalized.indexOf("@A") + "@A".length;

    const result = await queryNuiDocumentDefinition(filePath, position);

    expect(result.status).toBe("resolved");
    expect(rangeText(source, result.referenceRange!)).toBe("A");
    expect(result.referenceRange!.segments[0]!.from.offset).toBe(normalized.indexOf("@A") + 1);
    expect(result.referenceRange!.segments[0]!.from.line).toBe(3);
  });
});
