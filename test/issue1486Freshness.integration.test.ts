import { describe, expect, it } from "vitest";
import {
  buildMultiDocumentSemanticOccurrenceIndex, MultiDocumentGraphCoordinator, planMultiDocumentRename,
  queryMultiDocumentDefinition, queryMultiDocumentReferences,
  type SavedDependencyLoadResult, type MultiDocumentSemanticOccurrenceIndex
} from "@nuinuicad/nui-language/workspace";
import { planDslRenameEditsResult, queryDslDefinition } from "@nuinuicad/nui-language";
import primary from "./fixtures/issue1486/primary.json";
import { bundle, compileGraph, findBundle, graphInput, id, proofFor, ranges, saved, texts } from "./issue1486Support";

const row = (name: string) => primary.find(r => r.id === name)!;
const position = (name: string) => ranges(row(name), "root.nui", "M")[0]!.from;
const definition = (index: MultiDocumentSemanticOccurrenceIndex, pos: number) =>
  queryMultiDocumentDefinition({ index, documentId: id("root.nui"), position: pos });
const roots = async (files: Record<string, string>) => Promise.all(Object.keys(files).map(file => bundle(files, file)));
const publicRename = (bundles: Awaited<ReturnType<typeof roots>>, indexes = bundles.map(b => b.index)) => {
  const b = findBundle(bundles, "root.nui");
  return planMultiDocumentRename({ index: b.index, documentId: id("root.nui"), position: b.graph.rootSource.normalizedSource.indexOf("m::M") + 3,
    newName: "Changed", reverseImporters: { status: "complete", indexes }, proveDocument: proofFor(bundles) });
};

