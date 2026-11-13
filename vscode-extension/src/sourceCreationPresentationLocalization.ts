import { SOURCE_OUTPUT_TEMPLATE_DEFINITIONS } from "../../src/commands/sourceOutputTemplateCatalog";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const sourceCreationPresentationTranslationCatalog = {
  "sourceCreation.outputPrint.layout-print": { en: "Layout + Print", ja: "Layout + Print（レイアウト + 印刷）" },
  "sourceCreation.outputPrint.layout": { en: "Layout", ja: "Layout（レイアウト）" },
  "sourceCreation.outputPrint.place": { en: "Place", ja: "Place（配置）" },
  "sourceCreation.outputPrint.print": { en: "Print", ja: "Print（印刷）" },
  "sourceCreation.outputPrint.svg": { en: "SVG", ja: "SVG" },

  "sourceCreation.message.stale": {
    en: "nuinuiCAD: The Source changed while the Output Preview template picker was open. Retry the command.",
    ja: "nuinuiCAD: Output Preview のテンプレート選択中に Source が変更されました。コマンドをもう一度実行してください。"
  },
  "sourceCreation.message.unsafeInsertion": {
    en: "nuinuiCAD: Could not establish a safe Output Preview document-end insertion target.",
    ja: "nuinuiCAD: Output Preview 用の安全なドキュメント末尾の挿入位置を特定できませんでした。"
  },
  "sourceCreation.message.placeScope": {
    en: "nuinuiCAD: Place is legal only directly inside a layout body.",
    ja: "nuinuiCAD: Place は layout 本体の直下でのみ使用できます。"
  },
  "sourceCreation.message.outputTopLevel": {
    en: "nuinuiCAD: This template is legal only at the document top level.",
    ja: "nuinuiCAD: このテンプレートはドキュメントのトップレベルでのみ使用できます。"
  }
} satisfies TranslationCatalog;

export type SourceCreationMessageId = "stale" | "unsafeInsertion" | "placeScope" | "outputTopLevel";

export const sourceCreationTranslatorFor = (displayLanguage: string) =>
  createTranslator(sourceCreationPresentationTranslationCatalog, resolveLocale(displayLanguage));

export const sourceCreationMessageFor = (
  messageId: SourceCreationMessageId,
  displayLanguage: string
): string => sourceCreationTranslatorFor(displayLanguage)(`sourceCreation.message.${messageId}`);

export const sourceOutputPrintPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.outputPrint.${item.id}`)
  }));
};
