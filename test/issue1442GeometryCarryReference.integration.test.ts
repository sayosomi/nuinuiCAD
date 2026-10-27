import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { normalizeParityPayload } from "./evaluationParitySupport";
import { geometryProof } from "./fixtures/issue-stage7/assertions";
import cases from "./fixtures/issue1260-d1/cases.json";
import frozen from "./fixtures/issue1260-d1/freeze.json";
import { checkCampaign, type Cell } from "./fixtures/issue1260-d1/assertions";

const issueCases = cases as Cell[];
const selectedCases = ["C-carry-if", "C-carry-if-control", "R1-04"];
const blank = regenerateCanonicalFromModel(emptyDocument(), 1);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let disposing = false;
let resourceError: Error | undefined;

const carryReferencesIn = (value: unknown): { collectionValueId: string; geometryType: string }[] => {
  if (Array.isArray(value)) return value.flatMap(carryReferencesIn);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(object.kind === "carryReference" && typeof object.collectionValueId === "string" && typeof object.geometryType === "string"
      ? [{ collectionValueId: object.collectionValueId, geometryType: object.geometryType }]
      : []),
    ...Object.values(object).flatMap(carryReferencesIn)
  ];
};
const collectionValueIdsIn = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectionValueIdsIn);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(typeof object.collectionValueId === "string" ? [object.collectionValueId] : []),
    ...Object.values(object).flatMap(collectionValueIdsIn)
  ];
};

beforeAll(() => {
  for (const id of selectedCases) {
    const source = issueCases.find((candidate) => candidate.id === id);
    const expected = frozen.find((candidate) => candidate.id === id);
    expect(source, `frozen source ${id}`).toBeDefined();
    expect(expected, `independent oracle ${id}`).toBeDefined();
    expect(sha256(source!.source), `frozen source hash ${id}`).toBe(expected!.sha256);
    expect(source).toMatchObject({ expected: expected!.expected, geometry: expected!.geometry, errors: expected!.errors });
  }
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], {
    timeout: 120_000,
    stdio: "inherit"
  });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      closed = new Promise((resolve) => {
        child!.once("close", (code, signal) => {
          if (!disposing) resourceError = new Error(`unexpected persistent Rust close ${code}/${signal}`);
          resolve();
        });
        child!.once("error", (error) => { resourceError = error; });
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (!disposing || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) resourceError = error;
      });
      return child;
    }) as typeof spawn
  });
}, 130_000);

afterAll(async () => {
  disposing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    rust?.dispose();
    if (closed) {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            child?.kill("SIGKILL");
            reject(new Error("persistent Rust cleanup exceeded 5 seconds"));
          }, 5_000);
        })
      ]);
    }
  } finally {
    clearTimeout(timer);
  }
  if (resourceError) throw resourceError;
}, 10_000);

for (const id of selectedCases) it(`${id}: compiler, TypeScript reference, and persistent Rust preserve the frozen oracle`, async () => {
  if (resourceError) throw resourceError;
  const cell = issueCases.find((candidate) => candidate.id === id)!;
  const result = compileCanonicalText(blank, cell.source);
  expect(result.status, "frozen source compiles").toBe("valid");
  expect(result.diagnostics).toEqual([]);
  const compiled = result.doc;
  const elements = compiled.document.elements;
  const options = buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  });
  const prepared = prepareRustEvaluation(elements, options);
  expect(prepared.rustEligible, "ordinary production eligibility permits the request").toBe(true);

  const references = carryReferencesIn(prepared.input.geometryCollectionNodes);
  if (id === "C-carry-if") {
    expect(references).toEqual([
      expect.objectContaining({
        collectionValueId: expect.stringMatching(/^carry-collection:binding:/),
        geometryType: "point"
      })
    ]);
    expect(collectionValueIdsIn(prepared.input.bindingVersions)).toContain(references[0]!.collectionValueId);
    expect(JSON.parse(JSON.stringify(references))).toEqual(references);
  }
  if (id === "R1-04") {
    expect(references.length).toBe(2);
    expect(references.every((reference) => reference.geometryType === "point")).toBe(true);
    expect(references.every((reference) => reference.collectionValueId.startsWith("carry-collection:module-binding:"))).toBe(true);
    expect(new Set(references.map((reference) => reference.collectionValueId)).size).toBe(2);
    const plannedCollectionIds = collectionValueIdsIn(prepared.input.bindingVersions);
    expect(references.every((reference) => plannedCollectionIds.includes(reference.collectionValueId))).toBe(true);
  }

  const referencePayload = evaluateElementsReferencePayload(elements, options);
  checkCampaign(cell, result, referencePayload);
  const productionPayload: EvaluationPayload = await rust!.request(prepared.input);
  checkCampaign(cell, result, productionPayload);
  expect(normalizeParityPayload(productionPayload)).toEqual(normalizeParityPayload(referencePayload));
  expect(evaluationPayloadToResult(productionPayload).errors).toEqual([]);
  if (id === "C-carry-if") expect(productionPayload.geometryValueErrors ?? []).toEqual([]);
});

