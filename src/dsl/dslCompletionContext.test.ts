import { describe, expect, it } from "vitest";
import { dslCompletionContextAt } from "./dslCompletionContext";

const at = (line: string, token: string) => line.indexOf(token) + token.length;

describe("dslCompletionContextAt", () => {
  it("uses parser-owned statement keywords only at a line head", () => {
    const context = dslCompletionContextAt("  poi", 5);
    expect(context).toMatchObject({ kind: "keyword", from: 2, to: 5 });
    expect(context?.kind === "keyword" && context.options).toContain("point");
    expect(dslCompletionContextAt("# point", 7)).toBeNull();
    expect(dslCompletionContextAt("line L = A ->", 13)).toBeNull();
  });

  it("resolves reference, choice, and attribute contexts through live line reparsing", () => {
    const line = "line L = A -> B";
    expect(dslCompletionContextAt(line, at(line, "A"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "reference" } }
    });

    const choice = "line Seam = offset [AB] distance=4 side=left";
    expect(dslCompletionContextAt(choice, at(choice, "left"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "choice" } }
    });

    const attribute = "arc C center=A radius=10 start=0 end=90 vis";
    expect(dslCompletionContextAt(attribute, at(attribute, "vis"))).toMatchObject({ kind: "attribute", elementType: "arcLine" });
  });

  it("keeps group-opening attributes eligible through the shared synthetic-close reparse", () => {
    const line = "group Draft printEnabled=true {";
    expect(dslCompletionContextAt(line, line.indexOf("true") + 2)).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "boolean" } }
    });
  });
});
