import { describe, expect, it } from "vitest";
import { defaultPrintSvgFileName, defaultPrintSvgPath } from "./printSvgExport";

describe("printSvgExport", () => {
  it("uses the pattern file name and print layout name for the default SVG file name", () => {
    expect(defaultPrintSvgFileName({
      layoutName: "袖のみ",
      documentPath: "/tmp/pattern.nui"
    })).toBe("pattern_袖のみ.svg");
  });

  it("uses the pattern file directory for the default SVG path", () => {
    expect(defaultPrintSvgPath({
      layoutName: "袖のみ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("/tmp/basic bodice_袖のみ.svg");
  });

  it("falls back to layout when the print layout name is blank", () => {
    expect(defaultPrintSvgFileName({
      layoutName: " ",
      documentPath: "/tmp/basic bodice.nui"
    })).toBe("basic bodice_layout.svg");
  });

  it("uses a generic default for unsaved documents and sanitizes invalid characters", () => {
    expect(defaultPrintSvgFileName({
      layoutName: "front/back:1",
      documentPath: null
    })).toBe("pattern_front_back_1.svg");
    expect(defaultPrintSvgFileName({
      layoutName: "",
      documentPath: null
    })).toBe("pattern_layout.svg");
  });
});
