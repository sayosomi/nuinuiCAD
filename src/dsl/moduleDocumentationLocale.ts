import type { ModuleDocumentation } from "./moduleDocumentation";

/**
 * Select authored Module documentation without inventing locale aliases.
 *
 * The shared Completion / Signature Help rule is intentionally strict:
 * exact requested locale -> `en` -> first authored non-empty locale.
 * In particular, `ja-JP` does not implicitly match `ja`.
 */
export const selectModuleDocumentationMarkdown = (
  documentation: ModuleDocumentation | null | undefined,
  locale: string
): string | null => {
  const variants = documentation?.variants.filter((variant) => variant.markdown.trim().length > 0) ?? [];
  if (variants.length === 0) return null;

  return variants.find((variant) => variant.locale === locale)?.markdown
    ?? variants.find((variant) => variant.locale === "en")?.markdown
    ?? variants[0]!.markdown;
};
