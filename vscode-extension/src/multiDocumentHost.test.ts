import { afterEach, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  files: new Map<string, Uint8Array>(),
  publications: [] as Array<{ documentUri: string; publication: unknown }>,
  openListeners: [] as Array<(document: TestDocument) => void>,
  changeListeners: [] as Array<(event: { document: TestDocument }) => void>,
  saveListeners: [] as Array<(document: TestDocument) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  watcherChangeListeners: [] as Array<(uri: TestUri) => void>,
  watcherCreateListeners: [] as Array<(uri: TestUri) => void>,
  watcherDeleteListeners: [] as Array<(uri: TestUri) => void>,
  watcherDispose: vi.fn(),
  findFiles: vi.fn(async () => [] as TestUri[])
}));

type TestUri = {
  scheme: string;
  fsPath: string;
  toString: () => string;
};

type TestDocument = {
  uri: TestUri;
  fileName: string;
  version: number;
  isDirty: boolean;
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  positionAt: (offset: number) => vscode.Position;
};

const disposable = () => ({ dispose: vi.fn() });

vi.mock("vscode", () => {
  const fileUri = (filePath: string): TestUri => {
    const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
    return {
      scheme: "file",
      fsPath: normalized,
      toString: () => `file://${normalized}`
    };
  };

  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class CompletionItem {
    constructor(public readonly label: string, public readonly kind: number) {}
  }
  class Location {
    constructor(public readonly uri: TestUri, public readonly range: Range) {}
  }
  class WorkspaceEdit {
    readonly replacements: unknown[] = [];
    replace(uri: TestUri, range: Range, newText: string): void {
      this.replacements.push({ uri, range, newText });
    }
  }
  class FileSystemError extends Error {
    constructor(message: string, public readonly code?: string) {
      super(message);
    }
  }

  return {
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      fs: {
        readFile: vi.fn(async (uri: TestUri) => {
          const bytes = mocks.files.get(uri.fsPath);
          if (!bytes) throw new FileSystemError(`missing ${uri.fsPath}`, "FileNotFound");
          return bytes;
        })
      },
      findFiles: mocks.findFiles,
      onDidOpenTextDocument: vi.fn((listener: (document: TestDocument) => void) => {
        mocks.openListeners.push(listener);
        return disposable();
      }),
      onDidChangeTextDocument: vi.fn((listener: (event: { document: TestDocument }) => void) => {
        mocks.changeListeners.push(listener);
        return disposable();
      }),
      onDidSaveTextDocument: vi.fn((listener: (document: TestDocument) => void) => {
        mocks.saveListeners.push(listener);
        return disposable();
      }),
      onDidCloseTextDocument: vi.fn((listener: (document: TestDocument) => void) => {
        mocks.closeListeners.push(listener);
        return disposable();
      }),
      createFileSystemWatcher: vi.fn(() => ({
        dispose: mocks.watcherDispose,
        onDidChange: (listener: (uri: TestUri) => void) => {
          mocks.watcherChangeListeners.push(listener);
          return disposable();
        },
        onDidCreate: (listener: (uri: TestUri) => void) => {
          mocks.watcherCreateListeners.push(listener);
          return disposable();
        },
        onDidDelete: (listener: (uri: TestUri) => void) => {
          mocks.watcherDeleteListeners.push(listener);
          return disposable();
        }
      }))
    },
    Uri: {
      file: fileUri,
      parse: (value: string) => {
        if (!value.startsWith("file://")) {
          return { scheme: value.split(":", 1)[0] ?? "", fsPath: "", toString: () => value };
        }
        return fileUri(value.slice("file://".length));
      }
    },
    Position,
    Range,
    CompletionItem,
    CompletionItemKind: { Property: 1, Function: 2, Value: 3 },
    env: { language: "en" },
    Location,
    WorkspaceEdit,
    FileSystemError
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("../../src/vscode/vscodeWebviewSession", () => ({
  publishVscodeMultiDocumentGraphPublication: (documentUri: string, publication: unknown) => {
    mocks.publications.push({ documentUri, publication });
  }
}));

import * as vscode from "vscode";
import issue1490 from "../../test/fixtures/issue-1490/matrix.json";
import { compileFreshCanonicalText, isLastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { compileDslDocument, createModuleRuntimeContext, queryDslCompletion, sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  moduleDeclarationContributor
} from "@nuinuicad/nui-language/workspace";
import { queryDslSignatureHelp } from "@nuinuicad/nui-language";
import { diagnosticTextFor } from "./diagnosticLocalization";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { CanvasImageResources } from "./canvasImageResources";
import { canvasImageSourceUrl } from "../../src/vscode/canvasImageResources";
import { canonicalVscodeDocumentId, VscodeMultiDocumentHost } from "./multiDocumentHost";
import { createVscodeModuleMultiDocumentHost } from "./moduleMultiDocumentHost";
import { createNuiRenameProvider } from "./renameProvider";
import { createNuiCompletionProvider, normalizedOffsetAt, normalizedPositionAt } from "./completionProvider";
import { evaluateElements } from "../../src/geometry/evaluate";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import type { VscodeMultiDocumentGraphPublication } from "../../src/vscode/multiDocumentGraphTransport";

const encoder = new TextEncoder();

const documentFor = (
  filePath: string,
  source: string,
  options: { version?: number; dirty?: boolean } = {}
): TestDocument => ({
  uri: vscode.Uri.file(filePath) as unknown as TestUri,
  fileName: filePath,
  version: options.version ?? 1,
  isDirty: options.dirty ?? false,
  getText: () => source,
  offsetAt: (position) => normalizedOffsetAt(source, position),
  positionAt: (offset) => normalizedPositionAt(source, offset)
});

const currentPublicationsFor = (documentUri: string) => mocks.publications.filter((entry) => {
  const publication = entry.publication as VscodeMultiDocumentGraphPublication;
  return entry.documentUri === documentUri && publication.status === "current";
});

const latestCurrentGraphFor = (documentUri: string) => {
  const entry = currentPublicationsFor(documentUri).at(-1);
  const publication = entry?.publication as VscodeMultiDocumentGraphPublication | undefined;
  return publication?.status === "current" ? publication.graph : null;
};

const latestCurrentPublicationFor = (documentUri: string) => {
  const entry = currentPublicationsFor(documentUri).at(-1);
  return entry?.publication as Extract<VscodeMultiDocumentGraphPublication, { status: "current" }> | undefined;
};

afterEach(() => {
  mocks.textDocuments = [];
  mocks.files.clear();
  mocks.publications = [];
  mocks.openListeners = [];
  mocks.changeListeners = [];
  mocks.saveListeners = [];
  mocks.closeListeners = [];
  mocks.watcherChangeListeners = [];
  mocks.watcherCreateListeners = [];
  mocks.watcherDeleteListeners = [];
  mocks.watcherDispose.mockClear();
  mocks.findFiles.mockClear();
});

describe("VS Code completion with the active Module host", () => {
  it("#1654 separates the exact imported Canvas root from standalone image-resource publication", async () => {
    const rootPath = "/tmp/front_import_instance.nui";
    const probePath = "/tmp/probe.nui";
    const imageDefinition = [
      "image Ref = image(",
      '  source: "./reference.png",',
      "  origin: (0, 0),",
      "  naturalWidthPx: 600,",
      "  naturalHeightPx: 400,",
      "  sourceDpi: 150,",
      "  targetPixelsPerMm: 5.905511811,",
      "  scale: 1,",
      ")"
    ].join("\n");
    const rootSource = [
      "nui 1",
      'import "./probe.nui" as probe',
      imageDefinition,
      "instance N = probe::Probe(x: 20)"
    ].join("\n");
    const probeSource = [
      "nui 1",
      "export module Probe(x: number) {",
      "  point marker = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n");
    mocks.files.set(probePath, encoder.encode(probeSource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      const rootUri = root.uri.toString();
      await vi.waitFor(() => {
        expect(latestCurrentPublicationFor(rootUri)?.canvasRuntime).toBeDefined();
      });

      const semantic = await host.languageSemanticSnapshotFor(root);
      expect(semantic).toMatchObject({
        documentVersion: root.version,
        sourceText: rootSource,
        rootDocumentId: rootUri
      });
      expect(semantic?.compiled.spans.sourceMap).toMatchObject({
        source: rootSource,
        sourceRevision: semantic?.sourceRevision
      });
      const graphImages = semantic?.compiled.document?.elements.filter((element) => element.type === "image") ?? [];
      expect(graphImages).toEqual([expect.objectContaining({ sourcePath: "./reference.png" })]);

      const graphPublication = latestCurrentPublicationFor(rootUri);
      const canvasRuntime = graphPublication?.canvasRuntime;
      const canvasImages = canvasRuntime?.preparedRustEvaluation.input.elements
        .filter((element) => element.type === "image") ?? [];
      expect(graphPublication?.graph).toMatchObject({ rootDocumentId: rootUri, rootSource: { normalizedSource: rootSource } });
      expect(canvasRuntime).toMatchObject({
        rootDocumentId: rootUri,
        rootSourceRevision: semantic?.sourceRevision,
        graphRevision: graphPublication?.graph.revision
      });
      expect(canvasImages).toEqual([expect.objectContaining({ sourcePath: "./reference.png" })]);

      const standalone = createLanguageAnalysisSession(rootSource);
      const standaloneSnapshot = standalone.runtimeEvaluationSnapshot();
      const standaloneEvidence = {
        documentVersion: root.version,
        sourceMatchesGraphRoot: standalone.getSource() === semantic?.sourceText,
        sourceRevision: standalone.getSourceRevision(),
        graphSourceRevision: semantic?.sourceRevision,
        diagnostics: standalone.diagnostics().map(({ code, severity }) => ({ code, severity })),
        snapshotAvailable: standaloneSnapshot !== null,
        compiledImageSourcePaths: standaloneSnapshot?.compiled.document?.elements
          .filter((element) => element.type === "image").map((element) => element.sourcePath) ?? []
      };
      expect(standaloneEvidence).toMatchObject({
        documentVersion: 1,
        sourceMatchesGraphRoot: true,
        sourceRevision: semantic?.sourceRevision,
        graphSourceRevision: semantic?.sourceRevision,
        diagnostics: [{ code: "module-unresolved-callee", severity: "error" }],
        snapshotAvailable: false,
        compiledImageSourcePaths: []
      });
      const imageWebview = {
        options: { enableScripts: true },
        asWebviewUri: (uri: TestUri) => ({
          toString: () => `https://file.vscode-resource.test${new URL(uri.toString()).pathname}`
        })
      } as unknown as vscode.Webview;
      const authority = new CanvasImageResources(vscode.Uri.file("/tmp/extension/dist"));
      const standalonePublished = authority.publishDocument(
        imageWebview,
        root as unknown as vscode.TextDocument,
        standalone,
        { evaluateCurrent: vi.fn() } as never,
        () => true,
        vi.fn()
      );
      expect(standalonePublished).toEqual({});
      expect(imageWebview.options.localResourceRoots?.map((uri) => uri.toString())).toEqual(["file:///tmp/extension/dist"]);
      const graphPublished = authority.publishGraphDocument(
        imageWebview,
        root as unknown as vscode.TextDocument,
        semantic!,
        () => true
      );
      expect(graphPublished).toEqual({
        "./reference.png": "https://file.vscode-resource.test/tmp/reference.png"
      });
      const publicationEvidence = {
        ...standaloneEvidence,
        standalonePublication: standalonePublished,
        graphPublication: graphPublished,
        localResourceRoots: imageWebview.options.localResourceRoots?.map((uri) => uri.toString()),
        canvasImageSourceUrl: canvasImageSourceUrl("./reference.png", graphPublished ?? {})
      };
      expect(publicationEvidence.canvasImageSourceUrl).toBe("https://file.vscode-resource.test/tmp/reference.png");
      expect(publicationEvidence.localResourceRoots).toEqual(["file:///tmp/extension/dist", "file:///tmp"]);

      const graphAuthority = {
        rootDocumentId: semantic.rootDocumentId,
        graphRevision: semantic.graphRevision
      };
      expect(await host.isCanvasGraphCommitAuthorityCurrent(root as unknown as vscode.TextDocument, graphAuthority)).toBe(true);
      mocks.files.set(probePath, encoder.encode(`${probeSource}\n// saved dependency revision changed`));
      mocks.watcherChangeListeners[0]?.(vscode.Uri.file(probePath) as unknown as TestUri);
      await vi.waitFor(() => {
        const current = latestCurrentPublicationFor(rootUri);
        expect(current?.graph.revision).not.toBe(graphAuthority.graphRevision);
      });
      expect(await host.isCanvasGraphCommitAuthorityCurrent(root as unknown as vscode.TextDocument, graphAuthority)).toBe(false);
    } finally {
      host.dispose();
    }
  });

  it("#1654 grants root image paths without resolving imported Module-owned images at the root", async () => {
    const rootPath = "/tmp/root-image-owner.nui";
    const libraryPath = "/tmp/image-library.nui";
    const imageFields = (sourcePath: string) => [
      "image Reference = image(",
      `  source: "${sourcePath}",`,
      "  origin: (0, 0),",
      "  naturalWidthPx: 600,",
      "  naturalHeightPx: 400,",
      "  sourceDpi: 150,",
      "  targetPixelsPerMm: 5.905511811,",
      "  scale: 1,",
      ")"
    ].join("\n");
    const rootSource = [
      "nui 1",
      'import "./image-library.nui" as library',
      imageFields("./reference.png"),
      "instance N = library::Panel()"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      imageFields("./module-owned.png"),
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      const rootUri = root.uri.toString();
      await vi.waitFor(() => {
        expect(latestCurrentPublicationFor(rootUri)?.canvasRuntime).toBeDefined();
      });
      const semantic = await host.languageSemanticSnapshotFor(root);
      expect(semantic).not.toBeNull();
      if (!semantic) return;
      const runtimeImages = latestCurrentPublicationFor(rootUri)?.canvasRuntime?.preparedRustEvaluation.input.elements
        .filter((element) => element.type === "image") ?? [];
      const importedRuntimeImage = runtimeImages.find((element) => element.sourcePath === "./module-owned.png");
      expect(importedRuntimeImage).toBeDefined();
      const importedOwner = importedRuntimeImage
        ? sourceOwnerForRuntimeElementId(semantic.compiled, importedRuntimeImage.id)
        : null;
      expect(importedOwner?.sourceDocumentId).toBe(libraryPath.startsWith("/") ? `file://${libraryPath}` : libraryPath);

      const webview = {
        options: { enableScripts: true },
        asWebviewUri: (uri: TestUri) => ({
          toString: () => `https://file.vscode-resource.test${new URL(uri.toString()).pathname}`
        })
      } as unknown as vscode.Webview;
      const authority = new CanvasImageResources(vscode.Uri.file("/tmp/extension/dist"));
      const published = authority.publishGraphDocument(
        webview,
        root as unknown as vscode.TextDocument,
        semantic,
        () => true
      );

      expect(published).toEqual({
        "./reference.png": "https://file.vscode-resource.test/tmp/reference.png"
      });
      expect(published).not.toHaveProperty("./module-owned.png");
      expect(webview.options.localResourceRoots?.map((uri) => uri.toString())).toEqual([
        "file:///tmp/extension/dist",
        "file:///tmp"
      ]);
    } finally {
      host.dispose();
    }
  });

  it("#1631 keeps the exact opened Source URI beside the realpath graph identity", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const nfcPath = "/synthetic/型紙-ず/pick_ascii.nui";
    const nfdPath = nfcPath.normalize("NFD");
    const openedUri = `file://${nfcPath}`;
    const originalRealpath = realpathSync.native;
    const realpath = vi.spyOn(realpathSync, "native").mockImplementation((candidate) =>
      String(candidate) === nfcPath ? nfdPath : originalRealpath(candidate)
    );
    const root = documentFor(nfcPath, source);
    root.uri.toString = () => openedUri;
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    try {
      const snapshot = await host.languageSemanticSnapshotFor(root);
      expect(snapshot).toMatchObject({ sourceDocumentUri: openedUri, rootDocumentId: `file://${nfdPath}` });
      const currentPublication = mocks.publications
        .map(({ publication }) => publication as VscodeMultiDocumentGraphPublication)
        .find((publication) => publication.type === "multiDocumentGraphPublication" && publication.status === "current");
      expect(currentPublication).toMatchObject({
        hostDocumentUri: String(canonicalVscodeDocumentId(root.uri as unknown as vscode.Uri)),
        graph: { rootDocumentId: String(canonicalVscodeDocumentId(root.uri as unknown as vscode.Uri)) }
      });

      const forgedAlias = documentFor(nfcPath, source);
      forgedAlias.uri.toString = () => `file:///foreign/型紙-ず/pick_ascii.nui`;
      expect(await host.languageSemanticSnapshotFor(forgedAlias)).toBeNull();
    } finally {
      host.dispose();
      realpath.mockRestore();
    }
  });

  it("#1631 keeps an ASCII-parent Source and graph identity equal", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const root = documentFor("/synthetic/ascii-parent/pick_ascii.nui", source);
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      const snapshot = await host.languageSemanticSnapshotFor(root);
      expect(snapshot?.sourceDocumentUri).toBe(root.uri.toString());
      expect(snapshot?.rootDocumentId).toBe(root.uri.toString());
    } finally {
      host.dispose();
    }
  });

  it("retains canonical knot IDs when the graph recompiles a current Source revision (#1537)", async () => {
    let text = `nui 1
module Shape() {
  export curve C = bezier(start: (0, 0), end: (10, 0), intermediates: [knot(point: (5, 2), angle: 90, incoming: 1, outgoing: 2)])
}
instance One = Shape()`;
    const root = documentFor("/workspace/knot-identity.nui", text);
    root.getText = () => text;
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const first = await host.languageSemanticSnapshotFor(root);
    expect(first).not.toBeNull();
    const firstCurve = first!.compiled.document!.elements.find(element => element.type === "bezierCurve")!;
    text = text.replace("angle: 90", "angle: 80");
    root.version += 1;
    for (const listener of mocks.changeListeners) listener({ document: root, contentChanges: [{}] });
    const second = await host.languageSemanticSnapshotFor(root);
    expect(second).not.toBeNull();
    const secondCurve = second!.compiled.document!.elements.find(element => element.type === "bezierCurve")!;
    expect(secondCurve.intermediatePoints[0]!.id).toBe(firstCurve.intermediatePoints[0]!.id);
    host.dispose();
  });

  const minimalSource = [
    "nui 1",
    "line Horizontal = segment(start: (0, 0), end: (10, 0))",
    "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
    "const lineArc: number = lineAngle(@Horizontal.start, @Arc.start)"
  ].join("\n");
  const humanSource = [
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 0, endAngle: 180, endLength: 0)",
      "const Offset: path = offset(sources: [@Curve], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "const Reversed: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Curve])",
      "arc Quarter = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Quarter_base: path = @Quarter",
      "reverse @Quarter ()",
      "const lineArc: number = lineAngle(@Horizontal.start, @Arc.start)",
      "const arcEnds: number = lineAngle(@Arc.start, @Arc.end)",
      "const zeroHandleBezier: number = lineAngle(@Curve.start, @Curve.end)",
      "const offsetArc: number = lineAngle(@Offset.end, @Arc.start)",
      "const reversedArc: number = lineAngle(@Reversed.start, @Arc.end)",
      "const stageAngle: number = lineAngle(@Quarter_base.start, @Horizontal.end)"
    ].join("\n");
  const validCall = "lineAngle(@Horizontal.start, @Arc.start)";

  const completionDocument = (source: string) => {
    let text = source;
    let session: ReturnType<typeof createLanguageAnalysisSession> | undefined;
    const root = documentFor("/workspace/endpoint-completion.nui", text);
    root.getText = () => text;
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    mocks.textDocuments = [root];
    const provider = createNuiCompletionProvider(() => session ??= createLanguageAnalysisSession(text));
    return {
      host,
      root,
      session: () => session!,
      edit: (next: string) => {
        text = next;
        root.version += 1;
        root.isDirty = true;
        for (const listener of mocks.changeListeners) listener({ document: root });
      },
      items: async (needle: string) => {
        const offset = text.indexOf(needle) + needle.length;
        expect(offset).toBeGreaterThanOrEqual(needle.length);
        return await provider.provideCompletionItems(
          root as unknown as vscode.TextDocument,
          normalizedPositionAt(text, offset),
          undefined as never,
          undefined as never
        ) as vscode.CompletionItem[];
      }
    };
  };

  it.each([
    { fixture: "minimal", mode: "cold", call: "lineAngle(@Horizontal.|, @Arc.start)", member: "" },
    { fixture: "human", mode: "cold", call: "lineAngle(@Horizontal.start, @Arc.|)", member: "" },
    { fixture: "human", mode: "live", call: "lineAngle(@Arc.|, @Arc.start)", member: "" },
    { fixture: "human", mode: "live", call: "lineAngle(@Horizontal.start, @Horizontal.|)", member: "" },
    { fixture: "human", mode: "live", call: "lineAngle(@Quarter_base.st|, @Arc.start)", member: "st" },
    { fixture: "human", mode: "cold", call: "ab|", member: "ab" },
    { fixture: "human", mode: "live", call: "ab|", member: "ab" }
  ])("inserts current candidates for $fixture $mode $call", async ({ fixture, mode, call, member }) => {
    const valid = fixture === "minimal" ? minimalSource : humanSource;
    const source = valid.replace(validCall, call.replace("|", ""));
    const cursorPrefix = `const lineArc: number = ${call.slice(0, call.indexOf("|"))}`;
    const test = completionDocument(mode === "cold" ? source : valid);
    const snapshotFor = vi.spyOn(test.host, "completionSemanticSnapshotFor");
    try {
      if (mode === "live") {
        await test.items("@Horizontal.start");
        test.edit(source);
      }
      const items = await test.items(cursorPrefix);
      expect(snapshotFor).toHaveBeenCalledWith(test.root);
      const snapshot = await test.host.completionSemanticSnapshotFor(test.root);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.sourceText).toBe(source);
      expect(snapshot!.sourceRevision).toBe(test.session().getSourceRevision());
      expect(snapshot!.sourceRevision).toBe(mode === "cold" ? 1 : 2);
      expect(snapshot!.compiled.spans.sourceMap).toMatchObject({ source, sourceRevision: snapshot!.sourceRevision });
      expect(test.session().getSource()).toBe(source);
      expect(test.host.diagnosticsStateFor(test.root)).toMatchObject({ documentVersion: mode === "cold" ? 1 : 2 });

      const scalar = member === "ab";
      expect(items.map(item => item.label)).toEqual(expect.arrayContaining(scalar ? ["abs"] : ["start", "end"]));
      const item = items.find(item => item.label === (scalar ? "abs" : "start"))!;
      const offset = source.indexOf(cursorPrefix) + cursorPrefix.length;
      const from = offset - member.length;
      expect(item.range).toEqual(new vscode.Range(normalizedPositionAt(source, from), normalizedPositionAt(source, offset)));
      expect(item.insertText).toBe(scalar ? "abs" : "start");
      const range = item.range as vscode.Range;
      const applied = source.slice(0, normalizedOffsetAt(source, range.start)) + item.insertText + source.slice(normalizedOffsetAt(source, range.end));
      expect(applied).toBe(source.slice(0, from) + (scalar ? "abs" : "start") + source.slice(offset));
      const query = queryDslCompletion({
        source: { normalizedSource: source, sourceRevision: snapshot!.sourceRevision },
        position: offset,
        semantic: snapshot!
      });
      if (member === "st") {
        expect(query?.candidates.find(candidate => candidate.label === "start")?.identity).toContain(":start");
        expect(applied).toContain("lineAngle(@Quarter_base.start, @Arc.start)");
      }
      if (!scalar) {
        test.edit(applied);
        await test.items("@Arc.start");
        expect(test.session().getDiagnostics().filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
      }
    } finally {
      test.host.dispose();
    }
  });

  it("does not reuse endpoint candidates after invalid edits and restores argument diagnostics", async () => {
    const source = humanSource.replace(validCall, "lineAngle(@Horizontal., @Arc.start)");
    const test = completionDocument(humanSource);
    try {
      await test.items("@Horizontal.start");
      test.edit(source);
      expect((await test.items("@Horizontal.")).map(item => item.label)).toEqual(expect.arrayContaining(["start", "end"]));

      for (const invalid of [
        source.replace("line Horizontal =", "line Renamed ="),
        source.replace("line Horizontal = segment(start: (0, 0), end: (10, 0))", "point Horizontal = coordinate(x: 0, y: 0)"),
        source.replace("@Horizontal.,", "@Quarter.missing.st,")
      ]) {
        test.edit(invalid);
        const items = await test.items(invalid.includes("@Quarter.missing.st") ? "@Quarter.missing.st" : "@Horizontal.");
        expect(items.map(item => item.label)).not.toContain("start");
        expect(items.map(item => item.label)).not.toContain("end");
        const snapshot = await test.host.completionSemanticSnapshotFor(test.root);
        expect(snapshot!.sourceText).toBe(invalid);
        expect(snapshot!.sourceRevision).toBe(test.session().getSourceRevision());
        expect(test.session().getDiagnostics().some(diagnostic => diagnostic.severity === "error")).toBe(true);
      }

      test.edit(humanSource.replace(validCall, "lineAngle(@Horizontal, @Arc)"));
      await test.items("@Horizontal,");
      expect(test.session().getDiagnostics().filter(diagnostic => diagnostic.code === "builtin-geometry-argument-invalid")).toHaveLength(2);
      test.edit(humanSource);
      await test.items("@Horizontal.start");
      expect(test.session().getDiagnostics().filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    } finally {
      test.host.dispose();
    }
  });
});

