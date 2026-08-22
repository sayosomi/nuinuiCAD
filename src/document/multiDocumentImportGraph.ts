import { parseDslSnapshot } from "../dsl/dslParser";
import {
  buildSourceLexicalNamespaceIndex,
  type SourceLexicalDeclaration,
  type SourceLexicalExternalNamespaceResolver,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { DslDiagnostic, DslStatement, ParseDslResult } from "../dsl/dslTypes";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import {
  qualifySemanticIdentity,
  qualifySourceLocation,
  sourceIdentityOf,
  type DependencySavedSourceSnapshot,
  type DocumentId,
  type DocumentQualifiedSourceLocation,
  type DocumentTextRange,
  type MultiDocumentSourceSnapshot,
  type RootCurrentSourceSnapshot,
  type SavedSourceFingerprint
} from "./multiDocumentPrimitives";
import {
  buildMultiDocumentPublicApiCatalog,
  createPublicApiExternalNamespaceResolver,
  type FileExportableDeclarationDescriptor,
  type FileReExportDescriptor,
  type MultiDocumentPublicApiCatalog,
  type MultiDocumentPublicApiDiagnostic
} from "./multiDocumentPublicApi";
import { createStatementIdentity } from "./statementIdentity";

export type SavedDependencyLoadFailureReason =
  | "root-unaddressable"
  | "missing"
  | "unreadable"
  | "stale"
  | "canceled";

export type SavedDependencyLoadResult =
  | { status: "loaded"; snapshot: DependencySavedSourceSnapshot }
  | { status: "failed"; reason: SavedDependencyLoadFailureReason; message?: string };

/**
 * Host boundary. Path canonicalization, filesystem access and fingerprinting
 * stay outside the graph owner; the graph receives one exact saved snapshot.
 */
export type MultiDocumentSavedSourceLoader = {
  loadSavedDependency(
    importerDocumentId: DocumentId,
    validatedRelativePath: string
  ): Promise<SavedDependencyLoadResult>;
};

export type MultiDocumentDeclarationContributor<Metadata = unknown> = (context: {
  source: MultiDocumentSourceSnapshot;
  parsed: ParseDslResult;
  statementIdByStatementIndex: ReadonlyMap<number, string>;
}) => readonly FileExportableDeclarationDescriptor<Metadata>[];

export type MultiDocumentImportDirective = {
  statementIndex: number;
  identity: ReturnType<typeof qualifySemanticIdentity<string>>;
  location: DocumentQualifiedSourceLocation;
  importPath: string;
  alias: string;
  aliasLocation: DocumentQualifiedSourceLocation;
};

export type MultiDocumentSourceArtifact<Metadata = unknown> = {
  source: MultiDocumentSourceSnapshot;
  parsed: ParseDslResult;
  statementIdByStatementIndex: ReadonlyMap<number, string>;
  sourceLexicalNamespace: SourceLexicalNamespaceIndex;
  imports: readonly MultiDocumentImportDirective[];
  reExports: readonly FileReExportDescriptor[];
  declarations: readonly FileExportableDeclarationDescriptor<Metadata>[];
  syntaxValid: boolean;
};

export type MultiDocumentImportEdgeFailureReason =
  | SavedDependencyLoadFailureReason
  | "invalid-source"
  | "invalid-dependency"
  | "cycle";

export type MultiDocumentImportEdge = {
  importerDocumentId: DocumentId;
  importIdentity: MultiDocumentImportDirective["identity"];
  importLocation: DocumentQualifiedSourceLocation;
  importPath: string;
  alias: string;
  aliasLocation: DocumentQualifiedSourceLocation;
  targetDocumentId?: DocumentId;
  status: "resolved" | "failed" | "cycle";
  failureReason?: MultiDocumentImportEdgeFailureReason;
};

export type MultiDocumentGraphDiagnosticCode =
  | "import-root-unaddressable"
  | "import-missing"
  | "import-unreadable"
  | "import-load-stale"
  | "import-load-canceled"
  | "import-invalid-source"
  | "import-invalid-dependency"
  | "import-cycle";

export type MultiDocumentGraphDiagnostic = {
  code: MultiDocumentGraphDiagnosticCode;
  message: string;
  location: DocumentQualifiedSourceLocation;
  relatedLocations?: readonly DocumentQualifiedSourceLocation[];
};

export type MultiDocumentGraphNode<Metadata = unknown> = {
  documentId: DocumentId;
  artifact: MultiDocumentSourceArtifact<Metadata>;
  imports: readonly MultiDocumentImportEdge[];
  publicApi: MultiDocumentPublicApiCatalog<Metadata>;
  publicApiDiagnostics: readonly MultiDocumentPublicApiDiagnostic[];
  sourceDiagnostics: readonly DslDiagnostic[];
  valid: boolean;
};

export type MultiDocumentImportGraph<Metadata = unknown> = {
  rootDocumentId: DocumentId;
  rootSource: RootCurrentSourceSnapshot;
  nodes: ReadonlyMap<DocumentId, MultiDocumentGraphNode<Metadata>>;
  edges: readonly MultiDocumentImportEdge[];
  diagnostics: readonly MultiDocumentGraphDiagnostic[];
  dependencyFingerprints: ReadonlyMap<DocumentId, SavedSourceFingerprint>;
  valid: boolean;
};

export type BuildMultiDocumentImportGraphInput<Metadata = unknown> = {
  root: RootCurrentSourceSnapshot;
  loader: MultiDocumentSavedSourceLoader;
  cache?: SavedDocumentArtifactCache<Metadata>;
  declarationContributors?: readonly MultiDocumentDeclarationContributor<Metadata>[];
  /** Canonical root callers may supply reconciler-owned identities. */
  rootStatementIdByStatementIndex?: ReadonlyMap<number, string>;
};

const cacheKey = (documentId: DocumentId, fingerprint: SavedSourceFingerprint) =>
  `${documentId}\u0000${fingerprint}`;

/** Exact-saved-snapshot artifact cache. No DocumentId-only fallback exists. */
export class SavedDocumentArtifactCache<Metadata = unknown> {
  private readonly entries = new Map<string, MultiDocumentSourceArtifact<Metadata>>();

  get(
    documentId: DocumentId,
    fingerprint: SavedSourceFingerprint
  ): MultiDocumentSourceArtifact<Metadata> | undefined {
    return this.entries.get(cacheKey(documentId, fingerprint));
  }

  set(artifact: MultiDocumentSourceArtifact<Metadata>): void {
    if (artifact.source.kind !== "dependency-saved") {
      throw new Error("SavedDocumentArtifactCache accepts dependency-saved artifacts only.");
    }
    const key = cacheKey(artifact.source.documentId, artifact.source.savedSourceFingerprint);
    if (!this.entries.has(key)) this.entries.set(key, artifact);
  }

  get size(): number {
    return this.entries.size;
  }
}

const physicalRange = (span: DslPhysicalSpan | null | undefined): DocumentTextRange | null => {
  if (!span || span.segments.length === 0) return null;
  return {
    from: span.segments[0]!.from,
    to: span.segments.at(-1)!.to
  };
};

const statementLocation = (
  source: MultiDocumentSourceSnapshot,
  statement: DslStatement
): DocumentQualifiedSourceLocation => qualifySourceLocation(sourceIdentityOf(source), {
  from: statement.documentRange.from,
  to: statement.documentRange.to
});

const payloadLocation = (
  source: MultiDocumentSourceSnapshot,
  statement: DslStatement,
  key: string
): DocumentQualifiedSourceLocation => qualifySourceLocation(
  sourceIdentityOf(source),
  physicalRange(statement.payloadPhysicalSpans?.[key]) ?? {
    from: statement.documentRange.from,
    to: statement.documentRange.to
  }
);

const hasNui4Version = (parsed: ParseDslResult) => {
  const versions = parsed.statements.filter(
    (statement): statement is Extract<DslStatement, { kind: "version" }> => statement.kind === "version"
  );
  return versions.length === 1 && versions[0]!.value === "4";
};

const statementIdsFor = (
  parsed: ParseDslResult,
  supplied?: ReadonlyMap<number, string>
): ReadonlyMap<number, string> => {
  const ids = new Map<number, string>(supplied ?? []);
  parsed.statements.forEach((statement, statementIndex) => {
    if (!ids.has(statementIndex)) ids.set(statementIndex, createStatementIdentity(`multiDocument:${statement.kind}`));
  });
  return ids;
};

export const analyzeMultiDocumentSource = <Metadata = unknown>(
  source: MultiDocumentSourceSnapshot,
  options: {
    declarationContributors?: readonly MultiDocumentDeclarationContributor<Metadata>[];
    statementIdByStatementIndex?: ReadonlyMap<number, string>;
  } = {}
): MultiDocumentSourceArtifact<Metadata> => {
  const parsed = parseDslSnapshot({
    normalizedSource: source.normalizedSource,
    sourceRevision: source.kind === "root-current" ? source.sourceRevision : 0
  });
  const statementIdByStatementIndex = statementIdsFor(parsed, options.statementIdByStatementIndex);
  const sourceLexicalNamespace = buildSourceLexicalNamespaceIndex(parsed.statements, statementIdByStatementIndex);
  const imports: MultiDocumentImportDirective[] = [];
  const reExports: FileReExportDescriptor[] = [];

  parsed.statements.forEach((statement, statementIndex) => {
    const localIdentity = statementIdByStatementIndex.get(statementIndex)!;
    if (statement.kind === "import") {
      imports.push({
        statementIndex,
        identity: qualifySemanticIdentity(source.documentId, localIdentity),
        location: statementLocation(source, statement),
        importPath: statement.importPath,
        alias: statement.alias,
        aliasLocation: payloadLocation(source, statement, "alias")
      });
    } else if (statement.kind === "fileReExport") {
      reExports.push({
        identity: qualifySemanticIdentity(source.documentId, localIdentity),
        location: payloadLocation(source, statement, "target"),
        importAlias: statement.importAlias,
        exportedName: statement.exportedName
      });
    }
  });

  const declarations = (options.declarationContributors ?? []).flatMap((contributor) =>
    contributor({ source, parsed, statementIdByStatementIndex })
  );
  const syntaxValid =
    hasNui4Version(parsed) &&
    !parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
    !sourceLexicalNamespace.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    source,
    parsed,
    statementIdByStatementIndex,
    sourceLexicalNamespace,
    imports,
    reExports,
    declarations,
    syntaxValid
  };
};

