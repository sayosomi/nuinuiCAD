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
import { VscodeMultiDocumentHost } from "./multiDocumentHost";
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
});
