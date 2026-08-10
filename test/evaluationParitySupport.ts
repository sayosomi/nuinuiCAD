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
import { buildNumericBindingRuntimeEntries, type NumericBindingRuntimeEntry } from "../src/geometry/numericBindingRuntime";
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
  sourceExecutionPositionByElementId?: ReadonlyMap<string, number>;
  scalarExecutionPositionByElementId?: ReadonlyMap<string, number>;
  statementIdByStatementIndex?: ReadonlyMap<number, string>;
  conditionalGroupConditions?: ReadonlyMap<string, TypedScalarExpression>;
  materializedConditionalGroupConditions?: readonly { elementId: ElementId; expression: TypedScalarExpression }[];
  moduleConditionalOwnerStatementIdByElementId?: ReadonlyMap<ElementId, string>;
  moduleForGroupMutationOwnerByElementId?: ReadonlyMap<ElementId, import("../src/scalars/forGroupMutationControl").ForGroupMutationOwner>;
  materializedTextTemplates?: readonly { elementId: ElementId; template: TextTemplateAst }[];
  textTemplateEntriesByElementId?: ReadonlyMap<ElementId, TextTemplateAst>;
  propertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  controlBooleanEntries?: readonly PropertyBindingRuntimeEntry[];
  textPropertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
  numericBindingEntries?: readonly NumericBindingRuntimeEntry[];
  compiled?: TextCompileResult;
};

export const evaluationFixtureDir = (repoRoot: string) => join(repoRoot, "test", "fixtures", "evaluation");

export const parityFixtureNames = (repoRoot: string): string[] =>
  readdirSync(evaluationFixtureDir(repoRoot))
    .filter((name) => name.endsWith(".nui"))
    .sort();

export const isNui3ReleaseFixture = (name: string) => name.startsWith("nui3-") && name.endsWith(".nui");

export const fixtureFromSource = (source: string): EvaluationFixture => {
  const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (compiled.status === "fatal") throw new Error("parity source failed to compile");
  const doc = compiled.doc;
  const propertyBindingEntries = doc.scalarProgram && doc.propertyBindings
    ? buildPropertyBindingRuntimeEntries(
        {
          propertyBindings: doc.propertyBindings,
          elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: doc.materializedPropertyBindings
        },
        doc.document.elements
      )
    : undefined;
  const controlBooleanEntries = doc.scalarProgram && doc.propertyBindings
    ? buildControlBooleanRuntimeEntries(
      {
        propertyBindings: doc.propertyBindings,
        elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
        materializedPropertyBindings: doc.materializedPropertyBindings
      },
        doc.document.elements
      )
    : undefined;
  const textTemplateEntriesByElementId = doc.textTemplates || doc.materializedTextTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: doc.textTemplates ?? new Map(),
        elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
        materializedTextTemplates: doc.materializedTextTemplates
      })
    : undefined;
  const textPropertyBindingEntries = doc.scalarProgram && doc.propertyBindings
      ? buildTextPropertyBindingRuntimeEntries(
        {
          propertyBindings: doc.propertyBindings,
          elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: doc.materializedPropertyBindings
        },
        doc.document.elements
      )
    : undefined;
  const numericBindingEntries = doc.scalarProgram && doc.numericBindings
      ? buildNumericBindingRuntimeEntries(
        {
          numericBindings: doc.numericBindings,
          elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
          materializedNumericBindings: doc.materializedNumericBindings
        },
        doc.document.elements
      )
    : undefined;
  return {
    elements: doc.document.elements,
    evaluationLimitIndex: doc.document.evaluationLimitIndex,
    scalarProgram: doc.scalarProgram,
    bindingVersions: doc.bindingVersions,
    statementInfoByElementId: doc.statementMap.byElementId,
    sourceExecutionPositionByElementId: doc.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: doc.scalarExecutionPositionByRuntimeElementId,
    statementIdByStatementIndex: doc.statementMap.statementIdByStatementIndex,
    conditionalGroupConditions: doc.conditionalGroupConditions,
    materializedConditionalGroupConditions: doc.materializedConditionalGroupConditions,
    moduleConditionalOwnerStatementIdByElementId: doc.moduleConditionalOwnerStatementIdByElementId,
    moduleForGroupMutationOwnerByElementId: doc.moduleForGroupMutationOwnerByElementId,
    materializedTextTemplates: doc.materializedTextTemplates,
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {}),
    ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
    compiled
  };
};

