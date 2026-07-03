import { describe, expect, it } from "vitest";
import { defaultPrintPdfFileName } from "./printPdfExport";

describe("printPdfExport", () => {
  it("uses the print layout name for the default PDF file name", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "袖のみ",
      documentPath: "/tmp/pattern.nuinui.json"
    })).toBe("袖のみ.pdf");
  });

  it("falls back to the pattern file name when the print layout name is blank", () => {
    expect(defaultPrintPdfFileName({
      layoutName: " ",
      documentPath: "/tmp/basic bodice.nuinui.json"
    })).toBe("basic bodice.pdf");
  });

  it("uses a generic default for unsaved documents and sanitizes invalid characters", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "front/back:1",
      documentPath: null
    })).toBe("front_back_1.pdf");
    expect(defaultPrintPdfFileName({
      layoutName: "",
      documentPath: null
    })).toBe("pattern-print.pdf");
  });
});
