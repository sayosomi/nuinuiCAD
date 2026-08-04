import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { emptyDocument } from "./dslDocumentTestUtils";
import { regenerateCanonicalFromModel } from "../document/canonicalDocument";

describe("nui 3-only DSL", () => {
  it("does not recognize the removed var surface syntax", () => {
    const parsed = parseDsl("nui 3\nvar width = 10");
    expect(parsed.statements.some((statement) => (statement as { kind: string }).kind === "variable")).toBe(false);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("creates canonical documents with nui 3 and activity state", () => {
    const canonical = regenerateCanonicalFromModel(emptyDocument(), 3);
    expect(canonical.sourceText.startsWith("nui 3\n")).toBe(true);
    const compiled = compileDslDocument("nui 3\npoint A = coordinate(x: 0, y: 0, state: hidden)");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements[0]).toMatchObject({ activity: "hidden" });
  });
});
