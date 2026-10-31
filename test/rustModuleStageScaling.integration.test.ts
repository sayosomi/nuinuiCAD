// @vitest-environment node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, join } from "node:path";
import { afterAll, describe, it, vi } from "vitest";
import { bindingIdForStableStatementId, moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { evaluationResultsMatch, evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation, type PreparedRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import type { EvaluationResult } from "../src/types/geometry";
import {
  assertResult,
  declarationNames,
  hash,
  manifest,
  runtimeOwners,
  sourceFor,
  type Checkpoint,
  type Unit
} from "./issue1515PatternSupport";

type MatrixCase = {
  id: string;
  scale: "S" | "M" | "L";
  composition: "A" | "B" | "C";
  path: string;
  sha256: string;
  runtimeDrawables: number;
  moduleInstances: number;
  version: string;
};

type Point = { x: number; y: number };
type ExpectedGeometry = Record<string, unknown>;
type ScalarExpectation = { semanticName: string; bindingName: string; value: number };
type IndependentExpected = {
  geometry: Record<string, ExpectedGeometry>;
  orderedNames: string[];
  scalars: ScalarExpectation[];
  primitiveCounts: Record<string, number>;
};
type SemanticEntry = { name: string; sourceType: string; geometry: ExpectedGeometry };
type SampleStats = {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  rangeMs: number;
  sampleStandardDeviationMs: number;
  coefficientOfVariationPercent: number;
};
type TimedSeries<T> = { warmupSamplesMs: number[]; rawSamplesMs: number[]; summary: SampleStats; last: T };

const fixtureRoot = "test/fixtures/rust-module-stage-scaling";
const sourceManifest = JSON.parse(readFileSync(`${fixtureRoot}/source-manifest.json`, "utf8")) as {
  cases: MatrixCase[];
};
const oracleManifest = JSON.parse(readFileSync(`${fixtureRoot}/oracle-manifest.json`, "utf8")) as {
  tolerancesMm: { coordinates: number; straightLength: number; bezier32ChordLength: number };
  scaleRows: Record<"S" | "M" | "L", { panelInstances: number; runtimeDrawables: number; rowYmm: number[] }>;
  primitiveCountsByRuntimeDrawableScale: Record<"S" | "M" | "L", Record<string, number>>;
  panelGeometryRule: { widthMm: number; curveConstruction: { independentlyComputed32ChordLengthMm: number } };
  rootControl: { scalarExpectations: Record<string, number> };
  expectedRustEligibility: boolean;
};

const describeMatrix = process.env.ISSUE1519_STAGE_MATRIX_DIR ? describe : describe.skip;

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function sampleStatistics(samplesMs: number[]): SampleStats {
  assert.equal(samplesMs.length, 21, "every measured stage must have 21 samples");
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1];
  const mean = samplesMs.reduce((sum, sample) => sum + sample, 0) / samplesMs.length;
  const variance = samplesMs.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / (samplesMs.length - 1);
  const sampleStandardDeviationMs = Math.sqrt(variance);
  return {
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    rangeMs: sorted[sorted.length - 1] - sorted[0],
    sampleStandardDeviationMs,
    coefficientOfVariationPercent: mean === 0 ? 0 : sampleStandardDeviationMs / mean * 100
  };
}

function elapsedMs<T>(operation: () => T): { elapsed: number; value: T } {
  const started = process.hrtime.bigint();
  const value = operation();
  return { elapsed: Number(process.hrtime.bigint() - started) / 1_000_000, value };
}

function measureSync<T>(operation: () => T): TimedSeries<T> {
  const warmupSamplesMs: number[] = [];
  for (let index = 0; index < 5; index++) warmupSamplesMs.push(elapsedMs(operation).elapsed);
  const rawSamplesMs: number[] = [];
  let last!: T;
  for (let index = 0; index < 21; index++) {
    const sample = elapsedMs(operation);
    rawSamplesMs.push(sample.elapsed);
    last = sample.value;
  }
  return { warmupSamplesMs, rawSamplesMs, summary: sampleStatistics(rawSamplesMs), last };
}

async function elapsedAsync<T>(operation: () => Promise<T>): Promise<{ elapsed: number; value: T }> {
  const started = process.hrtime.bigint();
  const value = await operation();
  return { elapsed: Number(process.hrtime.bigint() - started) / 1_000_000, value };
}

async function within<T>(operation: Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        rustProcess?.dispose();
        reject(new Error("#1519 matrix persistent Rust request exceeded 20 seconds"));
      }, timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let rustProcess: RustEvaluationProcess | undefined;
let rustClosed: Promise<void> | undefined;
let rustSpawns = 0;

function point(x: number, y: number): Point {
  return { x, y };
}

function independentBezier32ChordLength(width: number, handle: number): number {
  const controlPoints = [point(0, 0), point(0, handle), point(width, handle), point(width, 0)];
  const at = (t: number): Point => {
    const inverse = 1 - t;
    const a = inverse ** 3;
    const b = 3 * inverse ** 2 * t;
    const c = 3 * inverse * t ** 2;
    const d = t ** 3;
    return {
      x: a * controlPoints[0].x + b * controlPoints[1].x + c * controlPoints[2].x + d * controlPoints[3].x,
      y: a * controlPoints[0].y + b * controlPoints[1].y + c * controlPoints[2].y + d * controlPoints[3].y
    };
  };
  let previous = at(0);
  let total = 0;
  for (let index = 1; index <= 32; index++) {
    const current = at(index / 32);
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return total;
}

function lineGeometry(start: Point, end: Point, length: number): ExpectedGeometry {
  return { kind: "line", start, end, length };
}

function curveGeometry(width: number, rowY: number, length: number): ExpectedGeometry {
  return {
    kind: "bezierCurve",
    segments: [{
      start: point(0, rowY),
      control1: point(0, rowY + 12),
      control2: point(width, rowY + 12),
      end: point(width, rowY)
    }],
    length
  };
}

function seamGeometry(width: number, rowY: number): ExpectedGeometry {
  const start = point(0, rowY + 3);
  const end = point(width, rowY + 3);
  return {
    kind: "offsetLine",
    start,
    end,
    segments: [{ kind: "line", start, end, length: width }],
    length: width
  };
}

function addPanelGeometry(
  geometry: Record<string, ExpectedGeometry>,
  prefix: string,
  width: number,
  rowY: number,
  curveLength: number
) {
  const a = point(0, rowY);
  const b = point(width, rowY);
  const n0 = point(width / 2, rowY);
  const n1 = point(width / 2, rowY - 2);
  geometry[`${prefix}A`] = { kind: "point", ...a };
  geometry[`${prefix}B`] = { kind: "point", ...b };
  geometry[`${prefix}N0`] = { kind: "point", ...n0 };
  geometry[`${prefix}N1`] = { kind: "point", ...n1 };
  geometry[`${prefix}Edge`] = lineGeometry(a, b, width);
  geometry[`${prefix}Curve`] = curveGeometry(width, rowY, curveLength);
  geometry[`${prefix}Seam`] = seamGeometry(width, rowY);
  geometry[`${prefix}Notch`] = lineGeometry(n0, n1, 2);
}

function independentExpected(entry: MatrixCase): IndependentExpected {
  const panelLength = independentBezier32ChordLength(48, 12);
  const rootLength = independentBezier32ChordLength(40, 12);
  assert.ok(Math.abs(panelLength - oracleManifest.panelGeometryRule.curveConstruction.independentlyComputed32ChordLengthMm) <= 1e-12);
  assert.ok(Math.abs(rootLength - oracleManifest.rootControl.scalarExpectations.ControlcurveLength) <= 1e-12);
  const geometry: Record<string, ExpectedGeometry> = {};
  addPanelGeometry(geometry, "Control", 40, 20, rootLength);
  const scalars: ScalarExpectation[] = [
    { semanticName: "width", bindingName: "width", value: 48 },
    { semanticName: "ControlseamLength", bindingName: "ControlseamLength", value: 40 },
    { semanticName: "ControlcurveLength", bindingName: "ControlcurveLength", value: rootLength }
  ];
  const rows = oracleManifest.scaleRows[entry.scale].rowYmm;
  assert.equal(rows.length, oracleManifest.scaleRows[entry.scale].panelInstances);
  for (const [index, rowY] of rows.entries()) {
    const semanticPrefix = `I${index}::`;
    const sourcePrefix = entry.composition === "B" ? `I${index}` : semanticPrefix;
    addPanelGeometry(geometry, sourcePrefix, 48, rowY, panelLength);
    scalars.push(
      { semanticName: `${semanticPrefix}seamLength`, bindingName: entry.composition === "B" ? `I${index}seamLength` : `${semanticPrefix}seamLength`, value: 48 },
      { semanticName: `${semanticPrefix}curveLength`, bindingName: entry.composition === "B" ? `I${index}curveLength` : `${semanticPrefix}curveLength`, value: panelLength }
    );
  }
  if (entry.composition === "B") {
    const normalized: Record<string, ExpectedGeometry> = {};
    for (const [name, value] of Object.entries(geometry)) {
      if (name.startsWith("Control")) normalized[name] = value;
      else {
        const match = /^(I\d+)(A|B|N0|N1|Edge|Curve|Seam|Notch)$/.exec(name);
        assert.ok(match, `unexpected flattened semantic name ${name}`);
        normalized[`${match[1]}::${match[2]}`] = value;
      }
    }
    return {
      geometry: normalized,
      orderedNames: Object.keys(normalized),
      scalars,
      primitiveCounts: oracleManifest.primitiveCountsByRuntimeDrawableScale[entry.scale]
    };
  }
  return {
    geometry,
    orderedNames: Object.keys(geometry),
    scalars,
    primitiveCounts: oracleManifest.primitiveCountsByRuntimeDrawableScale[entry.scale]
  };
}

function compareComplete(actual: unknown, expected: unknown, path: string, tolerance: number): void {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", path);
    assert.ok(Number.isFinite(actual), `${path} must be finite`);
    assert.ok(Math.abs(Number(actual) - expected) <= tolerance, `${path}: ${actual} != ${expected} ± ${tolerance}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((value, index) => compareComplete(actual[index], value, `${path}[${index}]`, tolerance));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object" && !Array.isArray(actual), path);
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    assert.deepEqual(Object.keys(actualRecord).sort(), Object.keys(expectedRecord).sort(), `${path} fields`);
    for (const [key, value] of Object.entries(expectedRecord)) {
      compareComplete(actualRecord[key], value, `${path}.${key}`, tolerance);
    }
    return;
  }
  assert.deepEqual(actual, expected, path);
}

function compareExpectedFields(actual: unknown, expected: unknown, path: string, tolerance: number): void {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", path);
    assert.ok(Number.isFinite(actual), `${path} must be finite`);
    assert.ok(Math.abs(Number(actual) - expected) <= tolerance, `${path}: ${actual} != ${expected} ± ${tolerance}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((value, index) => compareExpectedFields(actual[index], value, `${path}[${index}]`, tolerance));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object" && !Array.isArray(actual), path);
    const actualRecord = actual as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      assert.ok(Object.hasOwn(actualRecord, key), `${path}.${key} is present`);
      compareExpectedFields(actualRecord[key], value, `${path}.${key}`, tolerance);
    }
    return;
  }
  assert.deepEqual(actual, expected, path);
}

function normalizeGeometry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGeometry);
  if (value && typeof value === "object") {
    const identityFields = new Set([
      "elementId", "name", "startPointId", "endPointId", "baseLineIds", "intermediatePointIds", "intermediateSlotIds"
    ]);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !identityFields.has(key))
      .map(([key, child]) => [key, normalizeGeometry(child)]));
  }
  return value;
}

