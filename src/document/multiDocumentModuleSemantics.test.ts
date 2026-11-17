import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { recursiveDocumentQualifiedModuleInstanceIds } from "@nuinuicad/nui-language";
import type { ModuleDefinitionSemantic } from "@nuinuicad/nui-language";
import {
  buildMultiDocumentImportGraph,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "@nuinuicad/nui-language/workspace";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "@nuinuicad/nui-language/workspace";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  qualifySemanticIdentity,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";

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

const moduleDefinition = (analysis: ReturnType<typeof analyzeMultiDocumentModuleSemantics>, documentId: string, name: string) =>
  analysis.analysesByDocument.get(documentId as ReturnType<typeof documentIdFromHost>)?.definitions.find((definition) => definition.name === name);

const scalarBindingProbe = savedSource("probe", "sha256:scalar-binding-probe", [
  "nui 1",
  "export module Probe() {",
  "  export point P = coordinate(x: 0, y: 0)",
  "}"
].join("\n"));

const scalarKnotFixture = (includeImport: boolean, body: "knot" | "coordinate" | "handles") => [
  "nui 1",
  ...(includeImport ? ['import "./probe.nui" as probe'] : []),
  "group test {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 20, y: 0)",
  "  point M = coordinate(x: 10, y: 5)",
  "  const bulge: number(step: 0.1) = 4",
  ...(body === "coordinate" ? [
    "  point Sample = coordinate(x: @bulge, y: 0)"
  ] : body === "handles" ? [
    "  curve C = bezier(start: @A, end: @B, startAngle: 30, startLength: @bulge, endAngle: 150, endLength: @bulge)"
  ] : [
    "  curve C = bezier(",
    "    start: @A,",
    "    end: @B,",
    "    startAngle: 30,",
    "    startLength: @bulge,",
    "    endAngle: 150,",
    "    endLength: @bulge,",
    "    intermediates: [",
    "      knot(point: @M, angle: 0, incoming: @bulge, outgoing: @bulge),",
    "    ],",
    "  )"
  ]),
  "}"
].join("\n");

const analyzeScalarKnotFixture = async (includeImport: boolean, body: "knot" | "coordinate" | "handles") => {
  const root = rootSource("scalar-root", scalarKnotFixture(includeImport, body));
  const dependencies = new Map<string, DependencySavedSourceSnapshot>();
  if (includeImport) dependencies.set(`${root.documentId}|./probe.nui`, scalarBindingProbe);
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: loaderFrom(dependencies),
    declarationContributors: [moduleDeclarationContributor]
  });
  return { graph, analysis: analyzeMultiDocumentModuleSemantics(graph) };
};

