import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createModuleRuntimeContext,
  moduleSemanticIdentityKey,
  parseDslSnapshot,
  sourceModuleTemplateCandidates
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor,
  buildMultiDocumentImportGraph,
  type DependencySavedSourceSnapshot,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult,
  type RootCurrentSourceSnapshot,
  documentIdFromHost,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";

const compileLocal = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: 1,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `source-module-local:${index}`]))
  });
};

const sourceLocationAt = (compiled: ReturnType<typeof compileLocal>, statementIndex: number, scopeId?: string) => ({
  statementIndex,
  ...(scopeId ? { scopeId } : {}),
  sourceOrderIndex: statementIndex
});

const rootSnapshot = (source: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost("source-module-template-root"),
  normalizedSource: source,
  sourceRevision: 1
});

const savedSnapshot = (source: string): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost("source-module-template-library"),
  savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:source-module-template-library"),
  normalizedSource: source
});

const importedCompiled = async (source: string, librarySource: string) => {
  const root = rootSnapshot(source);
  const library = savedSnapshot(librarySource);
  const loader: MultiDocumentSavedSourceLoader = {
    async loadSavedDependency(importerDocumentId, validatedRelativePath): Promise<SavedDependencyLoadResult> {
      return importerDocumentId === root.documentId && validatedRelativePath === "./library.nui"
        ? { status: "loaded", snapshot: library }
        : { status: "failed", reason: "missing" };
    }
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader,
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(root.documentId);
  if (!rootNode) throw new Error("missing graph root");
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return compiled;
};

describe("Source Module Template semantic candidates", () => {
  it("returns visible local Modules with their canonical identity and parameter metadata", () => {
    const source = [
      "nui 1",
      "module Wrapper() {",
      "  module Inner(value: number, optional: string?, count: number = 2) {",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileLocal(source);
    const wrapperIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleDefinition" && statement.name === "Wrapper");
    const wrapperId = compiled.statementMap?.statementIdByStatementIndex?.get(wrapperIndex);

    const candidates = sourceModuleTemplateCandidates({
      compiled,
      insertion: sourceLocationAt(compiled, wrapperIndex, wrapperId ? `module:${wrapperId}` : undefined)
    });

    expect(candidates.map(({ sourceCallee }) => sourceCallee)).toEqual(["Inner"]);
    expect(candidates[0]).toMatchObject({
      identity: "source-module-local:2",
      sourceCallee: "Inner",
      parameters: [
        { name: "value", parameterIndex: 0, required: true, optional: false, defaultValue: null },
        { name: "optional", parameterIndex: 1, required: false, optional: true, defaultValue: null },
        { name: "count", parameterIndex: 2, required: false, optional: false, defaultValue: "2" }
      ]
    });
  });

  it("returns imported public Modules with alias-qualified source spelling and identity", async () => {
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel(value: number, side: string?, count: number = 2) {",
      "}"
    ].join("\n");
    const compiled = await importedCompiled(rootSource, librarySource);
    const importIndex = compiled.statements.findIndex((statement) => statement.kind === "import");
    const candidates = sourceModuleTemplateCandidates({
      compiled,
      insertion: sourceLocationAt(compiled, importIndex)
    });
    const candidate = candidates.find(({ sourceCallee }) => sourceCallee === "lib::Panel");
    const libraryId = documentIdFromHost("source-module-template-library");
    const definitionId = compiled.moduleRuntimeContext?.graph.nodes.get(libraryId)?.artifact.statementIdByStatementIndex.get(1);

    expect(candidate).toBeDefined();
    expect(candidate?.identity).toBe(moduleSemanticIdentityKey({
      documentId: libraryId,
      localIdentity: definitionId!
    }));
    expect(candidate?.definitionIdentity).toEqual({ documentId: libraryId, localIdentity: definitionId });
    expect(candidate?.sourceCallee).toBe("lib::Panel");
    expect(candidate?.parameters.map(({ name, required, optional, defaultValue }) => ({ name, required, optional, defaultValue })))
      .toEqual([
        { name: "value", required: true, optional: false, defaultValue: null },
        { name: "side", required: false, optional: true, defaultValue: null },
        { name: "count", required: false, optional: false, defaultValue: "2" }
      ]);
  });

  it("returns no candidates where the captured Module body has no legal callee", () => {
    const source = [
      "nui 1",
      "module Wrapper() {",
      "}"
    ].join("\n");
    const compiled = compileLocal(source);
    const wrapperIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleDefinition");
    const wrapperId = compiled.statementMap?.statementIdByStatementIndex?.get(wrapperIndex);

    expect(sourceModuleTemplateCandidates({
      compiled,
      insertion: sourceLocationAt(compiled, wrapperIndex, wrapperId ? `module:${wrapperId}` : undefined)
    })).toEqual([]);
  });
});
