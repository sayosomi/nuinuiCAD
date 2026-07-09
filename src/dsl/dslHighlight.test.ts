import { describe, expect, it } from "vitest";
import { highlightDslLine, highlightDslSource } from "./dslHighlight";

const tokenKinds = (line: string) => highlightDslLine(line).map((token) => token.kind);

describe("DSL highlighting", () => {
  it("classifies common DSL tokens", () => {
    const tokens = highlightDslLine("element seam type=offsetLine offset=10 # seam allowance");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: "keyword", text: "element" },
        { kind: "attributeKey", text: "type" },
        { kind: "elementType", text: "offsetLine" },
        { kind: "attributeKey", text: "offset" },
        { kind: "number", text: "10" },
        { kind: "comment", text: "# seam allowance" }
      ])
    );
  });

  it("classifies strings and references", () => {
    expect(tokenKinds("text label = \"前中心\" at=A.start size=4")).toEqual(
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
    expect(tokenKinds("if B condition=1 {")).toEqual(
      expect.arrayContaining(["keyword", "reference", "attributeKey", "number", "operator"])
    );
    expect(tokenKinds("for i start=0 count=3 {")).toEqual(
      expect.arrayContaining(["keyword", "attributeKey", "attributeKey"])
    );
  });

  it("classifies @stop as a keyword, not a reference", () => {
    expect(tokenKinds("@stop")).toEqual(["keyword"]);
  });

  it("classifies nui, color, place, layoutVar, activePrintLayout, default", () => {
    expect(tokenKinds("nui 1")[0]).toBe("keyword");
    expect(tokenKinds("color main \"#ff0000\" default")).toEqual(
      expect.arrayContaining(["keyword", "string", "keyword"])
    );
    expect(tokenKinds("place G at=(0,0)")[0]).toBe("keyword");
    expect(tokenKinds("layoutVar margin = 20")[0]).toBe("keyword");
    expect(tokenKinds("activePrintLayout A4")[0]).toBe("keyword");
  });
});
