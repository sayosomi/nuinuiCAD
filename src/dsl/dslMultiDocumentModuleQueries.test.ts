import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslCompletion, type DslCompletionQueryResult } from "./dslCompletionQuery";
import { queryDslSignatureHelp, type DslSignatureHelpQueryResult } from "./dslSignatureHelpQuery";
import { parseDslSnapshot } from "./dslParser";
import { createModuleRuntimeContext } from "./moduleRuntimeContext";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "../document/multiDocumentModuleSemantics";
import {
  buildMultiDocumentImportGraph,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "../document/multiDocumentImportGraph";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "../document/multiDocumentPrimitives";
import { moduleSemanticIdentityKey } from "./moduleSemanticTypes";

const rootSource = (source: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost("query-root"),
  normalizedSource: source,
  sourceRevision: 1
});

const savedSource = (
  id: string,
  fingerprint: string,
  source: string
): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost(id),
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint),
  normalizedSource: source
});

const loaderFrom = (
  entries: ReadonlyMap<string, DependencySavedSourceSnapshot>
): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, validatedRelativePath): Promise<SavedDependencyLoadResult> {
    const snapshot = entries.get(`${importerDocumentId}|${validatedRelativePath}`);
    return snapshot ? { status: "loaded", snapshot } : { status: "failed", reason: "missing" };
  }
});

const compileImported = async (
  source: string,
  dependencies: ReadonlyMap<string, DependencySavedSourceSnapshot>
) => {
  const root = rootSource(source);
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: loaderFrom(dependencies),
    declarationContributors: [moduleDeclarationContributor]
  });
  const semantics = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, semantics);
  const rootNode = graph.nodes.get(root.documentId)!;
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return { compiled, context };
};

const compileLocal = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: 1,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `query-local:${index}`]))
  });
};

const completionAt = (
  source: string,
  compiled: ReturnType<typeof compileDslDocument>,
  marker: string,
  offset = marker.length
): DslCompletionQueryResult | null => {
  const position = source.indexOf(marker) + offset;
  return queryDslCompletion({
    source: { normalizedSource: source, sourceRevision: 1 },
    position,
    semantic: { sourceRevision: 1, compiled }
  });
};

const signatureAt = (
  source: string,
  compiled: ReturnType<typeof compileDslDocument>,
  marker: string,
  offset = marker.length
): DslSignatureHelpQueryResult | null => {
  const position = source.indexOf(marker) + offset;
  return queryDslSignatureHelp({
    source: { normalizedSource: source, sourceRevision: 1 },
    position,
    semantic: {
      sourceRevision: 1,
      sourceText: source,
      compiled
    }
  });
};

const panelSource = [
  "nui 1",
  "export module Panel(value: number, side?: choice(left, right), count: number = 2) {",
  "  export point Public = coordinate(x: @value, y: 0)",
  "  export const amount: number = @value",
  "}"
].join("\n");

const directRoot = (callee: string) => [
  "nui 1",
  "import \"./library.nui\" as lib",
  "const width: number = 10",
  `instance use = ${callee}${callee.endsWith("Panel") ? "(value: 1)" : "()"}`
].join("\n");

