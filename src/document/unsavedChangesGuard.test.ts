import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import {
  handleBeforeUnloadWithUnsavedChanges,
  registerUnsavedChangesGuard
} from "./unsavedChangesGuard";

const windowMock = vi.hoisted(() => ({
  closeHandler: null as null | ((event: { preventDefault: () => void }) => void | Promise<void>),
  destroy: vi.fn(async () => undefined),
  unlisten: vi.fn(),
  onCloseRequested: vi.fn(
    async (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => {
      windowMock.closeHandler = handler;
      return windowMock.unlisten;
    }
  )
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: windowMock.destroy,
    onCloseRequested: windowMock.onCloseRequested
  })
}));

const dialogMock = vi.hoisted(() => ({
  message: vi.fn(async () => "保存しないで閉じる")
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: dialogMock.message
}));

const documentFileMock = vi.hoisted(() => ({
  saveDocument: vi.fn(async () => undefined)
}));

vi.mock("./documentFile", () => ({
  saveDocument: documentFileMock.saveDocument
}));

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {}
  });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

const beforeUnloadEvent = () => {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    value: undefined,
    writable: true
  });
  return event;
};

const flushPromises = async () => {
  await vi.dynamicImportSettled();
};

describe("unsaved changes guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCadDocumentStore.setState(initialCadDocumentState());
    clearTauriRuntime();
    windowMock.closeHandler = null;
    windowMock.destroy.mockClear();
    windowMock.unlisten.mockReset();
    windowMock.onCloseRequested.mockReset();
    windowMock.onCloseRequested.mockImplementation(
      async (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => {
        windowMock.closeHandler = handler;
        return windowMock.unlisten;
      }
    );
    dialogMock.message.mockReset();
    dialogMock.message.mockResolvedValue("保存しないで閉じる");
    documentFileMock.saveDocument.mockReset();
    documentFileMock.saveDocument.mockResolvedValue(undefined);
  });

  it("does not block reload when the document is clean", () => {
    const event = beforeUnloadEvent();

    const result = handleBeforeUnloadWithUnsavedChanges(event);

    expect(result).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
    expect(event.returnValue).toBeUndefined();
  });

  it("blocks reload when the document is dirty", () => {
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    const event = beforeUnloadEvent();

    const result = handleBeforeUnloadWithUnsavedChanges(event);

    expect(result).toBe("");
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");
  });

  it("registers and unregisters the browser reload guard", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const cleanup = registerUnsavedChangesGuard();
    cleanup();

    expect(add).toHaveBeenCalledWith("beforeunload", handleBeforeUnloadWithUnsavedChanges);
    expect(remove).toHaveBeenCalledWith("beforeunload", handleBeforeUnloadWithUnsavedChanges);
  });

  it("prevents native close and destroys the window when closing without saving is selected", async () => {
    setTauriRuntime();
    dialogMock.message.mockResolvedValue("保存しないで閉じる");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(windowMock.onCloseRequested).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
    expect(dialogMock.message).toHaveBeenCalledWith("未保存の変更があります。閉じる前に保存しますか？", {
      title: "nuinuiCAD",
      kind: "warning",
      buttons: {
        yes: "保存して閉じる",
        no: "保存しないで閉じる",
        cancel: "キャンセル"
      }
    });
    expect(documentFileMock.saveDocument).not.toHaveBeenCalled();
    expect(windowMock.destroy).toHaveBeenCalled();
    cleanup();
    expect(windowMock.unlisten).toHaveBeenCalled();
  });

  it("saves then destroys the window when save and close is selected", async () => {
    setTauriRuntime();
    dialogMock.message.mockResolvedValue("保存して閉じる");
    documentFileMock.saveDocument.mockImplementation(async () => {
      useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    });
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(documentFileMock.saveDocument).toHaveBeenCalled();
    expect(windowMock.destroy).toHaveBeenCalled();
    cleanup();
  });

  it("does not destroy the window when save and close is selected but saving is canceled", async () => {
    setTauriRuntime();
    dialogMock.message.mockResolvedValue("保存して閉じる");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(documentFileMock.saveDocument).toHaveBeenCalled();
    expect(windowMock.destroy).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not destroy the window when save before close fails", async () => {
    setTauriRuntime();
    const error = new Error("write failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    dialogMock.message.mockResolvedValue("保存して閉じる");
    documentFileMock.saveDocument.mockRejectedValue(error);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(consoleError).toHaveBeenCalledWith("Failed to save document before closing.", error);
    expect(windowMock.destroy).not.toHaveBeenCalled();
    cleanup();
  });

  it("prevents native close without destroying when cancel is selected", async () => {
    setTauriRuntime();
    dialogMock.message.mockResolvedValue("キャンセル");
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(dialogMock.message).toHaveBeenCalled();
    expect(documentFileMock.saveDocument).not.toHaveBeenCalled();
    expect(windowMock.destroy).not.toHaveBeenCalled();
    cleanup();
  });

  it("allows native close without confirmation when the document is clean", async () => {
    setTauriRuntime();

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(dialogMock.message).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(windowMock.destroy).not.toHaveBeenCalled();
    cleanup();
  });

  it("logs close guard registration failures without throwing", async () => {
    setTauriRuntime();
    const error = new Error("registration failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    windowMock.onCloseRequested.mockRejectedValue(error);

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith("Failed to register window close guard.", error);
    expect(() => cleanup()).not.toThrow();
  });
});