const loadDiagnostic = (
  reason: SavedDependencyLoadFailureReason,
  location: DocumentQualifiedSourceLocation,
  path: string,
  message?: string
): MultiDocumentGraphDiagnostic => {
  const suffix = message ? `: ${message}` : "";
  switch (reason) {
    case "root-unaddressable":
      return { code: "import-root-unaddressable", message: `import元から相対path「${path}」を解決できません${suffix}`, location };
    case "missing":
      return { code: "import-missing", message: `import先「${path}」が見つかりません${suffix}`, location };
    case "unreadable":
      return { code: "import-unreadable", message: `import先「${path}」を読み込めません${suffix}`, location };
    case "stale":
      return { code: "import-load-stale", message: `import先「${path}」の読み込み結果がstaleです${suffix}`, location };
    case "canceled":
      return { code: "import-load-canceled", message: `import先「${path}」の読み込みがcancelされました${suffix}`, location };
  }
};

type MutableEdge = Omit<MultiDocumentImportEdge, "status"> & {
  status: "pending" | MultiDocumentImportEdge["status"];
};

type MutableNode<Metadata> = {
  documentId: DocumentId;
  artifact: MultiDocumentSourceArtifact<Metadata>;
  imports: MutableEdge[];
  publicApi: MultiDocumentPublicApiCatalog<Metadata> | null;
  valid: boolean;
};