function semanticName(entry: MatrixCase, compiled: TextCompileResult, elementId: string, elementName: string): string {
  if (elementName.startsWith("Control")) return elementName;
  if (entry.composition === "B") {
    const match = /^(I\d+)(A|B|N0|N1|Edge|Curve|Seam|Notch)$/.exec(elementName);
    assert.ok(match, `${entry.id} has unexpected direct source name ${elementName}`);
    return `${match[1]}::${match[2]}`;
  }
  const owner = runtimeOwnersById(compiled).get(elementId);
  assert.ok(owner, `${entry.id} runtime element ${elementName} must have a source owner`);
  return owner.path.length === 0 ? elementName : `${owner.path[0]}::${elementName}`;
}

function runtimeOwnersById(compiled: TextCompileResult) {
  return new Map([...runtimeOwners(compiled).values()].map(owner => [owner.id, owner]));
}

function assertGeometryAndOwnership(
  entry: MatrixCase,
  compiled: TextCompileResult,
  result: EvaluationResult,
  expected: IndependentExpected
): SemanticEntry[] {
  assert.deepEqual(result.errors, [], `${entry.id} Rust dependency errors`);
  assert.deepEqual(result.geometryValueErrors ?? [], [], `${entry.id} geometry-value errors`);
  assert.deepEqual(result.warnings, [], `${entry.id} Rust warnings`);
  assert.equal(result.computedGeometry.size, entry.runtimeDrawables, `${entry.id} runtime drawable count`);

  const elements = compiled.doc.document.elements.filter(element => element.type !== "moduleInstance");
  const elementsById = new Map(elements.map(element => [element.id, element]));
  const actualByName = new Map<string, { element: (typeof elements)[number]; geometry: ExpectedGeometry }>();
  const primitiveCounts: Record<string, number> = {};
  for (const [elementId, geometry] of result.computedGeometry) {
    const element = elementsById.get(elementId);
    assert.ok(element, `${entry.id} output element id ${elementId} must come from compiled runtime elements`);
    const name = semanticName(entry, compiled, elementId, element.name);
    assert.ok(!actualByName.has(name), `${entry.id} duplicate semantic geometry name ${name}`);
    actualByName.set(name, { element, geometry: geometry as unknown as ExpectedGeometry });
    const kind = (geometry as { kind?: string }).kind ?? "unknown";
    primitiveCounts[kind] = (primitiveCounts[kind] ?? 0) + 1;
  }
  assert.deepEqual([...actualByName.keys()].sort(), [...expected.orderedNames].sort(), `${entry.id} complete semantic geometry names`);
  assert.deepEqual(Object.fromEntries(Object.entries(primitiveCounts).sort()),
    Object.fromEntries(Object.entries(expected.primitiveCounts).sort()), `${entry.id} primitive kind distribution`);

  const projection = expected.orderedNames.map(name => {
    const observed = actualByName.get(name);
    assert.ok(observed, `${entry.id} expected semantic geometry ${name}`);
    const member = name.split("::").at(-1)!;
    const sourceMember = member.startsWith("Control") ? member.slice("Control".length) : member;
    const expectedSourceType = sourceMember === "A" ? "freePoint"
      : ["B", "N0", "N1"].includes(sourceMember) ? "offsetPoint"
        : sourceMember === "Curve" ? "bezierCurve"
          : sourceMember === "Seam" ? "offsetLine" : "line";
    assert.equal(observed.element.type, expectedSourceType, `${entry.id} ${name} authored primitive type`);
    const geometricFields = normalizeGeometry(observed.geometry);
    compareExpectedFields(geometricFields, expected.geometry[name], `${entry.id}.${name}`, oracleManifest.tolerancesMm.bezier32ChordLength);
    return { name, sourceType: observed.element.type, geometry: geometricFields };
  });

  const namesById = new Map([...declarationNames(compiled)].map(([statementId, name]) => [name, statementId]));
  const observedScalars: Record<string, number> = {};
  for (const scalar of expected.scalars) {
    const moduleMemberName = scalar.bindingName.includes("::")
      ? `Panel::${scalar.bindingName.split("::")[1]}`
      : scalar.bindingName;
    const statementId = namesById.get(moduleMemberName);
    assert.ok(statementId, `${entry.id} scalar declaration ${scalar.bindingName}`);
    const bindingId = scalar.bindingName.includes("::")
      ? moduleScalarBindingIdFor(
          [namesById.get(scalar.bindingName.split("::")[0])!],
          namesById.get("Panel")!,
          statementId
        )
      : bindingIdForStableStatementId(statementId);
    const evaluated = result.computedScalarBindings?.get(bindingId);
    assert.ok(evaluated?.status === "ok", `${entry.id} scalar ${scalar.semanticName} must evaluate`);
    assert.equal(evaluated.value.kind, "number", `${entry.id} scalar ${scalar.semanticName} type`);
    if (evaluated.value.kind === "number") {
      assert.ok(Math.abs(evaluated.value.value - scalar.value) <= oracleManifest.tolerancesMm.bezier32ChordLength,
        `${entry.id} scalar ${scalar.semanticName}: ${evaluated.value.value} != ${scalar.value}`);
      observedScalars[scalar.semanticName] = evaluated.value.value;
    }
  }
  const expectedScalarBindingCount = expected.scalars.length
    + (entry.composition === "B" ? 0 : entry.moduleInstances * 2);
  assert.equal(result.computedScalarBindings?.size, expectedScalarBindingCount, `${entry.id} complete scalar output count`);

  const snapshots = compiled.doc.moduleMaterialization?.instanceBaseGeometrySnapshots ?? [];
  assert.equal(snapshots.length, entry.moduleInstances, `${entry.id} Module snapshot count`);
  const preparedModuleInstances = compiled.doc.document.elements.filter(element => element.type === "moduleInstance");
  assert.equal(preparedModuleInstances.length, entry.moduleInstances, `${entry.id} Module instance count`);
  const owners = entry.composition === "B" ? undefined : runtimeOwnersById(compiled);
  for (const [index, snapshot] of snapshots.entries()) {
    assert.equal(snapshot.descendantIds.length, 8, `${entry.id} Module snapshot descendants`);
    for (const descendantId of snapshot.descendantIds) {
      const owner = owners?.get(descendantId);
      assert.ok(owner, `${entry.id} descendant ${descendantId} source owner`);
      assert.deepEqual(owner.path, [`I${index}`], `${entry.id} descendant owner path`);
    }
  }

  assert.equal(Object.keys(observedScalars).length, expected.scalars.length, `${entry.id} scalar projection count`);
  return projection;
}

