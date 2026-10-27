import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileDslDocument, createDslSemanticOccurrenceIndex, dslSemanticIdentityKey,
  parseDslSnapshot, planDslRenameEditsResult, queryDslRenameTarget,
  type DslRenameEdit, type DslRenameSnapshot
} from "@nuinuicad/nui-language";
import {
  applyLineSplices, buildSourceSemanticRenameSplices, compileCanonicalText, isLastGoodDslDocument,
  type LastGoodDslDocument
} from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { createRustStdioParityClient } from "./evaluationParitySupport";
import cases from "./fixtures/issue1448/cases.json";
import frozen from "./fixtures/issue1448/freeze.json";
import controls from "./fixtures/issue1448/controls.json";
import controlFreeze from "./fixtures/issue1448/controls-freeze.json";
const frozenRows = [...frozen.cases, ...controlFreeze.cases];

type Case = typeof cases[number] | typeof controls[number];
const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const compile = (row: Case) => {
  const preparsed = parseDslSnapshot({ normalizedSource: row.source, sourceRevision: 1 });
  const ids = new Map(preparsed.statements.map((_, index) => [index, `hunt:${row.id}:${index}`]));
  const compiled = compileDslDocument(row.source, { preparsed, assignedStatementIds: ids, assignedElementIds: ids });
  if (!isLastGoodDslDocument(compiled)) throw new Error(`${row.id}: no valid document`);
  return compiled;
};
const snapshot = (source: string, compiled: LastGoodDslDocument): DslRenameSnapshot => ({
  source: { normalizedSource: source, sourceRevision: compiled.statementMap.sourceRevision },
  semantic: { sourceRevision: compiled.statementMap.sourceRevision, compiled }
});
const diagnostics = (compiled: LastGoodDslDocument) => [
  ...compiled.diagnostics, ...compiled.bindingIssueDiagnostics ?? []
].filter((diagnostic) => diagnostic.severity === "error");

// Apply the returned exact plan through the production physical-span splice boundary.
// No occurrence search or handwritten textual rename supplies these entries.
const applyPlan = (source: string, compiled: LastGoodDslDocument, edits: readonly DslRenameEdit[]) => {
  const projected = buildSourceSemanticRenameSplices(source, compiled, edits.map((edit) => ({
    statementIndex: compiled.statements.findIndex((statement) =>
      statement.physicalSpan.segments.some((segment) => edit.from >= segment.from && edit.to <= segment.to)),
    span: { start: 0, end: 0 },
    physicalSpan: { segments: [{ from: edit.from, to: edit.to }], sourceRevision: compiled.statementMap.sourceRevision },
    oldName: edit.expectedText,
    newName: edit.newText
  })));
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error(projected.reason);
  return applyLineSplices(source, projected.splices);
};
const shifted = (offset: number, edits: readonly DslRenameEdit[]) => offset + edits
  .filter((edit) => edit.to <= offset).reduce((delta, edit) => delta + edit.newText.length - (edit.to - edit.from), 0);
const occurrences = (compiled: LastGoodDslDocument) => createDslSemanticOccurrenceIndex(compiled).occurrences
  .map((occurrence) => ({ from: occurrence.from, to: occurrence.to, kind: occurrence.kind, identity: dslSemanticIdentityKey(occurrence.identity) }))
  .sort((a, b) => a.from - b.from || a.to - b.to || a.identity.localeCompare(b.identity));