export const buildMultiDocumentImportGraph = async <Metadata = unknown>(
  input: BuildMultiDocumentImportGraphInput<Metadata>
): Promise<MultiDocumentImportGraph<Metadata>> => {
  const cache = input.cache ?? new SavedDocumentArtifactCache<Metadata>();
  const nodes = new Map<DocumentId, MutableNode<Metadata>>();
  const edges: MutableEdge[] = [];
  const diagnostics: MultiDocumentGraphDiagnostic[] = [];
  const dependencyFingerprints = new Map<DocumentId, SavedSourceFingerprint>();
  const cycleDiagnosticKeys = new Set<string>();

  const artifactForSaved = (snapshot: DependencySavedSourceSnapshot) => {
    const cached = cache.get(snapshot.documentId, snapshot.savedSourceFingerprint);
    if (cached) return cached;
    const artifact = analyzeMultiDocumentSource(snapshot, {
      declarationContributors: input.declarationContributors
    });
    cache.set(artifact);
    return artifact;
  };

  const markCycle = (cycleEdges: readonly MutableEdge[]) => {
    const chain = cycleEdges
      .map((edge) => `${edge.importerDocumentId} -> ${edge.targetDocumentId ?? "?"}`)
      .join(" -> ");
    for (const edge of cycleEdges) {
      edge.status = "cycle";
      edge.failureReason = "cycle";
      const key = `${edge.importerDocumentId}\u0000${edge.importIdentity.localIdentity}`;
      if (cycleDiagnosticKeys.has(key)) continue;
      cycleDiagnosticKeys.add(key);
      diagnostics.push({
        code: "import-cycle",
        message: `import cycleを検出しました: ${chain}`,
        location: edge.importLocation,
        relatedLocations: cycleEdges
          .filter((candidate) => candidate !== edge)
          .map((candidate) => candidate.importLocation)
      });
    }
  };

  const visit = async (
    artifact: MultiDocumentSourceArtifact<Metadata>,
    stackDocumentIds: readonly DocumentId[],
    stackEdges: readonly MutableEdge[]
  ): Promise<MutableNode<Metadata>> => {
    const existing = nodes.get(artifact.source.documentId);
    if (existing) return existing;

    const node: MutableNode<Metadata> = {
      documentId: artifact.source.documentId,
      artifact,
      imports: [],
      publicApi: null,
      valid: artifact.syntaxValid
    };
    nodes.set(node.documentId, node);

    const nextStackDocumentIds = [...stackDocumentIds, node.documentId];
    if (artifact.syntaxValid) {
      for (const directive of artifact.imports) {
        const edge: MutableEdge = {
          importerDocumentId: node.documentId,
          importIdentity: directive.identity,
          importLocation: directive.location,
          importPath: directive.importPath,
          alias: directive.alias,
          aliasLocation: directive.aliasLocation,
          status: "pending"
        };
        node.imports.push(edge);
        edges.push(edge);

        const loaded = await input.loader.loadSavedDependency(node.documentId, directive.importPath);
        if (loaded.status === "failed") {
          edge.status = "failed";
          edge.failureReason = loaded.reason;
          diagnostics.push(loadDiagnostic(loaded.reason, directive.location, directive.importPath, loaded.message));
          node.valid = false;
          continue;
        }

        const targetSnapshot = loaded.snapshot;
        edge.targetDocumentId = targetSnapshot.documentId;
        const existingFingerprint = dependencyFingerprints.get(targetSnapshot.documentId);
        if (
          existingFingerprint !== undefined &&
          existingFingerprint !== targetSnapshot.savedSourceFingerprint
        ) {
          const previousEdge = edges.find(
            (candidate) => candidate !== edge && candidate.targetDocumentId === targetSnapshot.documentId
          );
          edge.status = "failed";
          edge.failureReason = "stale";
          diagnostics.push({
            code: "import-load-stale",
            message: `同じDocumentId「${targetSnapshot.documentId}」が異なるsaved source fingerprintで解決されたため、import graphを確定できません。`,
            location: directive.location,
            ...(previousEdge ? { relatedLocations: [previousEdge.importLocation] } : {})
          });
          node.valid = false;
          continue;
        }
        dependencyFingerprints.set(targetSnapshot.documentId, targetSnapshot.savedSourceFingerprint);
        const cycleStart = nextStackDocumentIds.indexOf(targetSnapshot.documentId);
        if (cycleStart >= 0) {
          markCycle([...stackEdges.slice(cycleStart), edge]);
          node.valid = false;
          continue;
        }

        const targetArtifact = artifactForSaved(targetSnapshot);
        if (!targetArtifact.syntaxValid) {
          edge.status = "failed";
          edge.failureReason = "invalid-source";
          diagnostics.push({
            code: "import-invalid-source",
            message: `import先「${directive.importPath}」は有効なnui 4 sourceではありません。`,
            location: directive.location
          });
          node.valid = false;
          continue;
        }

        const targetNode = await visit(
          targetArtifact,
          nextStackDocumentIds,
          [...stackEdges, edge]
        );
        if (edge.status === "cycle") {
          node.valid = false;
          continue;
        }
        if (!targetNode.valid) {
          edge.status = "failed";
          edge.failureReason = "invalid-dependency";
          diagnostics.push({
            code: "import-invalid-dependency",
            message: `import先「${directive.importPath}」のdependency graphが無効です。`,
            location: directive.location
          });
          node.valid = false;
          continue;
        }
        edge.status = "resolved";
      }
    }

    const publicApi = buildMultiDocumentPublicApiCatalog({
      documentId: node.documentId,
      declarations: artifact.declarations,
      reExports: artifact.reExports,
      resolveImportCatalog: (alias) => {
        const edge = node.imports.find((candidate) => candidate.alias === alias && candidate.status === "resolved");
        if (!edge?.targetDocumentId) return null;
        return nodes.get(edge.targetDocumentId)?.publicApi ?? null;
      }
    });
    node.publicApi = publicApi;
    node.valid = node.valid && publicApi.valid;
    return node;
  };

  const rootArtifact = analyzeMultiDocumentSource(input.root, {
    declarationContributors: input.declarationContributors,
    statementIdByStatementIndex: input.rootStatementIdByStatementIndex
  });
  const rootNode = await visit(rootArtifact, [], []);

  const readonlyNodes = new Map<DocumentId, MultiDocumentGraphNode<Metadata>>();
  for (const [documentId, mutable] of nodes) {
    const publicApi = mutable.publicApi ?? buildMultiDocumentPublicApiCatalog({
      documentId,
      declarations: mutable.artifact.declarations
    });
    const finalizedImports = mutable.imports.map((edge): MultiDocumentImportEdge => {
      if (edge.status === "pending") {
        return { ...edge, status: "failed", failureReason: "invalid-dependency" };
      }
      return edge as MultiDocumentImportEdge;
    });
    readonlyNodes.set(documentId, {
      documentId,
      artifact: mutable.artifact,
      imports: finalizedImports,
      publicApi,
      publicApiDiagnostics: publicApi.diagnostics,
      sourceDiagnostics: [
        ...mutable.artifact.parsed.diagnostics,
        ...mutable.artifact.sourceLexicalNamespace.diagnostics
      ],
      valid: mutable.valid && publicApi.valid
    });
  }

  const finalizedEdges = edges.map((edge): MultiDocumentImportEdge =>
    edge.status === "pending"
      ? { ...edge, status: "failed", failureReason: "invalid-dependency" }
      : edge as MultiDocumentImportEdge
  );

  return {
    rootDocumentId: input.root.documentId,
    rootSource: input.root,
    nodes: readonlyNodes,
    edges: finalizedEdges,
    diagnostics,
    dependencyFingerprints,
    valid: rootNode.valid && diagnostics.length === 0
  };
};