it("preserves point, line, and path carry types through selected if and match branches", async () => {
  const source = [
    "nui 1",
    "const P: point = coordinate(x: 3, y: 4)",
    "const Bad: point = coordinate(x: 1 / 0, y: 0)",
    "line Seed = segment(start: (0, 0), end: (5, 0))",
    "const Mode: choice(keep, poison) = keep",
    "for Tick in range(min: 0, max: 1, step: 1) carry Points: point[] = [@P] carry Lines: line[] = [@Seed] carry Paths: path[] = [@Seed] {",
    "  const SelectedPoints: point[] = if (true) { @Points } else { [@Bad] }",
    "  const SelectedLines: line[] = if (false) { [@Seed] } else { @Lines }",
    "  const SelectedPaths: path[] = match @Mode { keep => @Paths poison => [@Seed] }",
    "  next Points = @SelectedPoints",
    "  next Lines = @SelectedLines",
    "  next Paths = @SelectedPaths",
    "}",
    "point OutPoint = from(source: @Points[0])",
    "line OutLine = from(source: @Lines[0])",
    "line OutPath = offset(sources: [@Paths[0]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
    "const PathCount: number = @Paths.length"
  ].join("\n");
  const result = compileCanonicalText(blank, source);
  expect(result.status).toBe("valid");
  expect(result.diagnostics).toEqual([]);
  const compiled = result.doc;
  const options = buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  });
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible).toBe(true);
  const references = carryReferencesIn(prepared.input.geometryCollectionNodes);
  expect([...new Set(references.map((reference) => reference.geometryType))].sort()).toEqual(["line", "path", "point"]);
  expect(JSON.parse(JSON.stringify(prepared.input.geometryCollectionNodes))).toEqual(prepared.input.geometryCollectionNodes);

  const referencePayload = evaluateElementsReferencePayload(compiled.document.elements, options);
  const productionPayload = await rust!.request(prepared.input);
  const selectedOwners = ["OutPoint", "OutLine"];
  const selectedProof = (payload: EvaluationPayload) => geometryProof(result, payload)
    .filter((geometry) => selectedOwners.includes(geometry.owner))
    .sort((left, right) => left.owner.localeCompare(right.owner));
  const expected = [
    { owner: "OutLine", shape: { kind: "line", vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }], length: 5 } },
    { owner: "OutPoint", shape: { kind: "point", x: 3, y: 4 } }
  ];
  const outPathElement = compiled.document.elements.find((element) => element.name === "OutPath")!;
  const pointLinePayload = (payload: EvaluationPayload): EvaluationPayload => ({
    ...payload,
    computedGeometry: payload.computedGeometry.filter((geometry) => geometry.elementId !== outPathElement.id)
  });
  expect(selectedProof(pointLinePayload(referencePayload))).toEqual(expected);
  expect(selectedProof(pointLinePayload(productionPayload))).toEqual(expected);
  expect(evaluationPayloadToResult(referencePayload).computedGeometry.get(outPathElement.id)).toMatchObject({ kind: "offsetLine" });
  expect(evaluationPayloadToResult(productionPayload).computedGeometry.get(outPathElement.id)).toMatchObject({ kind: "offsetLine" });
  expect(productionPayload.errors).toEqual([]);
  expect(productionPayload.geometryValueErrors ?? []).toEqual([]);
  const pathLengthBinding = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "PathCount")!;
  expect(evaluationPayloadToResult(referencePayload).computedScalarBindings?.get(pathLengthBinding.id))
    .toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
  expect(evaluationPayloadToResult(productionPayload).computedScalarBindings?.get(pathLengthBinding.id))
    .toMatchObject({ status: "ok", value: { kind: "number", value: 1 } });
  expect(normalizeParityPayload(productionPayload)).toEqual(normalizeParityPayload(referencePayload));
});

