import { describe, expect, it } from "vitest";
import {
  defaultOutputExportFileName,
  defaultOutputExportPath,
  ensureOutputExportExtension
} from "./printExportFileName";

describe("output export file names", () => {
  it("uses the document and selected output names", () => {
    expect(defaultOutputExportFileName({
      outputName: "家庭用A4",
      documentPath: "/tmp/bodice.nui",
      extension: "pdf"
    })).toBe("bodice_家庭用A4.pdf");
  });

  it("uses the document directory and sanitizes output names", () => {
    expect(defaultOutputExportPath({
      outputName: "front/back:1",
      documentPath: "/tmp/basic bodice.nui",
      extension: "svg"
    })).toBe("/tmp/basic bodice_front_back_1.svg");
  });

  it("uses stable fallbacks and appends only a missing extension", () => {
    expect(defaultOutputExportFileName({ outputName: " ", documentPath: null, extension: "svg" }))
      .toBe("pattern_output.svg");
    expect(ensureOutputExportExtension("/tmp/pattern", "pdf")).toBe("/tmp/pattern.pdf");
    expect(ensureOutputExportExtension("/tmp/PATTERN.PDF", "pdf")).toBe("/tmp/PATTERN.PDF");
  });
});
