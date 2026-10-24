import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileDslDocument, parseDslSnapshot, queryDslDefinition, queryDslReferences,
  queryDslRenameTarget, planDslRenameEditsResult, queryDslGeometryHoverTarget,
  queryDslGeometryHoverDeclarationRange, queryDslTransformationHoverTarget,
  type DslRenameEdit, type DslRenameSnapshot
} from "@nuinuicad/nui-language";
import {
  applyLineSplices, buildSourceSemanticRenameSplices, compileCanonicalText,
  isLastGoodDslDocument, type LastGoodDslDocument
} from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import { createRustStdioParityClient } from "./evaluationParitySupport";
import primary from "./fixtures/issue1450/cases.json";
import additional from "./fixtures/issue1450/additional.json";
import regressionControls from "./fixtures/issue1450/regression-controls.json";
// RC1 is a focused safety regression derived from X6, not an exploration unit.
const cases = [...primary, ...additional, ...regressionControls] as Case[];

type Case = typeof primary[number] & {
  parent?: string; shorthand?: boolean; dualDeclaration?: Range; stageConstruction?: string; rejections?: Record<string, string>;
};
type Range = { from: number; to: number };
const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const compile = (row: Case) => {
  const preparsed = parseDslSnapshot({ normalizedSource: row.source, sourceRevision: row.sourceRevision });
  const ids = new Map(preparsed.statements.map((_, index) => [index, `identity:${row.id}:${index}`]));
  const compiled = compileDslDocument(row.source, { preparsed, assignedStatementIds: ids, assignedElementIds: ids });
  if (!isLastGoodDslDocument(compiled)) throw new Error(`${row.id}: invalid source`);
  return compiled;
};
const assertLegal = (compiled: LastGoodDslDocument) => {
  expect([...compiled.diagnostics, ...compiled.bindingIssueDiagnostics ?? []].filter((d) => d.severity === "error")).toEqual([]);
};
const snapshot = (row: Case, compiled: LastGoodDslDocument): DslRenameSnapshot => ({
  source: { normalizedSource: row.source, sourceRevision: row.sourceRevision },
  semantic: { sourceRevision: row.sourceRevision, compiled }
});
const applyPlan = (source: string, compiled: LastGoodDslDocument, edits: readonly DslRenameEdit[]) => {
  const projected = buildSourceSemanticRenameSplices(source, compiled, edits.map((edit) => ({
    statementIndex: compiled.statements.findIndex((statement) =>
      statement.physicalSpan.segments.some((segment) => edit.from >= segment.from && edit.to <= segment.to)),
    span: { start: 0, end: 0 },
    physicalSpan: { segments: [{ from: edit.from, to: edit.to }], sourceRevision: compiled.statementMap.sourceRevision },
    oldName: edit.expectedText, newName: edit.newText
  })));
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error(projected.reason);
  return applyLineSplices(source, projected.splices);
};
const observations = (row: Case, compiled: LastGoodDslDocument, payload: EvaluationPayload, renamed = false) => {
  expect(payload.errors).toEqual([]);
  const name = (value: string) => {
    const leaf = value.split("::").at(-1)!.replace(/^\[tick=\d+\] /, "");
    return renamed && leaf === row.newName ? row.name : leaf;
  };
  const points = payload.computedGeometry.filter((g) => g.kind === "point")
    .map((g) => [name(g.name), g.x, g.y]);
  const ordered = (rows: unknown[][]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  expect(ordered(points), `${row.id} independently authored complete point output`).toEqual(ordered(row.points));
  if (row.lines) {
    expect(payload.computedGeometry.filter((g) => g.kind === "line")
      .map((g) => [name(g.name), g.start.x, g.start.y, g.end.x, g.end.y])).toEqual(row.lines);
  }
  for (const [key, expected] of Object.entries(row.scalars)) {
    const binding = compiled.bindingAnalysis?.catalog.bindings.find((b) => b.name === key);
    expect(binding).toBeDefined();
    expect(payload.computedScalarBindings?.find((b) => b.bindingId === binding!.id)?.evaluation)
      .toMatchObject({ status: "ok", value: { kind: "number", value: expected } });
  }
};
const records: unknown[] = [];
let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 120_000);
afterAll(() => {
  rust?.dispose();
  if (process.env.ISSUE1450_RECORD) writeFileSync(process.env.ISSUE1450_RECORD, `${JSON.stringify(records, null, 2)}\n`);
});

