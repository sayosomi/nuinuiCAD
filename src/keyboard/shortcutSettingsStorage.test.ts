import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tauriCoreMock } = vi.hoisted(() => ({ tauriCoreMock: { invoke: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => tauriCoreMock);

import { legacyBindingIdMap, loadShortcutSettings, normalizeShortcutSettings } from "./shortcutSettingsStorage";
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
  it("keeps legacy and current Inspector navigation bindings visible when they have no replacement", () => {
    const settings = normalizeShortcutSettings({
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
    });
    expect(settings.overrides).toEqual([]);
    expect(settings.unresolvedOverrides?.map((item) => item.bindingId)).toEqual([
      "parameter.selectNextParameter",
      "dependencyJump.selectNextDependencyJumpTarget",
      "global.focusInspectorParameterRows",
      "inspector.startInspectorParameterPick"
    ]);
  });

  it("keeps retired DslPanel bindings visible when they have no replacement", () => {
    const settings = normalizeShortcutSettings({
      version: 1,
      overrides: [
        { bindingId: "global.openDslPanel", chords: [chord("d")] },
        { bindingId: "dsl.exportDslSelection", chords: [chord("e")] },
        { bindingId: "dsl.validateDslPanel", chords: [chord("v")] },
        { bindingId: "dsl.applyDslPanel", chords: [chord("a")] },
        { bindingId: "dsl.closeDslPanel", chords: [chord("Escape")] },
        { bindingId: "normal.addFreePoint", chords: [chord("p")] }
      ]
    });
    expect(settings.overrides).toEqual([{ bindingId: "normal.addFreePoint", chords: [chord("p")] }]);
    expect(settings.unresolvedOverrides?.map((item) => item.bindingId)).toEqual([
      "global.openDslPanel",
      "dsl.exportDslSelection",
      "dsl.validateDslPanel",
      "dsl.applyDslPanel",
      "dsl.closeDslPanel"
    ]);
  });

  it("accepts Alt-only value-step overrides but keeps app-exclusive Source Editor shortcuts Mod-only", () => {
    const settings = normalizeShortcutSettings({
        version: 1,
        overrides: [
          { bindingId: "sourceEditor.stepSourceValueForward", chords: [{ ...chord("ArrowRight"), alt: true }] },
          { bindingId: "sourceEditor.addFreePoint", chords: [chord("x")] }
        ]
    });
    expect(settings.overrides).toEqual([
      { bindingId: "sourceEditor.stepSourceValueForward", chords: [{ ...chord("ArrowRight"), alt: true }] }
    ]);
    expect(settings.unresolvedOverrides?.map((item) => item.bindingId)).toEqual(["sourceEditor.addFreePoint"]);
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

  it("migrates every legacy element-list binding directly to Source Editor focus", () => {
    expect(normalizeShortcutSettings({
      version: 1,
      overrides: [
        { bindingId: "normal.focusElementList", chords: [chord("f")] },
        { bindingId: "normal.enterElementListMode", chords: [chord("g")] },
        { bindingId: "global.enterElementListMode", chords: [chord("h")] }
      ]
    })).toEqual({
      version: 1,
      overrides: [{
        bindingId: "normal.focusSourceEditor",
        chords: [chord("f"), chord("g"), chord("h")]
      }]
    });
  });

  it("keeps a current Source Editor focus override over all legacy replacements", () => {
    expect(normalizeShortcutSettings({
      version: 1,
      overrides: [
        { bindingId: "normal.focusElementList", chords: [chord("f")] },
        { bindingId: "normal.enterElementListMode", chords: [chord("g")] },
        { bindingId: "global.enterElementListMode", chords: [chord("h")] },
        { bindingId: "normal.focusSourceEditor", chords: [chord("s")] }
      ]
    })).toEqual({
      version: 1,
      overrides: [{ bindingId: "normal.focusSourceEditor", chords: [chord("s")] }]
    });
  });

  it("migrates every removed temporary creation binding through the existing replacement rules", () => {
    const commandIds = Object.keys(legacyCreationCommandRecipeMap).filter((commandId) =>
      `normal.commandLine${commandId[0].toUpperCase()}${commandId.slice(1)}` in legacyBindingIdMap
    );
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

  it("keeps retired, deleted, and unknown bindings in normalized browser settings", async () => {
    window.localStorage.setItem(
      "nuinuiCAD.shortcutSettings.v1",
      JSON.stringify({
        version: 1,
        overrides: [
          { bindingId: "parameter.toggleSelectedParameterValue", chords: [chord(" ")] },
          { bindingId: "global.openDslPanel", chords: [chord("d")] },
          { bindingId: "global.focusInspectorParameterRows", chords: [chord("e")] },
          { bindingId: "global.openGroupTemplateLibrary", chords: [chord("g")] },
          { bindingId: "normal.startTemplateInsertion", chords: [chord("t")] },
          { bindingId: "normal.noLongerExists", chords: [chord("x")] },
          { bindingId: "normal.addFreePoint", chords: [chord("p")] }
        ]
      })
    );

    const settings = await loadShortcutSettings();
    expect(settings.overrides).toEqual([{ bindingId: "normal.addFreePoint", chords: [chord("p")] }]);
    expect(settings.unresolvedOverrides?.map((item) => item.bindingId)).toEqual([
      "parameter.toggleSelectedParameterValue",
      "global.openDslPanel",
      "global.focusInspectorParameterRows",
      "global.openGroupTemplateLibrary",
      "normal.startTemplateInsertion",
      "normal.noLongerExists"
    ]);
    expect(JSON.parse(window.localStorage.getItem("nuinuiCAD.shortcutSettings.v1") ?? "")).toEqual(settings);
  });

  it("writes normalized Tauri settings back without waiting for a failed write", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    tauriCoreMock.invoke
      .mockResolvedValueOnce({
        version: 1,
        overrides: [{ bindingId: "parameter.decrementSelectedParameter", chords: [chord("x")] }]
      })
      .mockRejectedValueOnce(new Error("write failed"));

    const settings = await loadShortcutSettings();
    expect(settings.overrides).toEqual([]);
    expect(settings.unresolvedOverrides).toEqual([{
      bindingId: "parameter.decrementSelectedParameter",
      chords: [chord("x")],
      reason: "移行先のSource EditorアプリショートカットにはModキーが必要です。"
    }]);
    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(1, "load_shortcut_settings");
    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(2, "save_shortcut_settings", {
      input: {
        version: 1,
        overrides: [],
        unresolvedOverrides: settings.unresolvedOverrides
      }
    });
  });
});
