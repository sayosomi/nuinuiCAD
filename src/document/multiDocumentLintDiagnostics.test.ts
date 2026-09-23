import { describe, expect, it } from "vitest";
import {
  analyzeMultiDocumentLintDiagnostics,
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type MultiDocumentSavedSourceLoader,
  type RootCurrentSourceSnapshot,
  type SavedDependencyLoadResult
} from "@nuinuicad/nui-language/workspace";

const rootSource = (id: string, source: string, sourceRevision = 1): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
  normalizedSource: source,
  sourceRevision
});

const savedSource = (id: string, fingerprint: string, source: string): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost(id),
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint),
  normalizedSource: source
});

const loaderFrom = (
  table: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>
): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, relativePath) {
    const result = table.get(`${importerDocumentId}|${relativePath}`);
    if (!result) return { status: "failed", reason: "missing" };
    return "kind" in result ? { status: "loaded", snapshot: result } : result;
  }
});

const buildFixture = async (
  source: string,
  dependencies: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>,
  id = "lint-root"
) => {
  const root = rootSource(id, source, 2);
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: loaderFrom(dependencies),
    declarationContributors: [moduleDeclarationContributor]
  });
  return { root, graph, analysis: analyzeMultiDocumentModuleSemantics(graph) };
};

const library = (id = "lint-library") => savedSource(id, `sha256:${id}`, [
  "nui 1",
  "export module Pocket() {",
  "}"
].join("\n"));

const dependencyMap = (
  rootId: string,
  entries: Readonly<Record<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>>
) => new Map(Object.entries(entries).map(([relativePath, result]) => [`${rootId}|${relativePath}`, result] as const));

const lintFor = async (
  source: string,
  dependencies: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>,
  id = "lint-root"
) => {
  const fixture = await buildFixture(source, dependencies, id);
  return { ...fixture, diagnostics: analyzeMultiDocumentLintDiagnostics({ graph: fixture.graph, moduleAnalysis: fixture.analysis }) };
};

