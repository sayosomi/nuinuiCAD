import type { DslRenameRejection } from "../../src/dsl/dslRenameQuery";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const renameTranslationCatalog = {
  "rename.prepareUnavailable": {
    en: "Rename is not available at this position.",
    ja: "この位置では名前を変更できません。"
  },
  "rename.applyUnavailable": {
    en: "Rename could not be applied.",
    ja: "名前の変更を適用できませんでした。"
  },
  "rename.currentSourceInvalid": {
    en: "Rename is unavailable because the current Source has errors. Fix them and try again.",
    ja: "現在の Source にエラーがあるため、名前を変更できません。エラーを修正してから再試行してください。"
  },
  "rename.invalidName": { en: "Enter a valid name.", ja: "有効な名前を入力してください。" },
  "rename.sameScope": {
    en: "'{name}' already exists in this scope.",
    ja: "'{name}' はこのスコープですでに存在します。"
  },
  "rename.sameScopeAtLine": {
    en: "'{name}' already exists in this scope on line {line}.",
    ja: "'{name}' はこのスコープの {line} 行目にすでに存在します。"
  },
  "rename.typedReferenceChange": {
    en: "Rename would change the reference resolved by '{name}'.",
    ja: "名前を変更すると '{name}' の参照先が変わります。"
  },
  "rename.elementReferenceChange": {
    en: "Rename would change a reference.",
    ja: "名前を変更すると参照先が変わります。"
  },
  "rename.elementReferenceChangeAtLine": {
    en: "Rename would change a reference on line {line}.",
    ja: "名前を変更すると {line} 行目の参照先が変わります。"
  },
  "rename.moduleReferenceChange": {
    en: "Rename would change Module reference resolution.",
    ja: "名前を変更すると Module の参照解決が変わります。"
  },
  "rename.recordReferenceChange": {
    en: "Rename would change record reference resolution.",
    ja: "名前を変更すると record の参照解決が変わります。"
  }
} satisfies TranslationCatalog;

export const renameTranslatorFor = (displayLanguage: string) =>
  createTranslator(renameTranslationCatalog, resolveLocale(displayLanguage));

export const renameRejectionMessageFor = (
  rejection: DslRenameRejection,
  displayLanguage: string
): string => {
  const translator = renameTranslatorFor(displayLanguage);
  switch (rejection.reason) {
    case "invalid-name":
      return translator("rename.invalidName");
    case "same-scope-collision":
      return translator(
        rejection.conflictingLine === undefined ? "rename.sameScope" : "rename.sameScopeAtLine",
        rejection.conflictingLine === undefined
          ? { name: rejection.conflictingName }
          : { name: rejection.conflictingName, line: rejection.conflictingLine }
      );
    case "reference-resolution-change":
      if (rejection.family === "typed") {
        return translator("rename.typedReferenceChange", { name: rejection.referencedName });
      }
      if (rejection.family === "element") {
        return translator(
          rejection.line === undefined ? "rename.elementReferenceChange" : "rename.elementReferenceChangeAtLine",
          rejection.line === undefined ? undefined : { line: rejection.line }
        );
      }
      return translator(rejection.family === "module" ? "rename.moduleReferenceChange" : "rename.recordReferenceChange");
    case "unavailable":
      return translator("rename.applyUnavailable");
  }
};