it("resolves a selected whole carry alias against each incoming runtime generation", async () => {
  const source = [
    "nui 1",
    "const P: point = coordinate(x: 0, y: 0)",
    "const Ticks: number[] = [1, 2]",
    "for Tick in @Ticks carry Points: point[] = [@P] {",
    "  const Mapped: point[] = for Item in @Points { coordinate(x: @Item.x + 1, y: @Item.y) }",
    "  const Selected: point[] = if (@Tick == 1) { @Mapped } else { @Points }",
    "  next Points = @Selected",
    "}",
    "point Observed = from(source: @Points[0])"
  ].join("\n");
  const result = compileCanonicalText(blank, source);
  expect(result.status).toBe("valid");
  expect(result.diagnostics).toEqual([]);
  const compiled = result.doc;
  const options = buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  });
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible).toBe(true);
  expect(carryReferencesIn(prepared.input.geometryCollectionNodes)).toEqual([
    expect.objectContaining({ collectionValueId: expect.stringMatching(/^carry-collection:binding:/), geometryType: "point" })
  ]);

  const referencePayload = evaluateElementsReferencePayload(compiled.document.elements, options);
  const productionPayload = await rust!.request(prepared.input);
  expect(geometryProof(result, referencePayload)).toContainEqual({ owner: "Observed", shape: { kind: "point", x: 1, y: 0 } });
  expect(geometryProof(result, productionPayload)).toContainEqual({ owner: "Observed", shape: { kind: "point", x: 1, y: 0 } });
  expect(productionPayload.errors).toEqual([]);
  expect(productionPayload.geometryValueErrors ?? []).toEqual([]);
  expect(normalizeParityPayload(productionPayload)).toEqual(normalizeParityPayload(referencePayload));
});

it("evaluates a selected poison arm while keeping its unselected carry arm inert", async () => {
  const source = [
    "nui 1",
    "const P: point = coordinate(x: 3, y: 4)",
    "const Bad: point = coordinate(x: 1 / 0, y: 0)",
    "for Tick in range(min: 0, max: 1, step: 1) carry Points: point[] = [@P] {",
    "  const Selected: point[] = if (false) { @Points } else { [@Bad] }",
    "  next Points = @Selected",
    "}",
    "point Observed = from(source: @Points[0])"
  ].join("\n");
  const result = compileCanonicalText(blank, source);
  expect(result.status).toBe("valid");
  expect(result.diagnostics).toEqual([]);
  const compiled = result.doc;
  const options = buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  });
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible).toBe(true);
  const referencePayload = evaluateElementsReferencePayload(compiled.document.elements, options);
  const productionPayload = await rust!.request(prepared.input);
  const hasRuntimeFailure = (payload: EvaluationPayload) =>
    payload.errors.length > 0 || (payload.geometryValueErrors?.length ?? 0) > 0;
  expect(hasRuntimeFailure(referencePayload)).toBe(true);
  expect(hasRuntimeFailure(productionPayload)).toBe(true);
  expect(normalizeParityPayload(productionPayload)).toEqual(normalizeParityPayload(referencePayload));
});

it("rejects a scalar carry used as a whole geometry collection", () => {
  const source = [
    "nui 1",
    "const P: point = coordinate(x: 3, y: 4)",
    "for Tick in range(min: 0, max: 1, step: 1) carry Count: number = 1 {",
    "  const Invalid: point[] = if (true) { @Count } else { [@P] }",
    "  next Count = @Count",
    "}"
  ].join("\n");
  const result = compileCanonicalText(blank, source);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === "geometry-array-reference-not-array")).toBe(true);
});
