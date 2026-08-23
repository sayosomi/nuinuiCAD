import { describe, expect, it } from "vitest";
import { selectModuleDocumentationMarkdown } from "./moduleDocumentationLocale";

describe("Module documentation locale selection", () => {
  it("prefers the exact requested locale", () => {
    expect(selectModuleDocumentationMarkdown({
      variants: [
        { locale: "en", markdown: "English" },
        { locale: "ja", markdown: "日本語" }
      ]
    }, "ja")).toBe("日本語");
  });

  it("falls back to en without base-language matching", () => {
    expect(selectModuleDocumentationMarkdown({
      variants: [
        { locale: "ja", markdown: "日本語" },
        { locale: "en", markdown: "English" }
      ]
    }, "ja-JP")).toBe("English");
  });

  it("falls back to the first authored non-empty locale when exact and en are absent", () => {
    expect(selectModuleDocumentationMarkdown({
      variants: [
        { locale: "fr", markdown: "Français" },
        { locale: "pt-br", markdown: "Português" }
      ]
    }, "de")).toBe("Français");
  });

  it("fails closed for absent or empty documentation", () => {
    expect(selectModuleDocumentationMarkdown(null, "en")).toBeNull();
    expect(selectModuleDocumentationMarkdown({
      variants: [{ locale: "en", markdown: "   \n" }]
    }, "en")).toBeNull();
  });
});