export const readParityFixture = (repoRoot: string, name: string): EvaluationFixture => {
  const source = readFileSync(join(evaluationFixtureDir(repoRoot), name), "utf8");
  return fixtureFromSource(source);
};

export const optionsFor = (fixture: EvaluationFixture): EvaluateElementsOptions => ({
  evaluationLimitIndex: fixture.evaluationLimitIndex,
  ...(fixture.scalarProgram ? { scalarProgram: fixture.scalarProgram } : {}),
  ...(fixture.bindingVersions ? {
    bindingVersions: fixture.bindingVersions,
    statementInfoByElementId: fixture.statementInfoByElementId,
    sourceExecutionPositionByElementId: fixture.sourceExecutionPositionByElementId,
    scalarExecutionPositionByElementId: fixture.scalarExecutionPositionByElementId,
    statementIdByStatementIndex: fixture.statementIdByStatementIndex,
    conditionalOwnerStatementIdByElementId: new Map([
      ...conditionalOwnerIdByElementId(buildConditionalMutationOwners(
        fixture.bindingVersions, fixture.elements, fixture.statementInfoByElementId, fixture.statementIdByStatementIndex,
        new Set(fixture.moduleConditionalOwnerStatementIdByElementId?.values() ?? [])
      )),
      ...(fixture.moduleConditionalOwnerStatementIdByElementId ? [...fixture.moduleConditionalOwnerStatementIdByElementId] : [])
    ]),
    forGroupMutationOwnerByElementId: new Map([
      ...forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
        fixture.bindingVersions, fixture.elements, fixture.statementInfoByElementId, fixture.statementIdByStatementIndex,
        new Set(fixture.moduleForGroupMutationOwnerByElementId
          ? [...fixture.moduleForGroupMutationOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
          : [])
      )),
      ...(fixture.moduleForGroupMutationOwnerByElementId ? [...fixture.moduleForGroupMutationOwnerByElementId] : [])
    ]),
    moduleConditionalOwnerStatementIdByElementId: fixture.moduleConditionalOwnerStatementIdByElementId,
    moduleForGroupMutationOwnerByElementId: fixture.moduleForGroupMutationOwnerByElementId
  } : {}),
  ...(fixture.propertyBindingEntries?.length ? { propertyBindingEntries: fixture.propertyBindingEntries } : {}),
  ...(fixture.controlBooleanEntries?.length ? { controlBooleanEntries: fixture.controlBooleanEntries } : {}),
  ...(fixture.conditionalGroupConditions || fixture.materializedConditionalGroupConditions
    ? { conditionalGroupConditionsByElementId: new Map([
        ...(fixture.conditionalGroupConditions && fixture.statementInfoByElementId
          ? buildConditionalGroupConditionsByElementId(
              fixture.conditionalGroupConditions,
              new Map(Array.from(fixture.statementInfoByElementId, ([elementId, info]) => [info.statementIndex, elementId]))
            )
          : []),
        ...(fixture.materializedConditionalGroupConditions ?? []).map((entry) => [entry.elementId, entry.expression] as const)
      ]) }
    : {}),
  ...(fixture.textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId: fixture.textTemplateEntriesByElementId } : {}),
  ...(fixture.textPropertyBindingEntries?.length ? { textPropertyBindingEntries: fixture.textPropertyBindingEntries } : {}),
  ...(fixture.numericBindingEntries?.length ? { numericBindingEntries: fixture.numericBindingEntries } : {})
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