describe("multi-document unused-import lint diagnostics", () => {
  it("warns once for a resolved import with no semantic alias use and spans only the alias", async () => {
    const source = ["nui 1", "import \"./library.nui\" as library"].join("\n");
    const result = await lintFor(source, dependencyMap("lint-root", { "./library.nui": library() }));
    const aliasStart = source.lastIndexOf("library");

    expect(result.graph.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "warning",
      code: "unused-import",
      presentation: { key: "diagnostic.unused-import", parameters: { name: "library" } },
      location: {
        source: { kind: "root-current", documentId: "lint-root", sourceRevision: 2 },
        range: {
          from: aliasStart,
          to: aliasStart + "library".length
        }
      }
    });
  });

  it("suppresses the warning for a valid imported Module call at root and inside a Module body", async () => {
    const rootCall = await lintFor([
      "nui 1",
      "import \"./library.nui\" as library",
      "instance use = library::Pocket()"
    ].join("\n"), dependencyMap("lint-root", { "./library.nui": library() }));
    expect(rootCall.diagnostics).toEqual([]);

    const nestedCall = await lintFor([
      "nui 1",
      "import \"./library.nui\" as library",
      "module Outer() {",
      "  instance use = library::Pocket()",
      "}"
    ].join("\n"), dependencyMap("lint-root", { "./library.nui": library() }));
    expect(nestedCall.diagnostics).toEqual([]);
  });

  it("counts a valid re-export as use of only its exact local import", async () => {
    const source = [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Pocket"
    ].join("\n");
    const result = await lintFor(source, dependencyMap("lint-root", { "./library.nui": library() }));
    expect(result.diagnostics).toEqual([]);
  });

  it("warns only unused aliases when multiple imports are mixed", async () => {
    const source = [
      "nui 1",
      "import \"./used.nui\" as used",
      "import \"./unused.nui\" as unused",
      "instance use = used::Pocket()"
    ].join("\n");
    const result = await lintFor(source, dependencyMap("lint-root", {
      "./used.nui": library("lint-used"),
      "./unused.nui": library("lint-unused")
    }));
    expect(result.diagnostics.map((diagnostic) => diagnostic.presentation.parameters?.name)).toEqual(["unused"]);
  });

  it("keeps re-export-chain usage document-local and does not invent transitive use", async () => {
    const facade = savedSource("lint-facade", "sha256:lint-facade", [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Pocket"
    ].join("\n"));
    const source = ["nui 1", "import \"./facade.nui\" as facade"].join("\n");
    const result = await lintFor(source, new Map([
      [`lint-root|./facade.nui`, facade],
      [`lint-facade|./library.nui`, library()]
    ]));

    expect(result.diagnostics.map((diagnostic) => [diagnostic.location.source.documentId, diagnostic.presentation.parameters?.name])).toEqual([
      ["lint-root", "facade"]
    ]);
  });

  it("fails closed for missing, stale, cyclic, and invalid re-export proof", async () => {
    const missing = await lintFor(
      ["nui 1", "import \"./missing.nui\" as missing"].join("\n"),
      new Map()
    );
    expect(missing.graph.valid).toBe(false);
    expect(missing.diagnostics).toEqual([]);

    const unreadable = await lintFor(
      ["nui 1", "import \"./unreadable.nui\" as unreadable"].join("\n"),
      dependencyMap("lint-root", { "./unreadable.nui": { status: "failed", reason: "unreadable" } })
    );
    expect(unreadable.graph.valid).toBe(false);
    expect(unreadable.diagnostics).toEqual([]);

    const root = rootSource("lint-stale-root", [
      "nui 1",
      "import \"./a.nui\" as first",
      "import \"./b.nui\" as second"
    ].join("\n"));
    const staleGraph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./a.nui`, savedSource("same-library", "sha256:first", libraryText("First"))],
        [`${root.documentId}|./b.nui`, savedSource("same-library", "sha256:second", libraryText("Second"))]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });
    expect(staleGraph.valid).toBe(false);
    expect(analyzeMultiDocumentLintDiagnostics({ graph: staleGraph })).toEqual([]);

    const cycleRoot = rootSource("lint-cycle-root", ["nui 1", "import \"./cycle.nui\" as cycle"].join("\n"));
    const cycle = savedSource("lint-cycle", "sha256:cycle", ["nui 1", "import \"./root.nui\" as root"].join("\n"));
    const cycleGraph = await buildMultiDocumentImportGraph({
      root: cycleRoot,
      loader: loaderFrom(new Map([
        [`${cycleRoot.documentId}|./cycle.nui`, cycle],
        [`${cycle.documentId}|./root.nui`, savedSource("lint-cycle-root", "sha256:cycle-root", cycleRoot.normalizedSource)]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });
    expect(cycleGraph.valid).toBe(false);
    expect(analyzeMultiDocumentLintDiagnostics({ graph: cycleGraph })).toEqual([]);

    const invalidReExport = await lintFor([
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Missing"
    ].join("\n"), dependencyMap("lint-root", { "./library.nui": library() }));
    expect(invalidReExport.graph.valid).toBe(false);
    expect(invalidReExport.diagnostics).toEqual([]);

    const privateLibrary = savedSource("lint-private-library", "sha256:lint-private-library", [
      "nui 1",
      "module Private() {",
      "}"
    ].join("\n"));
    const privateReExport = await lintFor([
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Private"
    ].join("\n"), dependencyMap("lint-root", { "./library.nui": privateLibrary }));
    expect(privateReExport.graph.valid).toBe(false);
    expect(privateReExport.diagnostics).toEqual([]);

    const unresolvedMember = await lintFor([
      "nui 1",
      "import \"./library.nui\" as library",
      "instance use = library::Missing()"
    ].join("\n"), dependencyMap("lint-root", { "./library.nui": library() }));
    expect(unresolvedMember.graph.valid).toBe(true);
    expect(unresolvedMember.analysis.valid).toBe(false);
    expect(unresolvedMember.diagnostics).toEqual([]);
  });

  it("fails closed when the supplied semantic proof is invalid or stale", async () => {
    const source = ["nui 1", "import \"./library.nui\" as library"].join("\n");
    const fixture = await buildFixture(source, dependencyMap("lint-root", { "./library.nui": library() }));
    expect(analyzeMultiDocumentLintDiagnostics({
      graph: fixture.graph,
      moduleAnalysis: { ...fixture.analysis, valid: false }
    })).toEqual([]);
    expect(analyzeMultiDocumentLintDiagnostics({
      graph: fixture.graph,
      occurrenceIndex: {
        ...({ graph: fixture.graph, valid: false, sourceByDocument: new Map(), occurrences: [] })
      }
    })).toEqual([]);
  });
});

const libraryText = (name: string) => [
  "nui 1",
  `export module ${name}() {`,
  "}"
].join("\n");
