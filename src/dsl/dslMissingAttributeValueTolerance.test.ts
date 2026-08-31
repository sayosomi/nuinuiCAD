import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { compileDslDocument } from "./dslDocument";

/**
 * missing-attribute-value ("well-formed but currently-empty named value" -
 * see dslArgScanner.ts) is deliberately excluded from every fatal
 * severity==="error" gate on the document-compile path (dslDocument.ts's two
 * gates, dslCompiler.ts's compileDslToElements gate, &&
 * canonicalDocument.ts's compileZippedModelText gate) so that a command-line
 * creation draft - || any hand-typed blank `key:` - degrades to an ordinary
 * element-level diagnostic instead of discarding the whole document back to
 * its last-good state. This file locks in that contract directly against
 * the two lowest-level entry points; every other severity==="error"
 * diagnostic must still be fully fatal.
 */
describe("missing-attribute-value tolerance", () => {
  it("compileDslDocument still compiles a document with one blank argument, alongside an unrelated valid statement", () => {
    const text = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line = segment(",
      "  start: @A,",
      "  end: ",
      ")"
    ].join("\n");
    const compiled = compileDslDocument(text, { sourceRevision: 1 });

    expect(compiled.document).toBeTruthy();
    expect(compiled.statementMap).toBeTruthy();
    expect(compiled.document!.elements.map((element) => element.type)).toEqual(["freePoint", "line"]);
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing-attribute-value", severity: "error" })])
    );
    expect(compiled.diagnostics.filter((item) => item.code !== "missing-attribute-value")).not.toContainEqual(
      expect.objectContaining({ severity: "error" })
    );
  });

  it("compileDslToElements still builds every other element when one statement has a blank argument", () => {
    const text = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line = segment(",
      "  start: @A,",
      "  end: ",
      ")",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n");
    const result = compileDslToElements(text, { elements: [], mode: "document" });

    expect(result.elements.map((element) => element.type)).toEqual(["freePoint", "line", "freePoint"]);
  });

  it("an actual syntax error remains fully fatal", () => {
    const text = [
      "nui 1",
      "line = segment(",
      "  start: @A",
      "  end: @B", // missing comma - a real nui 1 syntax error, not missing-attribute-value
      ")"
    ].join("\n");
    const compiled = compileDslDocument(text, { sourceRevision: 1 });

    expect(compiled.document).toBeNull();
    expect(compiled.statementMap).toBeNull();
  });

  it("a missing required argument alongside a genuine syntax error elsewhere stays fatal", () => {
    const text = [
      "nui 1",
      "line = segment(",
      "  start: ,",
      "  end: @A",
      "  mirrorX: false",
      ")",
      "point B = coordinate(x: 0, y: 0)" // missing comma
    ].join("\n");
    const compiled = compileDslDocument(text, { sourceRevision: 1 });

    expect(compiled.document).toBeNull();
  });
});
