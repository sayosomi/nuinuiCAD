import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerTauriMenuCommandListener,
  TAURI_MENU_COMMAND_EVENT
} from "./tauriMenuEvents";

const tauriEventMock = vi.hoisted(() => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => tauriEventMock);

type MenuEventHandler = (event: { payload: unknown }) => void;

let menuEventHandler: MenuEventHandler | null = null;

beforeEach(() => {
  menuEventHandler = null;
  tauriEventMock.listen.mockReset();
  tauriEventMock.listen.mockImplementation(
    (_eventName: string, handler: MenuEventHandler) => {
      menuEventHandler = handler;
      return Promise.resolve(vi.fn());
    }
  );
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {}
  });
});

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("registerTauriMenuCommandListener", () => {
  it("dispatches valid Tauri menu command events", async () => {
    const focusCanvas = vi.fn();
    const cleanup = registerTauriMenuCommandListener({ focusCanvas });

    await waitFor(() => expect(tauriEventMock.listen).toHaveBeenCalledTimes(1));
    expect(tauriEventMock.listen).toHaveBeenCalledWith(
      TAURI_MENU_COMMAND_EVENT,
      expect.any(Function)
    );

    menuEventHandler?.({ payload: "focusCanvas" });

    expect(focusCanvas).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("ignores unknown command event payloads", async () => {
    const focusCanvas = vi.fn();
    const cleanup = registerTauriMenuCommandListener({ focusCanvas });

    await waitFor(() => expect(tauriEventMock.listen).toHaveBeenCalledTimes(1));
    menuEventHandler?.({ payload: "notACommand" });
    menuEventHandler?.({ payload: null });

    expect(focusCanvas).not.toHaveBeenCalled();
    cleanup();
  });
});
