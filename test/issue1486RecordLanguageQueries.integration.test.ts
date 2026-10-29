import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDslDocument, createDslSemanticOccurrenceIndex, parseDslSnapshot, queryDslDefinition, queryDslReferences, planDslRenameEditsResult } from "@nuinuicad/nui-language";
import { applyLineSplices, buildSourceSemanticRenameSplices, isLastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { queryMultiDocumentDefinition, queryMultiDocumentReferences, planMultiDocumentRename, sourceIdentityOf } from "@nuinuicad/nui-language/workspace";
import { createRustStdioParityClient } from "./evaluationParitySupport";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import primary from "./fixtures/issue1486/primary.json";
import reducers from "./fixtures/issue1486/reducers.json";
import { bundle, findBundle, hash, id, proofFor, publicIndex, ranges, texts, type Bundle, type Case, type Range } from "./issue1486Support";

const evidence: Record<string, unknown>[] = [];
let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 120_000);
afterAll(() => { rust?.dispose(); if (process.env.ISSUE1486_RECORD) writeFileSync(process.env.ISSUE1486_RECORD, JSON.stringify(evidence, null, 2) + "\n"); });
const runtime = async (row: Case, b: Bundle, record = false) => {
  if (!row.numeric || Object.keys(row.numeric).length === 0 && !row.points) return;
  const compiled = b.compiled;
  if (!isLastGoodDslDocument(compiled)) throw new Error("invalid runtime document");
  const options = buildEvaluationOptions({ compiledDocument: compiled });
  const assert = (payload: EvaluationPayload) => {
    expect(payload.errors).toEqual([]);
    for (const [name, value] of Object.entries(row.numeric!)) {
      const binding = compiled.bindingAnalysis?.catalog.bindings.filter(item => item.name === name).at(-1);
      expect(binding, name).toBeDefined();
      expect(payload.computedScalarBindings?.find(item => item.bindingId === binding!.id)?.evaluation).toMatchObject({ status: "ok", value: { kind: "number", value } });
    }
    if (row.points) expect(payload.computedGeometry.filter(g => g.kind === "point").map(g => [g.name, g.x, g.y])).toEqual(row.points);
  };
  const reference = evaluateElementsReferencePayload(compiled.document.elements, options);
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible, `${row.id} ordinary Rust eligibility`).toBe(true);
  const production = await rust.evaluateInput(prepared.input);
  if (record) evidence.push({ case: row.id, runtime: { rustEligible: prepared.rustEligible,
    reference: { errors: reference.errors, points: reference.computedGeometry },
    rust: { errors: production.errors, points: production.computedGeometry } } });
  assert(reference);
  assert(production);
};

const legal = (b: Bundle) => {
  expect(b.graph.valid, JSON.stringify(b.graph.diagnostics)).toBe(true);
  expect(b.analysis.valid, JSON.stringify(b.analysis.diagnostics)).toBe(true);
  expect([...b.compiled.diagnostics, ...b.compiled.bindingIssueDiagnostics ?? []].filter(d => d.severity === "error")).toEqual([]);
};
const sorted = (items: unknown[]) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const location = (file: string, range: Range) => ({ documentId: id(file), range });
const minimal = (loc: { source: { documentId: string }; range: Range }) => ({ documentId: loc.source.documentId, range: loc.range });
const snapshot = (b: Bundle) => ({ source: { normalizedSource: b.graph.rootSource.normalizedSource, sourceRevision: b.graph.rootSource.sourceRevision },
  semantic: { sourceRevision: b.graph.rootSource.sourceRevision, compiled: b.compiled } });
const applyLocal = (b: Bundle, edits: readonly { from: number; to: number; expectedText: string; newText: string }[]) => {
  const source = b.graph.rootSource.normalizedSource;
  const projected = buildSourceSemanticRenameSplices(source, b.compiled, edits.map(e => ({
    statementIndex: b.compiled.statements.findIndex(s => s.physicalSpan.segments.some(p => p.from <= e.from && e.to <= p.to)),
    span: { start: 0, end: 0 }, physicalSpan: { segments: [{ from: e.from, to: e.to }], sourceRevision: b.graph.rootSource.sourceRevision },
    oldName: e.expectedText, newName: e.newText
  })));
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error(projected.reason);
  return applyLineSplices(source, projected.splices);
};

