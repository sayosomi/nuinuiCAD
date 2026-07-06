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
});
