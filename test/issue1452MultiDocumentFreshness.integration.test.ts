import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileDslDocument, createModuleRuntimeContext, parseDslSnapshot } from "@nuinuicad/nui-language";
import { reconcileStatements } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph,
  buildMultiDocumentSemanticOccurrenceIndex, createMultiDocumentModuleRenameDocumentProof,
  documentIdFromHost, moduleDeclarationContributor, MultiDocumentGraphCoordinator,
  planMultiDocumentRename, projectDslSemanticDocumentView,
  projectMultiDocumentModuleSemanticDocumentView, queryMultiDocumentDefinition,
  queryMultiDocumentReferences, savedSourceFingerprintFromHost, SavedDocumentArtifactCache,
  sourceIdentityOf,
  type DependencySavedSourceSnapshot, type DocumentId, type MultiDocumentImportGraph,
  type MultiDocumentRenameDocumentProof, type MultiDocumentSemanticOccurrenceIndex,
  type MultiDocumentSourceSnapshot, type RootCurrentSourceSnapshot, type SavedDependencyLoadResult
} from "@nuinuicad/nui-language/workspace";
import frozen from "./fixtures/issue1452/frozen.json";

type Key = keyof typeof frozen.sources;
type Range = { from: number; to: number };
const sources = frozen.sources;
const range = (key: Key, word = "Pocket", occurrence = 0): Range =>
  (sources[key].ranges as Record<string, Range[]>)[word]![occurrence]!;