function assertModuleFreeSemanticGeometry(
  entry: MatrixCase,
  compiled: TextCompileResult,
  result: EvaluationResult,
  expected: IndependentExpected
): SemanticEntry[] {
  assert.equal(entry.moduleInstances, 0);
  assert.equal(compiled.doc.moduleMaterialization?.instanceBaseGeometrySnapshots.length ?? 0, 0);
  return assertGeometryAndOwnership(entry, compiled, result, expected);
}

function scalarProjection(entry: MatrixCase, compiled: TextCompileResult, result: EvaluationResult, expected: IndependentExpected) {
  const namesById = new Map([...declarationNames(compiled)].map(([statementId, name]) => [name, statementId]));
  return expected.scalars.map(scalar => {
    const moduleMemberName = scalar.bindingName.includes("::")
      ? `Panel::${scalar.bindingName.split("::")[1]}`
      : scalar.bindingName;
    const statementId = namesById.get(moduleMemberName)!;
    const bindingId = scalar.bindingName.includes("::")
      ? moduleScalarBindingIdFor([namesById.get(scalar.bindingName.split("::")[0])!], namesById.get("Panel")!, statementId)
      : bindingIdForStableStatementId(statementId);
    const evaluated = result.computedScalarBindings?.get(bindingId);
    assert.ok(evaluated?.status === "ok", `${entry.id} scalar ${scalar.semanticName}`);
    assert.ok(evaluated.value.kind === "number", `${entry.id} scalar ${scalar.semanticName} is numeric`);
    return { name: scalar.semanticName, value: evaluated.value.value };
  });
}