describe("multi-document Module semantics", () => {
  it.each([
    { label: "an unused imported Module and knot references", includeImport: true, body: "knot" as const },
    { label: "an unused import and a coordinate scalar reference", includeImport: true, body: "coordinate" as const },
    { label: "an unused import and Bezier handle scalar references", includeImport: true, body: "handles" as const }
  ])("resolves group scalar bindings for $label", async ({ includeImport, body }) => {
    const { graph, analysis } = await analyzeScalarKnotFixture(includeImport, body);

    expect(graph.valid).toBe(true);
    expect(analysis.valid).toBe(true);
    expect(analysis.root?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("module-document-binding-unavailable");
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("module-semantic-invalid");
  });

  it("compiles the same group scalar knot fixture without an import", () => {
    const compiled = compileFreshCanonicalText(scalarKnotFixture(false, "knot")).currentCompiled;

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toContain("C");
  });

  it("keeps root, nested group, conditional, loop, and shadowed scalar scopes in the lexical resolver", async () => {
    const root = rootSource("scope-root", [
      "nui 1",
      'import "./probe.nui" as probe',
      "const enabled: boolean = true",
      "const size: number = 1",
      "const rootCopy: number = @size",
      "group outer {",
      "  const size: number = 2",
      "  group inner {",
      "    const size: number = 3",
      "    const nestedCopy: number = @size",
      "  }",
      "}",
      "if (@enabled) {",
      "  const conditionalValue: number = 4",
      "  const conditionalCopy: number = @conditionalValue",
      "}",
      "for i in range(min: 0, max: 0, step: 1) {",
      "  const loopValue: number = 5",
      "  const loopCopy: number = @loopValue",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./probe.nui`, scalarBindingProbe]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const node = graph.nodes.get(root.documentId)!;
    const declarationByName = (name: string, enclosingNameOrType?: string) => {
      const index = node.artifact.parsed.statements.findIndex((statement, statementIndex) =>
        statement.kind === "typedDeclaration" && statement.name === name &&
        (enclosingNameOrType === undefined || (() => {
          const enclosing = node.artifact.parsed.statements[statement.enclosing?.statementIndex ?? -1];
          return enclosing?.kind === "group"
            ? enclosing.name === enclosingNameOrType
            : enclosing?.kind === "element" && enclosing.type === enclosingNameOrType;
        })()) &&
        node.artifact.statementIdByStatementIndex.has(statementIndex)
      );
      const statementId = node.artifact.statementIdByStatementIndex.get(index);
      return { index, statementId };
    };
    const referenceTargetFor = (name: string, enclosingKind?: string) => {
      const declaration = declarationByName(name, enclosingKind);
      const site = analysis.root?.rootScalarExpressionsByStatementId.get(declaration.statementId!);
      return site?.expression.references[0]?.target;
    };
    const innerSize = declarationByName("size", "inner");
    const outerSize = declarationByName("size");

    expect(graph.valid).toBe(true);
    expect(analysis.valid).toBe(true);
    expect(referenceTargetFor("rootCopy")).toMatchObject({ kind: "documentBinding", statementIndex: outerSize.index });
    expect(referenceTargetFor("nestedCopy", "inner")).toMatchObject({
      kind: "documentBinding",
      statementIndex: innerSize.index,
      statementId: innerSize.statementId
    });
    expect(referenceTargetFor("conditionalCopy", "conditionalGroup")).toMatchObject({
      kind: "documentBinding",
      statementIndex: declarationByName("conditionalValue", "conditionalGroup").index
    });
    expect(referenceTargetFor("loopCopy", "forGroup")).toMatchObject({
      kind: "documentBinding",
      statementIndex: declarationByName("loopValue", "forGroup").index
    });
    expect(outerSize.index).not.toBe(innerSize.index);
  });

  it("projects optional scalar declarations with their canonical stable binding identity", async () => {
    const library = savedSource("optional-probe", "sha256:optional-scalar-probe", [
      "nui 1",
      "export module Optional(value: number?) {",
      "}"
    ].join("\n"));
    const root = rootSource("optional-root", [
      "nui 1",
      'import "./optional-probe.nui" as probe',
      "const maybe: number? = none",
      "instance Use = probe::Optional(value: @maybe)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./optional-probe.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const declarationIndex = graph.nodes.get(root.documentId)!.artifact.parsed.statements.findIndex(
      (statement) => statement.kind === "typedDeclaration" && statement.name === "maybe"
    );
    const statementId = graph.nodes.get(root.documentId)!.artifact.statementIdByStatementIndex.get(declarationIndex);

    expect(graph.valid).toBe(true);
    expect(analysis.valid).toBe(true);
    expect(analysis.root?.instances.find((instance) => instance.name === "Use")?.parameterBindings[0]?.value).toMatchObject({
      kind: "scalar",
      expression: {
        references: [{
          target: {
            kind: "documentBinding",
            bindingId: `binding:${statementId}`,
            statementId,
            statementIndex: declarationIndex
          }
        }]
      }
    });
  });

  it("contributes only direct modules and preserves exact exported name locations", async () => {
    const source = rootSource("library", [
      "nui 1",
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
      "nui 1",
      "export module ExternalHelper(value: number) {",
      "}"
    ].join("\n"));
    const library = savedSource("library", "sha256:library", [
      "nui 1",
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
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 1",
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
      "nui 1",
      "const libraryDefault: number = 41",
      "export module Panel(",
      "  optional: number?,",
      "  width: number = @libraryDefault,",
      "  hasOptional: boolean = match @optional { none => false some present => true },",
      ") {",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 1",
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
      state: "defaulted",
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
      state: "defaulted",
      value: { kind: "scalar", expression: { ast: { kind: "valueMatch" } } }
    });
  });

  it("keeps private, missing, and too-early imported callees unresolved", async () => {
    const library = savedSource("library", "sha256:library", [
      "nui 1",
      "module Hidden() {",
      "}",
      "export record Wrong(value: number)",
      "export module Public() {",
      "}",
      "export module Late() {",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 1",
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
      declarationContributors: [moduleDeclarationContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const byName = new Map(analysis.root?.instances.map((instance) => [instance.name, instance]));

    expect(byName.get("early")?.calleeResolution).toBe("resolved");
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
      mappedScalarCollectionBodies: [],
      localGeometryValues: [],
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
