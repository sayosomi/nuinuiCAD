import { describe, expect, it } from "vitest";
import {
  formatDslReferencePath,
  formatDslReferenceToken,
  parseDslReferenceToken
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
