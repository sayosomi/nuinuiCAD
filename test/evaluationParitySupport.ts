import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CadElement, ElementId } from "../src/types/geometry";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "../src/document/canonicalDocument";
import { emptyDocument } from "../src/dsl/dslDocumentTestUtils";
import { canUseRustEvaluationForElements } from "../src/geometry/evaluationEngine";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildConditionalGroupConditionsByElementId, buildControlBooleanRuntimeEntries } from "../src/geometry/controlBooleanRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../src/scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../src/scalars/forGroupMutationControl";
import { buildPropertyBindingRuntimeEntries, type PropertyBindingRuntimeEntry } from "../src/geometry/propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "../src/geometry/textTemplateRuntime";
import { runtimeScalarDiagnostics } from "../src/scalars/runtimeScalarDiagnostics";
import type { TypedScalarExpression } from "../src/scalars/typedExpressionAst";
import type { EvaluateElementsOptions } from "../src/geometry/evaluate";
import type { BindingVersionGraph } from "../src/scalars/bindingVersions";
import type { ScalarProgram } from "../src/scalars/scalarProgram";
import type { TextTemplateAst } from "../src/scalars/textTemplate";

export type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  scalarProgram?: ScalarProgram;
  bindingVersions?: BindingVersionGraph;
  statementInfoByElementId?: ReadonlyMap<string, { statementIndex: number }>;
  statementIdByStatementIndex?: ReadonlyMap<number, string>;
  conditionalGroupConditions?: ReadonlyMap<string, TypedScalarExpression>;
  textTemplateEntriesByElementId?: ReadonlyMap<ElementId, TextTemplateAst>;
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  controlBooleanEntries?: readonly PropertyBindingRuntimeEntry[];
  textPropertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  compiled?: TextCompileResult;
};

export const evaluationFixtureDir = (repoRoot: string) => join(repoRoot, "test", "fixtures", "evaluation");

export const parityFixtureNames = (repoRoot: string): string[] =>
  readdirSync(evaluationFixtureDir(repoRoot))
    .filter((name) => name.endsWith(".json") || name.endsWith(".nui"))
    .sort();

export const isNui3ReleaseFixture = (name: string) => name.startsWith("nui3-") && name.endsWith(".nui");

export const fixtureFromSource = (source: string): EvaluationFixture => {
  const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (compiled.status === "fatal") throw new Error("parity source failed to compile");
  const doc = compiled.doc;
  const propertyBindingEntries = doc.scalarProgram && doc.propertyBindings
    ? buildPropertyBindingRuntimeEntries(
        { propertyBindings: doc.propertyBindings, elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex },
        doc.document.elements
      )
    : undefined;
  const controlBooleanEntries = doc.scalarProgram && doc.propertyBindings
    ? buildControlBooleanRuntimeEntries(
        { propertyBindings: doc.propertyBindings, elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex },
        doc.document.elements
      )
    : undefined;
  const textTemplateEntriesByElementId = doc.textTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: doc.textTemplates,
        elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex
      })
    : undefined;
  const textPropertyBindingEntries = doc.scalarProgram && doc.propertyBindings
    ? buildTextPropertyBindingRuntimeEntries(
        { propertyBindings: doc.propertyBindings, elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex },
        doc.document.elements
      )
    : undefined;
  return {
    elements: doc.document.elements,
    evaluationLimitIndex: doc.document.evaluationLimitIndex,
    scalarProgram: doc.scalarProgram,
    bindingVersions: doc.bindingVersions,
    statementInfoByElementId: doc.statementMap.byElementId,
    statementIdByStatementIndex: doc.statementMap.statementIdByStatementIndex,
    conditionalGroupConditions: doc.conditionalGroupConditions,
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {}),
    compiled
  };
};

export const readParityFixture = (repoRoot: string, name: string): EvaluationFixture => {
  const source = readFileSync(join(evaluationFixtureDir(repoRoot), name), "utf8");
  return name.endsWith(".json") ? JSON.parse(source) as EvaluationFixture : fixtureFromSource(source);
};

export const optionsFor = (fixture: EvaluationFixture): EvaluateElementsOptions => ({
  evaluationLimitIndex: fixture.evaluationLimitIndex,
  ...(fixture.scalarProgram ? { scalarProgram: fixture.scalarProgram } : {}),
  ...(fixture.bindingVersions ? {
    bindingVersions: fixture.bindingVersions,
    statementInfoByElementId: fixture.statementInfoByElementId,
    statementIdByStatementIndex: fixture.statementIdByStatementIndex,
    conditionalOwnerStatementIdByElementId: conditionalOwnerIdByElementId(buildConditionalMutationOwners(
      fixture.bindingVersions, fixture.elements, fixture.statementInfoByElementId, fixture.statementIdByStatementIndex
    )),
    forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
      fixture.bindingVersions, fixture.elements, fixture.statementInfoByElementId, fixture.statementIdByStatementIndex
    ))
  } : {}),
  ...(fixture.propertyBindingEntries?.length ? { propertyBindingEntries: fixture.propertyBindingEntries } : {}),
  ...(fixture.controlBooleanEntries?.length ? { controlBooleanEntries: fixture.controlBooleanEntries } : {}),
  ...(fixture.conditionalGroupConditions && fixture.statementInfoByElementId
    ? { conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
        fixture.conditionalGroupConditions,
        new Map(Array.from(fixture.statementInfoByElementId, ([elementId, info]) => [info.statementIndex, elementId]))
      ) }
    : {}),
  ...(fixture.textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId: fixture.textTemplateEntriesByElementId } : {}),
  ...(fixture.textPropertyBindingEntries?.length ? { textPropertyBindingEntries: fixture.textPropertyBindingEntries } : {})
});

export const evaluateWithRustFixture = (
  repoRoot: string,
  fixture: EvaluationFixture
): EvaluationPayload => {
  const cargoManifest = join(repoRoot, "src-tauri", "Cargo.toml");
  const output = execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", cargoManifest, "--example", "evaluate_fixture"],
    { encoding: "utf8", input: JSON.stringify(buildRustEvaluationInput(fixture.elements, optionsFor(fixture))) }
  );
  return JSON.parse(output) as EvaluationPayload;
};

export const normalizeParityPayload = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) return value.map(normalizeParityPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeParityPayload(nested)])
    );
  }
  return value;
};

export const isRustEligibleFixture = (fixture: EvaluationFixture) =>
  canUseRustEvaluationForElements(fixture.elements, optionsFor(fixture));

export const runtimeDiagnosticsFor = (fixture: EvaluationFixture, payload: EvaluationPayload) => {
  const doc = fixture.compiled?.doc;
  if (!doc?.bindingAnalysis || !doc.statementMap) return [];
  return runtimeScalarDiagnostics({
    computedScalarBindings: evaluationPayloadToResult(payload).computedScalarBindings,
    bindingAnalysis: doc.bindingAnalysis,
    statements: doc.statements,
    spans: doc.spans,
    elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
    propertySourcesByOccurrenceKey: doc.propertyBindings ?? new Map(),
    occurrenceKeysByBindingId: doc.occurrenceKeysByBindingId ?? new Map(),
    freshness: { isSourceDirty: false, isEvaluationStale: false }
  });
};
