import { describe, expect, it } from "vitest";
import { recursiveDocumentQualifiedModuleInstanceIds } from "../dsl/moduleCallGraph";
import type { ModuleDefinitionSemantic } from "../dsl/moduleSemanticTypes";
import {
  buildMultiDocumentImportGraph,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "./multiDocumentImportGraph";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "./multiDocumentModuleSemantics";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  qualifySemanticIdentity,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "./multiDocumentPrimitives";

const rootSource = (id: string, source: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
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
  normalizedSource: source,
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint)
});

const loaderFrom = (
  table: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>
): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, relativePath) {
    const result = table.get(`${importerDocumentId}|${relativePath}`);
    if (!result) return { status: "failed", reason: "missing" };
    return "kind" in result
      ? { status: "loaded", snapshot: result }
      : result;
  }
});

const publicProfileContributor: MultiDocumentDeclarationContributor = ({
  source,
  parsed,
  statementIdByStatementIndex
}) => parsed.statements.flatMap((statement, statementIndex) => {
  if (statement.kind !== "profileDeclaration" || !statement.name) return [];
  const statementId = statementIdByStatementIndex.get(statementIndex);
  const name = statement.namePhysicalSpan?.segments;
  if (!statementId || !name || name.length === 0) return [];
  return [{
    identity: qualifySemanticIdentity(source.documentId, statementId),
    family: "profile" as const,
    name: statement.name,
    declaration: {
      source: source.kind === "root-current"
        ? { kind: source.kind, documentId: source.documentId, sourceRevision: source.sourceRevision }
        : { kind: source.kind, documentId: source.documentId, savedSourceFingerprint: source.savedSourceFingerprint },
      range: { from: name[0]!.from, to: name.at(-1)!.to }
    },
    exported: true
  }];
});

const moduleDefinition = (analysis: ReturnType<typeof analyzeMultiDocumentModuleSemantics>, documentId: string, name: string) =>
  analysis.analysesByDocument.get(documentId as ReturnType<typeof documentIdFromHost>)?.definitions.find((definition) => definition.name === name);

