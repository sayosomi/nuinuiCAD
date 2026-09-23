import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentInspectInputError,
  inspectNuiDocument,
  type SourceRangeDto
} from "../src/documentSnapshot";

const temporaryDirectories: string[] = [];

const makeTempDocument = async (source: string, filename = "sample.nui") => {
  const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, filename);
  await writeFile(filePath, source, "utf8");
  return filePath;
};

const makeTempWorkspace = async (files: Readonly<Record<string, string>>) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-workspace-"));
  temporaryDirectories.push(directory);
  const paths = new Map<string, string>();
  for (const [filename, source] of Object.entries(files)) {
    const filePath = path.join(directory, filename);
    await writeFile(filePath, source, "utf8");
    paths.set(filename, filePath);
  }
  return paths;
};

const rangeText = (source: string, range: SourceRangeDto): string => {
  const normalized = source.replace(/\r\n/g, "\n");
  return range.segments
    .map((segment) => normalized.slice(segment.from.offset, segment.to.offset))
    .join("");
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("inspectNuiDocument", () => {
  it("returns a valid exact-current snapshot with compact declarations and elements", async () => {
    const filePath = await makeTempDocument([
      "nui 1",
      "const width: number = 10",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n"));

    const result = await inspectNuiDocument(filePath);

    expect(result.path).toBe(await import("node:fs/promises").then(({ realpath }) => realpath(filePath)));
    expect(result.sourceIdentity.algorithm).toBe("sha256");
    expect(result.sourceIdentity.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.compileStatus).toBe("valid");
    expect(result.currentSemantics).toEqual({ available: true, sourceRevision: expect.any(Number) });
    expect(result.summary.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "typedDeclaration", name: "width", bindingKind: "const" }),
      expect.objectContaining({ kind: "element", name: "A", category: "point", construction: "coordinate" })
    ]));
    expect(result.summary.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "A", type: "freePoint", activity: "visible" })
    ]));
  });

  it("keeps lint diagnostics separate and valid-only lint does not change compile status", async () => {
    const source = [
      "nui 1",
      "const unused: number = 1"
    ].join("\r\n");
    const filePath = await makeTempDocument(source);

    const result = await inspectNuiDocument(filePath);
    expect(result.compileStatus).toBe("valid");
    expect(result.diagnostics.compile).toEqual([]);
    expect(result.diagnostics.binding).toEqual([]);
    expect(result.diagnostics.lint).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unused-typed-declaration",
        sourceRevision: result.lifecycle.sourceRevision,
        range: expect.objectContaining({
          sourceRevision: result.lifecycle.sourceRevision,
          segments: [expect.objectContaining({
            from: expect.objectContaining({ line: 2 }),
            to: expect.objectContaining({ line: 2 })
          })]
        })
      })
    ]);
    expect(rangeText(source, result.diagnostics.lint[0]!.range!)).toBe("unused");
  });

  it("reports an unused imported alias through lint without changing compile status", async () => {
    const files = await makeTempWorkspace({
      "root.nui": [
        "nui 1",
        "import \"./library.nui\" as library"
      ].join("\n"),
      "library.nui": [
        "nui 1",
        "export module Pocket() {",
        "}"
      ].join("\n")
    });

    const result = await inspectNuiDocument(files.get("root.nui")!);
    expect(result.compileStatus).toBe("valid");
    expect(result.diagnostics.compile).toEqual([]);
    expect(result.diagnostics.lint).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unused-import",
        presentation: { key: "diagnostic.unused-import", parameters: { name: "library" } },
        range: expect.objectContaining({
          segments: [expect.objectContaining({
            from: expect.objectContaining({ line: 2 }),
            to: expect.objectContaining({ line: 2 })
          })]
        })
      })
    ]);
    expect(rangeText(
      await readFile(files.get("root.nui")!, "utf8"),
      result.diagnostics.lint[0]!.range!
    )).toBe("library");
  });

  it("does not report a valid direct imported Module use as unused", async () => {
    const files = await makeTempWorkspace({
      "root.nui": [
        "nui 1",
        "import \"./library.nui\" as library",
        "instance use = library::Pocket()"
      ].join("\n"),
      "library.nui": [
        "nui 1",
        "export module Pocket() {",
        "}"
      ].join("\n")
    });

    const result = await inspectNuiDocument(files.get("root.nui")!);
    expect(result.diagnostics.lint.some((diagnostic) => diagnostic.code === "unused-import")).toBe(false);
  });

  it("fails closed for a graph load failure without adding unused-import", async () => {
    const filePath = await makeTempDocument([
      "nui 1",
      "import \"./missing.nui\" as missing"
    ].join("\n"), "root.nui");

    const result = await inspectNuiDocument(filePath);
    expect(result.compileStatus).toBe("valid");
    expect(result.diagnostics.lint).toEqual([]);
  });

  it("leaves existing compile diagnostics unchanged when lint proof is unavailable", async () => {
    const filePath = await makeTempDocument([
      "nui 1",
      "const unused: number = 1",
      "this is not valid nui syntax"
    ].join("\n"));

    const result = await inspectNuiDocument(filePath);
    expect(result.compileStatus).toBe("fatal");
    expect(result.diagnostics.compile.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(result.diagnostics.lint).toEqual([]);
  });

  it("keeps element IDs stable while exact source identity is unchanged", async () => {
    const filePath = await makeTempDocument([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n"));

    const first = await inspectNuiDocument(filePath);
    const second = await inspectNuiDocument(filePath);

    expect(second.sourceIdentity).toEqual(first.sourceIdentity);
    expect(second.summary.elements.map((element) => element.id))
      .toEqual(first.summary.elements.map((element) => element.id));
  });

  it("keeps warning snapshots semantically available", async () => {
    const filePath = await makeTempDocument([
      "nui 1",
      "point UsesMissing = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n"));

    const result = await inspectNuiDocument(filePath);

    expect(result.compileStatus).toBe("warning");
    expect(result.currentSemantics.available).toBe(true);
    expect(result.diagnostics.compile).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("Missing") })
    ]));
    expect(result.summary.elements).toHaveLength(1);
  });

  it("fails closed on fatal current source instead of exposing last-good semantics", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "this is not valid nui syntax"
    ].join("\n");
    const filePath = await makeTempDocument(source);

    const result = await inspectNuiDocument(filePath);

    expect(result.compileStatus).toBe("fatal");
    expect(result.currentSemantics).toEqual({ available: false, sourceRevision: null });
    expect(result.diagnostics.compile.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(result.summary.elements).toEqual([]);
  });

  it("projects CRLF diagnostic ranges onto LF-normalized zero-based offsets", async () => {
    const source = [
      "nui 1",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\r\n");
    const filePath = await makeTempDocument(source);

    const result = await inspectNuiDocument(filePath);
    const diagnostic = result.diagnostics.compile.find((item) => item.code === "module-missing-argument");

    expect(diagnostic).toBeDefined();
    expect(diagnostic!.relatedInformation).toHaveLength(1);
    const related = diagnostic!.relatedInformation![0]!;
    expect(related.physicalSpan.segments).toHaveLength(1);
    expect(rangeText(source, related.range)).toBe("required");
    expect(related.range.segments[0]!.from.line).toBe(2);
    expect(related.range.segments[0]!.from.column).toBeGreaterThan(1);
    expect(related.range.segments[0]!.from.offset).toBeGreaterThan(0);
  });

  it("preserves structured related diagnostic information", async () => {
    const source = [
      "nui 1",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\n");
    const filePath = await makeTempDocument(source);

    const result = await inspectNuiDocument(filePath);
    const diagnostic = result.diagnostics.compile.find((item) => item.code === "module-missing-argument");

    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "module-missing-argument",
      relatedInformation: [{ message: expect.any(String) }]
    });
    expect(rangeText(source, diagnostic!.relatedInformation![0]!.range)).toBe("required");
  });

  it("changes source identity when file content changes between calls", async () => {
    const filePath = await makeTempDocument("nui 1\npoint A = coordinate(x: 0, y: 0)");
    const first = await inspectNuiDocument(filePath);

    await writeFile(filePath, "nui 1\npoint A = coordinate(x: 1, y: 0)", "utf8");
    const second = await inspectNuiDocument(filePath);

    expect(second.sourceIdentity.hash).not.toBe(first.sourceIdentity.hash);
  });

  it("rejects relative, missing, and non-.nui paths cleanly", async () => {
    await expect(inspectNuiDocument("relative.nui")).rejects.toBeInstanceOf(DocumentInspectInputError);
    await expect(inspectNuiDocument(path.join(tmpdir(), "definitely-missing-nuinuicad-file.nui")))
      .rejects.toThrow(/does not exist/);
    const otherFile = await makeTempDocument("nui 1", "sample.txt");
    await expect(inspectNuiDocument(otherFile)).rejects.toThrow(/only \.nui/);
  });
});
