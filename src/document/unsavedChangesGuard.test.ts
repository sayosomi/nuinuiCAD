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
  confirm: vi.fn(async () => true)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: dialogMock.confirm
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
    dialogMock.confirm.mockReset();
    dialogMock.confirm.mockResolvedValue(true);
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

  it("destroys the native window when the dirty document discard is confirmed", async () => {
    setTauriRuntime();
    dialogMock.confirm.mockResolvedValue(true);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(windowMock.onCloseRequested).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
    expect(dialogMock.confirm).toHaveBeenCalledWith("未保存の変更を破棄して閉じますか？", {
      title: "nuinuiCAD",
      kind: "warning",
      okLabel: "破棄して閉じる",
      cancelLabel: "キャンセル"
    });
    expect(windowMock.destroy).toHaveBeenCalled();
    cleanup();
    expect(windowMock.unlisten).toHaveBeenCalled();
  });

  it("prevents native close without destroying when the dirty document discard is declined", async () => {
    setTauriRuntime();
    dialogMock.confirm.mockResolvedValue(false);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(dialogMock.confirm).toHaveBeenCalled();
    expect(windowMock.destroy).not.toHaveBeenCalled();
    cleanup();
  });

  it("allows native close without confirmation when the document is clean", async () => {
    setTauriRuntime();

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(dialogMock.confirm).not.toHaveBeenCalled();
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