function findIssue1515Checkpoint(entry: MatrixCase): { checkpoint: Checkpoint; unit: Unit } {
  const unit = manifest.units.find(candidate => candidate.id === `${entry.scale}-P`);
  assert.ok(unit, `${entry.id} #1515 source-backed oracle unit`);
  const checkpoint = unit.checkpoints.find(candidate => candidate.file.endsWith("-P-0.nui"));
  assert.ok(checkpoint, `${entry.id} #1515 P-0 checkpoint`);
  return { checkpoint, unit };
}

async function captureProductionRequest(input: PreparedRustEvaluation["input"]): Promise<{
  payload: EvaluationPayload;
  requestLine: string;
  responseLine: string;
}> {
  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  let requestLine: string | undefined;
  let responseLine: string | undefined;
  const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
    const encoded = originalStringify.call(JSON, value, replacer, space);
    if (value && typeof value === "object" && "id" in value && "input" in value) requestLine = encoded;
    return encoded;
  });
  const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    if (typeof text === "string" && text.startsWith("{\"id\":") && text.includes("\"payload\"")) responseLine = text;
    return originalParse.call(JSON, text, reviver);
  });
  try {
    const payload = await within(rustProcess!.request(input)) as EvaluationPayload;
    assert.ok(requestLine, "production RustEvaluationProcess JSON.stringify request was captured");
    assert.ok(responseLine, "production RustEvaluationProcess JSON.parse response bytes were captured");
    return { payload, requestLine, responseLine };
  } finally {
    stringifySpy.mockRestore();
    parseSpy.mockRestore();
  }
}