/**
 * Creates the member hook used by sourceLexicalNamespaceIndex for one importer
 * node. The source resolver has already proven alias visibility/source order;
 * this function only maps that exact import statement to its resolved catalog.
 */
export const createGraphExternalNamespaceResolver = <Metadata>(
  graph: MultiDocumentImportGraph<Metadata>,
  importerDocumentId: DocumentId
): SourceLexicalExternalNamespaceResolver => {
  const importer = graph.nodes.get(importerDocumentId);
  return createPublicApiExternalNamespaceResolver((declaration: SourceLexicalDeclaration) => {
    if (!importer || declaration.kind !== "import") return null;
    const edge = importer.imports.find(
      (candidate) => candidate.importIdentity.localIdentity === declaration.statementId && candidate.status === "resolved"
    );
    if (!edge?.targetDocumentId) return null;
    return graph.nodes.get(edge.targetDocumentId)?.publicApi ?? null;
  });
};

export type MultiDocumentGraphBuildResult<Metadata = unknown> =
  | { status: "current"; graph: MultiDocumentImportGraph<Metadata> }
  | { status: "stale" };

/**
 * Active-root coordinator: each root has its own latest-request-wins token.
 * Dependency invalidation drops only roots whose installed graph transitively
 * contains that saved DocumentId; callers rebuild those roots from their
 * latest current buffers.
 */
