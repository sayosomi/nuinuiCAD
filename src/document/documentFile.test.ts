import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleElements } from "../sampleData";
import {
  currentDocumentSnapshot,
  initialCadDocumentState,
  useCadDocumentStore,
  type CadDocumentSnapshot
} from "../state/cadDocumentStore";
import { serializeCadDocumentFile } from "./documentFormat";
import { newDocument, openDocument, saveDocument, saveDocumentAs } from "./documentFile";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn()
}));

const dialogMock = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {}
  });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

const loadedSnapshot = (): CadDocumentSnapshot => ({
  elements: [sampleElements[1]],
  evaluationLimitIndex: 1,
  selectedElementId: sampleElements[1].id,
  selectedElementIds: [sampleElements[1].id],
  selectionAnchorElementId: sampleElements[1].id,
  selectedParameterKey: "name"
});

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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/edited.nuinui.json");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    await newDocument();

    expect(confirm).toHaveBeenCalled();
    expect(useCadDocumentStore.getState()).toMatchObject({
      ...currentDocumentSnapshot(initialCadDocumentState()),
      past: [],
      future: [],
      currentFilePath: null,
      dirtySinceSave: false
    });
  });

  it("leaves the current dirty document untouched when new document discard is canceled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/edited.nuinui.json");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    const before = useCadDocumentStore.getState();

    await newDocument();

    expect(useCadDocumentStore.getState()).toMatchObject({
      ...currentDocumentSnapshot(before),
      currentFilePath: "/tmp/edited.nuinui.json",
      dirtySinceSave: true
    });
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
  });

  it("does not open a file or change state when dirty open discard is canceled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/current.nuinui.json");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    const before = useCadDocumentStore.getState();

    await openDocument();

    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState()).toMatchObject({
      ...currentDocumentSnapshot(before),
      currentFilePath: "/tmp/current.nuinui.json",
      dirtySinceSave: true
    });
  });

  it("keeps the dirty document when open dialog is canceled after confirming discard", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    dialogMock.open.mockResolvedValue(null);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/current.nuinui.json");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    const before = useCadDocumentStore.getState();

    await openDocument();

    expect(dialogMock.open).toHaveBeenCalled();
    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState()).toMatchObject({
      ...currentDocumentSnapshot(before),
      currentFilePath: "/tmp/current.nuinui.json",
      dirtySinceSave: true
    });
  });

  it("opens a selected document and clears dirty file state after parsing succeeds", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const snapshot = loadedSnapshot();
    dialogMock.open.mockResolvedValue("/tmp/loaded.nuinui.json");
    tauriCoreMock.invoke.mockResolvedValue(serializeCadDocumentFile(snapshot, "2026-06-29T00:00:00.000Z"));
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    await openDocument();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("read_document_file", {
      path: "/tmp/loaded.nuinui.json"
    });
    expect(useCadDocumentStore.getState()).toMatchObject({
      ...snapshot,
      past: [],
      future: [],
      currentFilePath: "/tmp/loaded.nuinui.json",
      dirtySinceSave: false
    });
  });

  it("saves as a selected path, normalizes the extension, and clears dirty state after write", async () => {
    dialogMock.save.mockResolvedValue("/tmp/pattern");
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    await saveDocumentAs();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
      "write_document_file",
      expect.objectContaining({ path: "/tmp/pattern.nuinui.json" })
    );
    expect(useCadDocumentStore.getState()).toMatchObject({
      currentFilePath: "/tmp/pattern.nuinui.json",
      dirtySinceSave: false
    });
  });

  it("saves the current file path without changing file state when write fails", async () => {
    useCadDocumentStore.getState().markDocumentSaved("/tmp/current.nuinui.json");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    tauriCoreMock.invoke.mockRejectedValue(new Error("write failed"));

    await expect(saveDocument()).rejects.toThrow("write failed");

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
      "write_document_file",
      expect.objectContaining({ path: "/tmp/current.nuinui.json" })
    );
    expect(useCadDocumentStore.getState()).toMatchObject({
      currentFilePath: "/tmp/current.nuinui.json",
      dirtySinceSave: true
    });
  });

  it("requires Tauri runtime for local file open and save operations", async () => {
    clearTauriRuntime();

    await expect(openDocument()).rejects.toThrow("ローカルファイル操作はTauri版でのみ利用できます。");
    await expect(saveDocument()).rejects.toThrow("ローカルファイル操作はTauri版でのみ利用できます。");
  });
});
