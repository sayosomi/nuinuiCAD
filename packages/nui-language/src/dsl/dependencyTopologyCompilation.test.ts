import { afterEach, describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { createCadElement } from "@nuinuicad/nui-language";
import * as names from "../model/elementNames";
// Keep package tests host neutral; the source-backed campaign checks this copy
// against the sealed .nui bytes and SHA before evaluating R3.
import fixture from "../../../../test/fixtures/issue-1474/continuation-2/R3-source.json";
import canonicalSources from "../../../../test/fixtures/canonical-regression-sources.json";
import seal from "../../../../test/fixtures/issue-1474/continuation-2/R3-seal.json";

afterEach(() => vi.restoreAllMocks());

describe("source-owned names in topology compilation", () => {
  it("does not generate discarded automatic names for authored declarations", () => {
    expect(fixture.sourceSha256).toBe(seal.sourceSha256);
    const canonical = (canonicalSources as Readonly<Record<string, { source: string } | undefined>>)[fixture.sourceSha256];
    if (!canonical) throw new Error("missing canonical spelling of the R3 regression");
    const source = canonical.source;
    expect(source).toBe(fixture.source.replaceAll("@Producer", "Producer").replaceAll("@Root", "Root"));
    const automatic = vi.spyOn(names, "withCreatedElementName");
    const compiled = compileFreshCanonicalText(source);
    expect(compiled.status).not.toBe("fatal");
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.doc.document.elements.map(e => e.name).sort()).toEqual([...seal.expectedAuthoredGeometryNames].sort());
    const discarded = automatic.mock.calls.filter(([, elements]) => elements.length > 0).length;
    expect(discarded).toBe(seal.expectedDiscardedAutoNameCalls);
  });

  it("keeps ordinary interactive automatic naming available", () => {
    const automatic = vi.spyOn(names, "withCreatedElementName");
    const first = createCadElement("freePoint", []);
    const second = createCadElement("freePoint", [first]);
    expect(first.name).not.toBe("");
    expect(second.name).not.toBe(first.name);
    expect(automatic).toHaveBeenCalledTimes(2);
  });
});