export class MultiDocumentGraphCoordinator<Metadata = unknown> {
  private readonly requestRevisionByRoot = new Map<DocumentId, number>();
  private readonly graphByRoot = new Map<DocumentId, MultiDocumentImportGraph<Metadata>>();
  private readonly dependenciesByRoot = new Map<DocumentId, Set<DocumentId>>();
  private readonly rootsByDependency = new Map<DocumentId, Set<DocumentId>>();

  async rebuild(
    input: BuildMultiDocumentImportGraphInput<Metadata>
  ): Promise<MultiDocumentGraphBuildResult<Metadata>> {
    const rootId = input.root.documentId;
    const requestRevision = (this.requestRevisionByRoot.get(rootId) ?? 0) + 1;
    this.requestRevisionByRoot.set(rootId, requestRevision);
    const graph = await buildMultiDocumentImportGraph(input);
    if (this.requestRevisionByRoot.get(rootId) !== requestRevision) return { status: "stale" };
    this.install(graph);
    return { status: "current", graph };
  }

  graphForRoot(rootDocumentId: DocumentId): MultiDocumentImportGraph<Metadata> | undefined {
    return this.graphByRoot.get(rootDocumentId);
  }

  invalidateSavedDependency(documentId: DocumentId): readonly DocumentId[] {
    const affected = [...(this.rootsByDependency.get(documentId) ?? [])];
    for (const rootId of affected) {
      this.requestRevisionByRoot.set(rootId, (this.requestRevisionByRoot.get(rootId) ?? 0) + 1);
      this.removeInstalledRoot(rootId);
    }
    return affected;
  }

  private install(graph: MultiDocumentImportGraph<Metadata>): void {
    this.removeInstalledRoot(graph.rootDocumentId);
    this.graphByRoot.set(graph.rootDocumentId, graph);
    const dependencies = new Set(
      [...graph.dependencyFingerprints.keys()].filter((documentId) => documentId !== graph.rootDocumentId)
    );
    this.dependenciesByRoot.set(graph.rootDocumentId, dependencies);
    for (const dependency of dependencies) {
      const roots = this.rootsByDependency.get(dependency);
      if (roots) roots.add(graph.rootDocumentId);
      else this.rootsByDependency.set(dependency, new Set([graph.rootDocumentId]));
    }
  }

  private removeInstalledRoot(rootDocumentId: DocumentId): void {
    this.graphByRoot.delete(rootDocumentId);
    const dependencies = this.dependenciesByRoot.get(rootDocumentId);
    this.dependenciesByRoot.delete(rootDocumentId);
    for (const dependency of dependencies ?? []) {
      const roots = this.rootsByDependency.get(dependency);
      if (!roots) continue;
      roots.delete(rootDocumentId);
      if (roots.size === 0) this.rootsByDependency.delete(dependency);
    }
  }
}
