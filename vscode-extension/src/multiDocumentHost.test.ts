import { afterEach, describe, expect, it, vi } from "vitest";

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
import { queryDslCompletion } from "@nuinuicad/nui-language";
import { queryDslSignatureHelp } from "@nuinuicad/nui-language";
import { diagnosticTextFor } from "./diagnosticLocalization";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { VscodeMultiDocumentHost } from "./multiDocumentHost";
import { createVscodeModuleMultiDocumentHost } from "./moduleMultiDocumentHost";
import { createNuiRenameProvider } from "./renameProvider";
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
  getText: () => source
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

describe("VS Code multi-document host lifecycle", () => {
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
      const legacy = state.snapshot.diagnostics.filter((diagnostic) =>
        diagnostic.code === undefined && diagnostic.presentation === undefined
      );
      const groupOpenOffset = rootSource.indexOf("[");
      const atGroup = legacy.filter((diagnostic) => diagnostic.location.range.from === groupOpenOffset);
      expect(atGroup).toHaveLength(2);
      expect(new Set(atGroup.map((diagnostic) => diagnostic.message)).size).toBe(2);
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
