import { describe, expect, it } from "vitest";
import {
  formatDslReferencePath,
  formatDslReferenceToken,
  formatDslSourceReference,
  parseDslReferenceToken,
  parseDslSourceReference
} from "@nuinuicad/nui-language";

describe("DSL reference token formatting", () => {
  it.each([
    ["Missing", "Missing"],
    ["Outer::Inner", "Outer::Inner"],
    ["::前身頃::肩線", "::前身頃::肩線"],
    ["  Outer::Inner[0].start  ", "Outer::Inner[0].start"]
  ])("formats %s without flattening its reference structure", (input, expected) => {
    expect(formatDslReferenceToken(input)).toBe(expected);
  });

  it.each([
    "Missing name", '"Missing name"', 'Outer::"Inner name"',
    '"Outer name"::"Inner#name"', '"Outer.name"::"Inner::name"',
    '::"Outer name"::"Inner=name"', '"literal::name"', "@Missing"
  ])("rejects the invalid source token %s", (input) => {
    expect(() => formatDslReferenceToken(input)).toThrow(TypeError);
  });

  it("parses quoted qualified segments as semantic path parts", () => {
    expect(parseDslReferenceToken('::"Outer name"::"Inner#name"')).toEqual({
      absolute: true,
      segments: ["Outer name", "Inner#name"]
    });
  });

  it("formats structured paths segment by segment", () => {
    expect(formatDslReferencePath({ absolute: false, segments: ["外側", "内側"] })).toBe("外側::内側");
    expect(() => formatDslReferencePath({ absolute: false, segments: ["Outer name", "Inner#name"] }))
      .toThrow(TypeError);
  });
});

describe("strict source reference grammar", () => {
  it.each([
    ["A", { path: { absolute: false, segments: ["A"] }, property: null }],
    ["前身頃::肩線", { path: { absolute: false, segments: ["前身頃", "肩線"] }, property: null }],
    ["AB.start", { path: { absolute: false, segments: ["AB"] }, property: "start" }],
    ["写し::縫い線.end", { path: { absolute: false, segments: ["写し", "縫い線"] }, property: "end" }],
    ["::Outer::Inner.length", { path: { absolute: true, segments: ["Outer", "Inner"] }, property: "length" }]
  ])("parses %s with one shared path/property representation", (source, expected) => {
    const result = parseDslSourceReference(source);
    expect(result).toMatchObject({ kind: "valid", reference: expected });
    if (result.kind === "valid") {
      expect(source.slice(result.reference.fullRange.start, result.reference.fullRange.end)).toBe(source);
      expect(source.slice(result.reference.pathRange.start, result.reference.pathRange.end)).toBe(source.slice(0, source.lastIndexOf("." ) > 0 ? source.lastIndexOf(".") : source.length));
    }
  });

  it("retains exact relative full/path/property spans", () => {
    const source = "  AB.start  ";
    const result = parseDslSourceReference(source);
    expect(result).toMatchObject({
      kind: "valid",
      reference: {
        fullRange: { start: 2, end: 10 },
        pathRange: { start: 2, end: 4 },
        propertyRange: { start: 5, end: 10 }
      }
    });
  });

  it("retains occurrence index and property spans without treating brackets as path", () => {
    const source = '  Outer::Inner[ 2 + i ].start.x  ';
    const result = parseDslSourceReference(source);
    expect(result).toMatchObject({
      kind: "valid",
      reference: {
        occurrenceIndex: "2 + i",
        property: "start.x"
      }
    });
    if (result.kind !== "valid") return;
    const { reference } = result;
    expect(source.slice(reference.pathRange.start, reference.pathRange.end)).toBe('Outer::Inner');
    expect(source.slice(reference.occurrenceIndexRange!.start, reference.occurrenceIndexRange!.end)).toBe("2 + i");
    expect(source.slice(reference.occurrenceRange!.start, reference.occurrenceRange!.end)).toBe("[ 2 + i ]");
    expect(source.slice(reference.propertyRange!.start, reference.propertyRange!.end)).toBe("start.x");
    expect(source.slice(reference.fullRange.start, reference.fullRange.end)).toBe(' Outer::Inner[ 2 + i ].start.x'.trimStart());
    expect(formatDslSourceReference(reference)).toBe('Outer::Inner[2 + i].start.x');
  });

  it.each([
    ["A[]", "missing-index"],
    ["A[0", "unterminated-index"]
  ])("rejects malformed occurrence index %s", (source, code) => {
    expect(parseDslSourceReference(source)).toMatchObject({ kind: "invalid", code });
  });

  it.each([
    ["@A", "missing-sigil"],
    ["前身頃::@肩線", "malformed-path"],
    ["", "missing-path"],
    ["A.", "missing-property"],
    ["A::", "malformed-path"],
    ["A.foo trailing", "trailing-junk"],
    ['"unterminated', "malformed-path"]
  ])("rejects malformed source reference %s", (source, code) => {
    expect(parseDslSourceReference(source)).toMatchObject({ kind: "invalid", code });
  });

  it("formats a valid Unicode member path with its absolute qualifier", () => {
    const result = parseDslSourceReference("::外側::内側.end");
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(formatDslSourceReference(result.reference)).toBe("::外側::内側.end");
  });
});