describe("Issue #1450 frozen cross-feature identities and physical Rename preservation", () => {
  it.each(cases)("$id: $purpose", async (row) => {
    expect(hash(row.source)).toBe(row.sha256);
    const compiled = compile(row);
    assertLegal(compiled);
    const current = snapshot(row, compiled);
    const ranges: Range[] = [row.declaration, ...row.references];
    const actual = ranges.map((range) => {
      const input = { ...current, position: range.from };
      return {
        range, definition: queryDslDefinition(input), references: queryDslReferences(input),
        target: queryDslRenameTarget(current, range.from), plan: planDslRenameEditsResult(current, range.from, row.newName),
        hover: queryDslGeometryHoverTarget(input), transformation: queryDslTransformationHoverTarget(input)
      };
    });
    const record: Record<string, unknown> = { id: row.id, sha256: row.sha256, selection: row.selection, actual };
    records.push(record);
    for (const [index, item] of actual.entries()) {
      const ambiguous = (row.ambiguousSelection === true && item.range.from === row.selection) || (row.shorthand === true && index === 3);
      const dual = row.shorthand === true && index === 3;
      const expectedDefinition = index === 0 ? null : {
        referenceRange: item.range, declarationRange: dual ? row.dualDeclaration : row.declaration
      };
      expect.soft(item.definition, `${row.id} Definition at ${item.range.from}`).toEqual(expectedDefinition);
      expect.soft(item.references, `${row.id} References at ${item.range.from}`).toEqual(ambiguous ? null : {
        declarationRange: row.declaration, referenceRanges: row.references
      });
      expect.soft(item.target, `${row.id} Rename target at ${item.range.from}`).toEqual(ambiguous ? null : {
        sourceRevision: row.sourceRevision, oldName: row.name, range: item.range
      });
      if (ambiguous) {
        expect.soft(item.plan).toEqual({ status: "rejected", rejection: { reason: "unavailable" } });
      } else {
        expect.soft(item.plan.status, `${row.id} safe Rename at ${item.range.from}`).toBe("ok");
        if (item.plan.status === "ok") expect.soft(item.plan.plan.edits, `${row.id} exact footprint`).toEqual(row.edits);
      }
      if (row.hover) {
        const statementIndex = compiled.statements.findIndex((s) => s.physicalSpan.segments.some((p) =>
          row.declaration.from >= p.from && row.declaration.to <= p.to));
        const elementId = compiled.statementMap.elementIdByStatementIndex.get(statementIndex);
        expect.soft(item.hover).toEqual({ range: item.range, elementId });
        expect.soft(queryDslGeometryHoverDeclarationRange({ ...current, elementId: elementId! })).toEqual(row.declaration);
      } else expect.soft(item.hover, `${row.id} unsupported runtime Hover`).toBeNull();
      const transformation = row.transformation && index === 1;
      const stage = row.stageConstruction && (index === 0 || (row.id === "X3" && index === 1));
      expect.soft(item.transformation).toEqual(stage ? {
        kind: "transformationStage", range: item.range,
        markdown: `**Stage** \`${row.name}\`\n\nImmutable geometry checkpoint produced by \`${row.stageConstruction}\`.`
      } : transformation ? {
        kind: "transformationTarget", range: item.range,
        markdown: `**Transformation target** \`${row.name}\`\n\nBare geometry owner selector used by \`${row.transformation}\`.`
      } : null);
    }
    const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: compiled.document.evaluationLimitIndex });
    const reference = evaluateElementsReferencePayload(compiled.document.elements, options);
    record.referencePoints = reference.computedGeometry.filter((g) => g.kind === "point");
    observations(row, compiled, reference);
    const prepared = prepareRustEvaluation(compiled.document.elements, options);
    record.rustEligible = prepared.rustEligible;
    if (prepared.rustEligible) observations(row, compiled, await rust.evaluateInput(prepared.input));

    const plan = actual[0]!.plan;
    expect(plan.status, `${row.id} declaration safe plan`).toBe("ok");
    if (plan.status !== "ok") return;
    const edited = applyPlan(row.source, compiled, plan.plan.edits);
    record.editedSource = edited;
    expect(edited).toBe(row.afterSource);
    const result = compileCanonicalText({
      sourceText: row.source, docText: row.source, doc: compiled,
      diagnostics: compiled.diagnostics, bindingIssueDiagnostics: compiled.bindingIssueDiagnostics ?? []
    }, edited);
    expect(result.status).not.toBe("fatal");
    assertLegal(result.doc);
    for (const declaration of compiled.sourceLexicalNamespace!.allDeclarations) {
      expect(result.doc.statementMap.statementIdByStatementIndex?.get(declaration.statementIndex)).toBe(declaration.statementId);
    }
    expect(result.doc.statementMap.elementIdByStatementIndex).toEqual(compiled.statementMap.elementIdByStatementIndex);
    expect(result.doc.moduleMaterialization?.originByRuntimeElementId).toEqual(compiled.moduleMaterialization?.originByRuntimeElementId);
    // Shift the independently frozen token ranges, including shorthand's two
    // distinct explicit tokens, rather than discovering them from the index.
    const renamedRange = (range: Range): Range => {
      const edit = row.edits.find((e) => e.from <= range.from && range.to <= e.to)!;
      const shift = row.edits.filter((e) => e.to <= edit.from)
        .reduce((delta, e) => delta + e.newText.length - (e.to - e.from), 0);
      const prefix = row.id === "C2" && edit.expectedText.startsWith("@")
        ? edit.newText.indexOf("@") + 1 : 0;
      const from = edit.from + shift + prefix;
      return { from, to: from + row.newName.length };
    };
    const afterDeclaration = renamedRange(row.declaration);
    const afterReferences = row.references.map(renamedRange);
    const afterCurrent = {
      source: { normalizedSource: edited, sourceRevision: result.doc.statementMap.sourceRevision },
      semantic: { compiled: result.doc, sourceRevision: result.doc.statementMap.sourceRevision }
    };
    for (const [index, range] of [afterDeclaration, ...afterReferences].entries()) {
      const input = { ...afterCurrent, position: range.from };
      expect(queryDslReferences(input)).toEqual({ declarationRange: afterDeclaration, referenceRanges: afterReferences });
      expect(queryDslDefinition(input)).toEqual(index === 0 ? null : { declarationRange: afterDeclaration, referenceRange: range });
      expect(queryDslRenameTarget(afterCurrent, range.from)).toEqual({
        sourceRevision: afterCurrent.source.sourceRevision, oldName: row.newName, range
      });
    }
    const afterOptions = buildEvaluationOptions({ compiledDocument: result.doc, evaluationLimitIndex: result.doc.document.evaluationLimitIndex });
    const afterReference = evaluateElementsReferencePayload(result.doc.document.elements, afterOptions);
    observations(row, result.doc, afterReference, true);
    const afterPrepared = prepareRustEvaluation(result.doc.document.elements, afterOptions);
    expect(afterPrepared.rustEligible).toBe(prepared.rustEligible);
    if (afterPrepared.rustEligible) observations(row, result.doc, await rust.evaluateInput(afterPrepared.input), true);
    // A missing reference or contamination by any other range must fail exact equality.
    expect(() => expect(row.references.slice(1)).toEqual(row.references)).toThrow();
    expect(() => expect([...row.references, row.declaration]).toEqual(row.references)).toThrow();
    for (const distractor of row.distractors ?? []) {
      expect(row.source.slice(distractor.from, distractor.to)).toBe(row.name);
      expect(() => expect([distractor, ...row.references.slice(1)]).toEqual(row.references)).toThrow();
    }
    expect(() => expect(plan.plan.edits.slice(1)).toEqual(row.edits)).toThrow();
    expect(() => expect(applyPlan(row.source, compiled, plan.plan.edits.slice(0, -1))).toBe(row.afterSource)).toThrow();
    const wrong = structuredClone(reference);
    const point = wrong.computedGeometry.find((g) => g.kind === "point");
    if (point?.kind === "point") point.x += 1;
    expect(() => observations(row, compiled, wrong)).toThrow();
    observations(row, compiled, reference);
    for (const stale of [
      { ...current, source: { ...current.source, sourceRevision: 99 } },
      { ...current, source: { ...current.source, normalizedSource: `${row.source}// changed\n` } }
    ]) {
      const input = { ...stale, position: row.selection };
      expect(queryDslDefinition(input)).toBeNull();
      expect(queryDslReferences(input)).toBeNull();
      expect(queryDslRenameTarget(stale, row.selection)).toBeNull();
      expect(queryDslGeometryHoverTarget(input)).toBeNull();
      expect(queryDslTransformationHoverTarget(input)).toBeNull();
      expect(planDslRenameEditsResult(stale, row.selection, row.newName)).toEqual({ status: "rejected", rejection: { reason: "unavailable" } });
    }
    const rejections: unknown[] = [];
    for (const [newName, reason] of Object.entries(row.rejections ?? {})) {
      const rejected = planDslRenameEditsResult(current, row.selection, newName);
      rejections.push({ newName, result: rejected });
      expect(rejected).toMatchObject({ status: "rejected", rejection: { reason } });
      expect("plan" in rejected).toBe(false);
    }
    if (row.id === "X4" || row.id === "X6") {
      expect(planDslRenameEditsResult(current, row.selection, row.id === "X4" ? "steps" : "values"))
        .toMatchObject({ status: "rejected", rejection: { reason: "same-scope-collision" } });
    }
    expect(planDslRenameEditsResult(current, row.declaration.from, "").status).toBe("rejected");
    expect(planDslRenameEditsResult(current, 0, row.newName)).toEqual({ status: "rejected", rejection: { reason: "unavailable" } });
    record.rejections = rejections;
    record.disposition = "PASS";
  }, 30_000);
});
