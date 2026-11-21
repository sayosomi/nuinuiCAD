import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslDefinition } from "@nuinuicad/nui-language";

const source = `nui 1
group face {
  line original = segment(start: (0,0), end: (80,0))
  extract Extract(source: @original, parts: [side_line: start..end])
}
line Use = segment(start: @face::Extract::side_line.start, end: (100,0))
line UseEnd = segment(start: @face::Extract::side_line.end, end: (120,0))
const Length: number = @face::Extract::side_line.length
`;

const contextFor = (input: string) => {
  const result = compileFreshCanonicalText(input);
  const compiled = result.currentCompiled;
  return {
    source: { normalizedSource: input, sourceRevision: compiled.spans.sourceMap.sourceRevision },
    semantic: { sourceRevision: compiled.spans.sourceMap.sourceRevision, compiled }
  };
};
const context = () => contextFor(source);

const reference = "@face::Extract::side_line.start";
const referenceStart = source.indexOf(reference);
const declarationStart = source.indexOf("side_line:");
const declarationRange = { from: declarationStart, to: declarationStart + "side_line".length };

describe("qualified geometry definition navigation", () => {
  it.each([
    ["face", reference.indexOf("face")],
    ["Extract", reference.indexOf("Extract")],
    ["side_line", reference.indexOf("side_line")],
    ["start", reference.indexOf("start")]
  ])("maps the %s cursor to the final geometry declaration range", (_segment, offset) => {
    const result = queryDslDefinition({ ...context(), position: referenceStart + offset + 1 });
    expect(result?.declarationRange).toEqual(declarationRange);
  });

  it.each([
    ["start", reference],
    ["end", "@face::Extract::side_line.end"],
    ["length", "@face::Extract::side_line.length"]
  ])("maps the %s property cursor to the final geometry declaration range", (property, referenceText) => {
    const start = source.indexOf(referenceText);
    const offset = referenceText.lastIndexOf(property);
    const result = queryDslDefinition({ ...context(), position: start + offset + 1 });
    expect(result?.referenceRange).toEqual({
      from: start + offset,
      to: start + offset + property.length
    });
    expect(result?.declarationRange).toEqual(declarationRange);
  });

  it("keeps same-named geometry identities isolated across extracts and nested groups", () => {
    const input = `nui 1
group face {
  line original = segment(start: (0,0), end: (80,0))
  extract Extract(source: @original, parts: [side_line: start..end])
  group Inner {
    line side_line = segment(start: (0,10), end: (80,10))
  }
}
group back {
  line original = segment(start: (0,20), end: (80,20))
  extract Extract(source: @original, parts: [side_line: start..end])
}
line UseExtract = segment(start: @face::Extract::side_line.start, end: (100,0))
line UseNested = segment(start: @face::Inner::side_line.start, end: (100,10))
line UseBack = segment(start: @back::Extract::side_line.start, end: (100,20))
`;
    const c = contextFor(input);
    const declarations = [...input.matchAll(/side_line(?=:|\s*=)/g)].map(match => ({
      from: match.index!,
      to: match.index! + "side_line".length
    }));
    const references = [
      { text: "@face::Extract::side_line.start", declaration: declarations[0]! },
      { text: "@face::Inner::side_line.start", declaration: declarations[1]! },
      { text: "@back::Extract::side_line.start", declaration: declarations[2]! }
    ];

    for (const reference of references) {
      const start = input.indexOf(reference.text);
      const result = queryDslDefinition({ ...c, position: start + 1 });
      expect(result?.declarationRange).toEqual(reference.declaration);
      const member = reference.text.indexOf("side_line");
      const memberResult = queryDslDefinition({ ...c, position: start + member + 1 });
      expect(memberResult?.declarationRange).toEqual(reference.declaration);
    }

    const nestedReference = references[1]!;
    const nestedStart = input.indexOf(nestedReference.text);
    const nestedProperty = queryDslDefinition({
      ...c,
      position: nestedStart + nestedReference.text.lastIndexOf("start") + 1
    });
    expect(nestedProperty?.declarationRange).toEqual(nestedReference.declaration);
  });

  it("returns no ancestor definition for unresolved, ambiguous, or incomplete qualified paths", () => {
    const unresolved = `nui 1
group face {
  line original = segment(start: (0,0), end: (80,0))
}
line Use = segment(start: @face::Missing::side_line.start, end: (100,0))
line UseBare = segment(start: @face::Missing::side_line, end: (100,10))
`;
    const unresolvedContext = contextFor(unresolved);
    const unresolvedStart = unresolved.indexOf("@face::Missing");
    expect(queryDslDefinition({ ...unresolvedContext, position: unresolvedStart + 2 })).toBeNull();
    const unresolvedBareStart = unresolved.indexOf("@face::Missing::side_line", unresolvedStart + 1);
    expect(queryDslDefinition({ ...unresolvedContext, position: unresolvedBareStart + 2 })).toBeNull();

    const ambiguous = `nui 1
group One {
  line Same = segment(start: (0,0), end: (80,0))
}
group Two {
  line Same = segment(start: (0,10), end: (80,10))
}
point Use = offset(from: @Same.start, dx: 1, dy: 0)
`;
    const ambiguousContext = contextFor(ambiguous);
    expect(queryDslDefinition({
      ...ambiguousContext,
      position: ambiguous.indexOf("@Same") + 2
    })).toBeNull();

    const incomplete = `nui 1
group face {
  line original = segment(start: (0,0), end: (80,0))
}
line Use = segment(start: @face::, end: (100,0))
`;
    const incompleteContext = contextFor(incomplete);
    expect(queryDslDefinition({
      ...incompleteContext,
      position: incomplete.indexOf("@face") + 2
    })).toBeNull();
  });

  it("rejects stale semantic snapshots before choosing any qualified target", () => {
    const c = context();
    const changedSource = source.replace("side_line", "other_line");
    const result = queryDslDefinition({
      source: {
        normalizedSource: changedSource,
        sourceRevision: c.source.sourceRevision + 1
      },
      position: changedSource.indexOf("@face") + 2,
      semantic: c.semantic
    });
    expect(result).toBeNull();
  });
});