const id = (key: Key) => documentIdFromHost(sources[key].documentId);
const current = (key: Key): RootCurrentSourceSnapshot => ({
  kind: "root-current", documentId: id(key), normalizedSource: sources[key].text,
  sourceRevision: sources[key].sourceRevision
});
const saved = (key: Key): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved", documentId: id(key), normalizedSource: sources[key].text,
  savedSourceFingerprint: savedSourceFingerprintFromHost(sources[key].savedSourceFingerprint)
});
const lineage: Partial<Record<Key, Key>> = {
  lib2: "lib1", libRenamed: "lib2", libDirty: "lib2", libCapture: "lib1",
  root2: "root1", facade2: "facade1", facadeRenamed: "facade2",
  chain2: "chain1", chainRenamed: "chain2"
};
// Only the canonical reconciler allocates/re-proves identities. This allocator
// makes its opaque fresh IDs deterministic; it does not resolve declarations.
const reconciled = new Map<Key, ReturnType<typeof reconcileStatements>>();
const parsed = (key: Key) => parseDslSnapshot({ normalizedSource: sources[key].text, sourceRevision: sources[key].sourceRevision });
const statementIds = (key: Key): ReturnType<typeof reconcileStatements>["assignedIds"] => {
  const existing = reconciled.get(key);
  if (existing) return existing.assignedIds;
  const before = lineage[key];
  const counters = new Map<string, number>();
  const result = reconcileStatements({
    oldStatements: before ? parsed(before).statements : [],
    oldLines: before ? sources[before].text.split("\n") : [],
    oldElementIds: new Map(), oldStatementIds: before ? statementIds(before) : new Map(),
    newStatements: parsed(key).statements, newLines: sources[key].text.split("\n")
  }, { createStatementId: (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${key}:${kind}:${next}`;
  } });
  reconciled.set(key, result);
  return result.assignedIds;
};
const pocketIdentity = { documentId: documentIdFromHost("library"), localIdentity: "lib1:moduleDefinition:1" };
const keyForSnapshot = (source: MultiDocumentSourceSnapshot): Key => {
  const key = (Object.keys(sources) as Key[]).find((key) =>
    id(key) === source.documentId && sources[key].text === source.normalizedSource);
  if (!key) throw new Error("unfrozen snapshot");
  return key;
};
const loader = (keys: Key[], failures = new Map<string, SavedDependencyLoadResult>()) => ({
  async loadSavedDependency(_importer: DocumentId, path: string): Promise<SavedDependencyLoadResult> {
    const failure = failures.get(path);
    if (failure) return failure;
    const name = path.slice(2, -4);
    const key = keys.find((key) => sources[key].documentId === name);
    return key ? { status: "loaded", snapshot: saved(key) } : { status: "failed", reason: "missing" };
  }
});
const input = (root: Key, dependencies: Key[]) => ({
  root: current(root), loader: loader(dependencies), declarationContributors: [moduleDeclarationContributor],
  rootStatementIdByStatementIndex: statementIds(root),
  savedDependencyStatementIdsForDocument: (source: DependencySavedSourceSnapshot) => statementIds(keyForSnapshot(source))
});
const graph = (root: Key, dependencies: Key[], cache?: SavedDocumentArtifactCache) =>
  buildMultiDocumentImportGraph({ ...input(root, dependencies), cache });
const node = (graph: MultiDocumentImportGraph, key: Key) => graph.nodes.get(id(key))!;
const compile = (graph: MultiDocumentImportGraph) => {
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const artifact = graph.nodes.get(graph.rootDocumentId)!.artifact;
  const compiled = compileDslDocument(graph.rootSource.normalizedSource, {
    preparsed: artifact.parsed, assignedStatementIds: artifact.statementIdByStatementIndex,
    sourceRevision: graph.rootSource.sourceRevision, moduleRuntimeContext: context
  });
  expect(analysis.valid, "legal Module semantics").toBe(true);
  expect(compiled.diagnostics.filter((d) => d.severity === "error"), "legal production compile").toEqual([]);
  const view = projectMultiDocumentModuleSemanticDocumentView({ source: graph.rootSource, compiled });
  expect(view.valid).toBe(true);
  return { graph, analysis, compiled, view, index: buildMultiDocumentSemanticOccurrenceIndex({ graph, documentViews: [view] }) };
};
type Bundle = ReturnType<typeof compile>;
const bundle = async (root: Key, dependencies: Key[]) => compile(await graph(root, dependencies));
const indexWith = (root: Bundle, ...others: Bundle[]) => buildMultiDocumentSemanticOccurrenceIndex({
  graph: root.graph, documentViews: [root.view, ...others.map((item) => item.view)]
});
const proofFor = (root: Bundle, ...others: Bundle[]) => createMultiDocumentModuleRenameDocumentProof({
  graph: root.graph, analysis: root.analysis, graphs: others.map((item) => item.graph),
  compiledByDocument: new Map([root, ...others].map((item) => [item.graph.rootDocumentId, item.compiled]))
});
const location = (source: MultiDocumentSourceSnapshot, range: Range) => ({ source: sourceIdentityOf(source), range });
const definition = (index: MultiDocumentSemanticOccurrenceIndex, key: Key, word = "Pocket") => queryMultiDocumentDefinition({
  index, documentId: id(key), position: range(key, word).from + 1
});
const references = (index: MultiDocumentSemanticOccurrenceIndex, key: Key, indexes: MultiDocumentSemanticOccurrenceIndex[], word = "Pocket") => queryMultiDocumentReferences({
  index, documentId: id(key), position: range(key, word).from + 1,
  reverseImporters: { status: "complete", indexes }
});
const rename = (index: MultiDocumentSemanticOccurrenceIndex, key: Key, proveDocument: MultiDocumentRenameDocumentProof,
  indexes: MultiDocumentSemanticOccurrenceIndex[] = [], newName = "Pouch") => planMultiDocumentRename({
  index, documentId: id(key), position: range(key).from + 1, newName, proveDocument,
  reverseImporters: { status: "complete", indexes }
});
const expectPlan = (result: ReturnType<typeof rename>, expected: [MultiDocumentSourceSnapshot, Range[]][], newName = "Pouch") => {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error(`unexpected rejection: ${result.reason}`);
  expect(result.plan.identity).toEqual(pocketIdentity);
  expect(result.plan.documents).toEqual(expected.map(([source, ranges]) => ({
    source: sourceIdentityOf(source), edits: ranges.map((r) => ({ ...r, expectedText: "Pocket", newText: newName }))
  })).sort((a, b) => String(a.source.documentId).localeCompare(String(b.source.documentId))));
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const installed = async (coordinator: MultiDocumentGraphCoordinator, root: Key, dependencies: Key[]) => {
  const result = await coordinator.rebuild(input(root, dependencies));
  expect(result.status).toBe("current");
  if (result.status !== "current") throw new Error("expected current");
  return result.graph;
};

// Replay all accepted plans against physical source strings, then rebuild every
// participating root. Expected whole outputs and ranges come from frozen text.
const replayPlan = async (result: ReturnType<typeof rename>, bundles: Bundle[]) => {
  if (result.status !== "ok") throw new Error("expected complete replay plan");
  const afterByDocument = new Map<DocumentId, RootCurrentSourceSnapshot>();
  const idsByDocument = new Map<DocumentId, ReadonlyMap<number, string>>();
  for (const before of bundles) {
    const source = before.graph.rootSource;
    const document = result.plan.documents.find((d) => d.source.documentId === source.documentId);
    if (!document) throw new Error("plan omitted participant");
    expect(document.source).toEqual(sourceIdentityOf(source));
    let text = source.normalizedSource;
    for (const edit of [...document.edits].reverse()) {
      expect(text.slice(edit.from, edit.to)).toBe(edit.expectedText);
      text = text.slice(0, edit.from) + edit.newText + text.slice(edit.to);
    }
    expect(text).toBe(source.normalizedSource.replaceAll("Pocket", "Pouch"));
    const after = { ...source, normalizedSource: text, sourceRevision: source.sourceRevision + 1 };
    afterByDocument.set(source.documentId, after);
    const newParsed = parseDslSnapshot({ normalizedSource: text, sourceRevision: after.sourceRevision });
    const artifact = before.graph.nodes.get(source.documentId)!.artifact;
    idsByDocument.set(source.documentId, reconcileStatements({
      oldStatements: artifact.parsed.statements, oldLines: source.normalizedSource.split("\n"),
      oldElementIds: new Map(), oldStatementIds: artifact.statementIdByStatementIndex,
      newStatements: newParsed.statements, newLines: text.split("\n")
    }).assignedIds);
  }
  const replayed: Bundle[] = [];
  for (const source of afterByDocument.values()) {
    const g = await buildMultiDocumentImportGraph({
      root: source, declarationContributors: [moduleDeclarationContributor],
      rootStatementIdByStatementIndex: idsByDocument.get(source.documentId),
      savedDependencyStatementIdsForDocument: (dependency) => idsByDocument.get(dependency.documentId),
      loader: { async loadSavedDependency(_importer, path) {
        const target = afterByDocument.get(documentIdFromHost(path.slice(2, -4)));
        if (!target) return { status: "failed", reason: "missing" };
        return { status: "loaded", snapshot: { kind: "dependency-saved", documentId: target.documentId,
          normalizedSource: target.normalizedSource,
          savedSourceFingerprint: savedSourceFingerprintFromHost(`sha256:${createHash("sha256").update(target.normalizedSource).digest("hex")}`) } };
      } }
    });
    const replayedBundle = compile(g);
    replayed.push(replayedBundle);
    const key = keyForSnapshot(bundles.find((b) => b.graph.rootDocumentId === source.documentId)!.graph.rootSource);
    if (source.documentId === id("lib1")) {
      const marker = g.nodes.get(source.documentId)!.artifact.parsed.statements.findIndex((s) => s.kind === "typedDeclaration");
      expect(g.nodes.get(source.documentId)!.artifact.statementIdByStatementIndex.get(marker)).toBe("lib1:typedDeclaration:1");
      expect(source.normalizedSource).toContain("const marker: number = 7");
    } else {
      expect(g.nodes.get(source.documentId)!.artifact.imports[0]?.identity).toEqual({ documentId: source.documentId, localIdentity: `${lineage[key] ?? key}:import:1` });
      const found = queryMultiDocumentDefinition({ index: replayedBundle.index, documentId: source.documentId, position: range(key).from + 1 });
      const libraryBefore = bundles.find((b) => b.graph.rootDocumentId === id("lib1"))!;
      const libraryKey = keyForSnapshot(libraryBefore.graph.rootSource);
      const libraryAfter = g.nodes.get(id("lib1"))!.artifact.source;
      expect(found).toMatchObject({ identity: pocketIdentity, target: location(libraryAfter, { from: range(libraryKey).from, to: range(libraryKey).from + 5 }) });
    }
  }
  const defining = replayed.find((b) => b.graph.rootDocumentId === id("lib1"))!;
  const libraryKey = keyForSnapshot(bundles.find((b) => b.graph.rootDocumentId === id("lib1"))!.graph.rootSource);
  const refs = queryMultiDocumentReferences({ index: defining.index, documentId: id("lib1"), position: range(libraryKey).from + 1,
    reverseImporters: { status: "complete", indexes: replayed.map((b) => b.index) } });
  expect(refs?.identity).toEqual(pocketIdentity);
  expect(refs?.references).toEqual(bundles.filter((b) => b.graph.rootDocumentId !== id("lib1")).map((b) => {
    const key = keyForSnapshot(b.graph.rootSource);
    return location(afterByDocument.get(b.graph.rootDocumentId)!, { from: range(key).from, to: range(key).from + 5 });
  }).sort((a, b) => String(a.source.documentId).localeCompare(String(b.source.documentId))));
};

describe("#1452 frozen multi-document freshness sequences", () => {
  it("prevalidates frozen syntax, hashes, UTF-16 offsets, and reconciler identity inheritance", () => {
    for (const [key, source] of Object.entries(sources) as [Key, typeof sources[Key]][]) {
      expect(createHash("sha256").update(source.text).digest("hex")).toBe(source.sha256);
      expect(parsed(key).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      for (const [word, ranges] of Object.entries(source.ranges)) {
        for (const r of ranges) expect(source.text.slice(r.from, r.to)).toBe(word);
      }
      statementIds(key);
    }
    for (const key of ["lib1", "lib2", "libRenamed", "libDirty"] as Key[]) {
      const declaration = parsed(key).statements.findIndex((s) => s.kind === "moduleDefinition");
      expect(statementIds(key).get(declaration)).toBe(pocketIdentity.localIdentity);
    }
    expect(frozen.sequences.map((s) => s.id)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "Q1", "Q2", "Q3", "Q4", "A1"]);
  });

  it("T1: newer R2 wins when R1 finishes late", async () => {
    const coordinator = new MultiDocumentGraphCoordinator();
    const gate = deferred<SavedDependencyLoadResult>();
    const entered = deferred<void>();
    const old = coordinator.rebuild({ ...input("root1", []), loader: {
      loadSavedDependency: () => { entered.resolve(); return gate.promise; }
    } });
    await entered.promise;
    try {
      const fresh = await installed(coordinator, "root2", ["lib2"]);
      gate.resolve({ status: "loaded", snapshot: saved("lib1") });
      expect(await old).toEqual({ status: "stale" });
      expect(coordinator.graphForRoot(id("root2"))).toBe(fresh);
      expect(fresh.rootSource).toEqual(current("root2"));
      expect(fresh.dependencyFingerprints.get(id("lib2"))).toBe(saved("lib2").savedSourceFingerprint);
      compile(fresh);
    } finally { gate.resolve({ status: "failed", reason: "canceled" }); await old; }
  });

  it("T2: saving a renamed declaration replaces the exact artifact and ranges", async () => {
    const coordinator = new MultiDocumentGraphCoordinator();
    const before = await installed(coordinator, "importOnly", ["lib1"]);
    expect(node(before, "lib1").publicApi.publicEntriesByName.get("Pocket")?.declaration).toEqual(location(saved("lib1"), range("lib1")));
    expect(coordinator.invalidateSavedDependency(id("lib1"))).toEqual([id("importOnly")]);
    const after = await installed(coordinator, "importOnly", ["libRenamed"]);
    expect(after.rootSource).toEqual(before.rootSource);
    expect(node(after, "libRenamed").artifact).not.toBe(node(before, "lib1").artifact);
    expect(after.dependencyFingerprints.get(id("lib1"))).toBe(saved("libRenamed").savedSourceFingerprint);
    expect(node(after, "libRenamed").publicApi.publicEntriesByName.has("Pocket")).toBe(false);
    expect(node(after, "libRenamed").publicApi.publicEntriesByName.get("Pouch")).toMatchObject({ identity: pocketIdentity, declaration: location(saved("libRenamed"), range("libRenamed", "Pouch")) });
    compile(after);
    expect(node(before, "lib1").publicApi.publicEntriesByName.has("Pocket")).toBe(true); // historical snapshot
  });

  it("T3: transitive invalidation preserves original re-export identity or fails explicitly", async () => {
    const coordinator = new MultiDocumentGraphCoordinator();
    const first = await installed(coordinator, "chain1", ["facade1", "lib1"]);
    expect(first.edges.map((e) => [e.importerDocumentId, e.targetDocumentId, e.status])).toEqual([
      [id("chain1"), id("facade1"), "resolved"], [id("facade1"), id("lib1"), "resolved"]
    ]);
    compile(first);
    expect(coordinator.invalidateSavedDependency(id("lib1"))).toEqual([id("chain1")]);
    expect(coordinator.graphForRoot(id("chain1"))).toBeUndefined();
    const fresh = await installed(coordinator, "chain1", ["facade2", "lib2"]);
    expect(node(fresh, "facade2").publicApi.publicEntriesByName.get("Pocket")).toMatchObject({ identity: pocketIdentity, declaration: location(saved("lib2"), range("lib2")) });
    const compiled = compile(fresh);
    expect(definition(compiled.index, "chain1")?.target).toEqual(location(saved("lib2"), range("lib2")));
    coordinator.invalidateSavedDependency(id("lib1"));
    const invalid = await installed(coordinator, "chain1", ["facade2", "libRenamed"]);
    expect(invalid.valid).toBe(false);
    expect(node(invalid, "facade2").publicApiDiagnostics.length).toBeGreaterThan(0);
    expect(invalid.diagnostics.map((d) => [d.code, d.location])).toEqual([
      ["import-invalid-dependency", location(current("chain1"), sources.chain1.imports[0]!)]
    ]);
  });

  it("T4: shared exact artifacts and selective installed-root invalidation", async () => {
    const coordinator = new MultiDocumentGraphCoordinator();
    const a = await installed(coordinator, "root1", ["lib1"]);
    const b = await installed(coordinator, "rootB", ["lib1"]);
    const c = await installed(coordinator, "independent", []);
    expect(node(a, "lib1").artifact).toBe(node(b, "lib1").artifact);
    [a, b, c].forEach(compile);
    expect(coordinator.invalidateSavedDependency(id("lib1"))).toEqual([id("root1"), id("rootB")]);
    expect(coordinator.graphForRoot(id("root1"))).toBeUndefined();
    expect(coordinator.graphForRoot(id("rootB"))).toBeUndefined();
    expect(coordinator.graphForRoot(id("independent"))).toBe(c);
    for (const root of ["root1", "rootB"] as Key[]) {
      const fresh = await installed(coordinator, root, ["lib2"]);
      expect(fresh.dependencyFingerprints.get(id("lib2"))).toBe(saved("lib2").savedSourceFingerprint);
      compile(fresh);
    }
    expect(coordinator.graphForRoot(id("independent"))).toBe(c);
  });

  it("T5: invalid -> valid -> invalid never falls back to last good semantics", async () => {
    const cache = new SavedDocumentArtifactCache();
    for (const reason of ["missing", "unreadable"] as const) {
      const g = await buildMultiDocumentImportGraph({ ...input("importOnly", []), cache,
        loader: loader([], new Map([["./library.nui", { status: "failed", reason }]])) });
      expect(g.valid).toBe(false);
      expect(g.diagnostics.map((d) => [d.code, d.location])).toEqual([
        [`import-${reason}`, location(current("importOnly"), sources.importOnly.imports[0]!)]
      ]);
    }
    for (const key of ["libInvalid", "lib1", "libInvalid"] as Key[]) {
      const g = await graph("importOnly", [key], cache);
      expect(g.valid).toBe(key === "lib1");
      expect(g.dependencyFingerprints.get(id(key))).toBe(saved(key).savedSourceFingerprint);
      if (key === "lib1") compile(g);
      else {
        expect(g.nodes.has(id(key))).toBe(false);
        expect(g.diagnostics.map((d) => [d.code, d.location])).toEqual([
          ["import-invalid-source", location(current("importOnly"), sources.importOnly.imports[0]!)]
        ]);
      }
    }
  });

  it("T6: incompatible same-DocumentId paths reject; same fingerprint control passes", async () => {
    for (const mismatch of [true, false]) {
      const ordinary = loader(["left", "right", "lib1"]);
      const g = await buildMultiDocumentImportGraph({ ...input("diamond", []), loader: {
        async loadSavedDependency(importer, path) {
          return mismatch && importer === id("right") && path === "./library.nui"
            ? { status: "loaded", snapshot: saved("lib2") } : ordinary.loadSavedDependency(importer, path);
        }
      } });
      expect(g.valid).toBe(!mismatch);
      if (mismatch) {
        expect(g.diagnostics.map((d) => [d.code, d.location])).toEqual([
          ["import-load-stale", location(saved("right"), sources.right.imports[0]!)],
          ["import-invalid-dependency", location(current("diamond"), sources.diamond.imports[1]!)]
        ]);
        expect(g.diagnostics[0]?.relatedLocations).toEqual([location(saved("left"), sources.left.imports[0]!)]);
      } else { expect(g.nodes.size).toBe(4); compile(g); }
    }
  });

  it("Q1: dirty current Definition requires re-proven semantic identity and exact UTF-16 range", async () => {
    const root = await bundle("root1", ["lib1"]);
    expect(definition(root.index, "root1")).toMatchObject({ identity: pocketIdentity, target: location(saved("lib1"), range("lib1")) });
    const dirty = await bundle("libDirty", []);
    expect(definition(indexWith(root, dirty), "root1")).toMatchObject({ identity: pocketIdentity, target: location(current("libDirty"), range("libDirty")) });
    const generic = projectDslSemanticDocumentView({ source: current("libDirty"), compiled: dirty.compiled });
    expect(generic.valid).toBe(true);
    const missingProof = buildMultiDocumentSemanticOccurrenceIndex({ graph: root.graph, documentViews: [root.view, { ...dirty.view, valid: false }] });
    expect(definition(missingProof, "root1")).toBeNull();
    const other = await bundle("libOther", []);
    expect(definition(indexWith(root, other), "root1")).toBeNull();
    const stale = projectMultiDocumentModuleSemanticDocumentView({ source: current("libDirty"), compiled: (await bundle("lib1", [])).compiled });
    expect(stale.valid).toBe(false);
    expect(definition(buildMultiDocumentSemanticOccurrenceIndex({ graph: root.graph, documentViews: [root.view, stale] }), "root1")).toBeNull();
  });

  it("Q2: re-export update has exact complete deduplicated references and rejects old indexes", async () => {
    const old = await bundle("chain1", ["facade1", "lib1"]);
    const oldLibrary = await bundle("lib1", []);
    const oldFacade = await bundle("facade1", ["lib1"]);
    expect(references(oldLibrary.index, "lib1", [old.index, oldFacade.index])?.references).toEqual([
      location(current("facade1"), range("facade1")), location(current("chain1"), range("chain1"))
    ]);
    const fresh = await bundle("chainRenamed", ["facadeRenamed", "libRenamed"]);
    const library = await bundle("libRenamed", []);
    const facade = await bundle("facadeRenamed", ["libRenamed"]);
    expect(definition(fresh.index, "chainRenamed", "Pouch")).toMatchObject({ identity: pocketIdentity, target: location(saved("libRenamed"), range("libRenamed", "Pouch")) });
    const exact = references(library.index, "libRenamed", [fresh.index, facade.index, fresh.index, facade.index], "Pouch");
    expect(exact?.identity).toEqual(pocketIdentity);
    expect(exact?.declaration).toEqual(location(current("libRenamed"), range("libRenamed", "Pouch")));
    expect(exact?.references).toEqual([
      location(current("facadeRenamed"), range("facadeRenamed", "Pouch")), location(current("chainRenamed"), range("chainRenamed", "Pouch"))
    ]);
    expect(queryMultiDocumentReferences({ index: library.index, documentId: id("libRenamed"), position: range("libRenamed", "Pouch").from + 1, reverseImporters: { status: "incomplete" } })).toBeNull();
    expect(references(library.index, "libRenamed", [fresh.index, old.index], "Pouch")).toBeNull();
    const oldOtherRoot = await bundle("rootB", ["lib1"]);
    // Both saved versions are independently present; the current owner cannot
    // erase their incompatibility from the reverse-discovery universe.
    expect(references(library.index, "libRenamed", [fresh.index, oldOtherRoot.index], "Pouch")).toBeNull();
  });

  it("Q3: exact current rename proofs are atomic and accepted edits physically recompile", async () => {
    const root = await bundle("root1", ["lib1"]);
    const library = await bundle("lib1", []);
    const initial = indexWith(root, library);
    const firstPlan = rename(initial, "root1", proofFor(root, library));
    expectPlan(firstPlan, [[current("lib1"), [range("lib1")]], [current("root1"), [range("root1")]]]);
    await replayPlan(firstPlan, [root, library]);
    const dirty = await bundle("libDirty", []);
    const fresh = indexWith(root, dirty);
    expect(rename(fresh, "root1", proofFor(root, library)).status).toBe("rejected");
    const proof = proofFor(root, dirty);
    const plan = rename(fresh, "root1", proof);
    expectPlan(plan, [[current("libDirty"), [range("libDirty")]], [current("root1"), [range("root1")]]]);
    expect(rename(fresh, "root1", () => ({ status: "rejected" })).status).toBe("rejected");
    expect(rename(fresh, "root1", (request) => request.source.documentId === id("root1") ? { status: "ok", edits: [] } : proof(request)).status).toBe("rejected");
    const capture = await bundle("libCapture", []);
    const captureRoot = await bundle("root1", ["libCapture"]);
    expect(rename(indexWith(captureRoot, capture), "root1", proofFor(captureRoot, capture), [], "Bag").status).toBe("rejected");
    await replayPlan(plan, [root, dirty]);
  });

  it("Q4: composed freshness has coherent queries under both deterministic schedules", async () => {
    for (const late of [true, false]) {
      const coordinator = new MultiDocumentGraphCoordinator();
      const gate = deferred<SavedDependencyLoadResult>();
      const entered = deferred<void>();
      const old = coordinator.rebuild({ ...input("root1", []), loader: { loadSavedDependency: () => { entered.resolve(); return gate.promise; } } });
      await entered.promise;
      try {
        if (!late) { gate.resolve({ status: "loaded", snapshot: saved("lib1") }); expect((await old).status).toBe("current"); }
        const freshGraph = await installed(coordinator, "root2", ["lib2"]);
        const fresh = compile(freshGraph);
        const dirty = await bundle("libDirty", []);
        const index = indexWith(fresh, dirty);
        if (late) { gate.resolve({ status: "loaded", snapshot: saved("lib1") }); expect((await old).status).toBe("stale"); }
        expect(coordinator.graphForRoot(id("root2"))).toBe(freshGraph);
        expect(freshGraph.rootSource).toEqual(current("root2"));
        expect(freshGraph.dependencyFingerprints.get(id("lib2"))).toBe(saved("lib2").savedSourceFingerprint);
        expect(definition(index, "root2")).toMatchObject({ identity: pocketIdentity, target: location(current("libDirty"), range("libDirty")) });
        expect(references(index, "root2", [index, dirty.index])?.references).toEqual([location(current("root2"), range("root2"))]);
        const plan = rename(index, "root2", proofFor(fresh, dirty));
        expectPlan(plan, [[current("libDirty"), [range("libDirty")]], [current("root2"), [range("root2")]]]);
        await replayPlan(plan, [fresh, dirty]);
      } finally { gate.resolve({ status: "failed", reason: "canceled" }); await old; }
    }
  });

  it("A1: current view cannot mask incompatible saved reverse-importer snapshots", async () => {
    const a = await bundle("root1", ["lib1"]);
    const dirty = await bundle("libDirty", []);
    for (const mismatch of [true, false]) {
      const b = await bundle("rootB", [mismatch ? "lib2" : "lib1"]);
      const indexes = [b.index, dirty.index];
      const refs = references(a.index, "root1", indexes);
      if (mismatch) expect.soft(refs).toBeNull();
      else expect(refs?.references).toEqual([
        location(current("root1"), range("root1")), location(current("rootB"), range("rootB"))
      ]);
      const proof = proofFor(a, b, dirty);
      const result = rename(a.index, "root1", proof, indexes);
      if (mismatch) expect.soft(result).toEqual({ status: "rejected", reason: "stale-or-invalid" });
      else {
        expectPlan(result, [[current("libDirty"), [range("libDirty")]],
          [current("root1"), [range("root1")]], [current("rootB"), [range("rootB")]]]);
        await replayPlan(result, [a, b, dirty]);
      }
      if (mismatch) {
        // Overlay both graphs before discovery as well; saved evidence must
        // still be checked even after sourceByDocument discarded saved ranges.
        expect(references(indexWith(a, dirty), "root1", [indexWith(b, dirty)])).toBeNull();
      }
    }
  });


  it("sensitivity: frozen oracles detect stale owners, identities, references, and partial edits", async () => {
    const root = await bundle("root2", ["lib2"]);
    const dirty = await bundle("libDirty", []);
    const index = indexWith(root, dirty);
    const expectedDefinition = { identity: pocketIdentity,
      reference: location(current("root2"), range("root2")),
      target: location(current("libDirty"), range("libDirty")) };
    const actual = definition(index, "root2");
    expect(actual).toEqual(expectedDefinition);
    expect(() => expect({ ...actual, target: location(saved("lib1"), range("lib1")) }).toEqual(expectedDefinition)).toThrow();
    expect(() => expect({ ...actual, identity: { ...pocketIdentity, documentId: id("facade1") } }).toEqual(expectedDefinition)).toThrow();
    expect(() => expect(root.graph.dependencyFingerprints.get(id("lib2"))).toBe(saved("lib1").savedSourceFingerprint)).toThrow();
    expect(() => expect({ status: "current", graph: root.graph }).toEqual({ status: "stale" })).toThrow();
    const expectedRefs = [location(current("root2"), range("root2"))];
    const refs = references(index, "root2", [dirty.index]);
    expect(refs?.references).toEqual(expectedRefs);
    expect(() => expect([]).toEqual(expectedRefs)).toThrow();
    expect(() => expect([...expectedRefs, ...expectedRefs]).toEqual(expectedRefs)).toThrow();
    const plan = rename(index, "root2", proofFor(root, dirty));
    const expectedPlan: [MultiDocumentSourceSnapshot, Range[]][] = [
      [current("libDirty"), [range("libDirty")]], [current("root2"), [range("root2")]]
    ];
    expectPlan(plan, expectedPlan);
    if (plan.status !== "ok") throw new Error("expected sensitive plan");
    const partial = { ...plan, plan: { ...plan.plan, documents: plan.plan.documents.slice(0, 1) } };
    expect(() => expectPlan(partial, expectedPlan)).toThrow();
    await replayPlan(plan, [root, dirty]);
  });

});
