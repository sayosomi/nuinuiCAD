import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import * as vscode from "vscode";
import {
  dslSemanticIdentityKey,
  type DslSemanticIdentity
} from "../../src/dsl/dslSemanticOccurrenceIndex";
import {
  MultiDocumentGraphCoordinator,
  SavedDocumentArtifactCache,
  analyzeMultiDocumentSource,
  buildMultiDocumentImportGraph,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentImportGraph,
  type MultiDocumentSavedSourceLoader
} from "../../src/document/multiDocumentImportGraph";
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  planMultiDocumentRename,
  projectDslSemanticDocumentView,
  queryMultiDocumentDefinition,
  queryMultiDocumentReferences,
  type MultiDocumentRenameDocumentProof,
  type MultiDocumentReverseImporterDiscovery,
  type MultiDocumentSemanticDocumentView,
  type MultiDocumentSemanticOccurrence,
  type MultiDocumentSemanticOccurrenceIndex
} from "../../src/document/multiDocumentLanguageQueries";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type DocumentId,
  type DocumentQualifiedSemanticIdentity,
  type DocumentSourceIdentity,
  type MultiDocumentSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "../../src/document/multiDocumentPrimitives";
import { vscodeMultiDocumentGraphSnapshot } from "../../src/vscode/multiDocumentGraphTransport";
import { publishVscodeMultiDocumentGraphPublication } from "../../src/vscode/vscodeWebviewSession";
import { createLanguageAnalysisSession, type NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { normalizedSourceFor } from "./sourceOffsetAdapter";

export type VscodeMultiDocumentIdentityProjector = (
  documentId: DocumentId,
  identity: DslSemanticIdentity
) => DocumentQualifiedSemanticIdentity<string> | null;

export type VscodeMultiDocumentHostOptions = {
  declarationContributors?: readonly MultiDocumentDeclarationContributor<unknown>[];
  identityProjector?: VscodeMultiDocumentIdentityProjector;
  /** Family semantic owners may supply their existing exact rename proof. */
  renameProof?: MultiDocumentRenameDocumentProof;
};

export type VscodeMultiDocumentHandled<T> =
  | { handled: false }
  | { handled: true; value: T };

type RootState = {
  documentId: DocumentId;
  documentUri: string;
  documentVersion: number;
  requestRevision: number;
  graphRevision: number;
  graph: MultiDocumentImportGraph<unknown> | null;
  index: MultiDocumentSemanticOccurrenceIndex | null;
  pending: Promise<void> | null;
};

type SelectedOccurrence = {
  occurrence: MultiDocumentSemanticOccurrence;
  publicIdentity: boolean;
  importAliasIdentity: boolean;
};

type ReverseDiscoveryResult = {
  discovery: MultiDocumentReverseImporterDiscovery;
  indexes: readonly MultiDocumentSemanticOccurrenceIndex[];
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const supportedDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const supportedUri = (uri: vscode.Uri): boolean =>
  uri.scheme === "file" && uri.fsPath.endsWith(".nui");

const canonicalPathFor = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
};

export const canonicalVscodeDocumentId = (uri: vscode.Uri): DocumentId =>
  documentIdFromHost(vscode.Uri.file(canonicalPathFor(uri.fsPath)).toString());

const fingerprintFor = (bytes: Uint8Array): ReturnType<typeof savedSourceFingerprintFromHost> =>
  savedSourceFingerprintFromHost(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);

const fileNotFound = (error: unknown): boolean => {
  if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === "FileNotFound" ||
    candidate.code === "ENOENT" ||
    candidate.name === "EntryNotFound (FileSystemError)";
};

const identityKey = (identity: DocumentQualifiedSemanticIdentity<string>): string =>
  JSON.stringify([String(identity.documentId), identity.localIdentity]);

const sameIdentity = (
  left: DocumentQualifiedSemanticIdentity<string>,
  right: DocumentQualifiedSemanticIdentity<string>
): boolean => identityKey(left) === identityKey(right);

const sourceIdentityKey = (source: DocumentSourceIdentity): string => source.kind === "root-current"
  ? JSON.stringify([source.kind, String(source.documentId), source.sourceRevision])
  : JSON.stringify([source.kind, String(source.documentId), String(source.savedSourceFingerprint)]);

const sourceSnapshotMatchesIdentity = (
  source: MultiDocumentSourceSnapshot,
  identity: DocumentSourceIdentity
): boolean => sourceIdentityKey(source) === sourceIdentityKey(identity);

const positionAtNormalizedOffset = (source: string, offset: number): vscode.Position => {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return new vscode.Position(line, clamped - lineStart);
};

const rangeFor = (source: string, range: { from: number; to: number }): vscode.Range =>
  new vscode.Range(
    positionAtNormalizedOffset(source, range.from),
    positionAtNormalizedOffset(source, range.to)
  );

const lineRangeFor = (source: string, range: { from: number; to: number }): vscode.Range => {
  const start = Math.max(0, Math.min(range.from, source.length));
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = source.indexOf("\n", Math.max(start, range.to));
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  return rangeFor(source, { from: lineStart, to: lineEnd });
};

const normalizedOffsetAt = (source: string, position: vscode.Position): number => {
  let line = 0;
  let offset = 0;
  while (line < position.line && offset < source.length) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
    line += 1;
  }
  const lineEnd = source.indexOf("\n", offset);
  const end = lineEnd === -1 ? source.length : lineEnd;
  return Math.min(offset + Math.max(0, position.character), end);
};

