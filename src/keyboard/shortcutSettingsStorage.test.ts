import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tauriCoreMock } = vi.hoisted(() => ({ tauriCoreMock: { invoke: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => tauriCoreMock);

import { loadShortcutSettings, normalizeShortcutSettings } from "./shortcutSettingsStorage";
import { legacyCreationCommandRecipeMap } from "../commands/legacyCreationRecipes";

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

  it("removes every retired DslPanel binding without a replacement", () => {
    expect(normalizeShortcutSettings({
      version: 1,
      overrides: [
        { bindingId: "global.openDslPanel", chords: [chord("d")] },
        { bindingId: "dsl.exportDslSelection", chords: [chord("e")] },
        { bindingId: "dsl.validateDslPanel", chords: [chord("v")] },
        { bindingId: "dsl.applyDslPanel", chords: [chord("a")] },
        { bindingId: "dsl.closeDslPanel", chords: [chord("Escape")] },
        { bindingId: "normal.addFreePoint", chords: [chord("p")] }
      ]
    })).toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.addFreePoint", chords: [chord("p")] }]
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

  it("migrates every removed temporary creation binding through the existing replacement rules", () => {
    const commandIds = Object.keys(legacyCreationCommandRecipeMap);
    expect(normalizeShortcutSettings({
      version: 1,
      overrides: commandIds.map((commandId, index) => ({
        bindingId: `normal.commandLine${commandId[0].toUpperCase()}${commandId.slice(1)}`,
        chords: [chord(String.fromCharCode(97 + index))]
      }))
    })).toEqual({
      version: 1,
      overrides: commandIds.map((commandId, index) => ({
        bindingId: `normal.${commandId}`,
        chords: [chord(String.fromCharCode(97 + index))]
      }))
    });
  });

  it("keeps a current creation binding over its temporary predecessor", () => {
    expect(normalizeShortcutSettings({
      version: 1,
      overrides: [
        { bindingId: "normal.commandLineAddLine", chords: [chord("x")] },
        { bindingId: "normal.addLine", chords: [chord("l")] }
      ]
    })).toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.addLine", chords: [chord("l")] }]
    });
  });

  it("removes retired and unknown bindings and writes normalized browser settings back", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.shortcutSettings.v1",
      JSON.stringify({
        version: 1,
        overrides: [
          { bindingId: "parameter.toggleSelectedParameterValue", chords: [chord(" ")] },
          { bindingId: "global.openDslPanel", chords: [chord("d")] },
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