describe("multi-document Module completion and Signature Help", () => {
  it("completes a direct imported Module with defining-document identity", async () => {
    const source = directRoot("lib::Panel");
    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const { compiled, context } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const result = completionAt(source, compiled, "lib::Pa");
    const definition = context.analysisFor(library.documentId)?.definitions.find((candidate) => candidate.name === "Panel");

    expect(result?.category).toBe("moduleCallee");
    expect(result?.candidates.filter((candidate) => candidate.label === "Panel")).toEqual([
      expect.objectContaining({
        kind: "module",
        identity: moduleSemanticIdentityKey(definition!.identity!)
      })
    ]);
  });

  it("completes a re-exported Module using the original defining identity", async () => {
    const facade = savedSource("query-facade", "sha256:query-facade", [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n"));
    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const source = [
      "nui 1",
      "import \"./facade.nui\" as facade",
      "instance use = facade::Panel(value: 1)"
    ].join("\n");
    const { compiled, context } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./facade.nui`, facade],
      [`${facade.documentId}|./library.nui`, library]
    ]));
    const result = completionAt(source, compiled, "facade::Pa");
    const signature = signatureAt(source, compiled, "facade::Panel(value: 1");
    const definition = context.analysisFor(library.documentId)?.definitions.find((candidate) => candidate.name === "Panel");

    expect(result?.category).toBe("moduleCallee");
    expect(result?.candidates.filter((candidate) => candidate.label === "Panel")).toEqual([
      expect.objectContaining({ identity: moduleSemanticIdentityKey(definition!.identity!) })
    ]);
    expect(signature?.signatures[0]?.identity).toBe(`module:${moduleSemanticIdentityKey(definition!.identity!)}`);
  });

  it("uses imported Module parameter metadata for labels and Signature Help", async () => {
    const source = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "const width: number = 1",
      "instance use = lib::Panel(value: @width, ",
      ")"
    ].join("\n");
    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const { compiled, context } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const value = completionAt(source, compiled, "value: @");
    const labels = completionAt(source, compiled, "lib::Panel(value: @width, ");
    const signature = signatureAt(source, compiled, "lib::Panel(value: @width, ");
    const activeSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel(value: 1, side: left, count: 2)"
    ].join("\n");
    const { compiled: activeCompiled } = await compileImported(activeSource, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const activeSignature = signatureAt(activeSource, activeCompiled, "side: ");
    const definition = context.analysisFor(library.documentId)?.definitions.find((candidate) => candidate.name === "Panel");
    const expectedIdentity = moduleSemanticIdentityKey(definition!.identity!);

    expect(labels?.category).toBe("moduleArgumentLabel");
    expect(labels?.candidates.map((candidate) => candidate.label)).toEqual(["side", "count"]);
    expect(value?.category).toBe("moduleArgumentValue");
    expect(value?.candidates.map((candidate) => candidate.label)).toContain("width");
    expect(signature?.signatures[0]).toMatchObject({
      identity: `module:${expectedIdentity}`,
      name: "Panel",
      callingStyle: "module"
    });
    expect(signature?.signatures[0]?.parameters).toEqual([
      expect.objectContaining({ name: "value", type: "number", optional: false }),
      expect.objectContaining({
        name: "side",
        type: "choice(left, right)",
        optional: true,
        allowedValues: ["left", "right"]
      }),
      expect.objectContaining({ name: "count", type: "number", defaultValue: "2" })
    ]);
    expect(activeSignature?.activeParameter).toBe(1);
  });

  it("completes imported Module instance members from defining exports", async () => {
    const source = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel(value: 1)",
      "const copied: number = @use::amount",
      "point copiedPoint = offset(from: @use::Public, dx: 1, dy: 0)"
    ].join("\n");
    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const { compiled, context } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const result = completionAt(source, compiled, "@use::am");
    const geometry = completionAt(source, compiled, "@use::Pu");
    const definition = context.analysisFor(library.documentId)?.definitions.find((candidate) => candidate.name === "Panel");
    const amount = definition?.exports.find((entry) => entry.name === "amount");
    const publicGeometry = definition?.exports.find((entry) => entry.name === "Public");

    expect(result?.category).toBe("moduleQualifiedMember");
    expect(result?.candidates).toEqual([
      expect.objectContaining({
        kind: "binding",
        label: "amount",
        identity: moduleSemanticIdentityKey(amount!.exportedIdentity!)
      })
    ]);
    expect(geometry?.candidates).toEqual([
      expect.objectContaining({
        kind: "geometry",
        label: "Public",
        identity: moduleSemanticIdentityKey(publicGeometry!.exportedIdentity!)
      })
    ]);
  });

  it("does not expose private, missing, or wrong-family imported candidates", async () => {
    const library = savedSource("query-library", "sha256:query-library", [
      "nui 1",
      "export module Public() {",
      "}",
      "module Hidden() {",
      "}",
      "export profile Wrong() {",
      "}"
    ].join("\n"));
    for (const typed of ["Hidden", "Missing", "Wrong"]) {
      const source = directRoot(`lib::${typed}`);
      const { compiled } = await compileImported(source, new Map([
        [`${documentIdFromHost("query-root")}|./library.nui`, library]
      ]));
      const result = completionAt(source, compiled, `lib::${typed.slice(0, 2)}`);

      expect(result?.category).toBe("moduleCallee");
      expect(result?.candidates.map((candidate) => candidate.label)).toEqual([]);
    }
  });

  it("fails closed for ambiguous or stale imported Module semantics", async () => {
    const ambiguousLibrary = savedSource("query-library", "sha256:query-library", [
      "nui 1",
      "export module Panel() {",
      "}",
      "export module Panel() {",
      "}"
    ].join("\n"));
    const ambiguousSource = directRoot("lib::Panel");
    const ambiguous = await compileImported(ambiguousSource, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, ambiguousLibrary]
    ]));
    expect(completionAt(ambiguousSource, ambiguous.compiled, "lib::Pa")?.candidates).toEqual([]);

    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const source = directRoot("lib::Panel");
    const { compiled } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const staleSource = directRoot("lib::P");
    const stale = queryDslCompletion({
      source: { normalizedSource: staleSource, sourceRevision: 2 },
      position: staleSource.indexOf("lib::P") + "lib::P".length,
      semantic: { sourceRevision: 1, compiled }
    });

    expect(stale?.category).toBe("moduleCallee");
    expect(stale?.candidates).toEqual([]);
  });

  it("keeps bare Module completion local-only when imports are present", async () => {
    const source = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "module Local() {",
      "}",
      "instance use = Local"
    ].join("\n");
    const library = savedSource("query-library", "sha256:query-library", panelSource);
    const { compiled } = await compileImported(source, new Map([
      [`${documentIdFromHost("query-root")}|./library.nui`, library]
    ]));
    const result = completionAt(source, compiled, "instance use = Lo", "instance use = Lo".length);

    expect(result?.category).toBe("moduleCallee");
    expect(result?.candidates.map((candidate) => candidate.label)).toContain("Local");
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Panel");
  });

  it("preserves same-file Module completion and Signature Help", () => {
    const source = [
      "nui 1",
      "module Local(value: number) {",
      "}",
      "instance use = Local(value: 1)"
    ].join("\n");
    const compiled = compileLocal(source);
    const completion = completionAt(source, compiled, "instance use = Lo", "instance use = Lo".length);
    const signature = signatureAt(source, compiled, "Local(value: 1");

    expect(completion?.candidates.map((candidate) => candidate.label)).toContain("Local");
    expect(signature?.signatures[0]).toMatchObject({ name: "Local", callingStyle: "module" });
    expect(signature?.signatures[0]?.parameters[0]).toMatchObject({ name: "value", type: "number" });
  });
});
