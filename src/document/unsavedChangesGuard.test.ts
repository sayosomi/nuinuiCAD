import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import {
  handleBeforeUnloadWithUnsavedChanges,
  registerUnsavedChangesGuard
} from "./unsavedChangesGuard";

const windowMock = vi.hoisted(() => ({
  closeHandler: null as null | ((event: { preventDefault: () => void }) => void | Promise<void>),
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
    onCloseRequested: windowMock.onCloseRequested
  })
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
    windowMock.unlisten.mockReset();
    windowMock.onCloseRequested.mockReset();
    windowMock.onCloseRequested.mockImplementation(
      async (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => {
        windowMock.closeHandler = handler;
        return windowMock.unlisten;
      }
    );
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

  it("allows native close when the dirty document discard is confirmed", async () => {
    setTauriRuntime();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(windowMock.onCloseRequested).toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    cleanup();
    expect(windowMock.unlisten).toHaveBeenCalled();
  });

  it("prevents native close when the dirty document discard is declined", async () => {
    setTauriRuntime();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    cleanup();
  });

  it("allows native close without confirmation when the document is clean", async () => {
    setTauriRuntime();
    const confirm = vi.spyOn(window, "confirm");

    const cleanup = registerUnsavedChangesGuard();
    await flushPromises();
    const preventDefault = vi.fn();
    await windowMock.closeHandler?.({ preventDefault });

    expect(confirm).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    cleanup();
  });
});
