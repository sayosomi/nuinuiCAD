import { beforeEach, describe, expect, it } from "vitest";
import {
  bakeCommandOptionsFromSettings,
  defaultBakeSettings,
  normalizeBakeSettings
} from "./bakeSettingsStorage";

describe("Bake settings", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses the VS Code defaults and exact persisted keys", () => {
    expect(defaultBakeSettings()).toEqual({
      version: 1,
      "nuinuiCAD.bake.emitSkippedComments": true,
      "nuinuiCAD.bake.includeHiddenGeometry": false,
      "nuinuiCAD.bake.includeDisabledGeometry": false
    });
  });

  it("normalizes malformed values without changing the key model", () => {
    expect(normalizeBakeSettings({
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": "yes",
      extra: true
    })).toEqual({
      version: 1,
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": false,
      "nuinuiCAD.bake.includeDisabledGeometry": false
    });
  });

  it("maps loaded plain settings to the shared Bake command context", () => {
    expect(bakeCommandOptionsFromSettings({
      version: 1,
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": true,
      "nuinuiCAD.bake.includeDisabledGeometry": true
    })).toEqual({
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
  });
});
