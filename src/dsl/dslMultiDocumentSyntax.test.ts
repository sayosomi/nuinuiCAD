import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl, parseDslSnapshot } from "./dslParser";
import type { DslStatement } from "./dslTypes";

const errorCodes = (source: string) =>
  parseDsl(source).diagnostics.filter((item) => item.severity === "error").map((item) => item.code);

const importStatement = (statements: readonly DslStatement[]) =>
  statements.find((statement): statement is Extract<DslStatement, { kind: "import" }> => statement.kind === "import");

const reExportStatement = (statements: readonly DslStatement[]) =>
  statements.find((statement): statement is Extract<DslStatement, { kind: "fileReExport" }> => statement.kind === "fileReExport");

describe("nui1 multi-document source syntax", () => {
  it("parses relative imports with explicit aliases and preserves source order", () => {
    const source = [
      "nui 1",
      "const Before: number = 1",
      "import \"./library/basic.nui\" as basic",
      "const After: number = 2",
      "import '../shared/common.nui' as \"共有 名前\""
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "version",
      "typedDeclaration",
      "import",
      "typedDeclaration",
      "import"
    ]);
    expect(parsed.statements.map((statement) => statement.line)).toEqual([1, 2, 3, 4, 5]);
    expect(importStatement(parsed.statements)).toMatchObject({
      kind: "import",
      importPath: "./library/basic.nui",
      alias: "basic",
      name: "basic"
    });
    expect(parsed.statements[4]).toMatchObject({
      kind: "import",
      importPath: "../shared/common.nui",
      alias: "共有 名前"
    });
  });

  it("keeps exact path/alias physical spans on the current source snapshot", () => {
    const source = "nui 1\nimport \"./library/basic.nui\" as basic";
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 17 });
    const statement = importStatement(parsed.statements)!;

    expect(statement.sourceRevision).toBe(17);
    expect(statement.payloadPhysicalSpans?.path).toBeTruthy();
    expect(statement.payloadPhysicalSpans?.alias).toBeTruthy();
    const pathSegment = statement.payloadPhysicalSpans!.path!.segments[0]!;
    const aliasSegment = statement.payloadPhysicalSpans!.alias!.segments[0]!;
    expect(source.slice(pathSegment.from, pathSegment.to)).toBe("\"./library/basic.nui\"");
    expect(source.slice(aliasSegment.from, aliasSegment.to)).toBe("basic");
  });

  it("rejects non-relative paths, missing .nui extensions, and implicit aliases", () => {
    expect(errorCodes("nui 1\nimport \"/tmp/basic.nui\" as basic")).toContain("invalid-import-path");
    expect(errorCodes("nui 1\nimport \"basic.nui\" as basic")).toContain("invalid-import-path");
    expect(errorCodes("nui 1\nimport \"./basic\" as basic")).toContain("invalid-import-path");
    expect(errorCodes("nui 1\nimport \"./basic.nui\"")).toContain("missing-import-alias");
  });

  it("parses generic file re-exports as exactly one imported public name", () => {
    const source = [
      "nui 1",
      "import \"./common.nui\" as common",
      "export @common::Pocket"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(reExportStatement(parsed.statements)).toMatchObject({
      kind: "fileReExport",
      targetReference: "@common::Pocket",
      importAlias: "common",
      exportedName: "Pocket",
      name: "Pocket"
    });
  });

  it("rejects absolute, unqualified, nested, and property re-export targets", () => {
    expect(errorCodes("nui 1\nexport @Pocket")).toContain("invalid-file-reexport");
    expect(errorCodes("nui 1\nexport @::common::Pocket")).toContain("invalid-file-reexport");
    expect(errorCodes("nui 1\nexport @common::Pocket::Inner")).toContain("invalid-file-reexport");
    expect(errorCodes("nui 1\nexport @common::Pocket.length")).toContain("invalid-file-reexport");
  });

  it("requires import and file re-export declarations to stay at top level", () => {
    const parsed = parseDsl([
      "nui 1",
      "group G {",
      "  import \"./common.nui\" as common",
      "  export @common::Pocket",
      "}"
    ].join("\n"));

    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "import-top-level-only", line: 3 }),
      expect.objectContaining({ code: "file-reexport-top-level-only", line: 4 })
    ]));
  });

  it("keeps source-only multi-document declarations out of existing runtime elements", () => {
    const source = [
      "nui 1",
      "import \"./common.nui\" as common",
      "export @common::Pocket",
      "point A = coordinate(x: 1, y: 2)"
    ].join("\n");
    const compiled = compileDslDocument(source);

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements).toHaveLength(1);
    expect(compiled.document?.elements[0]).toMatchObject({ name: "A", type: "freePoint" });
  });
});