describe("VS Code multi-document host lifecycle", () => {
  it("projects lint only from the exact-current root compiled semantics", async () => {
    const rootPath = "/workspace/root.nui";
    const dependencyPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "module Private() {",
      "}",
      "instance Use = lib::Public()"
    ].join("\n");
    const dependencySource = [
      "nui 1",
      "export module Public() {",
      "}"
    ].join("\n");
    mocks.files.set(dependencyPath, encoder.encode(dependencySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    await vi.waitFor(() => {
      const state = host.diagnosticsStateFor(root);
      expect(state.status).toBe("current");
      if (state.status !== "current") return;
      expect(state.owner).toBe("multi-document");
      if (state.owner !== "multi-document") return;
      expect(state.snapshot.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "unused-private-module",
          location: expect.objectContaining({
            source: expect.objectContaining({
              kind: "root-current",
              documentId: root.uri.toString()
            }),
            range: {
              from: rootSource.indexOf("Private"),
              to: rootSource.indexOf("Private") + "Private".length
            }
          })
        })
      ]));
    });

    const state = host.diagnosticsStateFor(root);
    if (state.status !== "current" || state.owner !== "multi-document") throw new Error("missing current multi-document diagnostics");
    expect(state.snapshot.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("unused-") &&
      diagnostic.location.source.kind === "dependency-saved")).toEqual([]);
    host.dispose();
  });

  it("projects graph-backed unused imports through the multi-document diagnostic owner", async () => {
    const rootPath = "/workspace/root-unused-import.nui";
    const dependencyPath = "/workspace/library-unused-import.nui";
    const rootSource = [
      "nui 1",
      "import \"./library-unused-import.nui\" as library"
    ].join("\n");
    const dependencySource = [
      "nui 1",
      "export module Pocket() {",
      "}"
    ].join("\n");
    mocks.files.set(dependencyPath, encoder.encode(dependencySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    await vi.waitFor(() => {
      const state = host.diagnosticsStateFor(root);
      expect(state.status).toBe("current");
      if (state.status !== "current" || state.owner !== "multi-document") return;
      const diagnostic = state.snapshot.diagnostics.find((candidate) => candidate.code === "unused-import");
      expect(diagnostic).toMatchObject({
        severity: "warning",
        presentation: { key: "diagnostic.unused-import", parameters: { name: "library" } },
        location: {
          source: { kind: "root-current", documentId: root.uri.toString() },
          range: {
            from: rootSource.lastIndexOf("library"),
            to: rootSource.lastIndexOf("library") + "library".length
          }
        }
      });
      if (diagnostic) {
        expect(diagnosticTextFor(diagnostic, "en")).toBe("Import alias 'library' is not used anywhere.");
        expect(diagnosticTextFor(diagnostic, "ja-JP")).toBe("import alias「library」はどこからも使用されていません。");
      }
    });

    host.dispose();
  });

  it("keeps dependencies disk-authoritative and rebuilds importing roots after a saved dependency watch change", async () => {
    const rootPath = "/workspace/root.nui";
    const dependencyPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as library"
    ].join("\n");
    const savedDependency = [
      "nui 1",
      "// saved dependency"
    ].join("\n");
    const dirtyDependency = [
      "nui 1",
      "// dirty editor buffer must not replace graph authority"
    ].join("\n");

    mocks.files.set(dependencyPath, encoder.encode(savedDependency));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = new VscodeMultiDocumentHost();
    host.start();
    const rootUri = root.uri.toString();

    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(rootUri)?.nodes).toHaveLength(2);
    });

    const initialGraph = latestCurrentGraphFor(rootUri);
    const initialDependency = initialGraph?.nodes.find((node) => node.documentId === "file:///workspace/library.nui");
    expect(initialDependency?.source).toMatchObject({
      kind: "dependency-saved",
      normalizedSource: savedDependency
    });

    const dirty = documentFor(dependencyPath, dirtyDependency, { dirty: true });
    mocks.textDocuments.push(dirty);
    const rootPublicationCountBeforeOpen = currentPublicationsFor(rootUri).length;
    mocks.openListeners[0]?.(dirty);

    await vi.waitFor(() => {
      expect(currentPublicationsFor(rootUri).length).toBeGreaterThan(rootPublicationCountBeforeOpen);
    });
    const graphWithDirtyOpenDependency = latestCurrentGraphFor(rootUri);
    const dirtyProjectedDependency = graphWithDirtyOpenDependency?.nodes.find(
      (node) => node.documentId === "file:///workspace/library.nui"
    );
    expect(dirtyProjectedDependency?.source).toMatchObject({
      kind: "dependency-saved",
      normalizedSource: savedDependency
    });

    const nextSavedDependency = [
      "nui 1",
      "// changed on disk"
    ].join("\n");
    mocks.files.set(dependencyPath, encoder.encode(nextSavedDependency));
    const rootPublicationCountBeforeWatch = currentPublicationsFor(rootUri).length;
    mocks.watcherChangeListeners[0]?.(dirty.uri);

    await vi.waitFor(() => {
      expect(currentPublicationsFor(rootUri).length).toBeGreaterThan(rootPublicationCountBeforeWatch);
      const latest = latestCurrentGraphFor(rootUri);
      const dependency = latest?.nodes.find((node) => node.documentId === "file:///workspace/library.nui");
      expect(dependency?.source).toMatchObject({
        kind: "dependency-saved",
        normalizedSource: nextSavedDependency
      });
    });

    host.dispose();
    expect(mocks.watcherDispose).toHaveBeenCalledOnce();
  });

  it("keeps imported Module documentation disk-authoritative when a dependency is dirty", async () => {
    const rootPath = "/workspace/root.nui";
    const dependencyPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel(value: 1, ",
      ")"
    ].join("\n");
    const savedDependency = [
      "nui 1",
      "/// @en",
      "/// Saved panel documentation.",
      "export module Panel(",
      "  /// @en",
      "  /// Saved value documentation.",
      "  value: number",
      ") {",
      "}"
    ].join("\n");
    const dirtyDependency = savedDependency
      .replace("Saved panel documentation.", "Dirty panel documentation.")
      .replace("Saved value documentation.", "Dirty value documentation.");
    mocks.files.set(dependencyPath, encoder.encode(savedDependency));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const query = async () => {
      const semantic = await host.languageSemanticSnapshotFor(root);
      if (!semantic) return null;
      const source = { normalizedSource: rootSource, sourceRevision: semantic.sourceRevision };
      return {
        completion: queryDslCompletion({
          source,
          position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
          semantic
        }),
        signature: queryDslSignatureHelp({
          source,
          position: rootSource.indexOf("lib::Panel(value: 1, ") + "lib::Panel(value: 1, ".length,
          semantic
        })
      };
    };

    await vi.waitFor(async () => {
      const observed = await query();
      expect(observed?.completion?.candidates.find((candidate) => candidate.label === "Panel")).toMatchObject({
        kind: "module",
        documentation: { variants: [{ locale: "en", markdown: "Saved panel documentation." }] }
      });
      expect(observed?.signature?.signatures[0]).toMatchObject({
        name: "Panel",
        authoredDocumentation: { variants: [{ locale: "en", markdown: "Saved panel documentation." }] }
      });
      expect(observed?.signature?.signatures[0]?.parameters[0]).toMatchObject({
        name: "value",
        authoredDocumentation: { variants: [{ locale: "en", markdown: "Saved value documentation." }] }
      });
    });

    const dirty = documentFor(dependencyPath, dirtyDependency, { version: 2, dirty: true });
    mocks.textDocuments.push(dirty);
    mocks.openListeners[0]?.(dirty);

    await vi.waitFor(async () => {
      const observed = await query();
      expect(observed?.completion?.candidates.find((candidate) => candidate.label === "Panel")).toMatchObject({
        kind: "module",
        documentation: { variants: [{ locale: "en", markdown: "Saved panel documentation." }] }
      });
      expect(observed?.signature?.signatures[0]).toMatchObject({
        name: "Panel",
        authoredDocumentation: { variants: [{ locale: "en", markdown: "Saved panel documentation." }] }
      });
      expect(observed?.signature?.signatures[0]?.parameters[0]).toMatchObject({
        name: "value",
        authoredDocumentation: { variants: [{ locale: "en", markdown: "Saved value documentation." }] }
      });
    });

    host.dispose();
  });

  it("refreshes imported Module documentation after docs-only saved dependency rebuilds", async () => {
    const rootPath = "/workspace/root.nui";
    const dependencyPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel(value: 1)"
    ].join("\n");
    const initialDependency = [
      "nui 1",
      "/// @en",
      "/// Initial panel documentation.",
      "export module Panel(",
      "  /// @en",
      "  /// Initial value documentation.",
      "  value: number",
      ") {",
      "}"
    ].join("\n");
    const refreshedDependency = initialDependency
      .replace("Initial panel documentation.", "Refreshed panel documentation.")
      .replace("Initial value documentation.", "Refreshed value documentation.");
    const removedDependency = [
      "nui 1",
      "export module Panel(value: number) {",
      "}"
    ].join("\n");
    mocks.files.set(dependencyPath, encoder.encode(initialDependency));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const query = async () => {
      const semantic = await host.languageSemanticSnapshotFor(root);
      if (!semantic) return null;
      const source = { normalizedSource: rootSource, sourceRevision: semantic.sourceRevision };
      return {
        completion: queryDslCompletion({
          source,
          position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
          semantic
        }),
        signature: queryDslSignatureHelp({
          source,
          position: rootSource.indexOf("lib::Panel(value: 1") + "lib::Panel(value: 1".length,
          semantic
        })
      };
    };
    const assertDocumentation = async (definition: string, parameter: string) => {
      const observed = await query();
      expect(observed?.completion?.candidates.find((candidate) => candidate.label === "Panel")).toMatchObject({
        kind: "module",
        documentation: { variants: [{ locale: "en", markdown: definition }] }
      });
      expect(observed?.signature?.signatures[0]).toMatchObject({
        name: "Panel",
        authoredDocumentation: { variants: [{ locale: "en", markdown: definition }] }
      });
      expect(observed?.signature?.signatures[0]?.parameters[0]).toMatchObject({
        name: "value",
        authoredDocumentation: { variants: [{ locale: "en", markdown: parameter }] }
      });
    };

    await vi.waitFor(() => assertDocumentation("Initial panel documentation.", "Initial value documentation."));

    mocks.files.set(dependencyPath, encoder.encode(refreshedDependency));
    mocks.watcherChangeListeners[0]?.(vscode.Uri.file(dependencyPath) as unknown as TestUri);
    await vi.waitFor(() => assertDocumentation("Refreshed panel documentation.", "Refreshed value documentation."));

    mocks.files.set(dependencyPath, encoder.encode(removedDependency));
    mocks.watcherChangeListeners[0]?.(vscode.Uri.file(dependencyPath) as unknown as TestUri);
    await vi.waitFor(async () => {
      const observed = await query();
      const candidate = observed?.completion?.candidates.find((entry) => entry.label === "Panel");
      const signature = observed?.signature?.signatures[0];
      expect(candidate).toMatchObject({ kind: "module", label: "Panel" });
      expect(candidate?.documentation).toBeUndefined();
      expect(signature).toMatchObject({ name: "Panel" });
      expect(signature?.authoredDocumentation).toBeUndefined();
      expect(signature?.parameters[0]).toMatchObject({ name: "value" });
      expect(signature?.parameters[0]?.authoredDocumentation).toBeUndefined();
    });

    host.dispose();
  });

  it("uses the exact graph-root Module compile for native Definition and Rename", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    mocks.findFiles.mockResolvedValue([root.uri, vscode.Uri.file(libraryPath) as unknown as TestUri]);

    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(root.uri.toString())?.nodes).toHaveLength(2);
    });

    const diagnosticsState = host.diagnosticsStateFor(root);
    expect(diagnosticsState).toMatchObject({ status: "current", owner: "multi-document" });
    if (diagnosticsState.status === "current" && diagnosticsState.owner === "multi-document") {
      expect(diagnosticsState.snapshot.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("module-unresolved-callee");
    }

    const callLine = rootSource.split("\n")[2]!;
    const callOffset = callLine.indexOf("Panel") + 2;
    const definition = await host.provideDefinition(root, new vscode.Position(2, callOffset));
    expect(definition.handled).toBe(true);
    expect(definition.value?.[0]?.targetUri.toString()).toBe(`file://${libraryPath}`);

    const semantic = await host.languageSemanticSnapshotFor(root);
    expect(semantic).not.toBeNull();
    const completionSemantic = await host.completionSemanticSnapshotFor(root);
    expect(completionSemantic).not.toBeNull();
    const source = { normalizedSource: rootSource, sourceRevision: semantic!.sourceRevision };
    const completion = queryDslCompletion({
      source,
      position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
      semantic
    });
    const signature = queryDslSignatureHelp({
      source,
      position: rootSource.indexOf("lib::Panel(") + "lib::Panel(".length,
      semantic
    });
    expect(completion?.candidates.map((candidate) => candidate.label)).toContain("Panel");
    expect(signature?.signatures[0]?.name).toBe("Panel");

    const rename = await host.provideRenameEdits(root, new vscode.Position(2, callOffset), "Renamed");
    expect(rename.handled).toBe(true);
    const replacements = (rename.value as { replacements: Array<{ uri: TestUri; newText: string }> }).replacements;
    expect(replacements.map((replacement) => [replacement.uri.toString(), replacement.newText])).toEqual([
      [`file://${libraryPath}`, "Renamed"],
      [`file://${rootPath}`, "Renamed"]
    ]);

    host.dispose();
  });

  it("provides imported Module completion from an actually incomplete root", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Pa"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(async () => {
      expect(await host.languageSemanticSnapshotFor(root)).toBeNull();
      const snapshot = await host.completionSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const result = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
        semantic: snapshot!
      });
      expect(result?.candidates.map((candidate) => candidate.label)).toContain("Panel");
    });
    host.dispose();
  });

  it("provides facade-qualified imported Module completion from an actually incomplete root", async () => {
    const rootPath = "/workspace/root.nui";
    const facadePath = "/workspace/facade.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./facade.nui\" as facade",
      "instance use = facade::Pa"
    ].join("\n");
    const facadeSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(facadePath, encoder.encode(facadeSource));
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(async () => {
      const snapshot = await host.completionSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const result = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("facade::Pa") + "facade::Pa".length,
        semantic: snapshot!
      });
      expect(result?.candidates.map((candidate) => candidate.label)).toContain("Panel");
    });
    host.dispose();
  });

  it("does not expose private dependency Modules through incomplete imported completion", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "module Private() {",
      "}",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(async () => {
      const snapshot = await host.completionSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const result = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.length,
        semantic: snapshot!
      });
      expect(result?.candidates.map((candidate) => candidate.label)).toContain("Panel");
      expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Private");
    });
    host.dispose();
  });

  it("fails closed for unavailable or invalid imported completion authority", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Pa"
    ].join("\n");
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const unavailableHost = createVscodeModuleMultiDocumentHost();
    unavailableHost.start();
    await vi.waitFor(async () => {
      expect(await unavailableHost.completionSemanticSnapshotFor(root)).toBeNull();
    });
    unavailableHost.dispose();

    mocks.files.set(libraryPath, encoder.encode("nui 3\n"));
    const invalidHost = createVscodeModuleMultiDocumentHost();
    invalidHost.start();
    await vi.waitFor(async () => {
      expect(await invalidHost.completionSemanticSnapshotFor(root)).toBeNull();
    });
    invalidHost.dispose();
  });

  it("publishes exact imported Canvas runtime and fails closed for dirty or deleted dependencies", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "  point P = coordinate(x: 3, y: 4)",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const rootUri = root.uri.toString();
    await vi.waitFor(() => {
      const publication = latestCurrentPublicationFor(rootUri);
      expect(publication?.canvasRuntime).toBeDefined();
    });

    const publication = latestCurrentPublicationFor(rootUri);
    const runtime = publication?.canvasRuntime;
    expect(runtime?.preparedRustEvaluation.rustEligible).toBe(true);
    expect(runtime?.preparedRustEvaluation.input.elements.some((element) => element.name === "P")).toBe(true);
    expect(runtime?.modulePresentation.instanceBaseGeometrySnapshots.length).toBeGreaterThan(0);
    const bodyId = runtime?.preparedRustEvaluation.input.elements.find((element) => element.name === "P")?.id;
    expect(bodyId).toBeDefined();
    if (!bodyId) return;

    const target = await host.canvasSourceDefinitionFor(root, bodyId);
    expect(target.handled).toBe(true);
    expect(target.value).toMatchObject({
      targetUri: { scheme: "file", fsPath: libraryPath },
      normalizedSource: librarySource,
      sourceIdentity: {
        kind: "dependency-saved",
        documentId: `file://${libraryPath}`
      }
    });

    const dirtyDependency = documentFor(libraryPath, [
      "nui 1",
      "// dirty buffer must not be revealed into the saved target",
      "export module Panel() {",
      "  point P = coordinate(x: 30, y: 40)",
      "}"
    ].join("\n"), { version: 2, dirty: true });
    mocks.textDocuments = [root, dirtyDependency];
    const dirtyTarget = await host.canvasSourceDefinitionFor(root, bodyId);
    expect(dirtyTarget).toEqual({ handled: true, value: undefined });

    mocks.textDocuments = [root];
    mocks.files.delete(libraryPath);
    mocks.watcherDeleteListeners[0]?.(vscode.Uri.file(libraryPath) as unknown as TestUri);
    await vi.waitFor(() => {
      const current = latestCurrentPublicationFor(rootUri);
      expect(current).toBeDefined();
      expect(current?.canvasRuntime).toBeNull();
    });
    const diagnosticsState = host.diagnosticsStateFor(root);
    expect(diagnosticsState).toMatchObject({ status: "current", owner: "multi-document" });
    if (diagnosticsState.status === "current" && diagnosticsState.owner === "multi-document") {
      expect(diagnosticsState.snapshot.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "import-missing",
          presentation: { key: "diagnostic.import-missing", parameters: { path: "./library.nui" } }
        })
      ]));
      const importDiagnostic = diagnosticsState.snapshot.diagnostics.find((diagnostic) => diagnostic.code === "import-missing");
      if (!importDiagnostic) throw new Error("missing production import diagnostic");
      expect(diagnosticTextFor(importDiagnostic, "en")).toBe("The imported file './library.nui' was not found.");
      expect(diagnosticTextFor(importDiagnostic, "ja-JP")).toBe("import先「./library.nui」が見つかりません。");
    }

    host.dispose();
  });

  it("resolves a root Canvas geometry through the production host runtime identity", async () => {
    const rootPath = "/workspace/root-direct.nui";
    const libraryPath = "/workspace/library-direct.nui";
    const rootSource = [
      "nui 1",
      "import \"./library-direct.nui\" as lib",
      "instance use = lib::Panel()",
      "point Root = coordinate(x: 20, y: 10)"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "  point P = coordinate(x: 3, y: 4)",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const rootUri = root.uri.toString();
    await vi.waitFor(() => {
      expect(latestCurrentPublicationFor(rootUri)?.canvasRuntime).toBeDefined();
    });

    const runtime = latestCurrentPublicationFor(rootUri)?.canvasRuntime;
    const rootId = runtime?.preparedRustEvaluation.input.elements.find(
      (element) => element.name === "Root"
    )?.id;
    expect(rootId).toBeDefined();
    if (!rootId) return;

    const target = await host.canvasSourceDefinitionFor(root, rootId);

    expect(target).toMatchObject({
      handled: true,
      value: {
        targetUri: { scheme: "file", fsPath: rootPath },
        normalizedSource: rootSource,
        range: {
          from: rootSource.indexOf("Root"),
          to: rootSource.indexOf("Root") + "Root".length
        },
        sourceIdentity: {
          kind: "root-current",
          documentId: rootUri
        }
      }
    });

    host.dispose();
  });

  it("keeps graph-backed compilation and Canvas source definitions for imported group knot scalars", async () => {
    const rootPath = "/workspace/scalar-knot-root.nui";
    const probePath = "/workspace/scalar-knot-probe.nui";
    const rootSource = [
      "nui 1",
      'import "./scalar-knot-probe.nui" as probe',
      "group test {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 20, y: 0)",
      "  point M = coordinate(x: 10, y: 5)",
      "  const bulge: number(step: 0.1) = 4",
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
      "  )",
      "}"
    ].join("\n");
    const probeSource = [
      "nui 1",
      "export module Probe() {",
      "  export point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    mocks.files.set(probePath, encoder.encode(probeSource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => {
        const publication = latestCurrentPublicationFor(root.uri.toString());
        expect(publication?.graph.valid).toBe(true);
        expect(publication?.graph.nodes).toHaveLength(2);
        expect(publication?.graph.edges).toHaveLength(1);
      });

      const localCompiled = compileFreshCanonicalText(rootSource).doc;
      const compiled = await host.languageSemanticSnapshotFor(root);
      const hostElements = compiled?.compiled.document?.elements ?? [];
      const localPointId = localCompiled.document.elements.find((element) => element.name === "A")?.id;
      const localCurveId = localCompiled.document.elements.find((element) => element.name === "C")?.id;
      const hostPointId = hostElements.find((element) => element.name === "A")?.id;
      const hostCurveId = hostElements.find((element) => element.name === "C")?.id;
      const identityProjection = latestCurrentPublicationFor(root.uri.toString())?.canvasRuntime;
      expect(localPointId).toBeDefined();
      expect(localCurveId).toBeDefined();
      expect(hostPointId).toBeDefined();
      expect(hostCurveId).toBeDefined();
      expect(localPointId).not.toBe(hostPointId);
      expect(localCurveId).not.toBe(hostCurveId);
      expect(identityProjection?.identityOnly).toBe(true);
      const pointOwner = localPointId
        ? sourceOwnerForRuntimeElementId(localCompiled, localPointId)
        : null;
      const curveOwner = localCurveId
        ? sourceOwnerForRuntimeElementId(localCompiled, localCurveId)
        : null;
      const graphIdsBySourceStatementIndex = new Map(identityProjection?.sourceElementRuntimeIdsByStatementIndex ?? []);
      const pointId = pointOwner?.kind === "ordinary"
        ? graphIdsBySourceStatementIndex.get(pointOwner.sourceStatementIndex)
        : undefined;
      const curveId = curveOwner?.kind === "ordinary"
        ? graphIdsBySourceStatementIndex.get(curveOwner.sourceStatementIndex)
        : undefined;
      expect(pointId).toBe(hostPointId);
      expect(curveId).toBe(hostCurveId);
      if (!pointId || !curveId) return;

      const pointTarget = await host.canvasSourceDefinitionFor(root, pointId);
      const curveTarget = await host.canvasSourceDefinitionFor(root, curveId);
      const unprojectedLocalTarget = await host.canvasSourceDefinitionFor(root, localPointId!);
      const pointFrom = rootSource.indexOf("A =");
      const curveFrom = rootSource.indexOf("C =");

      expect(unprojectedLocalTarget).toEqual({ handled: true, value: undefined });
      expect({ compiled: compiled !== null, pointTarget, curveTarget }).toMatchObject({
        compiled: true,
        pointTarget: {
          handled: true,
          value: {
            targetUri: { fsPath: rootPath },
            normalizedSource: rootSource,
            range: { from: pointFrom, to: pointFrom + 1 }
          }
        },
        curveTarget: {
          handled: true,
          value: {
            targetUri: { fsPath: rootPath },
            normalizedSource: rootSource,
            range: { from: curveFrom, to: curveFrom + 1 }
          }
        }
      });
    } finally {
      host.dispose();
    }
  });

  it("leaves single-document Canvas source navigation to the local owner", async () => {
    const rootPath = "/workspace/root-local.nui";
    const rootSource = "nui 1\npoint Root = coordinate(x: 20, y: 10)";
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const rootUri = root.uri.toString();
    await vi.waitFor(() => {
      expect(latestCurrentPublicationFor(rootUri)).toBeDefined();
    });

    const localRuntimeId = compileFreshCanonicalText(rootSource).doc.document.elements.find(
      (element) => element.name === "Root"
    )?.id;
    expect(localRuntimeId).toBeDefined();
    if (!localRuntimeId) return;

    await expect(host.canvasSourceDefinitionFor(root, localRuntimeId)).resolves.toEqual({
      handled: false
    });

    host.dispose();
  });

  it("recovers the importer Canvas runtime after opening a clean source-navigation dependency", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()",
      "point Root = coordinate(x: 20, y: 10)"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "  point P = coordinate(x: 3, y: 4)",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const rootUri = root.uri.toString();
    await vi.waitFor(() => {
      const runtime = latestCurrentPublicationFor(rootUri)?.canvasRuntime;
      expect(runtime?.preparedRustEvaluation.input.elements.some((element) => element.name === "P")).toBe(true);
      expect(runtime?.preparedRustEvaluation.input.elements.some((element) => element.name === "Root")).toBe(true);
    });

    const initialPublication = latestCurrentPublicationFor(rootUri);
    const importedId = initialPublication?.canvasRuntime?.preparedRustEvaluation.input.elements
      .find((element) => element.name === "P")?.id;
    expect(importedId).toBeDefined();
    if (!importedId) return;

    const target = await host.canvasSourceDefinitionFor(root, importedId);
    expect(target).toMatchObject({
      handled: true,
      value: {
        targetUri: { scheme: "file", fsPath: libraryPath },
        normalizedSource: librarySource,
        sourceIdentity: {
          kind: "dependency-saved",
          documentId: `file://${libraryPath}`
        }
      }
    });

    const dependency = documentFor(libraryPath, librarySource);
    mocks.textDocuments = [root, dependency];
    const rootPublicationCountBeforeOpen = currentPublicationsFor(rootUri).length;
    mocks.openListeners[0]?.(dependency);

    await vi.waitFor(() => {
      expect(currentPublicationsFor(rootUri).length).toBeGreaterThan(rootPublicationCountBeforeOpen);
      const recovered = latestCurrentPublicationFor(rootUri);
      expect(recovered?.graph.rootDocumentId).toBe(rootUri);
      expect(recovered?.canvasRuntime?.rootDocumentId).toBe(rootUri);
      expect(recovered?.canvasRuntime?.preparedRustEvaluation.input.elements.some((element) => element.name === "P")).toBe(true);
      expect(recovered?.canvasRuntime?.preparedRustEvaluation.input.elements.some((element) => element.name === "Root")).toBe(true);
      expect(recovered?.canvasRuntime?.graphRevision).toBe(recovered?.graph.revision);
    });

    host.dispose();
  });

  it("preserves exact same-file compiler diagnostics on imported roots", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()",
      "point Broken = nope(x: 1)"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      const state = host.diagnosticsStateFor(root);
      expect(state.status).toBe("current");
      expect(state.owner).toBe("multi-document");
    });

    const state = host.diagnosticsStateFor(root);
    if (state.status === "current" && state.owner === "multi-document") {
      expect(state.snapshot.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-construction",
          presentation: expect.objectContaining({ key: "diagnostic.unknown-construction" })
        })
      ]));
    }
    host.dispose();
  });

  it("preserves distinct legacy fallback diagnostics at the same location", async () => {
    const rootPath = "/workspace/root.nui";
    const rootSource = [
      "nui 1",
      "import \"./missing.nui\" as missing",
      "group [ {"
    ].join("\n");
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      const state = host.diagnosticsStateFor(root);
      expect(state.status).toBe("current");
      expect(state.owner).toBe("multi-document");
    });

    const state = host.diagnosticsStateFor(root);
    if (state.status === "current" && state.owner === "multi-document") {
      const groupOpenOffset = rootSource.indexOf("[");
      const atGroup = state.snapshot.diagnostics.filter((diagnostic) => diagnostic.location.range.from === groupOpenOffset);
      expect(atGroup).toHaveLength(2);
      expect(new Set(atGroup.map((diagnostic) => diagnostic.message)).size).toBe(2);
      expect(atGroup.every((diagnostic) => diagnostic.code !== undefined && diagnostic.presentation !== undefined)).toBe(true);
    }
    host.dispose();
  });

  it("keeps imported Module instance export/member references on exact graph semantics", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Direct()",
      "point Used = offset(from: @use::Outline, dx: 1, dy: 0)"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Direct() {",
      "  export point Outline = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      const state = host.diagnosticsStateFor(root);
      expect(state.status).toBe("current");
      expect(state.owner).toBe("multi-document");
    });

    const state = host.diagnosticsStateFor(root);
    if (state.status === "current" && state.owner === "multi-document") {
      expect(state.snapshot.diagnostics.map((diagnostic) => diagnostic.code)).not.toEqual(
        expect.arrayContaining(["module-unresolved-callee", "module-unresolved-namespace"])
      );
    }
    host.dispose();
  });

  it("keeps one defining identity through a saved re-export chain", async () => {
    const rootPath = "/workspace/root.nui";
    const facadePath = "/workspace/facade.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./facade.nui\" as facade",
      "instance use = facade::Panel()"
    ].join("\n");
    const facadeSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(facadePath, encoder.encode(facadeSource));
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    mocks.findFiles.mockResolvedValue([
      root.uri,
      vscode.Uri.file(facadePath) as unknown as TestUri,
      vscode.Uri.file(libraryPath) as unknown as TestUri
    ]);

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(root.uri.toString())?.nodes).toHaveLength(3);
    });

    const diagnosticsState = host.diagnosticsStateFor(root);
    expect(diagnosticsState).toMatchObject({ status: "current", owner: "multi-document" });
    if (diagnosticsState.status === "current" && diagnosticsState.owner === "multi-document") {
      expect(diagnosticsState.snapshot.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("module-unresolved-callee");
    }

    const callLine = rootSource.split("\n")[2]!;
    const callOffset = callLine.indexOf("Panel") + 2;
    const definition = await host.provideDefinition(root, new vscode.Position(2, callOffset));
    expect(definition.value?.[0]?.targetUri.toString()).toBe(`file://${libraryPath}`);

    const rename = await host.provideRenameEdits(root, new vscode.Position(2, callOffset), "Renamed");
    expect(rename.value).toBeDefined();
    const replacements = (rename.value as { replacements: Array<{ uri: TestUri; newText: string }> }).replacements;
    expect(replacements.map((replacement) => [replacement.uri.toString(), replacement.newText])).toEqual([
      [`file://${facadePath}`, "Renamed"],
      [`file://${libraryPath}`, "Renamed"],
      [`file://${rootPath}`, "Renamed"]
    ]);

    host.dispose();
  });

  it("renames a definition-root Module across active and saved reverse importers through the native provider", async () => {
    const mainPath = "/workspace/main.nui";
    const facadePath = "/workspace/facade.nui";
    const libraryPath = "/workspace/library.nui";
    const mainSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "import \"./facade.nui\" as facade",
      "instance direct = library::Panel()",
      "instance reexport = facade::Panel()"
    ].join("\n");
    const facadeSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Panel"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(facadePath, encoder.encode(facadeSource));
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const main = documentFor(mainPath, mainSource);
    const library = documentFor(libraryPath, librarySource);
    mocks.textDocuments = [main];
    mocks.findFiles.mockResolvedValue([]);

    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(main.uri.toString())?.nodes).toHaveLength(3);
    });
    mocks.textDocuments.push(library);
    mocks.openListeners[0]?.(library);
    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(library.uri.toString())?.nodes).toHaveLength(1);
    });

    const provider = createNuiRenameProvider(() => createLanguageAnalysisSession(librarySource));
    const declarationLine = librarySource.split("\n")[1]!;
    const declarationPosition = new vscode.Position(1, declarationLine.indexOf("Panel") + 2);
    await expect(provider.prepareRename!(library, declarationPosition, undefined as never)).resolves.toMatchObject({
      placeholder: "Panel",
      range: {
        start: { line: 1, character: declarationLine.indexOf("Panel") },
        end: { line: 1, character: declarationLine.indexOf("Panel") + "Panel".length }
      }
    });

    const edit = await provider.provideRenameEdits!(library, declarationPosition, "Renamed", undefined as never);
    const replacements = (edit as { replacements: Array<{
      uri: TestUri;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }> }).replacements;
    const sourceByUri = new Map([
      [library.uri.toString(), librarySource],
      [vscode.Uri.file(facadePath).toString(), facadeSource],
      [main.uri.toString(), mainSource]
    ]);
    const offsetFor = (source: string, position: { line: number; character: number }): number => {
      const lines = source.split("\n");
      return lines.slice(0, position.line).reduce((offset, line) => offset + line.length + 1, 0) + position.character;
    };
    expect(replacements.map((replacement) => {
      const source = sourceByUri.get(replacement.uri.toString())!;
      const from = offsetFor(source, replacement.range.start);
      const to = offsetFor(source, replacement.range.end);
      return [replacement.uri.toString(), source.slice(from, to), replacement.newText];
    })).toEqual([
      [`file://${facadePath}`, "Panel", "Renamed"],
      [`file://${libraryPath}`, "Panel", "Renamed"],
      [`file://${mainPath}`, "Panel", "Renamed"],
      [`file://${mainPath}`, "Panel", "Renamed"]
    ]);
    expect(replacements.map((replacement) => [
      replacement.uri.toString(),
      replacement.range.start.line,
      replacement.range.start.character,
      replacement.range.end.line,
      replacement.range.end.character
    ])).toEqual([
      [`file://${facadePath}`, 2, facadeSource.split("\n")[2]!.indexOf("Panel"), 2, facadeSource.split("\n")[2]!.indexOf("Panel") + "Panel".length],
      [`file://${libraryPath}`, 1, declarationLine.indexOf("Panel"), 1, declarationLine.indexOf("Panel") + "Panel".length],
      [`file://${mainPath}`, 3, mainSource.split("\n")[3]!.indexOf("Panel"), 3, mainSource.split("\n")[3]!.indexOf("Panel") + "Panel".length],
      [`file://${mainPath}`, 4, mainSource.split("\n")[4]!.indexOf("Panel"), 4, mainSource.split("\n")[4]!.indexOf("Panel") + "Panel".length]
    ]);

    host.dispose();
  });

  it("#1636 routes local Rename through graph-aware semantics with an imported Module instance", async () => {
    const rootPath = "/workspace/patterns/1536.nui";
    const libraryPath = "/workspace/modules/library.nui";
    const rootSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const rename_probe: number = 15",
      "const use_angle: number = @rename_probe + 5",
      "point Angle = coordinate(x: @use_angle, y: 0)",
      "",
      "instance top = lib::Panel()"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => {
        const state = host.diagnosticsStateFor(root);
        expect(latestCurrentGraphFor(root.uri.toString())?.valid).toBe(true);
        expect(state).toMatchObject({ status: "current", owner: "multi-document" });
        if (state.status === "current" && state.owner === "multi-document") {
          expect(state.snapshot.diagnostics).toEqual([]);
        }
      });

      const isolatedSession = createLanguageAnalysisSession(rootSource);
      expect(isolatedSession.diagnostics().map((diagnostic) => diagnostic.code)).toContain("module-unresolved-callee");

      const sessionFor = vi.fn(() => createLanguageAnalysisSession(rootSource));
      const provider = createNuiRenameProvider(sessionFor);
      const declarationOffset = rootSource.indexOf("rename_probe");
      const referenceOffset = rootSource.lastIndexOf("rename_probe");
      const declaration = normalizedPositionAt(rootSource, declarationOffset);
      const reference = normalizedPositionAt(rootSource, referenceOffset);

      const hostPrepared = await host.prepareRename(root, declaration);
      expect(hostPrepared.handled).toBe(true);
      if (!hostPrepared.handled) throw new Error("expected graph-aware Rename handling");
      expect(hostPrepared.value).toMatchObject({
        placeholder: "rename_probe",
        range: {
          start: normalizedPositionAt(rootSource, 51),
          end: normalizedPositionAt(rootSource, 63)
        }
      });
      await expect(provider.prepareRename!(root as unknown as vscode.TextDocument, declaration, undefined as never)).resolves.toMatchObject({
        placeholder: "rename_probe"
      });
      const semantic = await host.languageSemanticSnapshotFor(root);
      expect(semantic).not.toBeNull();
      if (!semantic || !isLastGoodDslDocument(semantic.compiled)) {
        throw new Error("expected the exact current compiled imported root");
      }

      const hostEdit = await host.provideRenameEdits(root, reference, "renamed_probe");
      expect(hostEdit.handled).toBe(true);
      if (!hostEdit.handled || !hostEdit.value) throw new Error("expected graph-aware Rename edits");
      const hostReplacements = (hostEdit.value as unknown as { replacements: Array<{
        range: vscode.Range;
        newText: string;
      }> }).replacements;
      const offsetsFor = (range: vscode.Range) => {
        const lines = rootSource.split("\n");
        const offsetAt = (position: vscode.Position) =>
          lines.slice(0, position.line).reduce((offset, line) => offset + line.length + 1, 0) + position.character;
        return [offsetAt(range.start), offsetAt(range.end)];
      };
      expect(hostReplacements.map((replacement) => [
        ...offsetsFor(replacement.range),
        replacement.newText
      ])).toEqual([
        [51, 63, "renamed_probe"],
        [104, 116, "renamed_probe"]
      ]);

      const providerEdit = await provider.provideRenameEdits!(
        root as unknown as vscode.TextDocument,
        reference,
        "renamed_probe",
        undefined as never
      ) as unknown as { replacements: Array<{ range: vscode.Range; newText: string }> };
      expect(providerEdit.replacements.map((replacement) => [
        ...offsetsFor(replacement.range),
        replacement.newText
      ])).toEqual([
        [51, 63, "renamed_probe"],
        [104, 116, "renamed_probe"]
      ]);
      expect(sessionFor).not.toHaveBeenCalled();

      const candidateSource = [...hostReplacements]
        .sort((left, right) => offsetsFor(right.range)[0]! - offsetsFor(left.range)[0]!)
        .reduce((source, replacement) => {
          const [from, to] = offsetsFor(replacement.range);
          return source.slice(0, from!) + replacement.newText + source.slice(to!);
        }, rootSource);
      const originalGraph = semantic.compiled.moduleRuntimeContext?.graph;
      if (!originalGraph) throw new Error("missing imported-root module graph");
      const rootNode = originalGraph.nodes.get(originalGraph.rootDocumentId);
      const dependencyNode = [...originalGraph.nodes.values()].find((node) => node.documentId !== originalGraph.rootDocumentId);
      const dependencySource = dependencyNode?.artifact.source;
      if (!rootNode || dependencySource?.kind !== "dependency-saved") {
        throw new Error("missing exact saved Module dependency snapshot");
      }
      const candidateRootSource = {
        kind: "root-current" as const,
        documentId: originalGraph.rootDocumentId,
        normalizedSource: candidateSource,
        sourceRevision: semantic.compiled.spans.sourceMap.sourceRevision + 1
      };
      const candidateGraph = await buildMultiDocumentImportGraph({
        root: candidateRootSource,
        loader: {
          loadSavedDependency: async () => ({ status: "loaded" as const, snapshot: dependencySource })
        },
        declarationContributors: [moduleDeclarationContributor],
        rootStatementIdByStatementIndex: rootNode.artifact.statementIdByStatementIndex
      });
      expect(candidateGraph.valid).toBe(true);
      const candidateModuleAnalysis = analyzeMultiDocumentModuleSemantics(candidateGraph);
      const candidateModuleContext = createModuleRuntimeContext(candidateGraph, candidateModuleAnalysis);
      expect(candidateModuleContext.valid).toBe(true);
      const candidateRoot = candidateGraph.nodes.get(candidateGraph.rootDocumentId);
      if (!candidateRoot) throw new Error("missing candidate root graph artifact");
      const candidate = compileDslDocument(candidateSource, {
        preparsed: candidateRoot.artifact.parsed,
        sourceRevision: candidateRootSource.sourceRevision,
        assignedStatementIds: candidateRoot.artifact.statementIdByStatementIndex,
        moduleRuntimeContext: candidateModuleContext
      });
      expect(candidate.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(isLastGoodDslDocument(candidate)).toBe(true);
      if (!isLastGoodDslDocument(candidate)) throw new Error("expected a valid rename candidate compile");
      const evaluate = (compiled: LastGoodDslDocument) =>
        evaluateElements(
          compiled.document.elements,
          buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })
        );
      const beforeEvaluation = evaluate(semantic.compiled);
      const afterEvaluation = evaluate(candidate);
      const scalarBindingId = (compiled: typeof semantic.compiled, name: string) => {
        const binding = compiled.bindingAnalysis?.catalog.bindings.find((entry) => entry.name === name);
        if (!binding) throw new Error(`missing scalar binding ${name}`);
        return binding.id;
      };
      expect(beforeEvaluation.computedScalarBindings?.get(scalarBindingId(semantic.compiled, "rename_probe")))
        .toMatchObject({ status: "ok", value: { value: 15 } });
      expect(beforeEvaluation.computedScalarBindings?.get(scalarBindingId(semantic.compiled, "use_angle")))
        .toMatchObject({ status: "ok", value: { value: 20 } });
      expect(afterEvaluation.computedScalarBindings?.get(scalarBindingId(candidate, "renamed_probe")))
        .toMatchObject({ status: "ok", value: { value: 15 } });
      expect(afterEvaluation.computedScalarBindings?.get(scalarBindingId(candidate, "use_angle")))
        .toMatchObject({ status: "ok", value: { value: 20 } });
      expect(semantic.compiled.bindingAnalysis?.initializerReferences
        .filter((reference) => reference.name === "rename_probe")
        .map((reference) => reference.resolution.kind === "resolved" ? reference.resolution.binding.id : null))
        .toEqual([scalarBindingId(semantic.compiled, "rename_probe")]);
      expect(candidate.bindingAnalysis?.initializerReferences
        .filter((reference) => reference.name === "renamed_probe")
        .map((reference) => reference.resolution.kind === "resolved" ? reference.resolution.binding.id : null))
        .toEqual([scalarBindingId(candidate, "renamed_probe")]);
      expect(afterEvaluation.errors).toEqual(beforeEvaluation.errors);
      expect(afterEvaluation.computedGeometry).toEqual(beforeEvaluation.computedGeometry);
      expect(candidate.moduleRuntimeContext?.valid).toBe(true);
      expect(candidate.moduleRuntimeContext?.rootDocumentId).toBe(semantic.compiled.moduleRuntimeContext?.rootDocumentId);
      const beforeImport = semantic.compiled.moduleRuntimeContext?.graph.nodes
        .get(semantic.compiled.moduleRuntimeContext.rootDocumentId)?.artifact.imports[0];
      const afterImport = candidate.moduleRuntimeContext?.graph.nodes
        .get(candidate.moduleRuntimeContext.rootDocumentId)?.artifact.imports[0];
      expect(afterImport && beforeImport && {
        localIdentity: afterImport.identity.localIdentity,
        alias: afterImport.alias,
        importPath: afterImport.importPath,
        targetDocumentId: afterImport.targetDocumentId
      }).toEqual(beforeImport && {
        localIdentity: beforeImport.identity.localIdentity,
        alias: beforeImport.alias,
        importPath: beforeImport.importPath,
        targetDocumentId: beforeImport.targetDocumentId
      });
      expect(candidate.document?.elements.find((element) => element.name === "top")?.type)
        .toBe(semantic.compiled.document?.elements.find((element) => element.name === "top")?.type);
    } finally {
      host.dispose();
    }
  });

  it("#1636 preserves single-document fallback for no-import and import-only roots", async () => {
    const libraryPath = "/workspace/modules/library.nui";
    const noImportPath = "/workspace/patterns/no-import.nui";
    const importOnlyPath = "/workspace/patterns/import-only.nui";
    const noImportSource = [
      "nui 1",
      "const local_value: number = 15",
      "const use_value: number = @local_value + 5"
    ].join("\n");
    const importOnlySource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const local_value: number = 15",
      "const use_value: number = @local_value + 5"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode("nui 1\nexport module Panel() {\n}"));
    const noImport = documentFor(noImportPath, noImportSource);
    const importOnly = documentFor(importOnlyPath, importOnlySource);
    mocks.textDocuments = [noImport, importOnly];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const sessionFor = vi.fn((document: vscode.TextDocument) => createLanguageAnalysisSession(document.getText()));
    const provider = createNuiRenameProvider(sessionFor);
    try {
      await vi.waitFor(() => {
        expect(host.diagnosticsStateFor(noImport).status).toBe("current");
        expect(host.diagnosticsStateFor(importOnly).status).toBe("current");
      });

      for (const [document, source] of [[noImport, noImportSource], [importOnly, importOnlySource]] as const) {
        const position = normalizedPositionAt(source, source.indexOf("local_value"));
        await expect(host.prepareRename(document, position)).resolves.toEqual({ handled: false });
        await expect(provider.prepareRename!(document as unknown as vscode.TextDocument, position, undefined as never))
          .resolves.toMatchObject({ placeholder: "local_value" });
        const edit = await provider.provideRenameEdits!(
          document as unknown as vscode.TextDocument,
          position,
          "renamed_value",
          undefined as never
        ) as unknown as { replacements: Array<{ newText: string }> };
        expect(edit.replacements).toHaveLength(2);
        expect(edit.replacements.every((replacement) => replacement.newText === "renamed_value")).toBe(true);
      }
      expect(sessionFor).toHaveBeenCalledTimes(4);
    } finally {
      host.dispose();
    }
  });

  it("#1636 preserves typed collision and capture rejections through the provider", async () => {
    const libraryPath = "/workspace/modules/library.nui";
    const collisionPath = "/workspace/patterns/collision.nui";
    const capturePath = "/workspace/patterns/capture.nui";
    const collisionSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const outer: number = 1",
      "const collision: number = 2",
      "instance top = lib::Panel()"
    ].join("\n");
    const captureSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const outer: number = 1",
      "group G {",
      "  const inner: number = 2",
      "  const use_outer: number = @outer",
      "}",
      "instance top = lib::Panel()"
    ].join("\n");
    const librarySource = "nui 1\nexport module Panel() {\n}";
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const collision = documentFor(collisionPath, collisionSource);
    const capture = documentFor(capturePath, captureSource);
    mocks.textDocuments = [collision, capture];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    const sessionFor = vi.fn(() => createLanguageAnalysisSession("nui 1"));
    const provider = createNuiRenameProvider(sessionFor);
    try {
      await vi.waitFor(() => {
        expect(latestCurrentGraphFor(collision.uri.toString())?.valid).toBe(true);
        expect(latestCurrentGraphFor(capture.uri.toString())?.valid).toBe(true);
      });

      const collisionResult = await host.provideRenameEdits(
        collision,
        normalizedPositionAt(collisionSource, collisionSource.indexOf("outer")),
        "collision"
      );
      expect(collisionResult).toMatchObject({
        handled: true,
        rejection: { reason: "same-scope-collision", conflictingName: "collision" }
      });
      await expect(provider.provideRenameEdits!(
        collision as unknown as vscode.TextDocument,
        normalizedPositionAt(collisionSource, collisionSource.indexOf("outer")),
        "collision",
        undefined as never
      )).rejects.toThrow(/'collision' already exists in this scope/);

      const captureResult = await host.provideRenameEdits(
        capture,
        normalizedPositionAt(captureSource, captureSource.indexOf("outer")),
        "inner"
      );
      expect(captureResult).toMatchObject({
        handled: true,
        rejection: { reason: "reference-resolution-change", family: "typed", referencedName: "outer" }
      });
      await expect(provider.provideRenameEdits!(
        capture as unknown as vscode.TextDocument,
        normalizedPositionAt(captureSource, captureSource.indexOf("outer")),
        "inner",
        undefined as never
      )).rejects.toThrow("Rename would change the reference resolved by 'outer'.");
      expect(sessionFor).not.toHaveBeenCalled();
    } finally {
      host.dispose();
    }
  });

  const invalidImportedRenameDependencies = [
    { name: "missing", dependencySource: null, moduleName: "Panel" },
    { name: "invalid", dependencySource: "nui 1\nexport module Panel( {", moduleName: "Panel" },
    { name: "unresolved Module", dependencySource: "nui 1\nexport module Other() {\n}", moduleName: "Panel" },
    {
      name: "cyclic",
      dependencySource: [
        "nui 1",
        'import "../patterns/cyclic.nui" as pattern',
        "export module Panel() {",
        "}"
      ].join("\n"),
      moduleName: "Panel"
    }
  ] as const;

  it.each(invalidImportedRenameDependencies)("#1636 fails closed for $name dependency graphs", async ({
    dependencySource,
    moduleName
  }) => {
    const rootPath = "/workspace/patterns/cyclic.nui";
    const libraryPath = "/workspace/modules/library.nui";
    const rootSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const rename_probe: number = 15",
      "const use_probe: number = @rename_probe + 5",
      `instance top = lib::${moduleName}()`
    ].join("\n");
    if (dependencySource !== null) mocks.files.set(libraryPath, encoder.encode(dependencySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => expect(host.diagnosticsStateFor(root).status).toBe("current"));
      const result = await host.provideRenameEdits(
        root,
        normalizedPositionAt(rootSource, rootSource.indexOf("rename_probe")),
        "renamed_probe"
      );
      expect(result).toEqual({ handled: true, value: undefined });
    } finally {
      host.dispose();
    }
  });

  const staleImportedRenameAuthorityCases = [
    "building graph",
    "graph revision",
    "root generation",
    "diagnostic document version",
    "root source revision",
    "graph identity",
    "compiled identity",
    "dependency fingerprint",
    "dirty dependency"
  ] as const;

  it.each(staleImportedRenameAuthorityCases)("#1636 rejects a stale or changing %s", async (staleCase) => {
    const rootPath = "/workspace/patterns/stale.nui";
    const libraryPath = "/workspace/modules/library.nui";
    let rootSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const rename_probe: number = 15",
      "const use_probe: number = @rename_probe + 5",
      "instance top = lib::Panel()"
    ].join("\n");
    const librarySource = "nui 1\nexport module Panel() {\n}";
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    root.getText = () => rootSource;
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => expect(latestCurrentGraphFor(root.uri.toString())?.valid).toBe(true));
      type MutableRootState = {
        diagnosticsStatus: "building" | "invalidated" | "current";
        graphRevision: number;
        rootGeneration: number;
        graph: Record<string, unknown>;
        compiled: Record<string, unknown>;
        diagnostics: { documentVersion: number };
      };
      const state = (host as unknown as { rootByDocumentId: Map<string, MutableRootState> })
        .rootByDocumentId.get(root.uri.toString());
      if (!state) throw new Error("missing active imported root state");
      switch (staleCase) {
        case "building graph":
          state.diagnosticsStatus = "building";
          break;
        case "graph revision":
          state.graphRevision += 1;
          break;
        case "root generation":
          state.rootGeneration += 1;
          break;
        case "diagnostic document version":
          state.diagnostics.documentVersion += 1;
          break;
        case "root source revision":
          rootSource += "\n// changed while rename was pending";
          break;
        case "graph identity":
          state.graph = { ...state.graph };
          break;
        case "compiled identity":
          state.compiled = { ...state.compiled };
          break;
        case "dependency fingerprint":
          mocks.files.set(libraryPath, encoder.encode(`${librarySource}\n// changed on disk`));
          break;
        case "dirty dependency":
          mocks.textDocuments.push(documentFor(libraryPath, `${librarySource}\n// unsaved`, { dirty: true }));
          break;
      }

      const result = await host.provideRenameEdits(
        root,
        normalizedPositionAt(rootSource, rootSource.indexOf("rename_probe")),
        "renamed_probe"
      );
      expect(result).toEqual({ handled: true, value: undefined });
    } finally {
      host.dispose();
    }
  });

  it("#1636 discards edits when root state changes during dependency verification", async () => {
    const rootPath = "/workspace/patterns/concurrent.nui";
    const libraryPath = "/workspace/modules/library.nui";
    let rootSource = [
      "nui 1",
      'import "../modules/library.nui" as lib',
      "const rename_probe: number = 15",
      "const use_probe: number = @rename_probe + 5",
      "instance top = lib::Panel()"
    ].join("\n");
    const librarySource = "nui 1\nexport module Panel() {\n}";
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    root.getText = () => rootSource;
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => expect(latestCurrentGraphFor(root.uri.toString())?.valid).toBe(true));
      const readSpy = vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
        const bytes = mocks.files.get(uri.fsPath);
        if (!bytes) throw new Error(`missing ${uri.fsPath}`);
        if (uri.fsPath === libraryPath) {
          root.version += 1;
          rootSource += "\n// changed during rename planning";
        }
        return bytes;
      });
      try {
        const result = await host.provideRenameEdits(
          root,
          normalizedPositionAt(rootSource, rootSource.indexOf("rename_probe")),
          "renamed_probe"
        );
        expect(result).toEqual({ handled: true, value: undefined });
        expect(readSpy).toHaveBeenCalled();
      } finally {
        readSpy.mockRestore();
      }
    } finally {
      host.dispose();
    }
  });

  it("fails closed at a definition-root Module when an active reverse importer is invalid", async () => {
    const mainPath = "/workspace/main.nui";
    const libraryPath = "/workspace/library.nui";
    const mainSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "instance direct = library::Panel()"
    ].join("\n");
    const invalidMainSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "instance direct = library::"
    ].join("\n");
    const librarySource = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const main = documentFor(mainPath, mainSource);
    const library = documentFor(libraryPath, librarySource);
    mocks.textDocuments = [main];

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(main.uri.toString())?.nodes).toHaveLength(2);
    });
    mocks.textDocuments.push(library);
    mocks.openListeners[0]?.(library);
    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(library.uri.toString())?.nodes).toHaveLength(1);
    });

    const sessionFor = vi.fn(() => createLanguageAnalysisSession(librarySource));
    const provider = createNuiRenameProvider(sessionFor);
    const invalidMain = documentFor(mainPath, invalidMainSource, { version: 2 });
    mocks.textDocuments = [invalidMain, library];
    mocks.changeListeners[0]?.({ document: invalidMain });
    await vi.waitFor(() => {
      expect(host.diagnosticsStateFor(invalidMain)).toMatchObject({ status: "current" });
      expect(latestCurrentGraphFor(invalidMain.uri.toString())?.nodes).toHaveLength(2);
    });

    const declarationLine = librarySource.split("\n")[1]!;
    const declarationPosition = new vscode.Position(1, declarationLine.indexOf("Panel") + 2);
    await expect(provider.provideRenameEdits!(library, declarationPosition, "Renamed", undefined as never)).rejects.toThrow(
      "Rename could not be applied."
    );
    expect(sessionFor).not.toHaveBeenCalled();

    host.dispose();
  });

  it("keeps importer semantics on saved bytes until a watcher rebuild, then fails closed", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n");
    const savedLibrary = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(savedLibrary));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();

    await vi.waitFor(async () => {
      expect(await host.languageSemanticSnapshotFor(root)).not.toBeNull();
    });
    const dirty = documentFor(libraryPath, ["nui 1", "export module Other() {", "}"].join("\n"), { dirty: true });
    mocks.textDocuments.push(dirty);
    mocks.openListeners[0]?.(dirty);
    await vi.waitFor(async () => {
      const snapshot = await host.languageSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const result = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
        semantic: snapshot
      });
      expect(result?.candidates.map((candidate) => candidate.label)).toContain("Panel");
    });

    mocks.files.set(libraryPath, encoder.encode("nui 1\nexport module Panel("));
    mocks.watcherChangeListeners[0]?.(dirty.uri);
    await vi.waitFor(async () => {
      expect(await host.languageSemanticSnapshotFor(root)).toBeNull();
    });

    host.dispose();
  });

  it("rejects a prepared Canvas graph revision after its imported dependency changes", async () => {
    const rootPath = "/workspace/canvas-root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      'import "./library.nui" as lib',
      "point Root = coordinate(x: 0, y: 0)",
      "instance use = lib::Sample()"
    ].join("\n");
    const librarySource = "nui 1\nexport module Sample() {\n}";
    mocks.files.set(libraryPath, encoder.encode(librarySource));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    try {
      await vi.waitFor(() => expect(latestCurrentGraphFor(root.uri.toString())?.valid).toBe(true));
      const initial = latestCurrentPublicationFor(root.uri.toString());
      if (!initial) throw new Error("missing current imported graph publication");
      const preparedAuthority = {
        rootDocumentId: String(canonicalVscodeDocumentId(root.uri as unknown as vscode.Uri)),
        graphRevision: initial.graph.revision
      };
      expect(await host.isCanvasGraphCommitAuthorityCurrent(root as unknown as vscode.TextDocument, preparedAuthority)).toBe(true);

      mocks.files.set(libraryPath, encoder.encode(`${librarySource}\n// dependency changed after drag preview`));
      mocks.watcherChangeListeners[0]?.(vscode.Uri.file(libraryPath) as unknown as TestUri);

      await vi.waitFor(() => {
        const current = latestCurrentPublicationFor(root.uri.toString());
        expect(current?.graph.revision).not.toBe(preparedAuthority.graphRevision);
        expect(current?.graph.valid).toBe(true);
      });
      expect(await host.isCanvasGraphCommitAuthorityCurrent(root as unknown as vscode.TextDocument, preparedAuthority)).toBe(false);
      expect(root.getText()).toBe(rootSource);
    } finally {
      host.dispose();
    }
  });

  it("re-proves dirty dependency navigation or fails closed without leaking saved ranges", async () => {
    const rootPath = "/workspace/root.nui";
    const libraryPath = "/workspace/library.nui";
    const rootSource = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n");
    const savedLibrary = [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n");
    mocks.files.set(libraryPath, encoder.encode(savedLibrary));
    const root = documentFor(rootPath, rootSource);
    mocks.textDocuments = [root];
    mocks.findFiles.mockResolvedValue([
      root.uri,
      vscode.Uri.file(libraryPath) as unknown as TestUri
    ]);

    const host = createVscodeModuleMultiDocumentHost();
    host.start();
    await vi.waitFor(() => {
      expect(latestCurrentGraphFor(root.uri.toString())?.nodes).toHaveLength(2);
    });

    const savedLibraryDocument = documentFor(libraryPath, savedLibrary, { version: 1 });
    mocks.textDocuments.push(savedLibraryDocument);
    mocks.openListeners[0]?.(savedLibraryDocument);
    await vi.waitFor(async () => {
      expect(latestCurrentGraphFor(savedLibraryDocument.uri.toString())?.nodes).toHaveLength(1);
      expect(await host.languageSemanticSnapshotFor(savedLibraryDocument)).not.toBeNull();
    });

    const shiftedDirtyLibrary = [
      "nui 1",
      "// shifted dirty declaration",
      "export module Panel() {",
      "}"
    ].join("\n");
    const shiftedDirtyDocument = documentFor(libraryPath, shiftedDirtyLibrary, { version: 2, dirty: true });
    mocks.textDocuments = [root, shiftedDirtyDocument];
    mocks.changeListeners[0]?.({ document: shiftedDirtyDocument });

    const callLine = rootSource.split("\n")[2]!;
    const callPosition = new vscode.Position(2, callLine.indexOf("Panel") + 2);
    await vi.waitFor(async () => {
      expect(await host.languageSemanticSnapshotFor(shiftedDirtyDocument)).not.toBeNull();
      const snapshot = await host.languageSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const completion = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
        semantic: snapshot
      });
      const signature = queryDslSignatureHelp({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Panel(") + "lib::Panel(".length,
        semantic: snapshot
      });
      expect(completion?.candidates.map((candidate) => candidate.label)).toContain("Panel");
      expect(signature?.signatures[0]?.name).toBe("Panel");

      const definition = await host.provideDefinition(root, callPosition);
      expect(definition.handled).toBe(true);
      expect(definition.value?.[0]?.targetUri.toString()).toBe(`file://${libraryPath}`);
      expect(definition.value?.[0]?.targetSelectionRange.start.line).toBe(2);

      const references = await host.provideReferences(root, callPosition, true);
      expect(references.handled).toBe(true);
      const dirtyLocations = references.value?.filter((location) => location.uri.toString() === `file://${libraryPath}`);
      expect(dirtyLocations).toHaveLength(1);
      expect(dirtyLocations?.[0]?.range.start.line).toBe(2);
    });

    const unprovedDirtyLibrary = [
      "nui 1",
      "export module Other() {",
      "}"
    ].join("\n");
    const unprovedDirtyDocument = documentFor(libraryPath, unprovedDirtyLibrary, { version: 3, dirty: true });
    mocks.textDocuments = [root, unprovedDirtyDocument];
    mocks.changeListeners[0]?.({ document: unprovedDirtyDocument });

    await vi.waitFor(async () => {
      const snapshot = await host.languageSemanticSnapshotFor(root);
      expect(snapshot).not.toBeNull();
      const completion = queryDslCompletion({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Pa") + "lib::Pa".length,
        semantic: snapshot
      });
      const signature = queryDslSignatureHelp({
        source: { normalizedSource: rootSource, sourceRevision: snapshot!.sourceRevision },
        position: rootSource.indexOf("lib::Panel(") + "lib::Panel(".length,
        semantic: snapshot
      });
      expect(completion?.candidates.map((candidate) => candidate.label)).toContain("Panel");
      expect(signature?.signatures[0]?.name).toBe("Panel");

      const definition = await host.provideDefinition(root, callPosition);
      expect(definition.handled).toBe(true);
      expect(definition.value).toBeUndefined();

      const references = await host.provideReferences(root, callPosition, true);
      expect(references.handled).toBe(true);
      expect(references.value).toEqual([]);

      const rename = await host.provideRenameEdits(root, callPosition, "Renamed");
      expect(rename.handled).toBe(true);
      expect(rename.value).toBeUndefined();
    });

    host.dispose();
  });
});