describe("#1486 frozen saved/current transitions and atomic rejections", () => {
  it("A3: identical record shapes from distinct documents remain nominally incompatible", async () => {
    const r = row("A3");
    const good = await bundle(texts(r), "root.nui");
    const records = good.compiled.sourceLexicalNamespace!.recordSemanticAnalysis!;
    const values = [...records.valuesByStatementId.values()];
    const original = values.find(v => v.name === "r")!.typeIdentity;
    const other = values.find(v => v.name === "s")!.typeIdentity;
    expect(original).not.toBe(other);
    const document = "/issue1486/other.nui"; const declaration = "other.nui:recordDefinition:1";
    expect(other).toBe(`record-type:${document.length}:${document}${declaration.length}:${declaration}`);
    const bad = await bundle(r.states!.crossNominal!, "root.nui");
    const node = bad.graph.nodes.get(id("root.nui"))!;
    expect(node.sourceDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "record-nominal-type-mismatch", severity: "error" })]));
    expect(bad.graph.valid).toBe(false);
  });

  it("D4: missing discovery or one document's unsafe proof rejects the whole plan", async () => {
    const r = row("D4"); const bundles = await roots(texts(r)); const b = findBundle(bundles, "root.nui");
    const input = { index: b.index, documentId: id("root.nui"), position: position("D4"), newName: "Changed", proveDocument: proofFor(bundles) };
    expect(planMultiDocumentRename(input)).toEqual({ status: "rejected", reason: "incomplete-discovery" });
    expect(queryMultiDocumentReferences(input)).toBeNull();
    expect(planMultiDocumentRename({ ...input, reverseImporters: { status: "incomplete", indexes: bundles.map(b => b.index) } })).toEqual({ status: "rejected", reason: "incomplete-discovery" });
    const complete = { status: "complete" as const, indexes: bundles.map(b => b.index) };
    expect(planMultiDocumentRename({ ...input, reverseImporters: complete }).status).toBe("ok");
    for (const bad of ["root.nui", "module.nui"]) {
      expect(planMultiDocumentRename({ ...input, reverseImporters: complete, proveDocument: proof =>
        proof.source.documentId === id(bad) ? { status: "rejected" } : input.proveDocument(proof)
      })).toEqual({ status: "rejected", reason: "unsafe-edit-proof" });
    }
    expect(planMultiDocumentRename({ ...input, reverseImporters: complete, proveDocument: proof => {
      const result = input.proveDocument(proof);
      return result.status === "ok" ? { status: "ok", edits: result.edits.slice(1) } : result;
    } })).toEqual({ status: "rejected", reason: "unsafe-edit-proof" });
  });

  it("E1: saved record offset shifts; dirty Module target independently re-proves original ownership", async () => {
    const r = row("E1"); const files = r.states!.savedShift!;
    const b = await bundle(files, "root.nui");
    const dirty = await bundle({ ...files, "module.nui": r.states!.dirtyShift!["module.nui"]! }, "module.nui", 2);
    const index = buildMultiDocumentSemanticOccurrenceIndex({ graph: b.graph, documentViews: [b.view, dirty.view] });
    const result = definition(index, position("E1"));
    const from = dirty.graph.rootSource.normalizedSource.indexOf("module M") + 7;
    expect(result?.identity).toEqual({ documentId: id("module.nui"), localIdentity: "module.nui:moduleDefinition:2" });
    expect(result?.target).toEqual({ source: { kind: "root-current", documentId: id("module.nui"), sourceRevision: 2 }, range: { from, to: from + 1 } });
    const unproved = buildMultiDocumentSemanticOccurrenceIndex({ graph: b.graph, documentViews: [b.view, { ...dirty.view, occurrences: [] }] });
    expect(definition(unproved, position("E1"))).toBeNull();
    expect(b.graph.nodes.get(id("lib.nui"))!.artifact.source.normalizedSource).toBe(files["lib.nui"]);
  });

  it("E2: library/facade save invalidates transitive roots and preserves an independent root", async () => {
    const r = row("E2"); const files = texts(r); const c = new MultiDocumentGraphCoordinator();
    for (const name of ["root.nui", "module.nui", "independent.nui"]) expect((await c.rebuild(graphInput(files, name))).status).toBe("current");
    const independent = c.graphForRoot(id("independent.nui"));
    expect(new Set(c.invalidateSavedDependency(id("lib.nui")))).toEqual(new Set([id("root.nui"), id("module.nui")]));
    expect(c.graphForRoot(id("root.nui"))).toBeUndefined();
    expect(c.graphForRoot(id("module.nui"))).toBeUndefined();
    expect(c.graphForRoot(id("independent.nui"))).toBe(independent);
    const rebuilt = await c.rebuild(graphInput(r.states!.savedShift!, "root.nui", 2));
    expect(rebuilt.status).toBe("current");
    if (rebuilt.status !== "current") throw new Error("current graph missing");
    expect(definition(compileGraph(rebuilt.graph).index, position("E2"))?.target.range).toEqual(ranges(r, "module.nui", "M")[0]);
    const facadeFiles = r.states!.facade!;
    expect((await c.rebuild(graphInput(facadeFiles, "root.nui", 3))).status).toBe("current");
    expect(new Set(c.invalidateSavedDependency(id("facade.nui")))).toEqual(new Set([id("root.nui")]));
    expect((await c.rebuild(graphInput(facadeFiles, "root.nui", 4))).status).toBe("current");
    expect(c.invalidateSavedDependency(id("module.nui"))).toEqual([id("root.nui")]);
    expect(c.graphForRoot(id("independent.nui"))).toBe(independent);
  });

  it("E3: R2 publication wins over a deterministically delayed R1", async () => {
    const r = row("E3"); const files = texts(r); const c = new MultiDocumentGraphCoordinator();
    let release!: (value: SavedDependencyLoadResult) => void;
    let entered!: () => void;
    const gate = new Promise<SavedDependencyLoadResult>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const oldInput = graphInput(files, "root.nui");
    const pending = c.rebuild({ ...oldInput, loader: { async loadSavedDependency(importer, relative) {
      if (relative === "./module.nui") { entered(); return gate; }
      return oldInput.loader.loadSavedDependency(importer, relative);
    } } });
    await started;
    try {
      const current = await c.rebuild(graphInput(r.states!.root2!, "root.nui", 2));
      expect(current.status).toBe("current");
      release({ status: "loaded", snapshot: saved("module.nui", files["module.nui"]!) });
      expect(await pending).toEqual({ status: "stale" });
      if (current.status !== "current") throw new Error("missing R2");
      expect(c.graphForRoot(id("root.nui"))).toBe(current.graph);
      const b = compileGraph(current.graph);
      const pos = current.graph.rootSource.normalizedSource.indexOf("m::M") + 3;
      expect(definition(b.index, pos)?.reference.range).toEqual({ from: pos, to: pos + 1 });
      expect(definition(b.index, pos)?.target.range).toEqual(ranges(r, "module.nui", "M")[0]);
    } finally { release({ status: "failed", reason: "canceled" }); await pending; }
  });

  it("E4: incompatible saved fingerprints and stale source revision reject, exact neighbors pass", async () => {
    const r = row("E4"); const good = await roots(texts(r));
    expect(publicRename(good).status).toBe("ok");
    const changed = await bundle(r.states!.savedShift!, "root.nui");
    expect(publicRename(good, [...good.map(b => b.index), changed.index])).toEqual({ status: "rejected", reason: "stale-or-invalid" });
    const b = findBundle(good, "root.nui");
    const stale = buildMultiDocumentSemanticOccurrenceIndex({ graph: b.graph, documentViews: [{ ...b.view,
      source: { ...b.graph.rootSource, sourceRevision: 2 } }] });
    expect(stale.valid).toBe(false);
    expect(definition(stale, position("E4"))).toBeNull();
    expect(planMultiDocumentRename({ index: stale, documentId: id("root.nui"), position: position("E4"), newName: "Changed", proveDocument: proofFor(good) })).toEqual({ status: "rejected", reason: "stale-or-invalid" });
  });

  it("F1: a facade's public API collision rejects the otherwise safe cross-document Module Rename", async () => {
    const files = row("F1").states!.facadeCollision!;
    const bundles = await roots(files);
    expect(bundles.every(b => b.graph.valid && b.analysis.valid)).toBe(true);
    expect(publicRename(bundles)).toEqual({ status: "rejected", reason: "unsafe-edit-proof" });
  });

  it("F2: invalid saved graphs, private/missing/wrong-family names, and captures keep exact owners", async () => {
    const r = row("F2"); const good = await bundle(texts(r), "root.nui");
    expect(good.graph.valid).toBe(true);
    for (const state of ["private", "missing", "wrongFamily", "cycle", "invalid"] as const) {
      const b = await bundle(r.states![state]!, "root.nui");
      const errors = [...b.compiled.diagnostics, ...b.compiled.bindingIssueDiagnostics ?? []].filter(d => d.severity === "error");
      expect(b.graph.valid && b.analysis.valid && errors.length === 0, state).toBe(false);
      expect(definition(b.index, 40)).toBeNull();
      if (state === "invalid" || state === "cycle") {
        expect(b.graph.diagnostics.length).toBeGreaterThan(0);
        if (state === "invalid") expect(b.graph.diagnostics[0]!.location.source.documentId).toBe(id("root.nui"));
        else expect(new Set(b.graph.diagnostics.filter(d => d.code === "import-cycle").map(d => d.location.source.documentId))).toEqual(new Set([id("root.nui"), id("lib.nui")]));
      } else {
        expect(b.graph.nodes.get(id("root.nui"))!.sourceDiagnostics.some(d => d.severity === "error") || errors.length > 0 || !b.analysis.valid).toBe(true);
      }
    }
    const capture = await bundle(r.states!.capture!, "root.nui");
    const source = capture.graph.rootSource;
    const plan = planDslRenameEditsResult({ source, semantic: { sourceRevision: 1, compiled: capture.compiled } }, ranges(r, "root.nui", "r")[0]!.from, "renamed");
    expect(plan).toMatchObject({ status: "rejected", rejection: { reason: "same-scope-collision" } });
  });

  it("F3: exact UTF-16 query ranges and normalized-source CRLF fail-closed boundary", async () => {
    const r = row("F3"); const b = await bundle(texts(r), "root.nui");
    expect(definition(b.index, position("F3"))?.reference.range).toEqual(ranges(r, "root.nui", "M")[0]);
    const raw = b.graph.rootSource.normalizedSource.replaceAll("\n", "\r\n");
    const index = buildMultiDocumentSemanticOccurrenceIndex({ graph: b.graph, documentViews: [{ ...b.view, source: { ...b.graph.rootSource, normalizedSource: raw } }] });
    expect(index.valid).toBe(false);
    expect(definition(index, raw.indexOf("m::M") + 3)).toBeNull();
    expect(queryDslDefinition({ source: { normalizedSource: raw, sourceRevision: 1 }, position: 1, semantic: { sourceRevision: 1, compiled: b.compiled } })).toBeNull();
  });
});
