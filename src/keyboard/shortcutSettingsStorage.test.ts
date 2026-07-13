import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tauriCoreMock } = vi.hoisted(() => ({ tauriCoreMock: { invoke: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => tauriCoreMock);

import { loadShortcutSettings, normalizeShortcutSettings } from "./shortcutSettingsStorage";

const chord = (key: string) => ({ key, mod: false, alt: false, shift: false });

beforeEach(() => {
  window.localStorage.clear();
  tauriCoreMock.invoke.mockReset();
});

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("shortcutSettingsStorage", () => {
  it("removes legacy and current Inspector navigation bindings without a replacement", () => {
    expect(
      normalizeShortcutSettings({
        version: 1,
        overrides: [
          { bindingId: "parameter.selectNextParameter", chords: [chord("a"), chord("b")] },
          {
            bindingId: "dependencyJump.selectNextDependencyJumpTarget",
            chords: [chord("b"), chord("c")]
          },
          { bindingId: "global.focusInspectorParameterRows", chords: [chord("e")] },
          { bindingId: "inspector.startInspectorParameterPick", chords: [chord("p")] }
        ]
      })
    ).toEqual({
      version: 1,
      overrides: []
    });
  });

  it("keeps an explicit replacement binding ahead of legacy overrides", () => {
    expect(
      normalizeShortcutSettings({
        version: 1,
        overrides: [
          { bindingId: "parameter.incrementSelectedParameter", chords: [chord("x")] },
          { bindingId: "sourceEditor.stepSourceValueForward", chords: [chord("y")] }
        ]
      })
    ).toEqual({
      version: 1,
      overrides: [{ bindingId: "sourceEditor.stepSourceValueForward", chords: [chord("y")] }]
    });
  });

  it("migrates palette-created normal bindings as well as their default-scope bindings", () => {
    expect(
      normalizeShortcutSettings({
        version: 1,
        overrides: [{ bindingId: "normal.toggleElementInfoPanel", chords: [chord("i")] }]
      })
    ).toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.toggleInspectorPanel", chords: [chord("i")] }]
    });
  });

  it("removes retired and unknown bindings and writes normalized browser settings back", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.shortcutSettings.v1",
      JSON.stringify({
        version: 1,
        overrides: [
          { bindingId: "parameter.toggleSelectedParameterValue", chords: [chord(" ")] },
          { bindingId: "global.focusInspectorParameterRows", chords: [chord("e")] },
          { bindingId: "normal.noLongerExists", chords: [chord("x")] },
          { bindingId: "normal.addFreePoint", chords: [chord("p")] }
        ]
      })
    );

    await expect(loadShortcutSettings()).resolves.toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.addFreePoint", chords: [chord("p")] }]
    });
    expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.shortcutSettings.v1") ?? "")).toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.addFreePoint", chords: [chord("p")] }]
    });
  });

  it("writes normalized Tauri settings back without waiting for a failed write", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    tauriCoreMock.invoke
      .mockResolvedValueOnce({
        version: 1,
        overrides: [{ bindingId: "parameter.decrementSelectedParameter", chords: [chord("x")] }]
      })
      .mockRejectedValueOnce(new Error("write failed"));

    await expect(loadShortcutSettings()).resolves.toEqual({
      version: 1,
      overrides: [{ bindingId: "sourceEditor.stepSourceValueBackward", chords: [chord("x")] }]
    });
    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(1, "load_shortcut_settings");
    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(2, "save_shortcut_settings", {
      input: {
        version: 1,
        overrides: [
          { bindingId: "sourceEditor.stepSourceValueBackward", chords: [chord("x")] }
        ]
      }
    });
  });
});