// Replay the already sealed #1490 sources through the actual production
// discovery/provider owner. This is structured host testing, not native GUI E2E.
it.each([1,2,3,4])("#1490 R%i complete saved-workspace reverse discovery preserves exact rename footprint",async root=>{
 const cell=issue1490.find(c=>c.root===root&&c.state===0)!;
 const files=cell.files as Record<string,string>;
 for(const[file,text]of Object.entries(files))mocks.files.set(`/workspace/${file}`,encoder.encode(text));
 const module=documentFor("/workspace/module.nui",files["module.nui"]!);
 mocks.textDocuments=[module];
 mocks.findFiles.mockResolvedValue(Object.keys(files).map(file=>vscode.Uri.file(`/workspace/${file}`) as unknown as TestUri));
 const host=createVscodeModuleMultiDocumentHost();host.start();
 try{
  await vi.waitFor(()=>expect(latestCurrentGraphFor(module.uri.toString())?.nodes).toHaveLength(2));
  const offset=files["module.nui"].indexOf("export module Pocket")+"export module ".length;
  const lines=files["module.nui"].slice(0,offset).split("\n");
  const provider=createNuiRenameProvider(()=>createLanguageAnalysisSession(files["module.nui"]));
  const edit=await provider.provideRenameEdits!(module,new vscode.Position(lines.length-1,lines.at(-1)!.length),"PocketRenamed",undefined as never);
  const replacements=(edit as {replacements:{uri:TestUri;range:{start:{line:number;character:number};end:{line:number;character:number}};newText:string}[]}).replacements;
  const actual=replacements.map(r=>{
   const file=r.uri.fsPath.split("/").at(-1)!,text=files[file]!;
   const offset=(p:{line:number;character:number})=>text.split("\n").slice(0,p.line).reduce((n,line)=>n+line.length+1,0)+p.character;
   const from=offset(r.range.start),to=offset(r.range.end);
   return {file,from,to,expectedText:text.slice(from,to),newText:r.newText};
  });
  const expected=Object.entries(cell.edits).flatMap(([file,edits])=>(edits??[]).map(e=>({file,...e}))).sort((a,b)=>a.file.localeCompare(b.file)||a.from-b.from);
  expect(actual).toEqual(expected);expect(mocks.findFiles).toHaveBeenCalledWith("**/*.nui");
 }finally{host.dispose();}
},30000);