const applyEdits = (
  source: string,
  edits: readonly { from: number; to: number; newText: string }[]
): string => [...edits]
  .sort((left, right) => right.from - left.from || right.to - left.to)
  .reduce((current, edit) => current.slice(0, edit.from) + edit.newText + current.slice(edit.to), source);

export class VscodeMultiDocumentHost implements vscode.Disposable {
  private readonly coordinator = new MultiDocumentGraphCoordinator<unknown>();
  private readonly discoveryCache = new SavedDocumentArtifactCache<unknown>();
  private readonly rootByDocumentId = new Map<DocumentId, RootState>();
  private readonly sessionByDocumentId = new Map<DocumentId, NuiLanguageAnalysisSession>();
  private readonly knownDocumentIdByUri = new Map<string, DocumentId>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private publicationRevision = 0;
  private disposed = false;

  constructor(private readonly options: VscodeMultiDocumentHostOptions = {}) {}

  start(): void {
    if (this.disposed) return;
    activeHost = this;
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (!supportedDocument(document)) return;
        void this.activateRoot(document).then(() =>
          this.refreshRootsContaining(this.documentIdForUri(document.uri))
        );
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!supportedDocument(event.document)) return;
        const changedId = this.documentIdForUri(event.document.uri);
        this.syncSession(event.document, changedId);
        void this.activateRoot(event.document);
        void this.refreshRootsContaining(changedId, changedId);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!supportedDocument(document)) return;
        void this.savedFileChanged(document.uri, "change");
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!supportedDocument(document)) return;
        const documentId = this.documentIdForUri(document.uri);
        const state = this.rootByDocumentId.get(documentId);
        if (state?.documentUri === document.uri.toString()) {
          state.requestRevision += 1;
          this.rootByDocumentId.delete(documentId);
          publishVscodeMultiDocumentGraphPublication(state.documentUri, {
            type: "multiDocumentGraphPublication",
            documentVersion: null,
            status: "unavailable",
            graph: null
          });
        }
        this.sessionByDocumentId.delete(documentId);
        void this.refreshRootsContaining(documentId, documentId);
      })
    );

    const watcher = vscode.workspace.createFileSystemWatcher("**/*.nui");
    this.subscriptions.push(
      watcher,
      watcher.onDidChange((uri) => void this.savedFileChanged(uri, "change")),
      watcher.onDidCreate((uri) => void this.savedFileChanged(uri, "create")),
      watcher.onDidDelete((uri) => void this.savedFileChanged(uri, "delete"))
    );

    for (const document of vscode.workspace.textDocuments) {
      if (supportedDocument(document)) void this.activateRoot(document);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (activeHost === this) activeHost = null;
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.rootByDocumentId.clear();
    this.sessionByDocumentId.clear();
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<VscodeMultiDocumentHandled<vscode.DefinitionLink[] | undefined>> {
    const query = await this.queryContext(document, position);
    if (!query || (!query.selected.publicIdentity && !query.selected.importAliasIdentity)) {
      return { handled: false };
    }
    if (!query.index.valid) return { handled: true, value: undefined };
    const result = queryMultiDocumentDefinition({
      index: query.index,
      documentId: query.documentId,
      position: query.position
    });
    if (!result) return { handled: true, value: undefined };

    const originSource = query.index.sourceByDocument.get(result.reference.source.documentId);
    const targetSource = query.index.sourceByDocument.get(result.target.source.documentId);
    if (!originSource || !targetSource) return { handled: true, value: undefined };
    return {
      handled: true,
      value: [{
        originSelectionRange: rangeFor(originSource.normalizedSource, result.reference.range),
        targetUri: vscode.Uri.parse(String(result.target.source.documentId)),
        targetRange: lineRangeFor(targetSource.normalizedSource, result.target.range),
        targetSelectionRange: rangeFor(targetSource.normalizedSource, result.target.range)
      }]
    };
  }

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    includeDeclaration: boolean
  ): Promise<VscodeMultiDocumentHandled<vscode.Location[]>> {
    const query = await this.queryContext(document, position);
    if (!query || (!query.selected.publicIdentity && !query.selected.importAliasIdentity)) {
      return { handled: false };
    }
    if (!query.index.valid) return { handled: true, value: [] };

    const reverse = query.selected.publicIdentity
      ? await this.discoverReverseImporters(query.index, query.selected.occurrence.identity)
      : { discovery: undefined, indexes: [] as const };
    if (query.selected.publicIdentity && reverse.discovery?.status !== "complete") {
      return { handled: true, value: [] };
    }
    const result = queryMultiDocumentReferences({
      index: query.index,
      documentId: query.documentId,
      position: query.position,
      ...(reverse.discovery ? { reverseImporters: reverse.discovery } : {})
    });
    if (!result) return { handled: true, value: [] };
    const locations = includeDeclaration
      ? [result.declaration, ...result.references]
      : result.references;
    const indexes = [query.index, ...reverse.indexes];
    return {
      handled: true,
      value: locations.flatMap((location) => {
        const source = this.sourceForLocation(indexes, location.source);
        return source
          ? [new vscode.Location(
              vscode.Uri.parse(String(location.source.documentId)),
              rangeFor(source.normalizedSource, location.range)
            )]
          : [];
      })
    };
  }

  async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<VscodeMultiDocumentHandled<{ range: vscode.Range; placeholder: string } | undefined>> {
    const query = await this.queryContext(document, position);
    if (!query || (!query.selected.publicIdentity && !query.selected.importAliasIdentity)) {
      return { handled: false };
    }
    if (!query.index.valid) return { handled: true, value: undefined };
    const source = query.index.sourceByDocument.get(query.documentId);
    if (!source) return { handled: true, value: undefined };
    const token = source.normalizedSource.slice(
      query.selected.occurrence.location.range.from,
      query.selected.occurrence.location.range.to
    );
    if (!token) return { handled: true, value: undefined };
    return {
      handled: true,
      value: {
        range: rangeFor(source.normalizedSource, query.selected.occurrence.location.range),
        placeholder: token
      }
    };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): Promise<VscodeMultiDocumentHandled<vscode.WorkspaceEdit | undefined>> {
    const query = await this.queryContext(document, position);
    if (!query || (!query.selected.publicIdentity && !query.selected.importAliasIdentity)) {
      return { handled: false };
    }
    if (!query.index.valid) return { handled: true, value: undefined };

    const reverse = query.selected.publicIdentity
      ? await this.discoverReverseImporters(query.index, query.selected.occurrence.identity)
      : { discovery: undefined, indexes: [] as const };
    if (query.selected.publicIdentity && reverse.discovery?.status !== "complete") {
      return { handled: true, value: undefined };
    }

    const proveDocument = query.selected.importAliasIdentity
      ? this.proveImportAliasRename
      : this.options.renameProof;
    if (!proveDocument) return { handled: true, value: undefined };

    const result = planMultiDocumentRename({
      index: query.index,
      documentId: query.documentId,
      position: query.position,
      newName,
      proveDocument,
      ...(reverse.discovery ? { reverseImporters: reverse.discovery } : {})
    });
    if (result.status !== "ok") return { handled: true, value: undefined };

    const indexes = [query.index, ...reverse.indexes];
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const documentPlan of result.plan.documents) {
      const source = this.sourceForLocation(indexes, documentPlan.source);
      if (!source || !(await this.sourceStillCurrent(source))) {
        return { handled: true, value: undefined };
      }
      const uri = vscode.Uri.parse(String(documentPlan.source.documentId));
      for (const edit of documentPlan.edits) {
        if (source.normalizedSource.slice(edit.from, edit.to) !== edit.expectedText) {
          return { handled: true, value: undefined };
        }
        workspaceEdit.replace(uri, rangeFor(source.normalizedSource, edit), edit.newText);
      }
    }
    return { handled: true, value: workspaceEdit };
  }

  private readonly proveImportAliasRename: MultiDocumentRenameDocumentProof = ({
    source,
    occurrences,
    newName
  }) => {
    const edits = occurrences.map((occurrence) => ({
      from: occurrence.location.range.from,
      to: occurrence.location.range.to,
      expectedText: source.normalizedSource.slice(
        occurrence.location.range.from,
        occurrence.location.range.to
      ),
      newText: newName
    }));
    if (edits.some((edit) => !edit.expectedText)) {
      return { status: "rejected", reason: "empty occurrence" };
    }
    const nextSource = applyEdits(source.normalizedSource, edits);
    const checked = analyzeMultiDocumentSource({
      kind: "root-current",
      documentId: source.documentId,
      normalizedSource: nextSource,
      sourceRevision: source.kind === "root-current" ? source.sourceRevision + 1 : 1
    }, {
      declarationContributors: this.options.declarationContributors
    });
    return checked.syntaxValid
      ? { status: "ok", edits }
      : { status: "rejected", reason: "invalid alias rename" };
  };

  private async queryContext(document: vscode.TextDocument, position: vscode.Position): Promise<{
    documentId: DocumentId;
    position: number;
    index: MultiDocumentSemanticOccurrenceIndex;
    selected: SelectedOccurrence;
  } | null> {
    if (!supportedDocument(document)) return null;
    await this.activateRoot(document);
    const documentId = this.documentIdForUri(document.uri);
    const state = this.rootByDocumentId.get(documentId);
    if (state?.pending) await state.pending;
    const index = state?.index;
    if (!index) return null;
    const source = index.sourceByDocument.get(documentId);
    if (!source) return null;
    const normalizedPosition = normalizedOffsetAt(source.normalizedSource, position);
    const selected = this.selectedOccurrenceAt(index, documentId, normalizedPosition);
    return selected ? { documentId, position: normalizedPosition, index, selected } : null;
  }

  private selectedOccurrenceAt(
    index: MultiDocumentSemanticOccurrenceIndex,
    documentId: DocumentId,
    position: number
  ): SelectedOccurrence | null {
    const source = index.sourceByDocument.get(documentId);
    if (!source) return null;
    const matches = index.occurrences
      .filter((occurrence) =>
        occurrence.location.source.documentId === documentId &&
        sourceSnapshotMatchesIdentity(source, occurrence.location.source) &&
        occurrence.location.range.from <= position &&
        position <= occurrence.location.range.to
      )
      .sort((left, right) =>
        (left.location.range.to - left.location.range.from) -
        (right.location.range.to - right.location.range.from)
      );
    if (matches.length === 0) return null;
    const shortest = matches[0]!.location.range.to - matches[0]!.location.range.from;
    const shortestMatches = matches.filter((occurrence) =>
      occurrence.location.range.to - occurrence.location.range.from === shortest
    );
    const identities = new Map(
      shortestMatches.map((occurrence) => [identityKey(occurrence.identity), occurrence])
    );
    if (identities.size !== 1) return null;
    const occurrence = shortestMatches[0]!;
    return {
      occurrence,
      publicIdentity: this.isPublicIdentity(index, occurrence.identity),
      importAliasIdentity: this.isImportAliasIdentity(index, occurrence.identity)
    };
  }

  private isPublicIdentity(
    index: MultiDocumentSemanticOccurrenceIndex,
    identity: DocumentQualifiedSemanticIdentity<string>
  ): boolean {
    return [...index.graph.nodes.values()].some((node) =>
      [...node.publicApi.publicEntriesByName.values()].some((entry) =>
        sameIdentity(entry.identity, identity)
      )
    );
  }

  private isImportAliasIdentity(
    index: MultiDocumentSemanticOccurrenceIndex,
    identity: DocumentQualifiedSemanticIdentity<string>
  ): boolean {
    return [...index.graph.nodes.values()].some((node) =>
      node.artifact.imports.some((directive) => sameIdentity(directive.identity, identity))
    );
  }

  private async activateRoot(document: vscode.TextDocument): Promise<void> {
    if (this.disposed || !supportedDocument(document)) return;
    const documentId = this.documentIdForUri(document.uri);
    let state = this.rootByDocumentId.get(documentId);
    if (!state) {
      state = {
        documentId,
        documentUri: document.uri.toString(),
        documentVersion: document.version,
        requestRevision: 0,
        graphRevision: 0,
        graph: null,
        index: null,
        pending: null
      };
      this.rootByDocumentId.set(documentId, state);
    }
    const rawSource = document.getText();
    const session = this.syncSession(document, documentId);
    if (
      state.documentVersion === document.version &&
      state.graph &&
      state.index &&
      session.getSource() === rawSource
    ) return;

    state.documentUri = document.uri.toString();
    state.documentVersion = document.version;
    const requestRevision = ++state.requestRevision;
    publishVscodeMultiDocumentGraphPublication(state.documentUri, {
      type: "multiDocumentGraphPublication",
      documentVersion: document.version,
      status: "building",
      graph: null
    });
    const pending = this.rebuildRoot(document, state, requestRevision);
    state.pending = pending;
    try {
      await pending;
    } finally {
      if (state.pending === pending) state.pending = null;
    }
  }

  private async rebuildRoot(
    document: vscode.TextDocument,
    state: RootState,
    requestRevision: number
  ): Promise<void> {
    const rawSource = document.getText();
    const session = this.syncSession(document, state.documentId);
    const normalizedSource = normalizedSourceFor(rawSource);
    const root: RootCurrentSourceSnapshot = {
      kind: "root-current",
      documentId: state.documentId,
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    };
    const semantic = session.definitionSemanticSnapshot({
      normalizedSource,
      sourceRevision: root.sourceRevision
    });
    const result = await this.coordinator.rebuild({
      root,
      loader: this.savedLoader,
      declarationContributors: this.options.declarationContributors,
      ...(semantic?.compiled.statementMap?.statementIdByStatementIndex
        ? { rootStatementIdByStatementIndex: semantic.compiled.statementMap.statementIdByStatementIndex }
        : {})
    });
    if (
      result.status !== "current" ||
      this.disposed ||
      state.requestRevision !== requestRevision ||
      this.rootByDocumentId.get(state.documentId) !== state ||
      document.version !== state.documentVersion ||
      document.getText() !== rawSource
    ) return;

    const rootView = semantic
      ? this.semanticViewFor(root, session, semantic.compiled)
      : { source: root, valid: false, occurrences: [] };
    const index = await this.semanticIndexForGraph(result.graph, rootView);
    if (state.requestRevision !== requestRevision || this.rootByDocumentId.get(state.documentId) !== state) {
      return;
    }
    state.graph = result.graph;
    state.index = index;
    state.graphRevision = ++this.publicationRevision;
    publishVscodeMultiDocumentGraphPublication(state.documentUri, {
      type: "multiDocumentGraphPublication",
      documentVersion: state.documentVersion,
      status: "current",
      graph: vscodeMultiDocumentGraphSnapshot(result.graph, state.graphRevision)
    });
  }

  private semanticViewFor(
    source: RootCurrentSourceSnapshot,
    session: NuiLanguageAnalysisSession,
    compiled: NonNullable<ReturnType<NuiLanguageAnalysisSession["definitionSemanticSnapshot"]>>["compiled"]
  ): MultiDocumentSemanticDocumentView {
    return projectDslSemanticDocumentView({
      source,
      compiled,
      valid: !session.getDiagnostics().some((diagnostic) => diagnostic.severity === "error"),
      ...(this.options.identityProjector
        ? { identityFor: (identity) => this.options.identityProjector!(source.documentId, identity) }
        : {})
    });
  }

  private async semanticIndexForGraph(
    graph: MultiDocumentImportGraph<unknown>,
    rootView?: MultiDocumentSemanticDocumentView
  ): Promise<MultiDocumentSemanticOccurrenceIndex> {
    const views: MultiDocumentSemanticDocumentView[] = rootView ? [rootView] : [];
    for (const [documentId] of graph.nodes) {
      if (rootView?.source.documentId === documentId) continue;
      const document = this.openDocumentFor(documentId);
      if (!document) continue;
      if (documentId !== graph.rootDocumentId && !document.isDirty) continue;
      const session = this.syncSession(document, documentId);
      const source: RootCurrentSourceSnapshot = {
        kind: "root-current",
        documentId,
        normalizedSource: normalizedSourceFor(document.getText()),
        sourceRevision: session.getSourceRevision()
      };
      const semantic = session.definitionSemanticSnapshot({
        normalizedSource: source.normalizedSource,
        sourceRevision: source.sourceRevision
      });
      views.push(semantic
        ? this.semanticViewFor(source, session, semantic.compiled)
        : { source, valid: false, occurrences: [] });
    }
    return buildMultiDocumentSemanticOccurrenceIndex({ graph, documentViews: views });
  }

  private async discoverReverseImporters(
    rootIndex: MultiDocumentSemanticOccurrenceIndex,
    identity: DocumentQualifiedSemanticIdentity<string>
  ): Promise<ReverseDiscoveryResult> {
    let uris: vscode.Uri[];
    try {
      uris = await vscode.workspace.findFiles("**/*.nui");
    } catch {
      return { discovery: { status: "incomplete" }, indexes: [] };
    }

    const indexes: MultiDocumentSemanticOccurrenceIndex[] = [];
    for (const uri of uris) {
      const documentId = this.documentIdForUri(uri);
      if (documentId === rootIndex.graph.rootDocumentId) continue;
      const active = this.rootByDocumentId.get(documentId);
      if (active?.pending) await active.pending;
      if (active?.index) {
        if (!active.index.valid) {
          return { discovery: { status: "incomplete", indexes }, indexes };
        }
        if (this.indexMayReferenceIdentity(active.index, identity)) indexes.push(active.index);
        continue;
      }

      const built = await this.discoveryIndexForUri(uri);
      if (!built || !built.valid) {
        return { discovery: { status: "incomplete", indexes }, indexes };
      }
      if (this.indexMayReferenceIdentity(built, identity)) indexes.push(built);
    }
    return { discovery: { status: "complete", indexes }, indexes };
  }

  private indexMayReferenceIdentity(
    index: MultiDocumentSemanticOccurrenceIndex,
    identity: DocumentQualifiedSemanticIdentity<string>
  ): boolean {
    return index.graph.nodes.has(identity.documentId) ||
      index.occurrences.some((occurrence) => sameIdentity(occurrence.identity, identity));
  }

  private async discoveryIndexForUri(uri: vscode.Uri): Promise<MultiDocumentSemanticOccurrenceIndex | null> {
    try {
      const documentId = this.documentIdForUri(uri);
      const openDocument = this.openDocumentFor(documentId);
      const savedRoot = openDocument ? null : await this.readSavedSnapshot(uri);
      const session = openDocument
        ? this.syncSession(openDocument, documentId)
        : createLanguageAnalysisSession(savedRoot!.normalizedSource);
      const normalizedSource = openDocument
        ? normalizedSourceFor(openDocument.getText())
        : savedRoot!.normalizedSource;
      const root: RootCurrentSourceSnapshot = {
        kind: "root-current",
        documentId,
        normalizedSource,
        sourceRevision: session.getSourceRevision()
      };
      const semantic = session.definitionSemanticSnapshot({
        normalizedSource,
        sourceRevision: root.sourceRevision
      });
      const graph = await buildMultiDocumentImportGraph({
        root,
        loader: this.savedLoader,
        cache: this.discoveryCache,
        declarationContributors: this.options.declarationContributors,
        ...(semantic?.compiled.statementMap?.statementIdByStatementIndex
          ? { rootStatementIdByStatementIndex: semantic.compiled.statementMap.statementIdByStatementIndex }
          : {})
      });
      const rootView = semantic
        ? this.semanticViewFor(root, session, semantic.compiled)
        : { source: root, valid: false, occurrences: [] };
      return this.semanticIndexForGraph(graph, rootView);
    } catch {
      return null;
    }
  }

  private sourceForLocation(
    indexes: readonly MultiDocumentSemanticOccurrenceIndex[],
    identity: DocumentSourceIdentity
  ): MultiDocumentSourceSnapshot | null {
    for (const index of indexes) {
      const source = index.sourceByDocument.get(identity.documentId);
      if (source && sourceSnapshotMatchesIdentity(source, identity)) return source;
    }
    return null;
  }

  private async sourceStillCurrent(source: MultiDocumentSourceSnapshot): Promise<boolean> {
    const open = this.openDocumentFor(source.documentId);
    if (open && source.kind === "root-current") {
      const session = this.syncSession(open, source.documentId);
      return session.getSourceRevision() === source.sourceRevision &&
        normalizedSourceFor(open.getText()) === source.normalizedSource;
    }
    if (open?.isDirty && source.kind === "dependency-saved") return false;
    try {
      const saved = await this.readSavedSnapshot(vscode.Uri.parse(String(source.documentId)));
      if (saved.normalizedSource !== source.normalizedSource) return false;
      return source.kind !== "dependency-saved" ||
        saved.savedSourceFingerprint === source.savedSourceFingerprint;
    } catch {
      return false;
    }
  }

  private syncSession(document: vscode.TextDocument, documentId: DocumentId): NuiLanguageAnalysisSession {
    const rawSource = document.getText();
    let session = this.sessionByDocumentId.get(documentId);
    if (!session) {
      session = createLanguageAnalysisSession(rawSource);
      this.sessionByDocumentId.set(documentId, session);
    } else if (session.getSource() !== rawSource) {
      session.replaceSource(rawSource);
    }
    return session;
  }

  private openDocumentFor(documentId: DocumentId): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((document) =>
      supportedDocument(document) && this.documentIdForUri(document.uri) === documentId
    );
  }

  private documentIdForUri(uri: vscode.Uri): DocumentId {
    const key = uri.toString();
    const known = this.knownDocumentIdByUri.get(key);
    if (known) return known;
    const documentId = canonicalVscodeDocumentId(uri);
    this.knownDocumentIdByUri.set(key, documentId);
    this.knownDocumentIdByUri.set(vscode.Uri.parse(String(documentId)).toString(), documentId);
    return documentId;
  }

  private readonly savedLoader: MultiDocumentSavedSourceLoader = {
    loadSavedDependency: async (importerDocumentId, validatedRelativePath) => {
      try {
        const importer = vscode.Uri.parse(String(importerDocumentId));
        if (importer.scheme !== "file") {
          return { status: "failed", reason: "root-unaddressable" };
        }
        const target = vscode.Uri.file(path.resolve(path.dirname(importer.fsPath), validatedRelativePath));
        return { status: "loaded", snapshot: await this.readSavedSnapshot(target) };
      } catch (error) {
        return {
          status: "failed",
          reason: fileNotFound(error) ? "missing" : "unreadable",
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };

  private async readSavedSnapshot(uri: vscode.Uri): Promise<DependencySavedSourceSnapshot> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const normalizedSource = normalizedSourceFor(utf8Decoder.decode(bytes));
    const documentId = canonicalVscodeDocumentId(uri);
    this.knownDocumentIdByUri.set(uri.toString(), documentId);
    return {
      kind: "dependency-saved",
      documentId,
      normalizedSource,
      savedSourceFingerprint: fingerprintFor(bytes)
    };
  }

  private async savedFileChanged(uri: vscode.Uri, kind: "change" | "create" | "delete"): Promise<void> {
    if (this.disposed || !supportedUri(uri)) return;
    const uriKey = uri.toString();
    const documentId = kind === "delete"
      ? this.knownDocumentIdByUri.get(uriKey) ?? canonicalVscodeDocumentId(uri)
      : canonicalVscodeDocumentId(uri);
    this.knownDocumentIdByUri.set(uriKey, documentId);
    const affected = this.coordinator.invalidateSavedDependency(documentId);
    const rebuildIds = new Set<DocumentId>(affected);
    if (this.rootByDocumentId.has(documentId)) rebuildIds.add(documentId);
    if (kind !== "change") {
      for (const rootId of this.rootByDocumentId.keys()) rebuildIds.add(rootId);
    }
    for (const rootId of rebuildIds) {
      const state = this.rootByDocumentId.get(rootId);
      if (!state) continue;
      state.graph = null;
      state.index = null;
      publishVscodeMultiDocumentGraphPublication(state.documentUri, {
        type: "multiDocumentGraphPublication",
        documentVersion: state.documentVersion,
        status: "invalidated",
        graph: null
      });
    }
    for (const rootId of rebuildIds) {
      const document = this.openDocumentFor(rootId);
      if (document) await this.activateRoot(document);
    }
  }

  private async refreshRootsContaining(documentId: DocumentId, exclude?: DocumentId): Promise<void> {
    const documents: vscode.TextDocument[] = [];
    for (const [rootId, state] of this.rootByDocumentId) {
      if (rootId === exclude || rootId === documentId || !state.graph?.nodes.has(documentId)) continue;
      const document = this.openDocumentFor(rootId);
      if (document) documents.push(document);
    }
    for (const document of documents) {
      const state = this.rootByDocumentId.get(this.documentIdForUri(document.uri));
      if (state) {
        state.documentVersion = -1;
        await this.activateRoot(document);
      }
    }
  }
}

let activeHost: VscodeMultiDocumentHost | null = null;

export const activeVscodeMultiDocumentHost = (): VscodeMultiDocumentHost | null => activeHost;

/** Default production host. Family-specific contributors are plugged in by their owning issues. */
export const createVscodeMultiDocumentHost = (
  options: VscodeMultiDocumentHostOptions = {}
): VscodeMultiDocumentHost => new VscodeMultiDocumentHost(options);

/** Keep the generic compiler identity projection available to future family adapters. */
export const defaultVscodeMultiDocumentIdentityProjector: VscodeMultiDocumentIdentityProjector = (
  documentId,
  identity
) => qualifySemanticIdentity(documentId, dslSemanticIdentityKey(identity));