describe("multi-document Module semantics", () => {
  it("contributes only direct modules and preserves exact exported name locations", async () => {
    const source = rootSource("library", [
      "nui 4",
      "export module Public() {",
      "}",
      "module Private() {",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root: source,
      loader: loaderFrom(new Map()),
      declarationContributors: [moduleDeclarationContributor]
    });

    expect(graph.valid).toBe(true);
    const node = graph.nodes.get(source.documentId)!;
    expect([...node.publicApi.publicEntriesByName.keys()]).toEqual(["Public"]);
    expect([...node.artifact.declarations].map((declaration) => [declaration.name, declaration.exported])).toEqual([
      ["Public", true],
      ["Private", false]
    ]);
    const publicDeclaration = node.artifact.declarations[0]!;
    expect(source.normalizedSource.slice(
      publicDeclaration.declaration.range.from,
      publicDeclaration.declaration.range.to
    )).toBe("Public");
    expect(publicDeclaration.identity).toEqual({
      documentId: source.documentId,
      localIdentity: node.artifact.statementIdByStatementIndex.get(1)
    });

    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    expect(analysis.valid).toBe(true);
    expect(analysis.root?.definitions.map((definition) => definition.name)).toEqual(["Public", "Private"]);
    expect(analysis.root?.definitions.every((definition) => definition.identity?.documentId === source.documentId)).toBe(true);
  });

  it("resolves imported and re-exported Modules with defining-document identity and lexical context", async () => {
    const helper = savedSource("helper", "sha256:helper", [
      "nui 4",
      "export module ExternalHelper(value: number) {",
      "}"
    ].join("\n"));
    const library = savedSource("library", "sha256:library", [
      "nui 4",
      "import \"./helper.nui\" as helperLib",
      "const libraryDefault: number = 41",
      "module Helper(value: number) {",
      "}",
      "export module Panel(width: number = @libraryDefault) {",
      "  const local: number = @width",
      "  instance child = Helper(value: @local)",
      "  instance externalChild = helperLib::ExternalHelper(value: @local)",
      "}"
    ].join("\n"));
    const facade = savedSource("facade", "sha256:facade", [
      "nui 4",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 4",
      "import \"./facade.nui\" as facade",
      "const callerWidth: number = 60",
      "instance use = facade::Panel(width: @callerWidth)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./facade.nui`, facade],
        [`${facade.documentId}|./library.nui`, library],
        [`${library.documentId}|./helper.nui`, helper]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });

    expect(graph.valid).toBe(true);
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    expect(analysis.valid).toBe(true);

    const rootAnalysis = analysis.root;
    expect(rootAnalysis).not.toBeNull();
    if (!rootAnalysis) return;
    const rootInstance = rootAnalysis.instances.find((instance) => instance.name === "use")!;
    expect(rootInstance.callee).toMatchObject({
      name: "Panel",
      definitionDocumentId: library.documentId,
      definitionIdentity: {
        documentId: library.documentId
      }
    });
    expect(rootInstance.parameterBindings[0]?.value).toMatchObject({
      kind: "scalar",
      expression: {
        references: [{
          target: {
            kind: "documentBinding",
            identity: { documentId: root.documentId }
          }
        }]
      }
    });

    const panel = moduleDefinition(analysis, library.documentId, "Panel")!;
    expect(panel.parameters[0]?.defaultExpression).toMatchObject({
      references: [{
        target: {
          kind: "documentBinding",
          identity: { documentId: library.documentId }
        }
      }]
    });
    const child = analysis.instances.find((instance) => instance.name === "child")!;
    expect(child).toMatchObject({
      documentId: library.documentId,
      callerModuleDefinitionIdentity: panel.identity,
      callee: {
        name: "Helper",
        definitionIdentity: { documentId: library.documentId }
      },
      parameterBindings: [{
        value: {
          kind: "scalar",
          expression: {
            references: [{
              target: {
                kind: "moduleLocal",
                identity: { documentId: library.documentId }
              }
            }]
          }
        }
      }]
    });
    const externalChild = analysis.instances.find((instance) => instance.name === "externalChild")!;
    expect(externalChild).toMatchObject({
      documentId: library.documentId,
      callerModuleDefinitionIdentity: panel.identity,
      callee: {
        name: "ExternalHelper",
        definitionDocumentId: helper.documentId,
        definitionIdentity: { documentId: helper.documentId }
      }
    });
    expect(analysis.callEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        caller: panel.identity,
        callee: expect.objectContaining({ documentId: library.documentId }),
        instance: child.identity
      })
    ]));
  });

  it("preserves defining-document ownership when an imported default expression is transferred", async () => {
    const library = savedSource("library", "sha256:library-defaults", [
      "nui 4",
      "const libraryDefault: number = 41",
      "export module Panel(",
      "  optional?: number,",
      "  width: number = @libraryDefault,",
      "  hasOptional: boolean = hasValue(@optional),",
      ") {",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 4",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });

    expect(graph.valid).toBe(true);
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    expect(analysis.valid).toBe(true);

    const rootInstance = analysis.root?.instances.find((instance) => instance.name === "use");
    expect(rootInstance).toMatchObject({
      callee: {
        name: "Panel",
        definitionDocumentId: library.documentId,
        definitionIdentity: { documentId: library.documentId }
      }
    });
    expect(rootInstance).toBeDefined();
    if (!rootInstance) return;

    const widthBinding = rootInstance.parameterBindings.find((binding) => binding.parameterName === "width");
    expect(widthBinding).toMatchObject({
      state: "defaultedOmitted",
      value: {
        kind: "scalar",
        expression: {
          references: [{
            target: {
              kind: "documentBinding",
              identity: { documentId: library.documentId }
            }
          }]
        }
      }
    });

    const hasOptionalBinding = rootInstance.parameterBindings.find((binding) => binding.parameterName === "hasOptional");
    expect(hasOptionalBinding).toMatchObject({
      state: "defaultedOmitted",
      value: {
        kind: "scalar",
        expression: {
          hasValueParameters: [{
            definitionIdentity: { documentId: library.documentId }
          }]
        }
      }
    });
  });

  it("keeps private, missing, and too-early imported callees unresolved", async () => {
    const library = savedSource("library", "sha256:library", [
      "nui 4",
      "module Hidden() {",
      "}",
      "profile Wrong",
      "export module Public() {",
      "}",
      "export module Late() {",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 4",
      "instance early = library::Public()",
      "import \"./library.nui\" as library",
      "instance hidden = library::Hidden()",
      "instance missing = library::Missing()",
      "instance wrongFamily = library::Wrong()",
      "instance late = library::Late()"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor, publicProfileContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const byName = new Map(analysis.root?.instances.map((instance) => [instance.name, instance]));

    expect(byName.get("early")?.calleeResolution).toBe("forward");
    expect(byName.get("hidden")?.calleeResolution).toBe("undefined");
    expect(byName.get("missing")?.calleeResolution).toBe("undefined");
    expect(byName.get("wrongFamily")?.calleeResolution).toBe("notModule");
    expect(byName.get("late")?.calleeResolution).toBe("resolved");
  });

  it("uses document-qualified call identities for cross-document recursion traversal", () => {
    const a = documentIdFromHost("a");
    const b = documentIdFromHost("b");
    const definition = (documentId: typeof a, localIdentity: string): ModuleDefinitionSemantic => ({
      statementId: localIdentity,
      statementIndex: 0,
      name: localIdentity,
      documentId,
      identity: qualifySemanticIdentity(documentId, localIdentity),
      declarationScopeId: "root",
      bodyScopeId: `module:${localIdentity}`,
      scopeId: "root",
      parameters: [],
      localScalars: [],
      recordValues: [],
      bodyStatements: [],
      exports: [],
      bodyStatementIds: []
    });
    const definitions = [definition(a, "A"), definition(b, "B")];
    const edges = [
      {
        caller: qualifySemanticIdentity(a, "A"),
        callee: qualifySemanticIdentity(b, "B"),
        instance: qualifySemanticIdentity(a, "a-to-b"),
        callerModuleDefinitionStatementId: "A",
        calleeModuleDefinitionStatementId: "B",
        instanceStatementId: "a-to-b"
      },
      {
        caller: qualifySemanticIdentity(b, "B"),
        callee: qualifySemanticIdentity(a, "A"),
        instance: qualifySemanticIdentity(b, "b-to-a"),
        callerModuleDefinitionStatementId: "B",
        calleeModuleDefinitionStatementId: "A",
        instanceStatementId: "b-to-a"
      }
    ];

    expect(recursiveDocumentQualifiedModuleInstanceIds(definitions, edges)).toEqual(new Set([
      JSON.stringify([a, "a-to-b"]),
      JSON.stringify([b, "b-to-a"])
    ]));
  });
});
