import { describe, expect, it } from "vitest";
import {
  compileDslDocument, createNuiLanguageSession, dslCompletionInsertionTextFor,
  parseDslSnapshot, queryDslCompletion
} from "@nuinuicad/nui-language";

const compile = (source: string, sourceRevision = 1) => {
  const preparsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed, assignedStatementIds: new Map(preparsed.statements.map((_, i) => [i, `layer-completion:${i}`]))
  });
};
const query = (marked: string) => {
  const position = marked.indexOf("|");
  const source = marked.replace("|", "");
  const compiled = compile(source);
  const result = queryDslCompletion({ source: { normalizedSource: source, sourceRevision: 1 }, position,
    semantic: { sourceRevision: 1, compiled } });
  return { source, compiled, result };
};
const names = (marked: string) => query(marked).result?.candidates.map(c => c.label);
const layers = "nui 1\nlayer outline\nlayer seam\nlayer guide\n";
const line = "line L in @| = segment(start: (0, 0), end: (10, 0))";

describe("lexical Layer reference completion (#1581)", () => {
  it("offers the independent oracle and resolves the selected drawable to seam", () => {
    const { source, result } = query(layers + line);
    expect(result?.category).toBe("layerReference");
    expect(result?.candidates.map(c => c.label)).toEqual(["default", "outline", "seam", "guide"]);
    const candidate = result!.candidates.find(c => c.label === "seam")!;
    const range = result!.replacementRange;
    const inserted = source.slice(0, range.from) + dslCompletionInsertionTextFor(candidate, result!.category, range, source) + source.slice(range.to);
    expect(inserted).toBe(layers + line.replace("@|", "@seam"));
    const fixed = compile(inserted);
    expect(fixed.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect([...fixed.sourceLexicalNamespace!.layerMembershipsByStatementIndex.values()]).toEqual([
      expect.objectContaining({ layerIdentity: candidate.identity, layerName: "seam", explicit: true })
    ]);
  });

  it.each([
    line, line.replace("L in", "L [Ink] in"),
    "extract E in @|(source: @Base, parts: [p: start..end])",
    "extract E(source: @Base, parts: [p in @|: start..end])",
    "extract E(source: @Base, parts: [p: start..end, q [Ink] in @|: start..end])",
    "print P(layout: @Layout, layers: [@|], paper: a4, overlap: 10)",
    "svg S(layout: @Layout, layers: [@outline, @|], margin: 0)",
    "svg S(\n layout: @Layout,\n layers: [\n @outline,\n @|\n ],\n margin: 0,\n)",
    "extract E(\n source: @Base,\n parts: [\n p [Ink] in @|: start..end,\n ],\n)",
    "line L in @|", "svg S(layers: [@|", "print P(layers: [@outline, @|",
    "extract E in @|", "extract E(source: @Base, parts: [p in @|"
  ])("classifies complete and unfinished sites: %s", site => {
    const { source, result } = query(layers + site);
    expect(result?.candidates.map(c => c.label)).toEqual(["default", "outline", "seam", "guide"]);
    const cursor = (layers + site).indexOf("|");
    expect(result?.replacementRange).toEqual({ from: cursor, to: cursor });
    expect(source[cursor - 1]).toBe("@");
  });

  it.each([
    line,
    "line L [Ink] in @| = segment(start: (0, 0), end: (10, 0))",
    "line L in @| = segment(\n start: (0, 0),\n end: (10, 0),\n)",
    "extract E in @|(source: @Base, parts: [p: start..end])",
    "extract E(source: @Base, parts: [p in @|: start..end])",
    "extract E(\n source: @Base,\n parts: [\n p [Ink] in @|: start..end,\n ],\n)",
    "print P(layout: @Layout, layers: [@outline, @|], paper: a4, overlap: 10)",
    "svg S(\n layout: @Layout,\n layers: [@|],\n margin: 0,\n)"
  ])("produces a compilable resolved reference at each complete site: %s", site => {
    const setup = layers + "style Ink {\n width: 1px,\n}\nline Base = segment(start: (0, 0), end: (20, 0))\ngroup Shape {\n line Placed = segment(start: (0, 0), end: (10, 0))\n}\nlayout Layout {\n place @Shape(at: (0, 0))\n}\n";
    const { source, result } = query(setup + site);
    const candidate = result!.candidates.find(c => c.label === "seam")!;
    const range = result!.replacementRange;
    const inserted = source.slice(0, range.from) + candidate.sourceText + source.slice(range.to);
    expect(inserted).toBe(setup + site.replace("@|", "@seam"));
    const compiled = compile(inserted);
    expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    if (site.startsWith("line") || site.startsWith("extract")) {
      expect([...compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.values()].some(m => m.layerIdentity === candidate.identity && m.layerName === "seam")).toBe(true);
    }
  });

  it.each([line, "extract E in @|(source: @Base, parts: [p: start..end])",
    "extract E(source: @Base, parts: [p in @|: start..end])", "svg S(layers: [@|])"])(
    "filters prefixes and replaces the full token without touching syntax: %s", site => {
      const { source, result } = query(layers + site.replace("@|", "@se|am"));
      expect(result?.candidates.map(c => c.label)).toEqual(["seam"]);
      expect(source.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe("seam");
      const range = result!.replacementRange;
      expect(source.slice(0, range.from) + "seam" + source.slice(range.to)).toBe(layers + site.replace("@|", "@seam"));
    });

  it("uses nearest scope identities, forward declarations and non-Layer shadowing", () => {
    const root = "nui 1\nlayer root\nlayer same\nlayer blocked\n";
    const grouped = root + "group G {\n const blocked: number = 1\n layer same\n group Inner {\n" + line + "\n layer future\n }\n layer local\n}\nmodule Hidden() {\n layer private\n}";
    const { compiled, result } = query(grouped);
    expect(result?.candidates.map(c => c.label)).toEqual(["default", "future", "same", "local", "root"]);
    expect(result?.candidates.find(c => c.label === "same")?.identity).toBe(
      compiled.sourceLexicalNamespace!.layerDeclarations.filter(d => d.name === "same")[1]!.statementId);
    expect(names(root + line + "\ngroup G {\n layer local\n}\nmodule M() {\n layer private\n}"))
      .toEqual(["default", "root", "same", "blocked"]);
  });

  it("closes outer scopes at each Module boundary, including unfinished declarations", () => {
    for (const site of [line, "line L in @|"]) {
      expect(names("nui 1\nlayer outer\nmodule M() {\n layer local\n group G {\n" + site + "\n }\n}"))
        .toEqual(["default", "local"]);
      expect(names("nui 1\nlayer outer\nmodule M() {\n layer local\n module N() {\n" + site + "\n layer nested\n }\n}"))
        .toEqual(["default", "nested"]);
    }
  });

  it("excludes ambiguous, invalid-scope and non-Layer declarations", () => {
    expect(names("nui 1\nlayer duplicate\nlayer duplicate\nconst scalar: number = 1\npoint P = coordinate(x: 0, y: 0)\nstyle Ink {\n}\nmodule M() {\n}\n" + line))
      .toEqual(["default"]);
    expect(names("nui 1\nlayer hidden\ngroup G {\n layer hidden\n const hidden: number = 1\n" + line + "\n}"))
      .toEqual(["default"]);
    expect(names("nui 1\nif (true) {\n layer invalid\n" + line + "\n}"))
      .toEqual(["default"]);
    expect(names("nui 1\nlayer default\n" + line)).toEqual(["default"]);
  });

  it("does not publish names from an uncertain scope while delimiters are edited", () => {
    for (const header of ["module M()", "group G", "}"]) {
      expect(names("nui 1\nlayer outside\n" + header + "\n" + line)).toEqual(["default"]);
    }
    const session = createNuiLanguageSession("nui 1\nlayer outside\n" + line.replace("|", ""));
    const isolated = "nui 1\nlayer outside\nmodule M() {\n" + line.replace("|", "") + "\n layer local\n}";
    session.replaceSource(isolated);
    expect(session.completion(isolated.indexOf("in @") + 4)?.candidates.map(c => c.label)).toEqual(["default", "local"]);
  });

  it("projects unfinished declarations into their body rather than an adjacent namespace", () => {
    expect(names("nui 1\nlayer seam\nline Base = segment(start: (0, 0), end: (10, 0))\nextract E(source: @Base, parts: [seam: start..end])\nline L in @|"))
      .toEqual(["default", "seam"]);
    for (const site of [line, "line L in @|"]) {
      expect(names("nui 1\nlayer seam\nif (true) {\nconst seam: number = 1\n" + site + "\n} else {\n}\n"))
        .toEqual(["default"]);
      expect(names("nui 1\nlayer seam\nif (true) {\nconst seam: number = 1\n} else {\n" + site + "\n}\n"))
        .toEqual(["default", "seam"]);
    }
  });

  it.each(["縫い線", "前 身頃", 'quote"slash\\', "dot.name", "colon::name", "tab\tname"])(
    "inserts canonical quoted/escaped names: %s", name => {
      const declaration = JSON.stringify(name);
      const { source, result } = query(`nui 1\nlayer ${declaration}\n` + line);
      const candidate = result!.candidates.find(c => c.label === name)!;
      const range = result!.replacementRange;
      const inserted = source.slice(0, range.from) + dslCompletionInsertionTextFor(candidate, result!.category, range, source) + source.slice(range.to);
      const fixed = compile(inserted);
      expect(fixed.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      expect([...fixed.sourceLexicalNamespace!.layerMembershipsByStatementIndex.values()][0]?.layerName).toBe(name);
    });

  it("handles quoted partial tokens, Unicode prefixes and exact UTF-16 positions", () => {
    const prefix = 'nui 1\n// 😀\nlayer "縫い 線"\n';
    for (const token of ['@"縫い| 線"', '@"縫い|']) {
      const { source, result } = query(prefix + line.replace("@|", token));
      expect(result?.candidates.map(c => c.label)).toEqual(["縫い 線"]);
      const range = result!.replacementRange;
      const inserted = source.slice(0, range.from) + result!.candidates[0]!.sourceText + source.slice(range.to);
      expect(inserted).toBe(prefix + line.replace("@|", '@"縫い 線"'));
    }
    expect(names("nui 1\nlayer 縫い線\nlayer 輪郭\n" + line.replace("@|", "@縫|"))).toEqual(["縫い線"]);
  });

  it.each([['quote"tail', 'quote"'], ['slash\\ tail', 'slash\\'], ['tab\ttail', 'tab\t']])(
    "decodes an escaped quoted prefix: %s", (name, prefix) => {
      const token = JSON.stringify(name);
      const offset = JSON.stringify(prefix).length - 1;
      const marked = token.slice(0, offset) + "|" + token.slice(offset);
      const { source, result } = query(`nui 1\nlayer ${token}\n` + line.replace("@|", "@" + marked));
      expect(result?.candidates.map(c => c.label)).toEqual([name]);
      expect(source.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe(token);
      expect(result?.candidates[0]?.sourceText).toBe(token);
    });

  it("never reuses stale names or scopes across live edits, revisions and Undo/Redo", () => {
    const original = layers + line.replace("|", "");
    const edited = original.replace("layer seam", "layer renamed");
    const session = createNuiLanguageSession(original);
    for (const source of [original, edited, original, edited, edited.replace("layer renamed\n", "")]) {
      session.replaceSource(source);
      const labels = session.completion(source.lastIndexOf("in @") + 4)?.candidates.map(c => c.label);
      expect(labels).toContain("outline");
      expect(labels?.includes("seam")).toBe(source.includes("layer seam"));
      expect(labels?.includes("renamed")).toBe(source.includes("layer renamed"));
    }
    const compiled = compile(original);
    for (const [text, revision] of [[edited, 1], [original, 2]] as const) {
      const result = queryDslCompletion({ source: { normalizedSource: text, sourceRevision: revision }, position: text.lastIndexOf("in @") + 4,
        semantic: { sourceRevision: 1, compiled } });
      expect(result?.candidates).toEqual([]);
    }
  });

  it.each([
    "const x: number = @|", "for i in @| {", "point P = coordinate(x: @|, y: 0)",
    'text T = label(text: "in @|", anchor: (0, 0), size: 3)',
    "// line L in @|", "/* line L in @| */", "group G in @| {", "line L [@|] = segment()"
  ])("does not classify unrelated text as a Layer site: %s", site => {
    expect(query(layers + site).result?.category).not.toBe("layerReference");
  });

  it("keeps invalid Layer paths out of geometry/Module completion lanes", () => {
    const setup = "nui 1\nmodule M() {\n export point P = coordinate(x: 0, y: 0)\n}\ninstance I = M()\n";
    for (const site of [line.replace("@|", "@I::|"), "svg S(layers: [@I::|])", "line L in @I.| = segment()"] ) {
      const { result } = query(setup + site);
      expect(result?.category).toBe("layerReference");
      expect(result?.candidates).toEqual([]);
    }
  });
});
