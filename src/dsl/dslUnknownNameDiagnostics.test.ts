import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import type { DslDiagnostic } from "./dslTypes";

const exactText = (source: string, diagnostic: DslDiagnostic): string => {
  expect(diagnostic.exactSpanOnly).toBe(true);
  expect(diagnostic.physicalSpan?.segments).toHaveLength(1);
  const segment = diagnostic.physicalSpan!.segments[0]!;
  return source.slice(segment.from, segment.to);
};

const parsedDiagnostic = (source: string, code: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 17 });
  const diagnostic = parsed.diagnostics.find((item) => item.code === code);
  expect(diagnostic, `missing ${code}`).toBeDefined();
  return diagnostic!;
};

describe("stable unknown-name diagnostics", () => {
  it("marks an unknown DSL keyword with a stable code and exact token span", () => {
    const source = "nui 4\npont P = coordinate(x: 0, y: 0)";
    const diagnostic = parsedDiagnostic(source, "unknown-dsl-keyword");
    expect(exactText(source, diagnostic)).toBe("pont");
  });

  it("marks an unknown declaration type with a stable code and exact token span", () => {
    const source = "nui 4\nlet x: numbr = 10";
    const diagnostic = parsedDiagnostic(source, "unknown-type");
    expect(exactText(source, diagnostic)).toBe("numbr");
  });

  it("marks an unknown Module parameter type with the same stable code", () => {
    const source = "nui 4\nmodule M(value: numbr) {\n}";
    const diagnostic = parsedDiagnostic(source, "unknown-type");
    expect(exactText(source, diagnostic)).toBe("numbr");
  });

  it("marks an unknown construction with a stable code and exact construction span", () => {
    const source = "nui 4\nline L = segmnt(start: @A, end: @B)";
    const diagnostic = parsedDiagnostic(source, "unknown-construction");
    expect(exactText(source, diagnostic)).toBe("segmnt");
  });

  it("marks a known construction in the wrong category with a separate exact diagnostic", () => {
    const source = "nui 4\npoint P = segment(start: @A, end: @B)";
    const diagnostic = parsedDiagnostic(source, "construction-category-mismatch");
    expect(exactText(source, diagnostic)).toBe("segment");
  });

  it("marks an unknown construction argument with a stable code and exact key span", () => {
    const source = "nui 4\npoint P = coordinate(xx: 0, y: 0)";
    const diagnostic = parsedDiagnostic(source, "unknown-construction-argument");
    expect(exactText(source, diagnostic)).toBe("xx");
  });

  it("marks undefined geometry without reclassifying a forward reference", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "line L = segment(start: @A, end: @Missng)",
      "line F = segment(start: @A, end: @Later)",
      "point Later = coordinate(x: 10, y: 10)"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 23 });
    const undefinedDiagnostic = compiled.diagnostics.find((item) => item.code === "undefined-geometry-reference");
    expect(undefinedDiagnostic).toBeDefined();
    expect(undefinedDiagnostic!.severity).toBe("warning");
    expect(exactText(source, undefinedDiagnostic!)).toBe("Missng");
    expect(compiled.diagnostics.some((item) => item.code === "undefined-geometry-reference" && item.message.includes("Later"))).toBe(false);
    expect(compiled.diagnostics.some((item) => item.message.includes("この位置より後"))).toBe(true);
  });
});
