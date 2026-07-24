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
import type { PropertyBindingRuntimeEntry } from "../src/geometry/propertyBindingRuntime";
import {
  buildTextPropertyBindingRuntimeEntries,
  buildTextTemplateEntriesByElementId,
  toRustTextTemplateSegments,
  type RustTextTemplateSegment
} from "../src/geometry/textTemplateRuntime";
import type { ScalarProgram } from "../src/scalars/scalarProgram";

type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  scalarProgram?: ScalarProgram;
  textTemplates?: readonly { elementId: ElementId; segments: readonly RustTextTemplateSegment[] }[];
  textPropertyBindings?: readonly PropertyBindingRuntimeEntry[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const fixtureDir = join(repoRoot, "test", "fixtures", "evaluation");
const cargoManifest = join(repoRoot, "src-tauri", "Cargo.toml");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";

const fixtureNames: string[] = runRustParity
  ? readdirSync(fixtureDir)
      .filter((name: string) => name.endsWith(".json"))
      .sort()
  : [];

const readFixture = (name: string): EvaluationFixture =>
  JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as EvaluationFixture;

const evaluateWithRust = (input: EvaluationFixture): EvaluationPayload => {
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
    { encoding: "utf8", input: JSON.stringify(input) }
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
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
        evaluationLimitIndex: fixture.evaluationLimitIndex,
        scalarProgram: fixture.scalarProgram
      });
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

  // Task 28: compiles a nui 3 `label(text:...)` source through the same
  // entry builders AppLayout.tsx/textTemplateEvaluationIntegration.test.ts
  // use, then derives the Rust wire payload from those same TS-shaped
  // entries via toRustTextTemplateSegments - never a second, independently
  // hand-written Rust fixture that could drift from what TS actually sends.
  const textTemplateFixture = (source: string) => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const compiled = compileCanonicalText(baseline, source);
    expect(compiled.status).not.toBe("fatal");
    const doc = compiled.doc;
    const elementIdByStatementIndex = doc.statementMap.elementIdByStatementIndex;
    const textTemplateEntriesByElementId = doc.textTemplates
      ? buildTextTemplateEntriesByElementId({ textTemplates: doc.textTemplates, elementIdByStatementIndex })
      : undefined;
    const textPropertyBindingEntries =
      doc.propertyBindings && doc.document
        ? buildTextPropertyBindingRuntimeEntries(
            { propertyBindings: doc.propertyBindings, elementIdByStatementIndex },
            doc.document.elements
          )
        : undefined;
    const textElementId = doc.document?.elements.find((element) => element.type === "text")?.id;

    const fixture: EvaluationFixture = {
      elements: doc.document!.elements,
      scalarProgram: doc.scalarProgram,
      ...(textTemplateEntriesByElementId?.size
        ? {
            textTemplates: Array.from(textTemplateEntriesByElementId, ([elementId, ast]) => ({
              elementId,
              segments: toRustTextTemplateSegments(ast)
            }))
          }
        : {}),
      ...(textPropertyBindingEntries?.length ? { textPropertyBindings: textPropertyBindingEntries } : {})
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    });
    return { fixture, tsPayload, textElementId };
  };

  it("Task 28: a typed string hole formats identically through TS/Rust", () => {
    const { fixture, tsPayload } = textTemplateFixture(
      ["nui 3", 'const ラベル: string = "前身頃"', 'text T = label(text: "{@ラベル}を2枚カット" anchor: none size: 3)'].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toHaveLength(0);
  }, 30000);

  it("Task 28: a typed number hole formats to the same max-3-decimal text through TS/Rust", () => {
    const { fixture, tsPayload } = textTemplateFixture(
      ["nui 3", "const 寸法: number = 12.3456", 'text T = label(text: "寸法={@寸法}mm" anchor: none size: 3)'].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
  }, 30000);

  it("Task 28: mixed legacy+typed holes assemble identically through TS/Rust", () => {
    const { fixture, tsPayload } = textTemplateFixture(
      [
        "nui 3",
        'const ラベル: string = "前身頃"',
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "line 直線AB = segment(start: A end: B)",
        'text T = label(text: "{@ラベル} 長さ={直線AB.length}mm" anchor: none size: 3)'
      ].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toHaveLength(0);
  }, 30000);

  it("Task 28: a poisoned typed hole reports a self-referential error identically through TS/Rust", () => {
    const { fixture, tsPayload, textElementId } = textTemplateFixture(
      ["nui 3", "const 割り算: number = 1 / 0", 'text T = label(text: "{@割り算}" anchor: none size: 3)'].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    const tsResult = evaluationPayloadToResult(tsPayload);
    expect(tsResult.errors).toHaveLength(1);
    expect(tsResult.errors[0].elementId).toBe(textElementId);
  }, 30000);

  it("Task 28: a bare @binding text.text property materializes identically through TS/Rust", () => {
    const { fixture, tsPayload } = textTemplateFixture(
      ["nui 3", 'const ラベル: string = "前身頃"', "text T = label(text: @ラベル anchor: none size: 3)"].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toHaveLength(0);
  }, 30000);

  it("Task 28: a forGroup-generated text element's poisoned typed-hole failure reports per clone identically through TS/Rust", () => {
    const { fixture, tsPayload } = textTemplateFixture(
      [
        "nui 3",
        "const 割り算: number = 1 / 0",
        "for 繰返し (i from: 0 count: 2 step: 1) {",
        '  text T = label(text: "{@割り算}" anchor: none size: 3)',
        "}"
      ].join("\n")
    );
    const rustPayload = evaluateWithRust(fixture);
    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    const tsResult = evaluationPayloadToResult(tsPayload);
    expect(tsResult.errors).toHaveLength(2);
  }, 30000);
});
