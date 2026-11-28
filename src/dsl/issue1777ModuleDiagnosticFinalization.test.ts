import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createModuleRuntimeContext
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  SavedDocumentArtifactCache,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";

const rootDocumentId = documentIdFromHost("file:///workspace/issue1777/main.nui");
const librarySource = [
  "nui 1",
  "",
  "export module Sample() {",
  "  export line Side = segment(",
  "    start: (0, 0),",
  "    end: (10, 10),",
  "  )",
  "}"
].join("\n");

const mainSource = (
  origin: "A::P" | "Q",
  exportName: "Side" | "Missing" = "Side",
  importPath = "./mini_lib.nui"
) => [
  "nui 1",
  "",
  `import "${importPath}" as lib`,
  "",
  "instance M = lib::Sample()",
  "",
  `line Preview = segment(start: M::${exportName}.start, end: (30, 10))`,
  "",
  "point Q = coordinate(x: 10, y: 0)",
  "",
  "group A {",
  "  point P = coordinate(x: 0, y: 0)",
  "}",
  "",
  "layout Layout {",
  `  place A(origin: ${origin}, at: (0, 0))`,
  "}"
].join("\n");

type GraphCompileOptions = {
  dependencyFileName?: string;
  dependencySource?: string;
  dependencyMode?: "loaded" | "missing" | "cycle";
  expectValidGraph?: boolean;
};

const compileGraphRoot = async (source: string, revision: number, options: GraphCompileOptions = {}) => {
  const dependencyFileName = options.dependencyFileName ?? "mini_lib.nui";
  const dependencyDocumentId = documentIdFromHost(`file:///workspace/issue1777/${dependencyFileName}`);
  const dependencySource = options.dependencySource ?? librarySource;
  const dependencyMode = options.dependencyMode ?? "loaded";
  const root: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: rootDocumentId,
    normalizedSource: source,
    sourceRevision: revision
  };
  const library: DependencySavedSourceSnapshot = {
    kind: "dependency-saved",
    documentId: dependencyDocumentId,
    normalizedSource: dependencySource,
    savedSourceFingerprint: savedSourceFingerprintFromHost(`sha256:issue-1777-${dependencyFileName}-${dependencySource}`)
  };
  const rootAsSavedDependency: DependencySavedSourceSnapshot = {
    kind: "dependency-saved",
    documentId: rootDocumentId,
    normalizedSource: source,
    savedSourceFingerprint: savedSourceFingerprintFromHost(`sha256:issue-1777-cycle-root-${revision}`)
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    cache: new SavedDocumentArtifactCache(),
    declarationContributors: [moduleDeclarationContributor],
    loader: {
      async loadSavedDependency(_importerDocumentId, path) {
        if (dependencyMode === "cycle" && path === "./main.nui") {
          return { status: "loaded" as const, snapshot: rootAsSavedDependency };
        }
        if (path !== `./${dependencyFileName}` || dependencyMode === "missing") {
          return { status: "failed" as const, reason: "missing" as const };
        }
        return { status: "loaded" as const, snapshot: library };
      }
    }
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(rootDocumentId);
  expect(rootNode).toBeDefined();
  if (!rootNode) throw new Error("missing Issue #1777 graph root");
  expect(graph.rootSource).toEqual(root);
  expect(rootNode.artifact.source).toBe(root);
  expect(rootNode.artifact.parsed.sourceRevision).toBe(revision);
  expect(rootNode.artifact.parsed.sourceMap.source).toBe(source);
  expect(rootNode.artifact.statementIdByStatementIndex.size).toBeGreaterThan(0);
  const dependencyNode = graph.nodes.get(dependencyDocumentId);
  if (dependencyNode) expect(dependencyNode.artifact.source).toEqual(library);
  if (options.expectValidGraph !== false) {
    expect(graph.valid).toBe(true);
    expect(analysis.valid).toBe(true);
    expect(context.valid).toBe(true);
  }

  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: revision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return { compiled, graph, rootNode, analysis, context, library };
};

const diagnosticsFor = (compiled: Awaited<ReturnType<typeof compileGraphRoot>>["compiled"]) =>
  compiled.diagnostics.map(({ code, severity, line }) => ({ code, severity, line }));

