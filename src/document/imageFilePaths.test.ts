import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { rebaseImageSourcePathsInText } from "./imageFilePaths";

describe("rebaseImageSourcePathsInText", () => {
  it("rewrites only the source value of a vertical (canonical) image statement", () => {
    const source = [
      "nui 3",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "image Img = image(",
      "  source: \"assets/photo.png\",",
      "  origin: A,",
      "  naturalWidthPx: 100,",
      "  naturalHeightPx: 100,",
      "  sourceDpi: 96,",
      "  targetPixelsPerMm: 3.78,",
      "  scale: 1,",
      "  angleDeg: 0,",
      "  mirrorX: false,",
      ")"
    ].join("\n");

    const rebased = rebaseImageSourcePathsInText(source, "/docs/a/pattern.nui", "/docs/b/pattern.nui");

    expect(rebased).toContain("source: \"../a/assets/photo.png\"");
    // Header line and every other argument line survive byte-identical.
    expect(rebased).toContain("image Img = image(\n");
    expect(rebased).toContain("origin: A");
    expect(rebased).toContain("naturalWidthPx: 100");
    expect(rebased).toContain("naturalHeightPx: 100");
    expect(rebased).toContain("sourceDpi: 96");
    expect(rebased).toContain("targetPixelsPerMm: 3.78");
    expect(rebased).toContain("scale: 1");
    expect(rebased).toContain("angleDeg: 0");
    expect(rebased).toContain("mirrorX: false");
    // No other line was disturbed by the rewrite.
    expect(rebased).toContain("point A = coordinate(\n  x: 0,\n  y: 0,\n)");
  });

  it("produces no diagnostics on reparse after rebasing a vertical image statement", () => {
    const source = [
      "nui 3",
      "image Img = image(",
      "  source: \"assets/photo.png\",",
      "  origin: (0, 0),",
      ")"
    ].join("\n");

    const rebased = rebaseImageSourcePathsInText(source, "/docs/a/pattern.nui", "/docs/b/pattern.nui");

    expect(parseDsl(rebased).diagnostics).toEqual([]);
  });

  it("still rewrites a compact single-line image statement", () => {
    const source = [
      "nui 3",
      "image Img = image(source: \"assets/photo.png\", origin: (0, 0))"
    ].join("\n");

    const rebased = rebaseImageSourcePathsInText(source, "/docs/a/pattern.nui", "/docs/b/pattern.nui");

    expect(rebased).toBe(
      ["nui 3", "image Img = image(source: \"../a/assets/photo.png\", origin: (0, 0))"].join("\n")
    );
    expect(parseDsl(rebased).diagnostics).toEqual([]);
  });

  it("leaves the text unchanged when the source and destination directories are the same", () => {
    const source = [
      "nui 3",
      "image Img = image(",
      "  source: \"assets/photo.png\",",
      "  origin: (0, 0),",
      ")"
    ].join("\n");

    const rebased = rebaseImageSourcePathsInText(source, "/docs/a/pattern.nui", "/docs/a/other.nui");

    expect(rebased).toBe(source);
  });

  it("rewrites multiple image statements independently, each at its own physical position", () => {
    const source = [
      "nui 3",
      "image First = image(",
      "  source: \"assets/first.png\",",
      "  origin: (0, 0),",
      ")",
      "image Second = image(",
      "  source: \"assets/second.png\",",
      "  origin: (10, 10),",
      ")"
    ].join("\n");

    const rebased = rebaseImageSourcePathsInText(source, "/docs/a/pattern.nui", "/docs/b/pattern.nui");

    expect(rebased).toContain("source: \"../a/assets/first.png\"");
    expect(rebased).toContain("source: \"../a/assets/second.png\"");
    expect(parseDsl(rebased).diagnostics).toEqual([]);
  });
});
