import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { initialCadUiState } from "../state/cadUiStore";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import {
  importLegacyDocument,
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs
} from "./documentFile";

const tauriCoreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const dialogMock = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
const LEGACY_APP_ID = "nuinuiCAD";
const LEGACY_SCHEMA_VERSION = 5;

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

describe("document file lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCadDocumentStore.setState(initialCadDocumentState());
    setTauriRuntime();
    tauriCoreMock.invoke.mockReset();
    dialogMock.open.mockReset();
    dialogMock.save.mockReset();
  });

  it("creates a new starter document and clears file state after confirming discard", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/edited.nui", useCadDocumentStore.getState().sourceText);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    await newDocument();

    expect(useCadDocumentStore.getState()).toMatchObject({
      currentFilePath: null,
      dirtySinceSave: false,
      past: [],
      future: []
    });
    expect(initialCadUiState().selectedElementIds).toBeDefined();
  });

  it("opens .nui text verbatim and resets file history", async () => {
    const content = "\uFEFFnui 2\r\n# keep this\r\npoint A = coordinate(x: 0 y: 0)\r\n";
    dialogMock.open.mockResolvedValue("/tmp/loaded.nui");
    tauriCoreMock.invoke.mockResolvedValue(content);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await openDocument();

    const state = useCadDocumentStore.getState();
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("read_document_file", { path: "/tmp/loaded.nui" });
    expect(state.sourceText).toBe(content);
    expect(state.currentFilePath).toBe("/tmp/loaded.nui");
    expect(state.dirtySinceSave).toBe(false);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
  });

  it("converts a v1 .nui on open, keeps its path, and marks the result dirty for a v2 save", async () => {
    const content = "\uFEFFnui 1\n# discarded during conversion\npoint A = (0, 0)";
    dialogMock.open.mockResolvedValue("/tmp/legacy.nui");
    tauriCoreMock.invoke.mockResolvedValue(content);

    await openDocument();

    const state = useCadDocumentStore.getState();
    expect(state.sourceText.startsWith("nui 2\n")).toBe(true);
    expect(state.sourceText).not.toContain("discarded during conversion");
    expect(state.elements).toMatchObject([{ name: "A", type: "freePoint", x: 0, y: 0 }]);
    expect(state.currentFilePath).toBe("/tmp/legacy.nui");
    expect(state.dirtySinceSave).toBe(true);
  });

  it("leaves the current document intact when a v1 conversion reports errors", async () => {
    const before = useCadDocumentStore.getState().sourceText;
    dialogMock.open.mockResolvedValue("/tmp/broken-v1.nui");
    tauriCoreMock.invoke.mockResolvedValue("nui 1\npoint Broken = (");

    await expect(openDocument()).rejects.toThrow("nui 1 文書を変換できません");

    expect(useCadDocumentStore.getState().sourceText).toBe(before);
  });

  it("opens fatal text with an empty last-good document instead of leaking the previous document", async () => {
    const content = "nui 2\npoint Broken = coordinate(";
    dialogMock.open.mockResolvedValue("/tmp/broken.nui");
    tauriCoreMock.invoke.mockResolvedValue(content);
    expect(useCadDocumentStore.getState().elements.length).toBeGreaterThan(0);

    await openDocument();

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toBe(content);
    expect(state.docText).not.toBe(content);
    expect(state.elements).toEqual([]);
    expect(state.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(state.currentFilePath).toBe("/tmp/broken.nui");
    expect(state.dirtySinceSave).toBe(false);
  });

  it("rejects only an unsupported major before replacing the current document", async () => {
    const before = useCadDocumentStore.getState().sourceText;
    dialogMock.open.mockResolvedValue("/tmp/future.nui");
    tauriCoreMock.invoke.mockResolvedValue("nui 3\npoint A = coordinate(x: 0 y: 0)");

    await expect(openDocument()).rejects.toThrow("未対応のDSLバージョンです: 3");

    expect(useCadDocumentStore.getState().sourceText).toBe(before);
  });

  it("rejects major 0 before replacing the current document", async () => {
    const before = useCadDocumentStore.getState().sourceText;
    dialogMock.open.mockResolvedValue("/tmp/zero.nui");
    tauriCoreMock.invoke.mockResolvedValue("nui 0\npoint A = coordinate(x: 0 y: 0)");

    await expect(openDocument()).rejects.toThrow("未対応のDSLバージョンです: 0");

    expect(useCadDocumentStore.getState().sourceText).toBe(before);
  });

  it.each([
    "",
    "nui abc",
    "nui 2\nnui 2",
    "point A = (0, 0)"
  ])("opens malformed version text with fatal diagnostics: %j", async (content) => {
    dialogMock.open.mockResolvedValue("/tmp/fatal.nui");
    tauriCoreMock.invoke.mockResolvedValue(content);

    await openDocument();

    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toBe(content);
    expect(state.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(state.currentFilePath).toBe("/tmp/fatal.nui");
  });

  it("saves sourceText byte-for-byte and clears dirty only after write succeeds", async () => {
    const content = "nui 1\r\n# keep\r\npoint A = (0, 0)\r\n";
    useCadDocumentStore.getState().replaceTextDocument(content, {
      currentFilePath: "/tmp/current.nui",
      dirtySinceSave: false
    });
    useCadDocumentStore.getState().commitText(`${content}# changed\r\n`, "test");
    tauriCoreMock.invoke.mockResolvedValue(undefined);

    await saveDocument();

    const state = useCadDocumentStore.getState();
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("write_document_file", {
      path: "/tmp/current.nui",
      content: state.sourceText
    });
    expect(state.dirtySinceSave).toBe(false);
  });

  it("flushes pending editor text and rereads state before saving", async () => {
    const flushedText = "nui 1\npoint A = (9, 0)";
    useCadDocumentStore.getState().replaceTextDocument("nui 1\npoint A = (0, 0)", {
      currentFilePath: "/tmp/current.nui",
      dirtySinceSave: false
    });
    let pending = true;
    const unregister = registerSourceEditSession({
      hasPendingText: () => pending,
      isComposing: () => false,
      flush: () => {
        pending = false;
        useCadDocumentStore.getState().commitText(flushedText, "editor");
        return "flushed";
      }
    });
    tauriCoreMock.invoke.mockResolvedValue(undefined);

    try {
      await saveDocument();
    } finally {
      unregister();
    }

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("write_document_file", {
      path: "/tmp/current.nui",
      content: flushedText
    });
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: flushedText,
      dirtySinceSave: false
    });
  });

  it("rebases image paths on Save As and restores dirty state across undo and redo", async () => {
    const source = [
      "nui 2",
      'image img = image(source: "images/ref.png" origin: (0, 0) scale: 1 angleDeg: 0 mirrorX: false)'
    ].join("\n");
    useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: "/old/pattern.nui",
      dirtySinceSave: false
    });
    dialogMock.save.mockResolvedValue("/new/copy");
    tauriCoreMock.invoke.mockResolvedValue(undefined);

    await saveDocumentAs();

    const saved = useCadDocumentStore.getState();
    expect(saved.sourceText).toContain('source: "/old/images/ref.png"');
    expect(saved.currentFilePath).toBe("/new/copy.nui");
    expect(saved.dirtySinceSave).toBe(false);
    expect(saved.past).toHaveLength(1);
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("write_document_file", {
      path: "/new/copy.nui",
      content: saved.sourceText
    });

    saved.undo();
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: source,
      currentFilePath: "/new/copy.nui",
      dirtySinceSave: true
    });

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: saved.sourceText,
      currentFilePath: "/new/copy.nui",
      dirtySinceSave: false
    });
  });

  it("returns to clean when redo restores text saved by Save", async () => {
    const before = "nui 1\npoint A = (0, 0)";
    const savedText = "nui 1\npoint A = (5, 0)";
    useCadDocumentStore.getState().replaceTextDocument(before, {
      currentFilePath: "/tmp/current.nui",
      dirtySinceSave: false
    });
    useCadDocumentStore.getState().commitText(savedText, "test");
    tauriCoreMock.invoke.mockResolvedValue(undefined);

    await saveDocument();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(false);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState()).toMatchObject({ sourceText: before, dirtySinceSave: true });

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState()).toMatchObject({ sourceText: savedText, dirtySinceSave: false });
  });

  it("keeps the document dirty when it changes while a save write is in flight", async () => {
    const savedText = "nui 1\npoint A = (5, 0)";
    const laterText = "nui 1\npoint A = (6, 0)";
    useCadDocumentStore.getState().replaceTextDocument(savedText, {
      currentFilePath: "/tmp/current.nui",
      dirtySinceSave: true
    });
    tauriCoreMock.invoke.mockImplementation(async () => {
      useCadDocumentStore.getState().commitText(laterText, "test");
    });

    await saveDocument();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("write_document_file", {
      path: "/tmp/current.nui",
      content: savedText
    });
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: laterText,
      savedSourceText: savedText,
      dirtySinceSave: true
    });
  });

  it("imports legacy JSON as a dirty untitled document without writing its source file", async () => {
    const snapshot = initialCadDocumentState().doc.document;
    dialogMock.open.mockResolvedValue("/tmp/legacy.nuinui.json");
    tauriCoreMock.invoke.mockResolvedValue(JSON.stringify({
      app: LEGACY_APP_ID,
      schemaVersion: LEGACY_SCHEMA_VERSION,
      savedAt: "2026-07-10T00:00:00.000Z",
      document: snapshot
    }));

    await importLegacyDocument();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("read_document_file", {
      path: "/tmp/legacy.nuinui.json"
    });
    expect(tauriCoreMock.invoke).not.toHaveBeenCalledWith("write_document_file", expect.anything());
    expect(useCadDocumentStore.getState()).toMatchObject({
      currentFilePath: null,
      dirtySinceSave: true,
      past: [],
      future: []
    });
  });

  it("requires Tauri runtime for local file operations", async () => {
    clearTauriRuntime();

    await expect(openDocument()).rejects.toThrow("ローカルファイル操作はTauri版でのみ利用できます。");
    await expect(saveDocument()).rejects.toThrow("ローカルファイル操作はTauri版でのみ利用できます。");
  });
});
