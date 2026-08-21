export type SupportedLocale = "ja" | "en";

export type TranslationParameters = Readonly<Record<string, string | number | boolean>>;

export type TranslationEntry = Readonly<{
  en: string;
  ja?: string;
}>;

export type TranslationCatalog = Readonly<Record<string, TranslationEntry>>;

export const resolveLocale = (displayLanguage: string): SupportedLocale =>
  displayLanguage === "ja" || displayLanguage.startsWith("ja-") ? "ja" : "en";

const interpolate = (text: string, parameters: TranslationParameters | undefined): string => {
  if (!parameters) return text;

  return text.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder
  );
};

export type Translator = (key: string, parameters?: TranslationParameters) => string;

export const createTranslator = (catalog: TranslationCatalog, locale: SupportedLocale = "en"): Translator =>
  (key, parameters) => {
    const entry = catalog[key];
    if (!entry) return key;

    const text = locale === "ja" ? entry.ja ?? entry.en : entry.en;
    return interpolate(text, parameters);
  };