describe("#1486 frozen 24 primary source/selection oracles", () => {
  it("freezes independent UTF-16 selections and bundle identities before queries", () => {
    expect(primary.map(r => r.id).sort()).toEqual('A1 A2 A3 A4 B1 B2 B3 B4 C1 C2 C3 C4 D1 D2 D3 D4 E1 E2 E3 E4 F1 F2 F3 F4'.split(' '));
    for (const row of primary) {
      expect(hash(JSON.stringify(Object.fromEntries(Object.entries(texts(row)).sort(([a], [b]) => a.localeCompare(b)))))).toBe(row.bundleSha256);
      for (const source of Object.values(row.files)) {
        expect(hash(source.text)).toBe(source.sha256);
        expect(parseDslSnapshot({ normalizedSource: source.text, sourceRevision: 1 }).diagnostics).toEqual([]);
        for (const rs of Object.values(source.ranges)) for (const r of rs) expect(source.text.slice(r.from, r.to)).toMatch(/^\p{ID_Start}\p{ID_Continue}*$/u);
      }
    }
  });
  it.each([...primary, ...reducers] as Case[])("$id: $purpose", async (row: Case) => {
    const files = texts(row);
    const bundles = await Promise.all(Object.keys(files).map(file => bundle(files, file)));
    if (row.id === "X1" || row.id === "X2") {
      const b = bundles[0]!;
      b.compiled = compileDslDocument(files["root.nui"]!, { sourceRevision: 1, assignedStatementIds: b.graph.nodes.get(id("root.nui"))!.artifact.statementIdByStatementIndex });
    }
    bundles.forEach(legal);
    for (const b of bundles) {
      const records = b.compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
      for (const value of records?.valuesByStatementId.values() ?? []) {
        if (value.name !== "r" || value.inlineCollectionMember || !files["lib.nui"]) continue;
        const document = "/issue1486/lib.nui";
        const declaration = "lib.nui:recordDefinition:1";
        expect(value.typeIdentity).toBe(`record-type:${document.length}:${document}${declaration.length}:${declaration}`);
      }
    }
    evidence.push({ case: row.id, bundleSha256: row.bundleSha256, queries: row.targets.map(target => {
      const b = findBundle(bundles, target.file);
      const index = publicIndex(b, target.kind === "publicRecord");
      const selection = ranges(row, target.file, target.key)[0]!.from;
      const input = { index, documentId: id(target.file), position: selection,
        reverseImporters: { status: "complete" as const, indexes: bundles.map(item => publicIndex(item, target.kind === "publicRecord")) } };
      return { file: target.file, key: target.key, graphDefinition: queryMultiDocumentDefinition(input), graphReferences: queryMultiDocumentReferences(input),
        graphRename: target.kind === "publicModule" ? planMultiDocumentRename({ ...input, newName: target.newName, proveDocument: proofFor(bundles) }) : undefined, observations: ranges(row, target.file, target.key).map(r => ({
        range: r, definition: queryDslDefinition({ ...snapshot(b), position: r.from }),
        references: queryDslReferences({ ...snapshot(b), position: r.from }),
        rename: planDslRenameEditsResult(snapshot(b), r.from, target.newName),
        occurrences: createDslSemanticOccurrenceIndex(b.compiled).occurrences.filter(o => o.from === r.from && o.to === r.to)
      })) };
    }) });
    await runtime(row, findBundle(bundles, "root.nui"), true);
    for (const [file, rs] of Object.entries(row.unsupported ?? {})) {
      const b = findBundle(bundles, file);
      for (const range of rs) {
        expect(queryDslDefinition({ ...snapshot(b), position: range.from })).toBeNull();
        expect(queryDslReferences({ ...snapshot(b), position: range.from })).toBeNull();
        expect(planDslRenameEditsResult(snapshot(b), range.from, "Other").status).toBe("rejected");
      }
    }
    for (const target of row.targets) {
      const b = findBundle(bundles, target.file);
      const selectedRanges = ranges(row, target.file, target.key);
      expect(selectedRanges.length).toBeGreaterThan(0);
      if (target.kind === "local") {
        const [decl, ...refs] = selectedRanges;
        for (const [i, r] of selectedRanges.entries()) {
          const input = { ...snapshot(b), position: r.from };
          expect.soft(queryDslDefinition(input), `${row.id} local Definition ${i}`).toEqual(i === 0 ? null : { referenceRange: r, declarationRange: decl });
          expect.soft(queryDslReferences(input), `${row.id} local References ${i}`).toEqual({ declarationRange: decl, referenceRanges: refs });
          const plan = planDslRenameEditsResult(snapshot(b), r.from, target.newName);
          expect.soft(plan.status, `${row.id} safe local Rename ${i}: ${JSON.stringify(plan)}`).toBe("ok");
          if (plan.status !== "ok") continue;
          expect(plan.plan.edits).toEqual(selectedRanges.map(range => ({ ...range, expectedText: files[target.file]!.slice(range.from, range.to), newText: target.newName })));
          const edited = applyLocal(b, plan.plan.edits);
          const independentlyEdited = selectedRanges.reduceRight((s, range) => s.slice(0, range.from) + target.newName + s.slice(range.to), files[target.file]!);
          expect(edited).toBe(independentlyEdited);
          const nextFiles = { ...files, [target.file]: edited };
          const next = await bundle(nextFiles, target.file, 2);
          legal(next);
          const shifted = selectedRanges.map((range, index) => ({
            from: range.from + selectedRanges.slice(0, index).reduce((n, r) => n + target.newName.length - (r.to - r.from), 0),
            to: range.from + selectedRanges.slice(0, index).reduce((n, r) => n + target.newName.length - (r.to - r.from), 0) + target.newName.length
          }));
          expect(queryDslReferences({ ...snapshot(next), position: shifted[0]!.from })).toEqual({ declarationRange: shifted[0], referenceRanges: shifted.slice(1) });
          await runtime(row, await bundle(nextFiles, "root.nui", 2));
          expect(planDslRenameEditsResult({ ...snapshot(b), source: { ...snapshot(b).source, sourceRevision: 99 } }, r.from, target.newName).status).toBe("rejected");
          expect(planDslRenameEditsResult(snapshot(b), r.from, "invalid name").status).toBe("rejected");
        }
      } else {
        const record = target.kind === "publicRecord";
        const index = publicIndex(b, record);
        const indexes = bundles.map(item => publicIndex(item, record));
        const selection = selectedRanges[0]!;
        const declFile = 'declarationFile' in target ? target.declarationFile! : target.file;
        const declKey = 'declarationKey' in target ? target.declarationKey! : target.key;
        const declaration = ranges(row, declFile, declKey)[0]!;
        const expectedRefs = Object.keys(files).flatMap(file => ranges(row, file, target.key)
          .filter(r => file !== declFile || r.from !== declaration.from).map(r => location(file, r)));
        const result = queryMultiDocumentReferences({ index, documentId: id(target.file), position: selection.from + 1, reverseImporters: { status: "complete", indexes } });
        expect.soft(result && minimal(result.declaration)).toEqual(location(declFile, declaration));
        expect.soft(result && sorted(result.references.map(minimal))).toEqual(sorted(expectedRefs));
        if (record) {
          const def = queryMultiDocumentDefinition({ index, documentId: id(target.file), position: selection.from + 1 });
          expect.soft(def && minimal(def.target)).toEqual(location(declFile, declaration));
          // Record public authoring proof is deliberately absent: #1439 did not add it.
          expect(planMultiDocumentRename({ index, documentId: id(target.file), position: selection.from + 1,
            newName: target.newName, reverseImporters: { status: "complete", indexes }, proveDocument: proofFor(bundles) }).status).toBe("rejected");
        } else if (target.kind === "publicModule") {
          const plan = planMultiDocumentRename({ index, documentId: id(target.file), position: selection.from + 1,
            newName: target.newName, reverseImporters: { status: "complete", indexes }, proveDocument: proofFor(bundles) });
          if (row.id === "F1") expect.soft(plan.status).toBe("rejected");
          else {
            expect.soft(plan.status, JSON.stringify(plan)).toBe("ok");
            if (plan.status === "ok") {
              expect(sorted(plan.plan.documents.flatMap(d => d.edits.map(e => location(String(d.source.documentId).split('/').at(-1)!, { from: e.from, to: e.to }))))).toEqual(sorted([location(declFile, declaration), ...expectedRefs]));
              const next = { ...files };
              for (const d of plan.plan.documents) {
                const file = String(d.source.documentId).split('/').at(-1)!;
                const owner = findBundle(bundles, file);
                expect(d.source).toEqual(sourceIdentityOf(owner.graph.rootSource));
                next[file] = applyLocal(owner, d.edits);
              }
              const after = await Promise.all(Object.keys(next).map(file => bundle(next, file, 2)));
              after.forEach(legal);
              await runtime(row, findBundle(after, "root.nui"));
              const caller = findBundle(bundles, "root.nui");
              const reference = ranges(row, "root.nui", "M")[0];
              if (reference) expect(planMultiDocumentRename({ index: caller.index, documentId: id("root.nui"), position: reference.from,
                newName: target.newName, reverseImporters: { status: "complete", indexes }, proveDocument: proofFor(bundles) })).toEqual(plan);
              const afterCaller = findBundle(after, "root.nui");
              const from = next["root.nui"]!.indexOf(`m::${target.newName}`) + 3;
              const afterDef = queryMultiDocumentDefinition({ index: afterCaller.index, documentId: id("root.nui"), position: from });
              expect(afterDef?.target.source.documentId).toBe(id("module.nui"));
              expect(afterDef?.target.range).toEqual({ from: declaration.from, to: declaration.from + target.newName.length });
              expect(afterDef?.reference.range).toEqual({ from, to: from + target.newName.length });
            }
          }
        }
      }
    }
  }, 30_000);
});
