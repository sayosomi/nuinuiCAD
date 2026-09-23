import { describe, expect, it } from "vitest";
import { modulePreviewTranslatorFor } from "./modulePreviewLocalization";

describe("Module Preview localization", () => {
  it("keeps the panel title in English for Japanese display language", () => {
    const translate = modulePreviewTranslatorFor("ja-JP");

    expect(translate("modulePreview.panelTitle")).toBe("Module Preview");
  });

  it("keeps the existing English panel title unchanged", () => {
    const translate = modulePreviewTranslatorFor("en");

    expect(translate("modulePreview.panelTitle")).toBe("Module Preview");
  });
});
