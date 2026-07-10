import { describe, expect, it } from "vitest";
import { defaultPrintPdfFileName, defaultPrintPdfPath } from "./printPdfExport";

describe("printPdfExport", () => {
  it("uses the pattern file name and print layout name for the default PDF file name", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "袖のみ",
      documentPath: "/tmp/pattern.nui"
    })).toBe("pattern_袖のみ.pdf");
  });

  it("uses the pattern file directory for the default PDF path", () => {
    expect(defaultPrintPdfPath({
      layoutName: "袖のみ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("/tmp/basic bodice_袖のみ.pdf");
  });

  it("falls back to layout when the print layout name is blank", () => {
    expect(defaultPrintPdfFileName({
      layoutName: " ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("basic bodice_layout.pdf");
  });

  it("uses a generic default for unsaved documents and sanitizes invalid characters", () => {
    expect(defaultPrintPdfFileName({
      layoutName: "front/back:1",
      documentPath: null
    })).toBe("pattern_front_back_1.pdf");
    expect(defaultPrintPdfFileName({
      layoutName: "",
      documentPath: null
    })).toBe("pattern_layout.pdf");
  });
});
