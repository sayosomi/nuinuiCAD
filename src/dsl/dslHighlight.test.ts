import { describe, expect, it } from "vitest";
import { highlightDslLine, highlightDslSource } from "./dslHighlight";

const tokenKinds = (line: string) => highlightDslLine(line).map((token) => token.kind);

describe("DSL highlighting", () => {
  it("classifies common DSL tokens", () => {
    const tokens = highlightDslLine("line seam = offset(distance: 10) # seam allowance");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: "keyword", text: "line" },
        { kind: "elementType", text: "offset" },
        { kind: "attributeKey", text: "distance" },
        { kind: "number", text: "10" },
        { kind: "comment", text: "# seam allowance" }
      ])
    );
  });

  it("classifies strings and references", () => {
    expect(tokenKinds("text Label = label(text: \"前中心\", anchor: A.start, size: 4)")).toEqual(
      expect.arrayContaining(["keyword", "string", "attributeKey", "reference", "number"])
    );
  });

  it("does not throw for incomplete strings or malformed input", () => {
    expect(() => highlightDslSource("text label = \"unterminated\npoint A = (0,")).not.toThrow();
    expect(highlightDslSource("text label = \"unterminated")).toHaveLength(1);
  });

  it("classifies block braces and new document keywords", () => {
    expect(tokenKinds("group G {")).toEqual(["keyword", "plain", "reference", "plain", "operator"]);
    expect(tokenKinds("}")).toEqual(["operator"]);
    expect(tokenKinds("} else {")).toEqual(["operator", "plain", "keyword", "plain", "operator"]);
    expect(tokenKinds("if (1) {")).toEqual(expect.arrayContaining(["keyword", "number", "operator"]));
    expect(tokenKinds("for i in range(from: 0, count: 3) {")).toEqual(
      expect.arrayContaining(["keyword", "reference", "attributeKey", "number", "operator"])
    );
  });

  it("classifies power and remainder as operators", () => {
    expect(highlightDslLine("const value: number = 2 ^ 3 % 2")).toEqual(
      expect.arrayContaining([
        { kind: "operator", text: "^" },
        { kind: "operator", text: "%" }
      ])
    );
  });

  it("classifies stop as a keyword, not a reference", () => {
    expect(tokenKinds("stop")).toEqual(["keyword"]);
  });

  it("classifies the nui 4 sigil form @Element.property as one reference token (Task 51)", () => {
    expect(highlightDslLine("point P = coordinate(x: @AB.length,y: 0)")).toEqual(
      expect.arrayContaining([{ kind: "reference", text: "@AB.length" }])
    );
    // A plain @name binding still highlights as its own reference token,
    // unaffected by the new dotted alternative.
    expect(highlightDslLine("point P = coordinate(x: @length,y: 0)")).toEqual(
      expect.arrayContaining([{ kind: "reference", text: "@length" }])
    );
  });

  it("classifies nui, color, place, activePrintLayout, default", () => {
    expect(tokenKinds("nui 2")[0]).toBe("keyword");
    expect(tokenKinds('color pattern-black ("#31322f", name: "基本線",default: true)')).toEqual(
      expect.arrayContaining(["keyword", "string", "attributeKey"])
    );
    expect(tokenKinds("place @G(at: (0, 0))")[0]).toBe("keyword");
    expect(tokenKinds("activePrintLayout A4")[0]).toBe("keyword");
  });

  it("classifies v2 roles rather than globally coloring construction/category spellings", () => {
    expect(highlightDslLine("point P = offset(")).toEqual(
      expect.arrayContaining([
        { kind: "keyword", text: "point" },
        { kind: "elementType", text: "offset" }
      ])
    );
    expect(highlightDslLine("  line: seam")).toEqual(
      expect.arrayContaining([
        { kind: "attributeKey", text: "line" },
        { kind: "reference", text: "seam" }
      ])
    );
  });
});
