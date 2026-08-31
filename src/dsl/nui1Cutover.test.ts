import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { emptyDocument } from "./dslDocumentTestUtils";
import { regenerateCanonicalFromModel } from "../document/canonicalDocument";

describe("nui 1 cutover", () => {
  it("does not recognize the removed var surface syntax", () => {
    const parsed = parseDsl("nui 1\nvar width = 10");
    expect(parsed.statements.some((statement) => (statement as { kind: string }).kind === "variable")).toBe(false);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("creates canonical documents with nui 1 and activity state", () => {
    const canonical = regenerateCanonicalFromModel(emptyDocument(), 1);
    expect(canonical.sourceText.startsWith("nui 1\n")).toBe(true);
    expect(canonical.doc.majorVersion).toBe(1);
    expect(canonical.sourceText).not.toContain("nui 4");
    const compiled = compileDslDocument("nui 1\npoint A = coordinate(x: 0, y: 0, state: hidden)");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements[0]).toMatchObject({ activity: "hidden" });
  });
});
