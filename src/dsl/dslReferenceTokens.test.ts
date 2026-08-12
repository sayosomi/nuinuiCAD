import { describe, expect, it } from "vitest";
import {
  formatDslReferencePath,
  formatDslReferenceToken,
  formatDslSourceReference,
  parseDslReferenceToken,
  parseDslSourceReference
} from "./dslReferenceTokens";

describe("DSL reference token formatting", () => {
  it.each([
    ["Missing", "Missing"],
    ["Missing name", '"Missing name"'],
    ['"Missing name"', '"Missing name"'],
    ["Outer::Inner", "Outer::Inner"],
    ['Outer::"Inner name"', 'Outer::"Inner name"'],
    ['"Outer name"::"Inner#name"', '"Outer name"::"Inner#name"'],
    ['"Outer.name"::"Inner::name"', '"Outer.name"::"Inner::name"'],
    ['::"Outer name"::"Inner=name"', '::"Outer name"::"Inner=name"'],
    ['"literal::name"', '"literal::name"']
  ])("formats %s without flattening its reference structure", (input, expected) => {
    expect(formatDslReferenceToken(input)).toBe(expected);
  });

  it("parses quoted qualified segments as semantic path parts", () => {
    expect(parseDslReferenceToken('::"Outer name"::"Inner#name"')).toEqual({
      absolute: true,
      segments: ["Outer name", "Inner#name"]
    });
  });

  it("formats structured paths segment by segment", () => {
    expect(formatDslReferencePath({ absolute: false, segments: ["Outer name", "Inner#name"] }))
      .toBe('"Outer name"::"Inner#name"');
  });
});

describe("strict source reference grammar", () => {
  it.each([
    ["@A", { path: { absolute: false, segments: ["A"] }, property: null }],
    ["@前身頃::肩線", { path: { absolute: false, segments: ["前身頃", "肩線"] }, property: null }],
    ["@AB.start", { path: { absolute: false, segments: ["AB"] }, property: "start" }],
    ["@写し::縫い線.end", { path: { absolute: false, segments: ["写し", "縫い線"] }, property: "end" }],
    ['@"Outer name"::"Inner#name".length', { path: { absolute: false, segments: ["Outer name", "Inner#name"] }, property: "length" }]
  ])("parses %s with one shared path/property representation", (source, expected) => {
    const result = parseDslSourceReference(source);
    expect(result).toMatchObject({ kind: "valid", reference: expected });
    if (result.kind === "valid") {
      expect(source.slice(result.reference.fullRange.start, result.reference.fullRange.end)).toBe(source);
      expect(source.slice(result.reference.pathRange.start, result.reference.pathRange.end)).toBe(source.slice(1, source.lastIndexOf("." ) > 0 ? source.lastIndexOf(".") : source.length));
    }
  });

  it("retains exact relative full/path/property spans", () => {
    const source = "  @AB.start  ";
    const result = parseDslSourceReference(source);
    expect(result).toMatchObject({
      kind: "valid",
      reference: {
        fullRange: { start: 2, end: 11 },
        pathRange: { start: 3, end: 5 },
        propertyRange: { start: 6, end: 11 }
      }
    });
  });

  it.each([
    ["A", "missing-sigil"],
    ["前身頃::肩線", "missing-sigil"],
    ["@", "missing-path"],
    ["@A.", "missing-property"],
    ["@A::", "malformed-path"],
    ["@A.foo trailing", "trailing-junk"],
    ['@"unterminated', "malformed-path"]
  ])("rejects malformed source reference %s", (source, code) => {
    expect(parseDslSourceReference(source)).toMatchObject({ kind: "invalid", code });
  });

  it("formats the source marker only at the source boundary", () => {
    const result = parseDslSourceReference("@Outer::\"Inner name\".end");
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(formatDslSourceReference(result.reference)).toBe("@Outer::\"Inner name\".end");
  });
});
