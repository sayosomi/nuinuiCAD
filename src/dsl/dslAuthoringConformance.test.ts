// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createModuleRuntimeContext,
  createNuiLanguageSession,
  dslCompletionInsertionTextFor,
  queryDslCompletion,
  queryDslSignatureHelp,
  type CompiledDslDocument,
  type DslCompletionQueryResult
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  currentCompiledSemanticSnapshotFor,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  SavedDocumentArtifactCache,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
import { createRustStdioParityClient } from "../../test/evaluationParitySupport";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluationPayloadToResult } from "../geometry/evaluationPayload";
import { rawOffsetFromNormalized } from "../../vscode-extension/src/sourceOffsetAdapter";

// Each source/probe/oracle is authored before execution, never derived from query results.
const marked = (text: string) => {
  const positions: Record<string, number> = {};
  let source = "";
  let last = 0;
  for (const match of text.matchAll(/§(\w+)§/g)) {
    source += text.slice(last, match.index);
    positions[match[1]!] = source.length;
    last = match.index! + match[0].length;
  }
  source += text.slice(last);
  return { source, positions };
};
const open = (text: string) => {
  const fixture = marked(text);
  const session = createNuiLanguageSession(fixture.source);
  const semantic = currentCompiledSemanticSnapshotFor(session)!;
  expect(semantic.sourceText).toBe(fixture.source);
  expect(semantic.sourceRevision).toBe(session.getSourceRevision());
  expect(semantic.compiled.spans.sourceMap.sourceRevision).toBe(semantic.sourceRevision);
  const source = { normalizedSource: fixture.source, sourceRevision: semantic.sourceRevision };
  return {
    ...fixture, session, semantic,
    completion: (probe: string) => queryDslCompletion({ source, position: fixture.positions[probe]!, semantic }),
    signature: (probe: string) => queryDslSignatureHelp({ source, position: fixture.positions[probe]!, semantic })
  };
};
const rangeAt = (result: DslCompletionQueryResult | null, from: number, to = from) => {
  expect(result).not.toBeNull();
  expect(result?.replacementRange).toEqual({ from, to });
};
const labels = (result: DslCompletionQueryResult | null) => result?.candidates.map(({ label }) => label) ?? [];
const signature = (result: ReturnType<typeof queryDslSignatureHelp>, name: string, parameter: number | undefined, overload = 0) => {
  expect(result).not.toBeNull();
  expect(result?.signatures[result.activeSignature]?.name).toBe(name);
  expect(result?.activeSignature).toBe(overload);
  expect(result?.activeParameter).toBe(parameter);
};
const errors = (compiled: CompiledDslDocument) => [
  ...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])
].filter(({ severity }) => severity === "error");
const compile = (source: string) => currentCompiledSemanticSnapshotFor(createNuiLanguageSession(source))!.compiled;
const valid = (compiled: CompiledDslDocument) => expect(errors(compiled)).toEqual([]);
const apply = (source: string, result: DslCompletionQueryResult | null, label: string, expectedOld: string, expectedInsertion: string) => {
  expect(result).not.toBeNull();
  const candidate = result!.candidates.find((item) => item.label === label);
  expect(candidate).toBeDefined();
  const range = result!.replacementRange;
  expect(source.slice(range.from, range.to)).toBe(expectedOld);
  const insertion = dslCompletionInsertionTextFor(candidate!, result!.category, range, source);
  expect(insertion).toBe(expectedInsertion);
  const next = source.slice(0, range.from) + insertion + source.slice(range.to);
  expect(next.slice(0, range.from)).toBe(source.slice(0, range.from));
  expect(next.slice(range.from + insertion.length)).toBe(source.slice(range.to));
  return next;
};
let rust: ReturnType<typeof createRustStdioParityClient> | undefined;
afterAll(() => rust?.dispose());
const point = async (compiled: CompiledDslDocument, expected: { x: number; y: number }) => {
  valid(compiled);
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) throw new Error("no document");
  rust ??= createRustStdioParityClient(process.cwd());
  const result = evaluationPayloadToResult(await rust.evaluate(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  })));
  expect(result.errors).toEqual([]);
  const points = [...result.computedGeometry.values()].filter((geometry) => geometry.kind === "point");
  expect(points).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "point", ...expected })]));
};
const imported = async (text: string, libraryText: string, revision: number, cache = new SavedDocumentArtifactCache(), facade = false) => {
  const fixture = marked(text);
  const root: RootCurrentSourceSnapshot = { kind: "root-current", documentId: documentIdFromHost("issue1521-root"), normalizedSource: fixture.source, sourceRevision: revision };
  const library: DependencySavedSourceSnapshot = { kind: "dependency-saved", documentId: documentIdFromHost("issue1521-library"), normalizedSource: libraryText, savedSourceFingerprint: savedSourceFingerprintFromHost(`sha256:${libraryText}`) };
  const facadeSource: DependencySavedSourceSnapshot = { kind: "dependency-saved", documentId: documentIdFromHost("issue1521-facade"), normalizedSource: 'nui 1\nimport "./lib.nui" as lib\nexport @lib::Panel', savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:facade") };
  const graph = await buildMultiDocumentImportGraph({
    root, cache, declarationContributors: [moduleDeclarationContributor],
    loader: { async loadSavedDependency(_id, path) { return { status: "loaded" as const, snapshot: path === "./facade.nui" ? facadeSource : library }; } }
  });
  expect(graph.valid).toBe(true);
  const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
  expect(context.valid).toBe(true);
  const node = graph.nodes.get(root.documentId)!;
  const compiled = compileDslDocument(root.normalizedSource, { preparsed: node.artifact.parsed, sourceRevision: revision, assignedStatementIds: node.artifact.statementIdByStatementIndex, moduleRuntimeContext: context });
  const source = { normalizedSource: fixture.source, sourceRevision: revision };
  const semantic = { sourceRevision: revision, sourceText: fixture.source, compiled };
  expect(graph.nodes.get(library.documentId)?.artifact.source).toMatchObject({ kind: "dependency-saved", savedSourceFingerprint: library.savedSourceFingerprint });
  expect(graph.nodes.has(facadeSource.documentId)).toBe(facade);
  return { ...fixture, sourceSnapshot: source, semantic, library, completion: (probe: string) => queryDslCompletion({ source, position: fixture.positions[probe]!, semantic }), signature: (probe: string) => queryDslSignatureHelp({ source, position: fixture.positions[probe]!, semantic }) };
};

describe("Issue 1521 frozen authoring conformance matrix", () => {
  it("B1 positional overloads, neighboring call, typed candidates and arity", () => {
    const f = open('nui 1\nconst width: number = 4\nconst flag: boolean = true\nconst a: number = round(§one§@width)\nconst b: number = round(1.25, §two§1)\nconst c: number = abs(§abs§@width)\nconst bad: number = abs(1, §extra§2)');
    signature(f.signature("one"), "round", 0);
    signature(f.signature("two"), "round", 1, 1);
    signature(f.signature("abs"), "abs", 0);
    signature(f.signature("extra"), "abs", undefined);
    expect(labels(f.completion("abs"))).toContain("width");
    expect(labels(f.completion("abs"))).not.toContain("flag");
    rangeAt(f.completion("abs"), f.positions.abs!);
    expect(errors(f.semantic.compiled).length).toBeGreaterThan(0);
  });
  it("B2 named-only reordered arguments and colon whitespace", () => {
    const f = open('nui 1\nconst width: number = 10\nconst a: number = spreadAngle(spread : §spread§10, length: §length§@width)\nconst b: number = spreadAngle(spread: §control§10, length: @width)');
    valid(f.semantic.compiled);
    signature(f.signature("control"), "spreadAngle", 1);
    signature(f.signature("spread"), "spreadAngle", 1);
    signature(f.signature("length"), "spreadAngle", 0);
    expect(labels(f.completion("length"))).toContain("width");
    rangeAt(f.completion("length"), f.positions.length!);
    for (const expression of ['spreadAngle(length: 10)', 'spreadAngle(length: 10, length: 10)', 'spreadAngle(10, 10)', 'abs(arg1: 1)']) {
      expect(errors(compile(`nui 1\nconst bad: number = ${expression}`)).length).toBeGreaterThan(0);
    }
  });
  it("B3 nearest nested call ignores deeper punctuation and strings", () => {
    const f = open('nui 1\nconst distractor: string = "abs(1, 2), )"\nconst value: number = max(round(abs(§inner§-2.5), §digits§1), §outer§3)');
    valid(f.semantic.compiled);
    signature(f.signature("inner"), "abs", 0);
    signature(f.signature("digits"), "round", 1, 1);
    signature(f.signature("outer"), "max", 1);
    expect(f.signature("outer")?.signatures[0]?.parameters).toHaveLength(2);
    expect(labels(f.completion("inner"))).toContain("abs");
    rangeAt(f.completion("inner"), f.positions.inner!);
  });
  it("B4 partial name, opening call and trailing comma recovery", () => {
    const partial = open('nui 1\nconst x: number = rou§p§');
    expect(labels(partial.completion("p"))).toContain("round");
    expect(partial.signature("p")).toBeNull();
    const next = apply(partial.source, partial.completion("p"), "round", "rou", "round");
    valid(compile(`${next}(1.5)`));
    const opening = open('nui 1\nconst x: number = abs(§p§');
    signature(opening.signature("p"), "abs", 0);
    rangeAt(opening.completion("p"), opening.positions.p!);
    expect(labels(opening.completion("p"))).toContain("round");
    const trailing = open('nui 1\nconst x: number = round(1,\n  §p§\n)');
    signature(trailing.signature("p"), "round", 1, 1);
    expect(trailing.signature("p")?.signatures[1]?.parameters).toHaveLength(2);
  });
  it("C1 numeric coordinate fields filter wrong types and sibling scope", () => {
    const f = open('nui 1\nconst width: number = 12\nconst textValue: string = "wrong"\nconst flag: boolean = true\ngroup Other {\n  const hidden: number = 99\n}\npoint P = coordinate(x: @§x§width§insert§, y: §y§-4)');
    valid(f.semantic.compiled);
    signature(f.signature("x"), "coordinate", 0);
    signature(f.signature("y"), "coordinate", 1);
    const candidates = labels(f.completion("x"));
    expect(candidates).toContain("width");
    for (const forbidden of ["textValue", "flag", "hidden"]) expect(candidates).not.toContain(forbidden);
    valid(compile(apply(f.source, f.completion("insert"), "width", "width", "width")));
  });
  it("C2 point versus path slots and reference spelling", () => {
    const f = open('nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 8, y: 0)\nline L = segment(start: @A, end: @B)\nline Use = segment(start: @§p§A§insert§, end: @B)\nline Shift = offset(sources: [@§l§L], distance: 2, side: left)');
    valid(f.semantic.compiled);
    const points = labels(f.completion("p"));
    expect(points).toEqual(expect.arrayContaining(["A", "B"]));
    expect(points).not.toContain("L");
    const paths = labels(f.completion("l"));
    expect(paths).toContain("L");
    expect(paths).not.toContain("A");
    valid(compile(apply(f.source, f.completion("insert"), "B", "A", "B")));
    signature(f.signature("p"), "segment", 0);
  });
  it("C3 enum and boolean metadata, defaults and eligibility", () => {
    const f = open('nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 8, y: 0)\nline L = segment(start: @A, end: @B)\nline Shift = offset(sources: [@L], side: §side§left, closed: §closed§false)');
    valid(f.semantic.compiled);
    const s = f.signature("side")!;
    expect(s.signatures[0]?.parameters.find((p) => p.name === "side")).toMatchObject({ type: "choice(right, left)", allowedValues: ["right", "left"] });
    expect(s.signatures[0]?.parameters.find((p) => p.name === "closed")).toMatchObject({ type: "boolean", defaultValue: "false", optional: true });
    expect(s.signatures[0]?.parameters.find((p) => p.name === "distance")).toMatchObject({ defaultValue: "10", optional: true });
    expect(labels(f.completion("side"))).toEqual(expect.arrayContaining(["left", "right"]));
    expect(labels(f.completion("side"))).not.toContain("true");
    expect(labels(f.completion("closed"))).toEqual(expect.arrayContaining(["true", "false"]));
    expect(labels(f.completion("closed"))).not.toContain("left");
    rangeAt(f.completion("side"), f.positions.side!);
  });
  it("C4 Module closed scope, shadow and nearest numeric call", () => {
    const f = open('nui 1\nconst width: string = "outer"\nconst forbidden: number = 99\nmodule M(width: number) {\n  point P = coordinate(x: round(§unsupported§@§round§width, 1), y: @§y§width)\n}\ninstance Use = M(width: 7)');
    valid(f.semantic.compiled);
    signature(f.signature("round"), "round", 0);
    signature(f.signature("y"), "coordinate", 1);
    expect(f.completion("unsupported")).toBeNull();
    expect(labels(f.completion("round"))).toContain("width");
    expect(labels(f.completion("round"))).not.toContain("forbidden");
    expect(f.completion("round")?.candidates.every((c) => c.kind === "binding")).toBe(true);
    const candidate = f.completion("round")!.candidates.find((c) => c.label === "width")!;
    expect(candidate.identity).toBe("module-parameter:width");
    expect(candidate.kind).toBe("binding");
    rangeAt(f.completion("round"), f.positions.round!);
    expect(errors(compile(f.source.replace("round(@width", "round(@forbidden"))).length).toBeGreaterThan(0);
  });
  it("M1 local typed parameters and literal insertion compile and evaluate", async () => {
    const f = open('nui 1\nconst width: number = 14\nconst other: number = 2\nmodule Panel(width: number, note: string?, rise: number = 3) {\n  point P = coordinate(x: @width, y: @rise)\n}\ninstance Use = Panel(rise: 3, width: @§width§other§insert§)');
    valid(f.semantic.compiled);
    signature(f.signature("width"), "Panel", 0);
    expect(f.signature("width")?.signatures[0]?.parameters).toEqual([
      expect.objectContaining({ name: "width", type: "number", optional: false }),
      expect.objectContaining({ name: "note", type: "string", optional: true }),
      expect.objectContaining({ name: "rise", defaultValue: "3" })
    ]);
    expect(labels(f.completion("width"))).toContain("width");
    const inserted = apply(f.source, f.completion("insert"), "width", "@other", "@width");
    await point(compile(inserted), { x: 14, y: 3 });
  }, 30000);
  it("M2 same-name lexical Modules and nested call documentation", () => {
    const f = open('nui 1\n/// @en\n/// outer documentation\nmodule Same(outer: number) {\n}\nmodule Wrapper(local: boolean) {\n  /// @en\n  /// inner documentation\n  module Same(inner: boolean) {\n  }\n  instance Nested = Same(inner: §inner§@local)\n}\ninstance Use = Wrapper(local: true)\ninstance Outer = Same(outer: §outer§1)');
    valid(f.semantic.compiled);
    signature(f.signature("inner"), "Same", 0);
    signature(f.signature("outer"), "Same", 0);
    expect(f.signature("inner")?.signatures[0]?.parameters[0]).toMatchObject({ name: "inner", type: "boolean" });
    expect(f.signature("inner")?.signatures[0]?.authoredDocumentation?.variants[0]?.markdown).toBe("inner documentation");
    expect(f.signature("outer")?.signatures[0]?.authoredDocumentation?.variants[0]?.markdown).toBe("outer documentation");
    expect(f.signature("inner")?.signatures[0]?.identity).not.toBe(f.signature("outer")?.signatures[0]?.identity);
    expect(labels(f.completion("inner"))).toContain("local");
    expect(labels(f.completion("inner"))).not.toContain("outer");
    rangeAt(f.completion("inner"), f.positions.inner!);
  });
  it("M3 direct alias and facade preserve saved Module identity and docs", async () => {
    const library = 'nui 1\n/// @en\n/// library panel\nexport module Panel(width: number, rise: number = 2) {\n  point P = coordinate(x: @width, y: @rise)\n}\nmodule Private(secret: boolean) {\n}';
    const cache = new SavedDocumentArtifactCache();
    const direct = await imported('nui 1\nimport "./lib.nui" as lib\ninstance Use = lib::Pa§callee§nel(width§label§: §p§8)', library, 11, cache);
    const facade = await imported('nui 1\nimport "./facade.nui" as api\ninstance Use = api::Pa§callee§nel(width§label§: §p§8)', library, 12, cache, true);
    for (const f of [direct, facade]) {
      valid(f.semantic.compiled);
      signature(f.signature("p"), "Panel", 0);
      expect(f.signature("p")?.signatures[0]?.parameters.map((p) => p.name)).toEqual(["width", "rise"]);
      expect(f.signature("p")?.signatures[0]?.authoredDocumentation?.variants[0]?.markdown).toBe("library panel");
      expect(f.signature("p")?.signatures[0]?.identity).toContain("issue1521-library");
      expect(labels(f.completion("p"))).not.toContain("secret");
      expect(labels(f.completion("callee"))).toContain("Panel");
      expect(labels(f.completion("callee"))).not.toContain("Private");
      expect(labels(f.completion("label"))).toContain("rise");
      rangeAt(f.completion("callee"), f.positions.callee! - 2, f.positions.callee!);
      rangeAt(f.completion("p"), f.positions.p!);
    }
    expect(direct.signature("p")?.signatures[0]?.identity).toBe(facade.signature("p")?.signatures[0]?.identity);
  });
  it("M4 saved dependency change and dirty root never mix old identities", async () => {
    const cache = new SavedDocumentArtifactCache();
    const a = await imported('nui 1\nimport "./lib.nui" as lib\nconst width: number = 8\ninstance Use = lib::Panel(width: §p§@width)', 'nui 1\nexport module Panel(width: number) {\n}', 20, cache);
    const b = await imported('nui 1\nimport "./lib.nui" as lib\nconst flag: boolean = true\ninstance Use = lib::Panel(flag: §p§@flag)', 'nui 1\nexport module Panel(flag: boolean) {\n}', 21, cache);
    valid(a.semantic.compiled); valid(b.semantic.compiled);
    signature(a.signature("p"), "Panel", 0); signature(b.signature("p"), "Panel", 0);
    expect(b.signature("p")?.signatures[0]?.parameters[0]).toMatchObject({ name: "flag", type: "boolean" });
    expect(labels(b.completion("p"))).toContain("flag");
    expect(labels(b.completion("p"))).not.toContain("width");
    rangeAt(b.completion("p"), b.positions.p!);
    expect(b.library.savedSourceFingerprint).not.toBe(a.library.savedSourceFingerprint);
    expect(queryDslSignatureHelp({ source: b.sourceSnapshot, position: b.positions.p!, semantic: a.semantic })).toBeNull();
    expect(labels(queryDslCompletion({ source: b.sourceSnapshot, position: b.positions.p!, semantic: a.semantic }))).not.toContain("width");
    const dirty = { ...b.sourceSnapshot, sourceRevision: 22, normalizedSource: b.source.replace("@flag)", "@)") };
    expect(queryDslSignatureHelp({ source: dirty, position: dirty.normalizedSource.length - 1, semantic: b.semantic })).toBeNull();
    expect(labels(queryDslCompletion({ source: dirty, position: dirty.normalizedSource.length - 1, semantic: b.semantic }))).not.toContain("width");
    expect(labels(queryDslCompletion({ source: dirty, position: dirty.normalizedSource.length - 1, semantic: b.semantic }))).not.toContain("flag");
  });
  it("R1 CRLF and supplementary Unicode have exact UTF-16 physical ranges", () => {
    const fixture = marked('nui 1\n// 🧵 literal abs(9, 2)\nconst 幅: number = 12\npoint P = coordinate(x: round(1.25, §sig§1), y: @§p§幅§insert§)');
    const raw = fixture.source.replaceAll("\n", "\r\n");
    const session = createNuiLanguageSession(raw);
    expect(session.getSource()).toBe(raw);
    signature(session.signatureHelp(fixture.positions.sig!), "round", 1, 1);
    const result = session.completion(fixture.positions.insert!)!;
    expect(labels(result)).toContain("幅");
    expect(result.replacementRange).toEqual({ from: fixture.positions.p, to: fixture.positions.p! + 1 });
    const from = rawOffsetFromNormalized(raw, result.replacementRange.from);
    const to = rawOffsetFromNormalized(raw, result.replacementRange.to);
    expect(raw.slice(from, to)).toBe("幅");
    expect(from).toBe(fixture.positions.p! + 3);
    valid(compile(apply(fixture.source, result, "幅", "幅", "幅")));
    expect(queryDslSignatureHelp({ source: { normalizedSource: raw, sourceRevision: 1 }, position: fixture.positions.sig! })).toBeNull();
  });
  it("R2 invalid current edit and valid recovery keep current Module labels", () => {
    const a = marked('nui 1\nmodule M(old: number) {\n}\ninstance Use = M(old: §p§1)');
    const b = marked('nui 1\nmodule M(newValue: boolean) {\n}\ninstance Use = M(§p§\n)');
    const c = marked('nui 1\nmodule M(newValue: boolean) {\n}\ninstance Use = M(newValue: §p§true)');
    const session = createNuiLanguageSession(a.source);
    const old = currentCompiledSemanticSnapshotFor(session)!;
    valid(old.compiled);
    session.replaceSource(b.source);
    expect(session.getSource()).toBe(b.source);
    expect(session.runtimeEvaluationSnapshot()).toBeNull();
    const current = currentCompiledSemanticSnapshotFor(session)!;
    expect(current.sourceRevision).toBeGreaterThan(old.sourceRevision);
    expect(current.sourceText).toBe(b.source);
    expect(labels(session.completion(b.positions.p!))).toContain("newValue");
    expect(labels(session.completion(b.positions.p!))).not.toContain("old");
    rangeAt(session.completion(b.positions.p!), b.positions.p!);
    session.replaceSource(c.source);
    valid(currentCompiledSemanticSnapshotFor(session)!.compiled);
    expect(session.runtimeEvaluationSnapshot()?.sourceText).toBe(c.source);
    signature(session.signatureHelp(c.positions.p!), "M", 0);
    expect(session.signatureHelp(c.positions.p!)?.signatures[0]?.parameters[0]?.name).toBe("newValue");
  });
  it("R3 A-B-A distinct revisions reject stale equal-text semantic proof", () => {
    const a = marked('nui 1\nmodule A(width: number) {\n}\ninstance Use = A(width: §p§2)');
    const b = marked('nui 1\nmodule B(flag: boolean) {\n}\ninstance Use = B(flag: §p§true)');
    const session = createNuiLanguageSession(a.source);
    const old = currentCompiledSemanticSnapshotFor(session)!;
    const revisions: number[] = [];
    for (const [f, name, parameter] of [[a, "A", "width"], [b, "B", "flag"], [a, "A", "width"]] as const) {
      if (revisions.length) session.replaceSource(f.source);
      revisions.push(session.getSourceRevision());
      valid(currentCompiledSemanticSnapshotFor(session)!.compiled);
      signature(session.signatureHelp(f.positions.p!), name, 0);
      expect(session.signatureHelp(f.positions.p!)?.signatures[0]?.parameters[0]?.name).toBe(parameter);
      rangeAt(session.completion(f.positions.p!), f.positions.p!);
    }
    expect(revisions[0]).toBeLessThan(revisions[1]!);
    expect(revisions[1]).toBeLessThan(revisions[2]!);
    const source = { normalizedSource: a.source, sourceRevision: revisions[2]! };
    expect(queryDslSignatureHelp({ source, position: a.positions.p!, semantic: old })).toBeNull();
    const calleePosition = a.source.lastIndexOf("A(") + 1;
    expect(labels(session.completion(calleePosition))).toContain("A");
    expect(labels(queryDslCompletion({ source, position: calleePosition, semantic: old }))).not.toContain("A");
  });
  it("R4 physically applied insertion preserves bytes and evaluates (12,-4)", async () => {
    const f = open('nui 1\n// preserve 🧵 and all spacing\nconst width: number = 12\nconst wide: number = 100\npoint P = coordinate(x: @wi§prefix§de§p§, y: -4) // untouched tail\n');
    valid(f.semantic.compiled);
    signature(f.signature("p"), "coordinate", 0);
    const result = f.completion("p")!;
    expect(result.replacementRange).toEqual({ from: f.source.indexOf("@wide") + 1, to: f.source.indexOf("@wide") + 5 });
    const inserted = apply(f.source, result, "width", "wide", "width");
    expect(inserted).toBe(f.source.replace("@wide", "@width"));
    await point(compile(inserted), { x: 12, y: -4 });
    expect(labels(result)).not.toContain("missing");
  }, 30000);
});


describe("Issue 1521 evidence-triggered adjacent cases and reducers", () => {
  it("X1 named argument whitespace spans across builtin, construction and Module", () => {
    const f = open('nui 1\nmodule M(value: number) {\n}\nconst a: number = spreadAngle(spread \t: §builtin§10, length: 10)\npoint P = coordinate(x  : §point§1, y: 0)\ninstance Use = M(value \t: §module§2)');
    expect(errors(f.semantic.compiled).map((d) => d.code)).toEqual(["construction-positional-argument-not-accepted", "module-argument-not-named"]);
    signature(f.signature("builtin"), "spreadAngle", 1);
    signature(f.signature("point"), "coordinate", 0);
  });
  it("X2 positional signature does not activate its synthetic name in an illegal named call", () => {
    const f = open('nui 1\nconst good: number = abs(§control§1)\nconst bad: number = abs(arg1: §bad§1)');
    signature(f.signature("control"), "abs", 0);
    expect(errors(f.semantic.compiled).some((d) => d.code !== "missing-stable-statement-identity")).toBe(true);
    signature(f.signature("bad"), "abs", undefined);
  });
  it("X3 nested numeric builtin in boolean Module initializer uses argument type and closed scope", () => {
    const f = open('nui 1\nconst outside: number = 99\nconst outsideFlag: boolean = true\nmodule M(width: number, flag: boolean) {\n  const local: number = 2\n  const result: boolean = isClose(@§p§width, 0, 0)\n}\ninstance Use = M(width: 1, flag: true)');
    valid(f.semantic.compiled);
    signature(f.signature("p"), "isClose", 0);
    const candidates = labels(f.completion("p"));
    expect(candidates).toEqual(expect.arrayContaining(["width", "local"]));
    for (const forbidden of ["outside", "outsideFlag", "flag"]) expect(candidates).not.toContain(forbidden);
    expect(errors(compile(f.source.replace("isClose(@width", "isClose(@flag"))).length).toBeGreaterThan(0);
  });
  it("X4 Module geometry references reuse lexical visibility", () => {
    const f = open('nui 1\npoint External = coordinate(x: 99, y: 0)\nmodule M(base: point) {\n  point Own = coordinate(x: 1, y: 0)\n  line L = segment(start: @§p§Own, end: @base)\n}\ninstance Use = M(base: @External)');
    valid(f.semantic.compiled);
    signature(f.signature("p"), "segment", 0);
    expect(labels(f.completion("p"))).toEqual(expect.arrayContaining(["Own", "base"]));
    expect(labels(f.completion("p"))).not.toContain("External");
    expect(errors(compile(f.source.replace("segment(start: @Own", "segment(start: @External"))).length).toBeGreaterThan(0);
  });
  it("X5 Module builtin reference and operator slots honor operand shape", () => {
    const f = open('nui 1\nmodule M(x: number) {\n  const result: number = abs(@§reference§x)§operator§ + 1\n}');
    valid(f.semantic.compiled);
    expect(f.completion("reference")?.candidates.every((c) => c.kind === "binding")).toBe(true);
    expect(labels(f.completion("reference"))).toContain("x");
    expect(f.completion("operator")?.candidates.every((c) => c.kind === "operator")).toBe(true);
    expect(f.completion("operator")).not.toBeNull();
  });
  it("D1 reduced whitespace witness retains the declared named parameter", () => {
    const f = open('nui 1\nconst a: number = spreadAngle(spread : §p§1, length: 1)');
    valid(f.semantic.compiled);
    signature(f.signature("p"), "spreadAngle", 1);
  });
  it("D2 reduced closed-Module numeric reference excludes outer binding", () => {
    const f = open('nui 1\nconst outside: number = 1\nmodule M(x: number) {\n  point P = coordinate(x: @§p§x, y: 0)\n}\npoint Control = coordinate(x: @§control§outside, y: 0)');
    valid(f.semantic.compiled);
    expect(labels(f.completion("control"))).toContain("outside");
    expect(labels(f.completion("p"))).toContain("x");
    expect(labels(f.completion("p"))).not.toContain("outside");
  });
});
