import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeMultiDocumentLintDiagnostics, SavedDocumentArtifactCache, analyzeMultiDocumentSource, documentIdFromHost, savedSourceFingerprintFromHost } from "@nuinuicad/nui-language/workspace";
import { parseDsl, createDslSemanticOccurrenceIndex } from "@nuinuicad/nui-language";
import { buildRecordImport } from "./issue1439Support";

const seam = `nui 1
export record SeamSettings(width: number, cornerAngle: number)
export module Forward(s: SeamSettings) {
  const local: SeamSettings = @s
  export const out: SeamSettings = @local
}`;
const facade = `nui 1
import "./seam.nui" as seam
export @seam::SeamSettings
export @seam::Forward`;
const direct = `nui 1
import "./seam.nui" as seam
import "./facade.nui" as facade
const s: seam::SeamSettings = facade::SeamSettings(width: 5, cornerAngle: 45)
instance use = facade::Forward(s: @s)
instance inline = seam::Forward(s: seam::SeamSettings(width: 9, cornerAngle: 63))
const width: number = @use::out.width
const angle: number = @inline::out.cornerAngle`;

describe("Issue 1439 shared nominal records", () => {
  it("parses exact export/type/constructor spelling without changing spans", () => {
    const source = `nui 1\nexport record 設定(width: number)\nimport "./seam.nui" as seam\nconst s: seam::SeamSettings = seam::SeamSettings(width: 5, cornerAngle: 45)`;
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements[1]!;
    expect(statement).toMatchObject({ kind: "recordDefinition", exported: true, exportSpan: { start: 0, end: 6 } });
    expect(statement.namePhysicalSpan?.segments.map(s => source.slice(s.from, s.to))).toEqual(["設定"]);
  });
  it("uses the original identity across direct/facade constructors and Module forwarding", async () => {
    const result = await buildRecordImport(direct, { "seam.nui": seam, "facade.nui": facade });
    expect(result.graph.valid, JSON.stringify([...result.graph.nodes.values()].map(n => n.sourceDiagnostics))).toBe(true);
    expect(result.analysis.valid, JSON.stringify(result.analysis.diagnostics)).toBe(true);
    expect(result.errors).toEqual([]);
    const catalogs = [...result.graph.nodes.values()].filter(n => n.documentId.endsWith("seam.nui") || n.documentId.endsWith("facade.nui"));
    const identities = catalogs.map(n => n.publicApi.publicEntriesByName.get("SeamSettings")!.identity);
    expect(identities[0]).toEqual(identities[1]);
  });
  it("rejects identical record names and shapes from distinct documents", async () => {
    const result = await buildRecordImport(direct.replace("facade::SeamSettings(width", "other::SeamSettings(width").replace('import "./facade.nui" as facade', 'import "./facade.nui" as facade\nimport "./other.nui" as other'), {
      "seam.nui": seam, "facade.nui": facade, "other.nui": seam
    });
    expect(result.graph.valid).toBe(false);
    expect([...result.graph.nodes.values()].flatMap(n => n.sourceDiagnostics).map(d => d.code)).toContain("record-nominal-type-mismatch");
  });
});

const library = `nui 1
export record R(x: number)
record Private(x: number)
export module M() {
}`;
const negativeCases = JSON.parse(readFileSync("test/fixtures/issue-1439/illegal.json", "utf8")) as { name: string; source: string; code: string }[];
for (const c of negativeCases) it(`rejects ${c.name} at its authored source`, async () => {
  const source = `nui 1\nimport "./library.nui" as lib\n${c.source}`;
  const result = await buildRecordImport(source, { "library.nui": library });
  const diagnostics = [...result.graph.nodes.get(result.graph.rootDocumentId)!.sourceDiagnostics, ...result.errors];
  expect(diagnostics.map(d => d.code), JSON.stringify(diagnostics)).toContain(c.code);
  const diagnostic = diagnostics.find(d => d.code === c.code)!;
  expect(diagnostic.line).toBeGreaterThanOrEqual(3);
  expect(diagnostic.physicalSpan?.segments.length).toBeGreaterThan(0);
});

it("keeps unexported record declarations private in the public catalog", async () => {
  const result = await buildRecordImport('nui 1\nimport "./library.nui" as lib', { "library.nui": library });
  const catalog = [...result.graph.nodes.values()].find(n => n.documentId.endsWith("library.nui"))!.publicApi;
  expect([...catalog.publicEntriesByName.keys()].sort()).toEqual(["M", "R"]);
  expect(catalog.declarationsByName.get("Private")?.[0]?.exported).toBe(false);
});

