import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CadElement, ElementId } from "../src/types/geometry";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../src/document/canonicalDocument";
import { emptyDocument } from "../src/dsl/dslDocumentTestUtils";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustBindingMutationPayload } from "../src/geometry/bindingVersionPayload";
import { buildConditionalGroupConditionsByElementId } from "../src/geometry/controlBooleanRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../src/scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../src/scalars/forGroupMutationControl";
import type { TypedScalarExpression } from "../src/scalars/typedExpressionAst";
import type { EvaluateElementsOptions } from "../src/geometry/evaluate";
import type { BindingVersionGraph } from "../src/scalars/bindingVersions";
import { isRustLinearMutationEligible } from "../src/scalars/linearMutationEvaluator";
import type { ScalarProgram } from "../src/scalars/scalarProgram";
import type { TextTemplateAst } from "../src/scalars/textTemplate";
import type { PropertyBindingRuntimeEntry } from "../src/geometry/propertyBindingRuntime";
import {
  buildTextPropertyBindingRuntimeEntries,
  buildTextTemplateEntriesByElementId,
  toRustTextTemplateSegments
} from "../src/geometry/textTemplateRuntime";

type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  scalarProgram?: ScalarProgram;
  bindingVersions?: BindingVersionGraph;
  statementInfoByElementId?: ReadonlyMap<string, { statementIndex: number }>;
  statementIdByStatementIndex?: ReadonlyMap<number, string>;
  conditionalGroupConditions?: ReadonlyMap<string, TypedScalarExpression>;
  textTemplateEntriesByElementId?: ReadonlyMap<ElementId, TextTemplateAst>;
  textPropertyBindingEntries?: readonly PropertyBindingRuntimeEntry[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const fixtureDir = join(repoRoot, "test", "fixtures", "evaluation");
const cargoManifest = join(repoRoot, "src-tauri", "Cargo.toml");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";

const fixtureNames: string[] = runRustParity
  ? readdirSync(fixtureDir)
      .filter((name: string) => name.endsWith(".json") || name.endsWith(".nui"))
      .sort()
  : [];

const fixtureFromSource = (source: string): EvaluationFixture => {
  const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (compiled.status === "fatal") throw new Error("parity source failed to compile");
  const textTemplateEntriesByElementId = compiled.doc.textTemplates
    ? buildTextTemplateEntriesByElementId({
        textTemplates: compiled.doc.textTemplates,
        elementIdByStatementIndex: compiled.doc.statementMap.elementIdByStatementIndex
      })
    : undefined;
  const textPropertyBindingEntries = compiled.doc.propertyBindings
    ? buildTextPropertyBindingRuntimeEntries(
        {
          propertyBindings: compiled.doc.propertyBindings,
          elementIdByStatementIndex: compiled.doc.statementMap.elementIdByStatementIndex
        },
        compiled.doc.document.elements
      )
    : undefined;
  return {
    elements: compiled.doc.document.elements,
    evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex,
    scalarProgram: compiled.doc.scalarProgram,
    bindingVersions: compiled.doc.bindingVersions,
    statementInfoByElementId: compiled.doc.statementMap.byElementId,
    statementIdByStatementIndex: compiled.doc.statementMap.statementIdByStatementIndex,
    conditionalGroupConditions: compiled.doc.conditionalGroupConditions,
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};

const readFixture = (name: string): EvaluationFixture => {
  const source = readFileSync(join(fixtureDir, name), "utf8");
  if (name.endsWith(".json")) return JSON.parse(source) as EvaluationFixture;
  return fixtureFromSource(source);
};

const optionsFor = (fixture: EvaluationFixture): EvaluateElementsOptions => ({
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
  ...(fixture.conditionalGroupConditions && fixture.statementInfoByElementId
    ? { conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
        fixture.conditionalGroupConditions,
        new Map(Array.from(fixture.statementInfoByElementId, ([elementId, info]) => [info.statementIndex, elementId]))
      ) }
    : {}),
  ...(fixture.textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId: fixture.textTemplateEntriesByElementId } : {}),
  ...(fixture.textPropertyBindingEntries?.length ? { textPropertyBindingEntries: fixture.textPropertyBindingEntries } : {})
});

const evaluateWithRust = (input: EvaluationFixture): EvaluationPayload => {
  const mutationPayload = input.bindingVersions && isRustLinearMutationEligible(input.bindingVersions)
    ? buildRustBindingMutationPayload(
        input.bindingVersions, input.elements, input.statementInfoByElementId, input.statementIdByStatementIndex
      )
    : undefined;
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      cargoManifest,
      "--example",
      "evaluate_fixture"
    ],
    {
      encoding: "utf8",
      input: JSON.stringify({
        elements: input.elements,
        evaluationLimitIndex: input.evaluationLimitIndex,
        ...(mutationPayload ? { bindingVersions: mutationPayload } : input.scalarProgram ? { scalarProgram: input.scalarProgram } : {}),
        ...(input.conditionalGroupConditions && input.statementInfoByElementId ? {
          conditionExpressions: Array.from(buildConditionalGroupConditionsByElementId(
            input.conditionalGroupConditions,
            new Map(Array.from(input.statementInfoByElementId, ([elementId, info]) => [info.statementIndex, elementId]))
          ), ([elementId, expression]) => ({ elementId, expression }))
        } : {}),
        ...(input.textTemplateEntriesByElementId?.size ? {
          textTemplates: Array.from(input.textTemplateEntriesByElementId, ([elementId, ast]) => ({
            elementId,
            segments: toRustTextTemplateSegments(ast)
          }))
        } : {}),
        ...(input.textPropertyBindingEntries?.length
          ? { textPropertyBindings: input.textPropertyBindingEntries }
          : {})
      })
    }
  );
  return JSON.parse(output) as EvaluationPayload;
};

