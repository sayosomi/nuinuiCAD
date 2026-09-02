import { describe, expect, it } from "vitest";
import {
  webviewPresentationFor,
  webviewPresentationTranslationCatalog
} from "./webviewPresentationLocalization";

describe("Webview presentation localization", () => {
  it("resolves Japanese presentation and keeps the payload clone-safe", () => {
    const presentation = webviewPresentationFor("ja-JP");

    expect(presentation.locale).toBe("ja");
    expect(presentation.strings["canvas.ariaLabel"]).toBe("CAD作図キャンバス");
    expect(presentation.strings["output.noOutputs"]).toBe("印刷またはSVGの出力がありません");
    expect(presentation.diagnosticTemplates["diagnostic.undefined-binding"]).toBe("未定義の変数「{referencedName}」を参照しています。");
    expect(structuredClone(presentation)).toEqual(presentation);
    expect(Object.getPrototypeOf(presentation)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(presentation.strings)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(presentation.diagnosticTemplates)).toBe(Object.prototype);
  });

  it("uses English for English and unsupported display languages", () => {
    const english = webviewPresentationFor("en");
    const unsupported = webviewPresentationFor("fr-FR");
    const missing = webviewPresentationFor(undefined);

    expect(english.locale).toBe("en");
    expect(unsupported.locale).toBe("en");
    expect(missing.locale).toBe("en");
    expect(english.strings["canvas.ariaLabel"]).toBe("CAD drawing canvas");
    expect(unsupported.strings["canvas.ariaLabel"]).toBe(english.strings["canvas.ariaLabel"]);
    expect(Object.keys(english.strings)).toEqual(Object.keys(webviewPresentationTranslationCatalog));
  });
});