it("preserves the source-independent dependency rule for late import aliases and definitions", async () => {
  const source = `nui 1
const x: lib::R = lib::R(x: @n)
const n: number = 11
import "./library.nui" as lib`;
  const result = await buildRecordImport(source, { "library.nui": library });
  expect(result.graph.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

it("rejects nested publication, duplicate public names, private re-exports and transitive access", async () => {
  const nested = await buildRecordImport("nui 1\nmodule M() {\n  export record R(x: number)\n}", {});
  expect(nested.graph.nodes.get(nested.graph.rootDocumentId)!.sourceDiagnostics.map(d => d.code)).toContain("record-definition-not-top-level");
  const reexport = await buildRecordImport('nui 1\nimport "./library.nui" as lib\nexport @lib::Private', { "library.nui": library });
  expect(reexport.graph.nodes.get(reexport.graph.rootDocumentId)!.publicApiDiagnostics.map(d => d.code)).toContain("private-reexport-target");
  const transitive = await buildRecordImport('nui 1\nimport "./facade.nui" as facade\nconst x: facade::lib::R = facade::lib::R(x: 1)', {
    "library.nui": library, "facade.nui": 'nui 1\nimport "./library.nui" as lib'
  });
  expect(transitive.graph.valid).toBe(false);
  const duplicate = await buildRecordImport('nui 1\nexport record R(x: number)\nexport record R(x: number)', {});
  expect(duplicate.graph.valid).toBe(false);
});

it("rejects record import cycles and missing saved dependencies", async () => {
  const cyclic = await buildRecordImport('nui 1\nimport "./cycle.nui" as cycle', { "cycle.nui": 'nui 1\nimport "./cycle.nui" as self\nexport record R(x: number)' });
  expect(cyclic.graph.valid).toBe(false);
  expect(cyclic.graph.diagnostics.map(d => d.code)).toContain("import-cycle");
  const missing = await buildRecordImport('nui 1\nimport "./missing.nui" as lib\nconst x: lib::R = lib::R(x: 1)', {});
  expect(missing.graph.diagnostics.map(d => d.code)).toContain("import-missing");
});

it("rejects same-shaped records across Module and array argument boundaries", async () => {
  const lib = `nui 1
export record R(x: number)
export module Read(value: R) {
  export const out: R = @value
}
export module Rows(values: R[]) {
  export const out: R[] = @values
}`;
  for (const call of ["instance bad = other::Read(value: @x)", "instance bad = other::Rows(values: [@x])"]) {
    const result = await buildRecordImport(`nui 1
import "./lib.nui" as lib
import "./other.nui" as other
const x: lib::R = lib::R(x: 5)
${call}`, { "lib.nui": lib, "other.nui": lib });
    expect(result.analysis.valid).toBe(false);
    expect(result.analysis.diagnostics.length).toBeGreaterThan(0);
  }
});

it("keeps private nested definitions usable through public values without publishing their names", async () => {
  const result = await buildRecordImport(`nui 1
import "./lib.nui" as lib
instance make = lib::Make()
const x: number = @make::out.inner.x`, { "lib.nui": `nui 1
record Hidden(x: number)
export record Public(inner: Hidden)
export module Make() {
  export const out: Public = Public(inner: Hidden(x: 73))
}` });
  expect(result.graph.valid).toBe(true);
  expect(result.analysis.valid).toBe(true);
  expect(result.errors).toEqual([]);
  const catalog = [...result.graph.nodes.values()].find(n => n.documentId.endsWith("lib.nui"))!.publicApi;
  expect(catalog.publicEntriesByName.has("Hidden")).toBe(false);
});

it("checks original nominal identity when a Module forwards an array parameter", async () => {
  const exported = `nui 1
export record R(x: number)
export module Rows(values: R[]) {
  export const out: R[] = @values
}`;
  const source = `nui 1
import "./one.nui" as one
import "./two.nui" as two
module Forward(values: one::R[]) {
  instance wrong = two::Rows(values: @values)
}`;
  const result = await buildRecordImport(source, { "one.nui": exported, "two.nui": exported });
  expect(result.analysis.valid).toBe(false);
  expect(result.analysis.root?.diagnostics).toContainEqual(expect.objectContaining({ code: "array-argument-type-mismatch", line: 5 }));
  const sameDefinition = await buildRecordImport(source.replace("two::Rows", "one::Rows"), { "one.nui": exported, "two.nui": exported });
  expect(sameDefinition.analysis.valid).toBe(true);
});

it("uses saved artifacts across dirty roots and invalidates the exact saved fingerprint", async () => {
  const cache = new SavedDocumentArtifactCache();
  const source = 'nui 1\nimport "./library.nui" as lib\nconst x: lib::R = lib::R(x: 11)';
  const first = await buildRecordImport(source, { "library.nui": library }, cache);
  const dependency = [...first.graph.nodes.values()].find(n => n.documentId.endsWith("library.nui"))!;
  const sourceBefore = dependency.artifact.source.normalizedSource;
  // An open current buffer is a separate authority and cannot replace the loader's saved source.
  analyzeMultiDocumentSource({ kind: "root-current", documentId: documentIdFromHost("/issue1439/library.nui"),
    sourceRevision: 99, normalizedSource: 'nui 1\nexport record R(dirty: string)' });
  const unchanged = await buildRecordImport(source, { "library.nui": library }, cache);
  expect(unchanged.errors).toEqual([]);
  expect(unchanged.graph.valid).toBe(true);
  expect(dependency.artifact.source.normalizedSource).toBe(sourceBefore);
  expect(cache.size).toBe(1);
  const changed = await buildRecordImport(source, { "library.nui": 'nui 1\nexport record R(saved: string)' }, cache);
  expect(cache.size).toBe(2);
  expect(changed.graph.valid).toBe(false);
  expect(changed.graph.nodes.get(changed.graph.rootDocumentId)!.sourceDiagnostics.map(d => d.code)).toContain("record-constructor-missing-field");
  expect(dependency.artifact.source.normalizedSource).toBe(sourceBefore);
});

it("does not warn that a type-only or constructor-only import is unused", async () => {
  const result = await buildRecordImport(`nui 1
import "./library.nui" as typeNames
import "./library.nui" as constructors
const x: typeNames::R = constructors::R(x: 1)`, { "library.nui": library });
  expect(result.errors).toEqual([]);
  expect(analyzeMultiDocumentLintDiagnostics({ graph: result.graph, moduleAnalysis: result.analysis })).toEqual([]);
});

it("rejects optional collections where a required imported Module collection is expected", async () => {
  const result = await buildRecordImport(`nui 1
import "./lib.nui" as lib
const xs: lib::R[]? = none
instance bad = lib::Read(xs: @xs)`, { "lib.nui": `nui 1
export record R(x: number)
export module Read(xs: R[]) {
  export const out: R[] = @xs
}` });
  expect(result.analysis.valid).toBe(false);
  expect(result.analysis.diagnostics.length).toBeGreaterThan(0);
});

it("includes the defining document even when two saved files reuse the exact local record identity", async () => {
  const cache = new SavedDocumentArtifactCache();
  const text = "nui 1\nexport record R(x: number)";
  for (const name of ["one.nui", "two.nui"]) cache.set(analyzeMultiDocumentSource({
    kind: "dependency-saved", documentId: documentIdFromHost(`/issue1439/${name}`), normalizedSource: text,
    savedSourceFingerprint: savedSourceFingerprintFromHost(createHash("sha256").update(text).digest("hex"))
  }, { statementIdByStatementIndex: new Map([[1, "same-record-local-identity"]]) }));
  const result = await buildRecordImport(`nui 1
import "./one.nui" as one
import "./two.nui" as two
const wrong: one::R = two::R(x: 5)`, { "one.nui": text, "two.nui": text }, cache);
  expect(result.graph.valid).toBe(false);
  expect(result.graph.nodes.get(result.graph.rootDocumentId)!.sourceDiagnostics.map(d => d.code)).toContain("record-nominal-type-mismatch");
});

it("requires optional imported Module collections to be resolved before required access", async () => {
  const saved = { "lib.nui": `nui 1
export record R(x: number)
export module Maybe(xs: R[]?) {
  export const out: R[]? = @xs
}` };
  for (const use of ["const n: number = @m::out.length", "const r: lib::R = @m::out[0]"]) {
    const result = await buildRecordImport(`nui 1
import "./lib.nui" as lib
instance m = lib::Maybe()
${use}`, saved);
    expect(!result.analysis.valid || result.errors.length > 0, JSON.stringify({use,errors:result.errors})).toBe(true);
  }
});

it("keeps imported record declarations out of the caller's source occurrence ranges", async () => {
  const source = 'nui 1\nimport "./library.nui" as lib\nconst x: lib::R = lib::R(x: 1)';
  const result = await buildRecordImport(source, { "library.nui": library });
  expect(result.errors).toEqual([]);
  const occurrences = createDslSemanticOccurrenceIndex(result.compiled).occurrences;
  expect(occurrences.filter(o => o.kind === "declaration" && (o.identity.kind === "recordType" || o.identity.kind === "recordField"))).toEqual([]);
  expect(result.compiled.spans.sourceMap.source).toBe(source);
  const entry = [...result.graph.nodes.values()].find(n => n.documentId.endsWith("library.nui"))!.publicApi.publicEntriesByName.get("R")!;
  expect(library.slice(entry.declaration.range.from, entry.declaration.range.to)).toBe("R");
});