const normalizeNumbers = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNumbers);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, normalizeNumbers(nested)])
    );
  }
  return value;
};

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  it.each(fixtureNames)(
    "%s matches the TypeScript reference payload",
    (name: string) => {
      const fixture = readFixture(name);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
      const rustPayload = evaluateWithRust(fixture);

      expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    },
    30000
  );

  it("declaration-only nui 3 source has no TS/Rust shadow mismatch", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      "const hem: number = 12",
      "const label: string = \"front\"",
      "const printed: boolean = true",
      "const side: choice(right, left) = right",
      "group Scope {",
      "  const hemCopy: number = @hem",
      "}"
    ].join("\n"));

    expect(compiled.status).not.toBe("fatal");
    const fixture: EvaluationFixture = {
      elements: compiled.doc.document.elements,
      scalarProgram: compiled.doc.scalarProgram
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram
    });

    expect(normalizeNumbers(evaluateWithRust(fixture))).toEqual(normalizeNumbers(tsPayload));
  }, 30000);

  it("group.printEnabled bound to a boolean binding has matching computedScalarBindings across TS/Rust (Task 24)", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      "let 印刷: boolean = true",
      "group G (printEnabled: @印刷) {",
      "  point A = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n"));

    expect(compiled.status).not.toBe("fatal");
    const fixture: EvaluationFixture = {
      elements: compiled.doc.document.elements,
      scalarProgram: compiled.doc.scalarProgram
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram
    });
    const rustPayload = evaluateWithRust(fixture);

    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    const bindings = Array.from(tsResult.computedScalarBindings ?? []);
    expect(bindings).toHaveLength(1);
    expect(bindings[0][1]).toEqual({ status: "ok", type: { kind: "boolean" }, value: { kind: "boolean", value: true } });
    expect(rustResult.computedScalarBindings).toEqual(tsResult.computedScalarBindings);
  }, 30000);

  it("valid nui 3 overflow source returns matching typed poison through IPC", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const maximumFiniteLiteral = `1${"0".repeat(308)}`;
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      `const maximum: number = ${maximumFiniteLiteral}`,
      "const overflow: number = @maximum + @maximum"
    ].join("\n"));

    expect(compiled.status).not.toBe("fatal");
    const fixture: EvaluationFixture = {
      elements: compiled.doc.document.elements,
      scalarProgram: compiled.doc.scalarProgram
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram
    });
    const rustPayload = evaluateWithRust(fixture);
    const rustResult = evaluationPayloadToResult(rustPayload);

    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    const bindings = Array.from(rustResult.computedScalarBindings ?? []);
    expect(bindings).toHaveLength(2);
    expect(bindings[0][1]).toMatchObject({ status: "ok", type: { kind: "number" } });
    expect(bindings[1][1]).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-non-finite-result"
    });
  }, 30000);

  it.each([
    [
      "typed string, number, escaped braces, and bare text binding",
      [
        "nui 3",
        'const label: string = "前身頃"',
        "const size: number = 12.3456",
        'text A = label(text: "\\{literal\\} {@label} {@size}" anchor: none size: 3)',
        "text B = label(text: @label anchor: none size: 3)"
      ].join("\n")
    ],
    [
      "linear set text reads the current binding version",
      [
        "nui 3",
        "let value: number = 1",
        'text A = label(text: "{@value}" anchor: none size: 3)',
        "set value = 2",
        'text B = label(text: "{@value}" anchor: none size: 3)'
      ].join("\n")
    ],
    [
      "conditional mutation text uses the active branch slot",
      [
        "nui 3",
        "let value: number = 0",
        "if C (true) {",
        "  set value = 3",
        '  text T = label(text: "{@value}" anchor: none size: 3)',
        "}"
      ].join("\n")
    ],
    [
      "forGroup mutation text uses each iteration current slot",
      [
        "nui 3",
        "let total: number = 0",
        "for Loop (i from: 0 count: 2 step: 1) {",
        "  set total = @total + 1",
        '  text T = label(text: "{@total}" anchor: none size: 3)',
        "}"
      ].join("\n")
    ]
  ])("Task 28 %s has exact TS/Rust payload parity", (_name, source) => {
    const fixture = fixtureFromSource(source);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
  }, 30000);
});