describe("Issue #1777 Module diagnostic finalization", () => {
  it("A1 keeps the exact-current imported export valid", async () => {
    const { compiled } = await compileGraphRoot(mainSource("A::P"), 25);

    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics).toEqual([]);
  });

  it("A2 finalizes the independent place error without a traversal false positive", async () => {
    const { compiled } = await compileGraphRoot(mainSource("Q"), 26);

    expect(compiled.document).toBeNull();
    expect(diagnosticsFor(compiled)).toEqual([{
      code: "place-origin-outside-target-group",
      severity: "error",
      line: 16
    }]);
  });

  it("A3 preserves a genuine undefined imported export", async () => {
    const { compiled } = await compileGraphRoot(mainSource("A::P", "Missing"), 27);

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-export", severity: "error", line: 7 })
    ]));
  });

  it("A4 finalizes both the undefined export and the independent place error", async () => {
    const { compiled } = await compileGraphRoot(mainSource("Q", "Missing"), 28);

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-undefined-export", severity: "error", line: 7 }),
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 16 })
    ]));
  });

  it("recovers from A2 to A1 with a new exact-current revision and no stale diagnostics", async () => {
    const invalid = await compileGraphRoot(mainSource("Q"), 29);
    expect(invalid.compiled.document).toBeNull();
    expect(invalid.compiled.diagnostics.map(({ code }) => code)).not.toContain("source-reference-invalid-traversal");

    const recovered = await compileGraphRoot(mainSource("A::P"), 30);
    expect(recovered.graph.rootSource.sourceRevision).toBe(30);
    expect(recovered.compiled.document).not.toBeNull();
    expect(recovered.compiled.diagnostics).toEqual([]);
  });

  it("does not defer a place error without a Module", () => {
    const source = [
      "nui 1",
      "point Q = coordinate(x: 10, y: 0)",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "layout Layout {",
      "  place A(origin: Q, at: (0, 0))",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 1 });

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 7 })
    ]));
    expect(compiled.moduleRuntimeContext).toBeUndefined();
  });

  it("keeps non-exported geometry and the independent place error fatal", async () => {
    const privateLibrary = librarySource.replace("  export line Side", "  line Side");
    const { compiled } = await compileGraphRoot(mainSource("Q"), 31, { dependencySource: privateLibrary });

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-private-member", severity: "error", line: 7 }),
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 16 })
    ]));
  });

  it.each([
    { name: "missing dependency", mode: "missing" as const, graphCode: "import-missing" },
    {
      name: "invalid dependency",
      mode: "loaded" as const,
      dependencySource: "nui 2\nexport module Sample() {}",
      graphCode: "import-invalid-source"
    },
    {
      name: "cyclic dependency",
      mode: "cycle" as const,
      dependencySource: [
        "nui 1",
        'import "./main.nui" as root',
        "export module Sample() {",
        "  export line Side = segment(start: (0, 0), end: (10, 10))",
        "}"
      ].join("\n"),
      graphCode: "import-cycle"
    }
  ])("fails closed for a $name", async ({ mode, dependencySource, graphCode }) => {
    const result = await compileGraphRoot(mainSource("Q"), 32, {
      dependencyMode: mode,
      dependencySource,
      expectValidGraph: false
    });

    expect(result.graph.valid).toBe(false);
    expect(result.context.valid).toBe(false);
    expect(result.graph.diagnostics.map(({ code }) => code)).toContain(graphCode);
    expect(result.compiled.document).toBeNull();
    expect(result.compiled.moduleRuntimeContext).toBeUndefined();
    expect(result.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 16 })
    ]));
  });

  it("keeps duplicate declarations and malformed syntax in the early fatal path", async () => {
    const duplicateSource = `${mainSource("Q")}\npoint Q = coordinate(x: 20, y: 0)`;
    const duplicate = await compileGraphRoot(duplicateSource, 33, { expectValidGraph: false });
    expect(duplicate.compiled.document).toBeNull();
    expect(duplicate.compiled.moduleRuntimeContext).toBeUndefined();
    expect(duplicate.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-element-name", severity: "error" })
    ]));

    const malformedSource = `${mainSource("Q")}\npoint Broken = coordinate(x: 0, y: 1`;
    const malformed = await compileGraphRoot(malformedSource, 34, { expectValidGraph: false });
    expect(malformed.compiled.document).toBeNull();
    expect(malformed.compiled.moduleRuntimeContext).toBeUndefined();
    expect(malformed.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unclosed-call", severity: "error", line: 18 })
    ]));

    const coexistingSource = `${mainSource("Q")}\nconst pi: number = 1`;
    const coexisting = await compileGraphRoot(coexistingSource, 43, { expectValidGraph: false });
    expect(coexisting.compiled.document).toBeNull();
    expect(coexisting.compiled.moduleRuntimeContext).toBeUndefined();
    expect(coexisting.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "reserved-builtin-constant-name", severity: "error" }),
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error" })
    ]));
  });

  it("rejects stale source and mismatched statement identity contexts", async () => {
    const current = await compileGraphRoot(mainSource("A::P"), 35);
    const staleSource = mainSource("Q");
    const stale = compileDslDocument(staleSource, {
      sourceRevision: 36,
      assignedStatementIds: current.rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: current.context
    });
    expect(stale.document).toBeNull();
    expect(stale.moduleRuntimeContext).toBeUndefined();
    expect(stale.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 16 })
    ]));

    const currentInvalid = await compileGraphRoot(staleSource, 37);
    const mismatchedIds = new Map(currentInvalid.rootNode.artifact.statementIdByStatementIndex);
    const placeIndex = currentInvalid.rootNode.artifact.parsed.statements.findIndex((statement) => statement.kind === "place");
    mismatchedIds.set(placeIndex, "stale-place-statement-identity");
    const mismatched = compileDslDocument(staleSource, {
      preparsed: currentInvalid.rootNode.artifact.parsed,
      sourceRevision: 37,
      assignedStatementIds: mismatchedIds,
      moduleRuntimeContext: currentInvalid.context
    });
    expect(mismatched.document).toBeNull();
    expect(mismatched.moduleRuntimeContext).toBeUndefined();
    expect(mismatched.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "place-origin-outside-target-group", severity: "error", line: 16 })
    ]));
  });

  it("preserves the existing blank-attribute draft carve-out", () => {
    const draftSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line = segment(",
      "  start: A,",
      "  end: ",
      ")"
    ].join("\n");
    const compiled = compileDslDocument(draftSource, { sourceRevision: 38 });

    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    ]));
  });

  it("uses the Stage 1 mirrorCopy shape with valid and invalid place origins", async () => {
    const mirrorSource = (origin: "A::P" | "Q") => [
      "nui 1",
      'import "./mini_lib.nui" as lib',
      "instance M = lib::Sample()",
      "line Base = segment(start: M::Side.start, end: M::Side.end)",
      "line Mirrored = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "point Q = coordinate(x: 10, y: 0)",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "group B {",
      "  point R = coordinate(x: 20, y: 0)",
      "}",
      "layout Layout {",
      `  place A(origin: ${origin}, at: (0, 0))`,
      "}"
    ].join("\n");

    const valid = await compileGraphRoot(mirrorSource("A::P"), 39);
    expect(valid.compiled.document).not.toBeNull();
    expect(valid.compiled.diagnostics).toEqual([]);

    const invalid = await compileGraphRoot(mirrorSource("Q"), 40);
    expect(invalid.compiled.document).toBeNull();
    expect(diagnosticsFor(invalid.compiled)).toEqual([{
      code: "place-origin-outside-target-group",
      severity: "error",
      line: 14
    }]);
  });

  it("uses the #1670 short imported export edge fixture with valid and invalid origins", async () => {
    const edgeLibrary = [
      "nui 1",
      "",
      "export module ExportLine() {",
      "  export line side = segment(",
      "    start: (0, 0),",
      "    end: (10, 0),",
      "  )",
      "}"
    ].join("\n");
    const edgeSource = (origin: "A::P" | "Q") => [
      "nui 1",
      'import "./edge_export_lib.nui" as lib',
      "",
      "point unrelated = coordinate(x: 100, y: 100)",
      "",
      "line bottom = segment(",
      "  start: (5, -10),",
      "  end: (5, 10),",
      ")",
      "",
      "instance concave_notch = lib::ExportLine()",
      "",
      "edge [",
      "  concave_notch::side.end,",
      "  bottom.start",
      "](index: 0)",
      "point Q = coordinate(x: 10, y: 0)",
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "layout Layout {",
      `  place A(origin: ${origin}, at: (0, 0))`,
      "}"
    ].join("\n");

    const valid = await compileGraphRoot(edgeSource("A::P"), 41, {
      dependencyFileName: "edge_export_lib.nui",
      dependencySource: edgeLibrary
    });
    expect(valid.compiled.document).not.toBeNull();
    expect(valid.compiled.diagnostics).toEqual([]);

    const invalid = await compileGraphRoot(edgeSource("Q"), 42, {
      dependencyFileName: "edge_export_lib.nui",
      dependencySource: edgeLibrary
    });
    expect(invalid.compiled.document).toBeNull();
    expect(diagnosticsFor(invalid.compiled)).toEqual([{
      code: "place-origin-outside-target-group",
      severity: "error",
      line: 22
    }]);
  });
});