describeMatrix("Issue #1519 frozen nine-program Rust Module stage matrix", () => {
  it("seals independent geometry, checks the complete oracle, and records isolated stages", async () => {
    const requestDir = process.env.ISSUE1519_STAGE_MATRIX_DIR;
    assert.ok(requestDir, "set ISSUE1519_STAGE_MATRIX_DIR outside the checkout");
    const outputDir = resolve(requestDir);
    const binaryPath = resolve(process.env.ISSUE1519_RUST_STDIO_BINARY ?? "rust-evaluator/target/release/evaluation_stdio");
    const binaryHash = sha256(readFileSync(binaryPath));
    const cases = sourceManifest.cases;
    assert.deepEqual(cases.map(entry => entry.id), ["S-A", "S-B", "S-C", "M-A", "M-B", "M-C", "L-A", "L-B", "L-C"]);
    const expectedByCase = new Map(cases.map(entry => [entry.id, independentExpected(entry)]));

    const sources = new Map<string, string>();
    for (const entry of cases) {
      let source: string;
      if (entry.composition === "A") {
        const { checkpoint } = findIssue1515Checkpoint(entry);
        source = sourceFor(checkpoint);
      } else {
        source = readFileSync(entry.path, "utf8");
      }
      assert.equal(hash(source), entry.sha256, `${entry.id} frozen source SHA-256`);
      sources.set(entry.id, source);
    }

    const compiledByCase = new Map<string, TextCompileResult>();
    const optionsByCase = new Map<string, ReturnType<typeof buildEvaluationOptions>>();
    const preparedByCase = new Map<string, PreparedRustEvaluation>();
    const nodeStagesByCase = new Map<string, Record<string, unknown>>();
    const caseRecords = new Map<string, Record<string, unknown>>();

    for (const entry of cases) {
      const source = sources.get(entry.id)!;
      const compilation = measureSync(() => compileFreshCanonicalText(source));
      const compiled = compilation.last;
      assert.notEqual(compiled.status, "fatal", `${entry.id} frozen source must compile`);
      const compileDiagnostics = [...compiled.diagnostics, ...compiled.bindingIssueDiagnostics];
      assert.deepEqual(compileDiagnostics, [], `${entry.id} compile warnings/errors`);
      assert.equal(compiled.doc.document.elements.filter(element => element.type !== "moduleInstance").length,
        entry.runtimeDrawables, `${entry.id} compiled drawable count`);
      assert.equal(compiled.doc.document.elements.filter(element => element.type === "moduleInstance").length,
        entry.moduleInstances, `${entry.id} compiled Module instance count`);

      const optionsSeries = measureSync(() => buildEvaluationOptions({
        compiledDocument: compiled.doc,
        evaluationLimitIndex: undefined
      }));
      const options = optionsSeries.last;
      const prepareSeries = measureSync(() => prepareRustEvaluation(compiled.doc.document.elements, options));
      const prepared = prepareSeries.last;
      assert.equal(prepared.rustEligible, oracleManifest.expectedRustEligibility, `${entry.id} Rust eligibility`);
      assert.equal(prepared.input.elements.length, entry.runtimeDrawables + entry.moduleInstances,
        `${entry.id} serialized runtime element count`);

      compiledByCase.set(entry.id, compiled);
      optionsByCase.set(entry.id, options);
      preparedByCase.set(entry.id, prepared);
      nodeStagesByCase.set(entry.id, {
        canonicalSourceCompilation: {
          warmupSamplesMs: compilation.warmupSamplesMs,
          rawSamplesMs: compilation.rawSamplesMs,
          summary: compilation.summary
        },
        buildEvaluationOptions: {
          warmupSamplesMs: optionsSeries.warmupSamplesMs,
          rawSamplesMs: optionsSeries.rawSamplesMs,
          summary: optionsSeries.summary
        },
        prepareRustEvaluation: {
          warmupSamplesMs: prepareSeries.warmupSamplesMs,
          rawSamplesMs: prepareSeries.rawSamplesMs,
          summary: prepareSeries.summary
        }
      });
    }

    rustProcess = new RustEvaluationProcess(binaryPath, {
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        const child = spawn(...args) as ChildProcessWithoutNullStreams;
        rustSpawns++;
        rustClosed = new Promise<void>(resolveClosed => {
          child.once("close", () => resolveClosed());
          child.once("error", () => resolveClosed());
        });
        return child;
      }) as typeof spawn
    });

    const semanticProjections = new Map<string, SemanticEntry[]>();
    const scalarProjections = new Map<string, Array<{ name: string; value: number }>>();
    const capturedEnvelopes = new Map<string, { requestLine: string; responseLine: string }>();
    for (const entry of cases) {
      const compiled = compiledByCase.get(entry.id)!;
      const options = optionsByCase.get(entry.id)!;
      const prepared = preparedByCase.get(entry.id)!;
      const source = sources.get(entry.id)!;
      const expected = expectedByCase.get(entry.id)!;
      const inputJson = JSON.stringify(prepared.input);
      const inputHash = sha256(inputJson);
      const capture = await captureProductionRequest(prepared.input);
      const parsedRequest = JSON.parse(capture.requestLine) as { id: number; input: unknown };
      const parsedResponse = JSON.parse(capture.responseLine) as { id: number; payload: EvaluationPayload };
      assert.equal(parsedResponse.id, parsedRequest.id, `${entry.id} response id`);
      assert.deepEqual(parsedRequest.input, JSON.parse(inputJson), `${entry.id} exact production request input`);
      assert.deepEqual(parsedResponse.payload, capture.payload, `${entry.id} captured stdio payload`);

      const rustResult = evaluationPayloadToResult(capture.payload);
      const rustProjection = assertGeometryAndOwnership(entry, compiled, rustResult, expected);
      const referencePayload = evaluateElementsReferencePayload(compiled.doc.document.elements, options);
      const referenceResult = evaluationPayloadToResult(referencePayload);
      const referenceProjection = assertGeometryAndOwnership(entry, compiled, referenceResult, expected);
      assert.ok(evaluationResultsMatch(rustResult, referenceResult), `${entry.id} complete Rust/TypeScript result parity`);
      compareComplete(rustProjection, referenceProjection, `${entry.id} ordered Rust/TypeScript semantic projection`,
        oracleManifest.tolerancesMm.bezier32ChordLength);

      if (entry.composition === "A" || entry.composition === "C") {
        const { checkpoint, unit } = findIssue1515Checkpoint(entry);
        assertResult(compiled, rustResult, checkpoint, unit);
        assertResult(compiled, referenceResult, checkpoint, unit);
      } else {
        assertModuleFreeSemanticGeometry(entry, compiled, rustResult, expected);
        assertModuleFreeSemanticGeometry(entry, compiled, referenceResult, expected);
      }

      semanticProjections.set(entry.id, rustProjection);
      scalarProjections.set(entry.id, scalarProjection(entry, compiled, rustResult, expected));
      capturedEnvelopes.set(entry.id, { requestLine: capture.requestLine, responseLine: capture.responseLine });
      const moduleSnapshots = prepared.input.moduleMaterialization?.instances ?? [];
      const edgeKinds: Record<string, number> = {};
      for (const edge of compiled.typedDependencyGraph?.edges ?? []) {
        edgeKinds[edge.kind] = (edgeKinds[edge.kind] ?? 0) + 1;
      }
      const bindingVersions = prepared.input.bindingVersions as { versions?: unknown[] } | undefined;
      const scalarProgram = prepared.input.scalarProgram as { statements?: unknown[] } | undefined;
      const inputAfter = JSON.stringify(prepared.input);
      assert.equal(sha256(inputAfter), inputHash, `${entry.id} prepared request remains frozen after oracle evaluation`);
      const requestBytes = Buffer.byteLength(capture.requestLine);
      const responseBytes = Buffer.byteLength(capture.responseLine);
      const record = {
        case: entry.id,
        version: entry.version,
        composition: entry.composition,
        sourcePath: entry.path,
        sourceBytes: Buffer.byteLength(source),
        sourceSha256: entry.sha256,
        rustEligible: prepared.rustEligible,
        inputSha256: inputHash,
        inputBytes: Buffer.byteLength(inputJson),
        productionRequestSha256: sha256(capture.requestLine),
        productionRequestBytes: requestBytes,
        wireRequestBytesIncludingLineFeed: requestBytes + 1,
        productionResponseSha256: sha256(capture.responseLine),
        productionResponseBytes: responseBytes,
        wireResponseBytesIncludingLineFeed: responseBytes + 1,
        requestId: parsedRequest.id,
        runtimeElementCount: prepared.input.elements.length,
        runtimeDrawableCount: entry.runtimeDrawables,
        moduleInstanceCount: entry.moduleInstances,
        moduleSnapshotCount: moduleSnapshots.length,
        moduleDescendantReferences: moduleSnapshots.reduce((sum, snapshot) => sum + snapshot.descendantIds.length, 0),
        computedScalarBindingCount: rustResult.computedScalarBindings?.size ?? 0,
        bindingVersionCount: bindingVersions?.versions?.length ?? 0,
        scalarProgramStatementCount: scalarProgram?.statements?.length ?? 0,
        dependencyEdgeCount: compiled.typedDependencyGraph?.edges.length ?? 0,
        dependencyEdgeKinds: edgeKinds,
        oracle: {
          compileDiagnostics: 0,
          rustErrors: rustResult.errors.length,
          rustWarnings: rustResult.warnings.length,
          typescriptErrors: referenceResult.errors.length,
          typescriptWarnings: referenceResult.warnings.length,
          rustEligibility: prepared.rustEligible,
          completeSemanticProjection: "PASS",
          fullResultRustTypeScriptParity: "PASS",
          issue1515IndependentOracle: entry.composition === "B" ? "not-applicable-to-module-free-source" : "PASS"
        },
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        releaseStdioBinaryPath: binaryPath,
        releaseStdioBinarySha256: binaryHash
      };
      caseRecords.set(entry.id, record);
      writeFileSync(join(outputDir, `${entry.id}.request.json`), capture.requestLine);
      writeFileSync(join(outputDir, `${entry.id}.response.json`), capture.responseLine);
      writeFileSync(join(outputDir, `${entry.id}.case-metadata.json`), `${JSON.stringify(record, null, 2)}\n`);
    }

    for (const scale of ["S", "M", "L"] as const) {
      const a = semanticProjections.get(`${scale}-A`)!;
      const b = semanticProjections.get(`${scale}-B`)!;
      const c = semanticProjections.get(`${scale}-C`)!;
      compareComplete(a, b, `${scale} A/B source-name geometry`, oracleManifest.tolerancesMm.bezier32ChordLength);
      compareComplete(a, c, `${scale} A/C source-name geometry`, oracleManifest.tolerancesMm.bezier32ChordLength);
      compareComplete(scalarProjections.get(`${scale}-A`), scalarProjections.get(`${scale}-B`), `${scale} A/B scalar values`,
        oracleManifest.tolerancesMm.bezier32ChordLength);
      compareComplete(scalarProjections.get(`${scale}-A`), scalarProjections.get(`${scale}-C`), `${scale} A/C scalar values`,
        oracleManifest.tolerancesMm.bezier32ChordLength);
    }

    for (const entry of cases) {
      const prepared = preparedByCase.get(entry.id)!;
      const envelopes = capturedEnvelopes.get(entry.id)!;
      const requestObject = JSON.parse(envelopes.requestLine) as { id: number; input: unknown };
      const exactFrame = JSON.stringify({ id: requestObject.id, input: prepared.input });
      assert.equal(exactFrame, envelopes.requestLine, `${entry.id} stage-4 JSON.stringify must match production request`);
      const responseObject = JSON.parse(envelopes.responseLine) as { id: number; payload: unknown };
      const requestHashBefore = sha256(JSON.stringify(prepared.input));
      const stringify = measureSync(() => JSON.stringify({ id: requestObject.id, input: prepared.input }));
      assert.equal(stringify.last, envelopes.requestLine, `${entry.id} measured JSON.stringify bytes`);
      const parse = measureSync(() => JSON.parse(envelopes.responseLine));
      assert.deepEqual(parse.last, responseObject, `${entry.id} measured JSON.parse response`);

      const requestWarmupsMs: number[] = [];
      const requestSamplesMs: number[] = [];
      const conversionWarmupsMs: number[] = [];
      const conversionSamplesMs: number[] = [];
      const convertPayload = (payload: unknown) => evaluationPayloadToResult(payload as EvaluationPayload);
      for (let index = 0; index < 5; index++) {
        const request = await elapsedAsync(() => within(rustProcess!.request(prepared.input)));
        requestWarmupsMs.push(request.elapsed);
        const conversion = elapsedMs(() => convertPayload(request.value));
        conversionWarmupsMs.push(conversion.elapsed);
        assert.equal(conversion.value.computedGeometry.size, entry.runtimeDrawables, `${entry.id} warmup conversion geometry count`);
      }
      for (let index = 0; index < 21; index++) {
        const request = await elapsedAsync(() => within(rustProcess!.request(prepared.input)));
        requestSamplesMs.push(request.elapsed);
        const conversion = elapsedMs(() => convertPayload(request.value));
        conversionSamplesMs.push(conversion.elapsed);
        assert.equal(conversion.value.computedGeometry.size, entry.runtimeDrawables, `${entry.id} measured conversion geometry count`);
        assert.deepEqual(conversion.value.errors, [], `${entry.id} measured conversion dependency errors`);
        assert.deepEqual(conversion.value.warnings, [], `${entry.id} measured conversion warnings`);
      }
      assert.equal(sha256(JSON.stringify(prepared.input)), requestHashBefore, `${entry.id} prepared input stable across stage repetitions`);

      const stages = {
        ...(nodeStagesByCase.get(entry.id) ?? {}),
        nodeJsonStringifyRequest: {
          warmupSamplesMs: stringify.warmupSamplesMs,
          rawSamplesMs: stringify.rawSamplesMs,
          summary: stringify.summary
        },
        persistentRustStdioRequestResponse: {
          warmupSamplesMs: requestWarmupsMs,
          rawSamplesMs: requestSamplesMs,
          summary: sampleStatistics(requestSamplesMs),
          processSpawnCountForMatrix: rustSpawns
        },
        nodeJsonParseResponse: {
          warmupSamplesMs: parse.warmupSamplesMs,
          rawSamplesMs: parse.rawSamplesMs,
          summary: parse.summary
        },
        nodePayloadConversion: {
          warmupSamplesMs: conversionWarmupsMs,
          rawSamplesMs: conversionSamplesMs,
          summary: sampleStatistics(conversionSamplesMs)
        },
        stageTimingNotes: [
          "Preparation stages 1-3 produce the single frozen prepared input reused by stages 4-7 and the external Rust stages.",
          "Stage 5 is an uninstrumented production Release RustEvaluationProcess roundtrip on one persistent process; stages 4, 6 and 7 are separately timed and not additive.",
          "Stages 8-10 run in a separate Release cfg(test) test binary; its identity and instrumentation are recorded separately."
        ]
      };
      nodeStagesByCase.set(entry.id, stages);
      const resultRecord = {
        ...(caseRecords.get(entry.id) ?? {}),
        stages
      };
      writeFileSync(join(outputDir, `${entry.id}.node-stage-result.json`), `${JSON.stringify(resultRecord, null, 2)}\n`);
      console.log(`ISSUE1519_NODE_STAGE_MATRIX ${JSON.stringify(resultRecord)}`);
    }

    assert.equal(rustSpawns, 1, "one persistent Rust stdio process serves all nine programs");
  }, 300_000);
});

afterAll(async () => {
  rustProcess?.dispose();
  if (rustClosed) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([rustClosed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("#1519 persistent Rust stdio process failed to close after dispose")), 5_000);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
});
