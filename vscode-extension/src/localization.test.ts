import { describe, expect, it } from "vitest";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

const catalog = {
  "greeting": {
    en: "Hello, {name}!",
    ja: "こんにちは、{name}さん！"
  },
  "stable.greeting": {
    en: "English text",
    ja: "日本語のテキスト"
  }
} satisfies TranslationCatalog;

describe("VS Code localization foundation", () => {
  it("resolves Japanese display language", () => {
    expect(resolveLocale("ja")).toBe("ja");
  });

  it("resolves Japanese regional display languages", () => {
    expect(resolveLocale("ja-JP")).toBe("ja");
  });

  it("resolves English display language", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back to English for unsupported display languages", () => {
    expect(resolveLocale("fr-FR")).toBe("en");
  });

  it("uses English by default and interpolates named parameters", () => {
    const translate = createTranslator(catalog);

    expect(translate("greeting", { name: "Ada" })).toBe("Hello, Ada!");
  });

  it("selects Japanese text and interpolates named parameters", () => {
    const translate = createTranslator(catalog, "ja");

    expect(translate("greeting", { name: "アダ" })).toBe("こんにちは、アダさん！");
  });

  it("keeps stable translation keys independent from localized results", () => {
    const key = "stable.greeting";
    const english = createTranslator(catalog, "en");
    const japanese = createTranslator(catalog, "ja");

    expect(key).toBe("stable.greeting");
    expect(english(key)).toBe("English text");
    expect(japanese(key)).toBe("日本語のテキスト");
    expect(english(key)).not.toBe(japanese(key));
  });
});
