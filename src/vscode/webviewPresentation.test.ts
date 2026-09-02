import { describe, expect, it } from "vitest";
import {
  webviewDiagnosticTextFor,
  webviewInputDiagnosticTextFor,
  webviewPresentationTextFor
} from "./webviewPresentation";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";

describe("Webview presentation boundary", () => {
  const presentation = {
    locale: "ja" as const,
    strings: {
      "modulePreview.parameters.valueFor": "{name}の値",
      "modulePreview.parameters.diagnostic.required-value-missing": "パラメータ「{name}」には値が必要です。"
    },
    diagnosticTemplates: {
      "diagnostic.undefined-binding": "未定義の変数「{referencedName}」を参照しています。"
    }
  };

  it("interpolates only primitive parameters in resolved templates", () => {
    expect(webviewPresentationTextFor(
      presentation,
      "modulePreview.parameters.valueFor",
      "Value for {name}",
      { name: "Bust" }
    )).toBe("Bustの値");
    expect(webviewDiagnosticTextFor(presentation, {
      message: "raw fallback",
      presentation: { key: "diagnostic.undefined-binding", parameters: { referencedName: "missing" } }
    })).toBe("未定義の変数「missing」を参照しています。");
    expect(webviewDiagnosticTextFor(presentation, {
      message: "legacy fallback"
    })).toBe("legacy fallback");
    expect(webviewDiagnosticTextFor(presentation, {
      message: "unsupported fallback",
      presentation: { key: "diagnostic.not-supported", parameters: { name: "x" } }
    })).toBe("unsupported fallback");
    expect(webviewInputDiagnosticTextFor(presentation, {
      message: "input fallback",
      presentation: {
        key: "modulePreview.parameters.diagnostic.required-value-missing",
        parameters: { name: "Bust" }
      }
    })).toBe("パラメータ「Bust」には値が必要です。");
  });

  it("projects localized Canvas labels without exposing locale state", () => {
    const canvas = webviewCanvasPresentationFor(presentation);
    expect(canvas.text("canvas.ariaLabel", "fallback")).toBe("fallback");
    expect(canvas.numericReferenceLabels?.length).toBe("長さ");
    expect(canvas.statusFields).toEqual({ zoom: "ZOOM", x: "X", y: "Y" });
    expect(canvas.axisLock?.horizontal).toBe("Horizontal");
  });
});