const dependencies = (compiled: LastGoodDslDocument) => compiled.typedDependencyGraph?.edges.map((edge) => ({
  kind: edge.kind, from: { kind: edge.from.kind, id: edge.from.id }, to: { kind: edge.to.kind, id: edge.to.id }, requiredness: edge.requiredness, reason: edge.reason
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const instanceOrigins = (compiled: LastGoodDslDocument) => [...compiled.moduleMaterialization?.originByRuntimeElementId ?? []]
  .map(([id, origin]) => ({ id, source: origin.sourceStatementId, instances: origin.instancePath }));

const assertOracle = (row: Case, compiled: LastGoodDslDocument, payload: EvaluationPayload, renamed: boolean) => {
  expect(payload.errors, `${row.id} evaluation diagnostics`).toEqual([]);
  const oldName = row.expectedEdits[0].expectedText;
  const normalize = (name: string) => name.split("::").map((part) => renamed && part === row.newName ? oldName : part).at(-1);
  const points = payload.computedGeometry.filter((geometry) => geometry.kind === "point")
    .map((geometry) => [normalize(geometry.name), geometry.x, geometry.y]);
  expect(points, `${row.id} independently authored coordinates and complete point output set`).toEqual(row.points);
  for (const [name, expected] of Object.entries(row.scalars)) {
    const actualName = renamed && name === oldName && row.id !== "T4" ? row.newName : name;
    const binding = compiled.bindingAnalysis?.catalog.bindings.find((entry) => entry.name === actualName);
    expect(binding, `${row.id} scalar ${actualName}`).toBeDefined();
    expect(payload.computedScalarBindings?.find((entry) => entry.bindingId === binding!.id)?.evaluation)
      .toMatchObject({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: expected } });
  }
  if (row.id === "T3") {
    expect(payload.computedGeometryValues?.some((entry) => entry.value.kind === "point" && entry.value.x === 3 && entry.value.y === 4)).toBe(true);
    expect(payload.computedGeometry).toHaveLength(2);
  }
};

const records: unknown[] = [];
let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 120_000);
afterAll(() => {
  rust?.dispose();
  if (process.env.ISSUE1448_RECORD) writeFileSync(process.env.ISSUE1448_RECORD, `${JSON.stringify(records, null, 2)}\n`);
});

describe("Issue #1448 actual production Rename semantic preservation", () => {
  it.each([...cases, ...controls])("$id: $discriminator", async (row) => {
    const record: Record<string, unknown> = { id: row.id, phase: "candidate", disposition: "UNRESOLVED" };
    records.push(record);
    try {
      expect(hash(row.source)).toBe(frozenRows.find((entry) => entry.id === row.id)!.sha256);
      const before = compile(row);
      expect(diagnostics(before)).toEqual([]);
      const current = snapshot(row.source, before);
      expect(queryDslRenameTarget(current, row.targetOffset)).toEqual(frozenRows.find((entry) => entry.id === row.id)!.target);
      const selected = occurrences(before).filter((entry) => entry.from === row.targetOffset);
      expect(selected.map((entry) => entry.identity)).toEqual(frozenRows.find((entry) => entry.id === row.id)!.identities.map((entry) => entry.key));
      record.target = selected;
      const baseOptions = buildEvaluationOptions({ compiledDocument: before, evaluationLimitIndex: before.document.evaluationLimitIndex });
      const baseReference = evaluateElementsReferencePayload(before.document.elements, baseOptions);
      const basePrepared = prepareRustEvaluation(before.document.elements, baseOptions);
      record.baseline = { reference: baseReference, rustEligible: basePrepared.rustEligible };
      assertOracle(row, before, baseReference, false);
      expect(basePrepared.rustEligible).toBe(true);
      const baseProduction = await rust.evaluateInput(basePrepared.input);
      (record.baseline as Record<string, unknown>).production = baseProduction;
      assertOracle(row, before, baseProduction, false);
      const result = planDslRenameEditsResult(current, row.targetOffset, row.newName);
      record.plan = result;
      expect(result.status, `${row.id} production safe plan`).toBe("ok");
      if (result.status !== "ok") throw new Error(JSON.stringify(result.rejection));
      expect(result.plan.edits).toEqual(row.expectedEdits);
      for (const edit of result.plan.edits) {
        expect(row.source.slice(edit.from, edit.to)).toBe(edit.expectedText);
        expect(queryDslRenameTarget(current, edit.from)?.oldName).toBe(edit.expectedText);
        const fromReference = planDslRenameEditsResult(current, edit.from, row.newName);
        expect(fromReference.status).toBe("ok");
        if (fromReference.status === "ok") expect(fromReference.plan.edits).toEqual(result.plan.edits);
      }
      const edited = applyPlan(row.source, before, result.plan.edits);
      record.editedSource = edited;
      let oldCursor = 0;
      let newCursor = 0;
      for (const edit of result.plan.edits) {
        const from = shifted(edit.from, result.plan.edits);
        expect(edited.slice(newCursor, from)).toBe(row.source.slice(oldCursor, edit.from));
        oldCursor = edit.to;
        newCursor = from + edit.newText.length;
      }
      expect(edited.slice(newCursor)).toBe(row.source.slice(oldCursor));
      const compiledResult = compileCanonicalText({
        sourceText: row.source, docText: row.source, doc: before,
        diagnostics: before.diagnostics, bindingIssueDiagnostics: before.bindingIssueDiagnostics ?? []
      }, edited);
      expect(compiledResult.status).not.toBe("fatal");
      const after = compiledResult.doc;
      expect(diagnostics(after)).toEqual([]);
      for (const declaration of before.sourceLexicalNamespace!.allDeclarations) {
        expect(after.statementMap.statementIdByStatementIndex!.get(declaration.statementIndex)).toBe(declaration.statementId);
      }
      expect(after.statementMap.elementIdByStatementIndex).toEqual(before.statementMap.elementIdByStatementIndex);
      const expectedOccurrences = occurrences(before).map((entry) => {
        const edit = result.plan.edits.find((candidate) => candidate.from === entry.from && candidate.to === entry.to);
        const from = shifted(entry.from, result.plan.edits);
        return { ...entry, from, to: from + (edit ? edit.newText.length : entry.to - entry.from) };
      });
      record.occurrences = { before: occurrences(before), after: occurrences(after) };
      expect(occurrences(after)).toEqual(expectedOccurrences);
      expect(dependencies(after)).toEqual(dependencies(before));
      expect(instanceOrigins(after)).toEqual(instanceOrigins(before));
      record.dependencies = dependencies(after);
      record.instanceOrigins = instanceOrigins(after);
      for (const [compiled, renamed] of [[before, false], [after, true]] as const) {
        const elements = compiled.document.elements;
        const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: compiled.document.evaluationLimitIndex });
        const reference = renamed ? evaluateElementsReferencePayload(elements, options) : baseReference;
        const prepared = prepareRustEvaluation(elements, options);
        record[renamed ? "after" : "before"] = { reference, rustEligible: prepared.rustEligible };
        assertOracle(row, compiled, reference, renamed);
        expect(prepared.rustEligible, `${row.id} ordinary production Rust eligibility`).toBe(true);
        if (!prepared.rustEligible) throw new Error("normal Rust route unavailable");
        const production = renamed ? await rust.evaluateInput(prepared.input) : baseProduction;
        (record[renamed ? "after" : "before"] as Record<string, unknown>).production = production;
        assertOracle(row, compiled, production, renamed);
        const wrong = structuredClone(reference);
        const observer = wrong.computedGeometry.find((geometry) => geometry.name === "Observer");
        if (observer?.kind === "point") {
          observer.x = row.id === "T2" ? 7 : row.id === "G2" ? 41 : row.id === "C2" ? 52 : row.id === "T4" ? 39 : observer.x + 1;
          expect(wrong.computedGeometry.find((geometry) => geometry.name === "Control"))
            .toEqual(reference.computedGeometry.find((geometry) => geometry.name === "Control"));
        }
        else {
          const picked = wrong.computedScalarBindings?.find((entry) => entry.evaluation.status === "ok" && entry.evaluation.value.kind === "number");
          if (!picked || picked.evaluation.status !== "ok" || picked.evaluation.value.kind !== "number") throw new Error("missing sensitivity observer");
          picked.evaluation.value.value += 1;
        }
        expect(() => assertOracle(row, compiled, wrong, renamed)).toThrow();
        // Real unmodified projection is the positive control; unrelated Control stays correct.
        assertOracle(row, compiled, reference, renamed);
      }
      expect(() => expect(result.plan.edits.slice(0, -1)).toEqual(row.expectedEdits)).toThrow();
      expect(planDslRenameEditsResult({ ...current, source: { ...current.source, sourceRevision: 999 } }, row.targetOffset, row.newName))
        .toEqual({ status: "rejected", rejection: { reason: "unavailable" } });
      expect(planDslRenameEditsResult(current, row.targetOffset, "").status).toBe("rejected");
      record.sensitivity = { omittedEdit: "detected", wrongObservation: "detected", positiveControl: "PASS" };
      if (row.id === "C2") {
        expect(planDslRenameEditsResult(current, row.targetOffset, "Other")).toMatchObject({ status: "rejected", rejection: { reason: "same-scope-collision" } });
        expect(planDslRenameEditsResult(current, row.targetOffset, "Taken").status).toBe("rejected");
      }
      record.disposition = "PASS";
    } catch (error) {
      record.failure = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }, 30_000);
});
