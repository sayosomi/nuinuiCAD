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
    expect(presentation.strings["canvas.commandError.staleSourceAnchor"]).toBe("現在のSource位置が古くなっています。現在のSourceでキャレットを再確定してから再試行してください。");
    expect(presentation.strings["canvas.commandError.pointer"]).toBe("Canvas上にポインターを置いてから実行してください。");
    expect(presentation.strings["canvas.creationAssist.shortcuts"]).toBe("Enter 次へ · Shift+Enter 戻る · macOS Option+Enter 選択 · Windows/Linux Alt+Enter 選択 · Esc キャンセル");
    expect(presentation.strings["canvas.referencePick.done"]).toBe("決定");
    expect(presentation.strings["canvas.coordinateConversion.apply"]).toBe("適用（Enter）");
    expect(presentation.strings["output.place.candidateMenu"]).toBe("重なっている配置ハンドル");
    expect(presentation.strings["output.place.dragReason.axes"]).toBe("ドラッグできません: at の {axes} は直接の有限数値リテラルである必要があります。");
    expect(presentation.strings["output.noValidPlan"]).toBe("現在のSourceから有効な出力プランを作成できません。");
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
    expect(english.strings["canvas.commandError.staleSourceAnchor"]).toBe("The current Source position is stale. Reconfirm the caret in the current Source and try again.");
    expect(english.strings["canvas.commandError.pointer"]).toBe("Place the pointer on the Canvas before running this command.");
    expect(english.strings["canvas.coordinateConversion.apply"]).toBe("Apply (Enter)");
    expect(english.strings["output.place.candidateMenu"]).toBe("Overlapping place handles");
    expect(english.strings["output.place.dragReason.axes"]).toBe("Cannot drag: {axes} in at must be direct finite numeric literals.");
    expect(unsupported.strings["canvas.ariaLabel"]).toBe(english.strings["canvas.ariaLabel"]);
    expect(Object.keys(english.strings)).toEqual(Object.keys(webviewPresentationTranslationCatalog));
  });
});
