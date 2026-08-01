import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { importLegacyDocument, newDocument, openDocument } from "./documentFile";

const tauriCoreMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const dialogMock = vi.hoisted(() => ({ confirm: vi.fn(), open: vi.fn(), save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

const dirtySource = () => {
  useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
  return useCadDocumentStore.getState().sourceText;
};

const expectNoFileOperation = (sourceText: string) => {
  expect(dialogMock.open).not.toHaveBeenCalled();
  expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
  expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe("document file confirmation boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    setTauriRuntime();
    tauriCoreMock.invoke.mockReset();
    dialogMock.confirm.mockReset();
    dialogMock.open.mockReset();
    dialogMock.save.mockReset();
    dialogMock.confirm.mockResolvedValue(true);
  });

  it.each([
    ["new document", newDocument],
    ["open document", openDocument],
    ["legacy import", importLegacyDocument]
  ] as const)("waits for confirmation before starting dirty Tauri %s", async (_, operation) => {
    const confirmation = deferred<boolean>();
    dialogMock.confirm.mockReturnValue(confirmation.promise);
    const before = dirtySource();

    const pendingOperation = operation();
    await Promise.resolve();

    expect(dialogMock.confirm).toHaveBeenCalledOnce();
    expectNoFileOperation(before);

    confirmation.resolve(false);
    await expect(pendingOperation).resolves.toBeUndefined();
    expectNoFileOperation(before);
  });

  it.each([
    ["new document", newDocument],
    ["open document", openDocument],
    ["legacy import", importLegacyDocument]
  ] as const)("handles a rejected Tauri confirmation and safely aborts dirty %s", async (_, operation) => {
    const error = new Error("dialog unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    dialogMock.confirm.mockRejectedValue(error);
    const before = dirtySource();

    await expect(operation()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("Failed to confirm discarding unsaved changes.", error);
    expect(useCadUiStore.getState().commandErrorMessage).toBe(
      "未保存の変更を破棄する確認を表示できませんでした。操作を中止しました。"
    );
    expectNoFileOperation(before);
  });

  it("continues a dirty legacy import after confirmation", async () => {
    const snapshot = initialCadDocumentState().doc.document;
    dialogMock.open.mockResolvedValue("/tmp/legacy.nuinui.json");
    tauriCoreMock.invoke.mockResolvedValue(JSON.stringify({
      app: "nuinuiCAD",
      schemaVersion: 5,
      savedAt: "2026-08-01T00:00:00.000Z",
      document: snapshot
    }));
    dirtySource();

    await importLegacyDocument();

    expect(dialogMock.confirm).toHaveBeenCalledOnce();
    expect(dialogMock.open).toHaveBeenCalledOnce();
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("read_document_file", {
      path: "/tmp/legacy.nuinui.json"
    });
    expect(useCadDocumentStore.getState()).toMatchObject({ currentFilePath: null, dirtySinceSave: true });
  });

  it("continues a dirty browser new document after native confirmation", async () => {
    clearTauriRuntime();
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    dirtySource();

    await newDocument();

    expect(nativeConfirm).toHaveBeenCalledOnce();
    expect(dialogMock.confirm).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState()).toMatchObject({ currentFilePath: null, dirtySinceSave: false });
  });
});
