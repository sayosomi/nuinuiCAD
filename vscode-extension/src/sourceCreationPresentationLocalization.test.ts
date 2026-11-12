import { describe, expect, it } from "vitest";
import {
  sourceCreationMessageFor,
  sourceOutputPrintPickerItemsFor
} from "./sourceCreationPresentationLocalization";

describe("Output Preview template localization", () => {
  it("localizes the retained specialized Output picker without changing stable IDs", () => {
    expect(sourceOutputPrintPickerItemsFor("en-US").map(({ id, label }) => [id, label])).toEqual([
      ["layout-print", "Layout + Print"],
      ["layout", "Layout"],
      ["place", "Place"],
      ["print", "Print"],
      ["svg", "SVG"]
    ]);
    expect(sourceOutputPrintPickerItemsFor("ja-JP").map(({ id }) => id)).toEqual([
      "layout-print", "layout", "place", "print", "svg"
    ]);
    expect(sourceOutputPrintPickerItemsFor("ja-JP")[1]?.label).toContain("レイアウト");
  });

  it("localizes the specialized Output safety messages", () => {
    expect(sourceCreationMessageFor("stale", "ja-JP")).toContain("Source が変更されました");
    expect(sourceCreationMessageFor("unsafeInsertion", "ja-JP")).toContain("挿入位置");
    expect(sourceCreationMessageFor("placeScope", "ja-JP")).toContain("layout 本体の直下");
    expect(sourceCreationMessageFor("outputTopLevel", "ja-JP")).toContain("トップレベル");
    expect(sourceCreationMessageFor("stale", "en-US")).toContain("Output Preview template picker");
  });
});
