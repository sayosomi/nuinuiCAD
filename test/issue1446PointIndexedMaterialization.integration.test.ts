import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import type { CadElement, GeometryInputTarget } from "../src/types/geometry";
import authoredCases from "./fixtures/issue1260-d1/cases.json";
import frozenCases from "./fixtures/issue1260-d1/freeze.json";
import { normalizeParityPayload } from "./evaluationParitySupport";

const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const frozenRows = frozenCases as Array<{
  id: string;
  sha256: string;
  geometry: Array<{ owner: string; shape: { kind: string; x: number; y: number } }>;
  errors: unknown[];
}>;
const authoredRows = authoredCases as Array<{ id: string; source: string }>;
const directSource = "nui 1\nconst P: point = coordinate(x: 3, y: 4)\npoint Observed = from(source: @P)\n";
const scenarios = [
  ...["C-coordinate", "C-coordinate-control"].map((id) => {
    const row = authoredRows.find((candidate) => candidate.id === id)!;
    const frozen = frozenRows.find((candidate) => candidate.id === id)!;
    return { id, source: row.source, frozen, collection: true };
  }),
  { id: "direct-immutable-point", source: directSource, frozen: undefined, collection: false }
];

let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let stopping = false;
let resourceError: Error | undefined;
let requestTimer: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;

beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], {
    timeout: 120_000,
    stdio: "inherit"
  });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      closed = new Promise((resolve) => {
        child!.once("error", (error) => {
          if (!stopping) resourceError = error;
        });
        child!.once("exit", (code, signal) => {
          if (!stopping) resourceError = new Error(`Rust process exited ${code}/${signal}`);
        });
        child!.once("close", (code, signal) => {
          if (!stopping && (code !== 0 || signal !== null)) {
            resourceError = new Error(`Rust process closed ${code}/${signal}`);
          }
          resolve();
        });
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (!stopping && !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) resourceError = error;
      });
      return child;
    }) as typeof spawn
  });
  watchdog = setTimeout(() => {
    resourceError = new Error("Rust process lifetime exceeded 10 minutes");
    rust?.dispose();
  }, 600_000);
}, 130_000);

afterAll(async () => {
  stopping = true;
  clearTimeout(watchdog);
  clearTimeout(requestTimer);
  rust?.dispose();
  if (closed) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            child?.kill("SIGKILL");
            reject(new Error("Rust cleanup timeout"));
          }, 5_000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  if (resourceError) throw resourceError;
}, 10_000);

const assertPointOracle = (payload: EvaluationPayload, elementId: string) => {
  expect(payload.errors).toEqual([]);
  expect(payload.computedGeometry.filter((geometry) => geometry.elementId === elementId)).toEqual([
    { kind: "point", elementId, name: "Observed", x: 3, y: 4 }
  ]);
};

const firstTarget = (target: GeometryInputTarget | readonly GeometryInputTarget[] | undefined) =>
  Array.isArray(target) ? target[0] : target;

const indexedMember = (target: GeometryInputTarget | undefined) => {
  if (target?.kind !== "collectionIndex" || target.value?.kind !== "leaf") return undefined;
  return target.value.targets[0];
};

it("materializes indexed immutable point values with ordinary Rust eligibility", async () => {
  const blank = regenerateCanonicalFromModel(emptyDocument(), 1);
  for (const scenario of scenarios) {
    if (scenario.frozen) {
      expect(hash(scenario.source), `${scenario.id} frozen source hash`).toBe(scenario.frozen.sha256);
      expect(scenario.frozen).toMatchObject({
        geometry: [{ owner: "Observed", shape: { kind: "point", x: 3, y: 4 } }],
        errors: []
      });
    }

    const compileResult = compileCanonicalText(blank, scenario.source);
    const compiled = compileResult.currentCompiled;
    const diagnostics = [
      ...compiled.diagnostics,
      ...(compiled.bindingIssueDiagnostics ?? [])
    ].filter((diagnostic) => diagnostic.severity === "error");
    expect(["valid", "warning"], `${scenario.id} compiler status`).toContain(compileResult.status);
    expect(diagnostics, `${scenario.id} compiler diagnostics`).toEqual([]);
    expect(compiled.document, `${scenario.id} compiled document`).not.toBeNull();
    expect(compiled.statementMap, `${scenario.id} statement map`).not.toBeNull();
    const document = compileResult.doc;
    const elements = document.document.elements;
    const observed = elements.find((element) => element.name === "Observed" && element.type === "materializedPoint");
    expect(observed, `${scenario.id} materialized drawable`).toBeDefined();
    const observedElement = observed as CadElement;

    const compiledInputTarget = firstTarget(document.geometryInputTargetsByElementId?.get(observedElement.id)?.get("source"));
    expect(compiledInputTarget, `${scenario.id} canonical source target`).toBeDefined();
    if (scenario.collection) {
      expect(compiledInputTarget).toMatchObject({
        kind: "collectionIndex",
        collectionLength: 1,
        targetSourceOrder: -1,
        index: { kind: "numberLiteral", value: 0 }
      });
      expect(indexedMember(compiledInputTarget)).toBeDefined();
      const target = compiledInputTarget as Extract<GeometryInputTarget, { kind: "collectionIndex" }>;
      const collectionNode = document.moduleGeometryRuntime?.geometryCollectionNodesByValueId?.get(target.collectionValueId);
      expect(collectionNode, `${scenario.id} resolved member collection`).toEqual(target.value);
      expect(collectionNode).toMatchObject({ kind: "leaf", targets: [{ kind: scenario.id === "C-coordinate" ? "coordinate" : "geometryValue" }] });
    } else {
      expect(compiledInputTarget?.kind).toBe("geometryValue");
    }

    const options = buildEvaluationOptions({
      compiledDocument: document,
      evaluationLimitIndex: document.document.evaluationLimitIndex
    });
    const reference = evaluateElementsReferencePayload(elements, options);
    assertPointOracle(reference, observedElement.id);
    const prepared = prepareRustEvaluation(elements, options);
    expect(prepared.rustEligible, `${scenario.id} ordinary Rust eligibility`).toBe(true);
    if (!prepared.rustEligible) throw new Error(`${scenario.id} unexpectedly ineligible for Rust evaluation`);
    const rustSourceTarget = firstTarget(prepared.input.geometryInputTargets
      ?.find((entry) => entry.elementId === observedElement.id)
      ?.parameters.find((parameter) => parameter.parameterKey === "source")?.target);
    expect(rustSourceTarget, `${scenario.id} prepared production target`).toBeDefined();
    expect(rustSourceTarget?.kind).toBe(compiledInputTarget?.kind);
    if (compiledInputTarget?.kind === "collectionIndex" && rustSourceTarget?.kind === "collectionIndex") {
      expect(rustSourceTarget).toMatchObject({
        collectionValueId: compiledInputTarget.collectionValueId,
        targetSourceOrder: -1,
        value: compiledInputTarget.value
      });
    } else if (compiledInputTarget?.kind === "geometryValue" && rustSourceTarget?.kind === "geometryValue") {
      expect(rustSourceTarget.occurrence).toEqual(compiledInputTarget.occurrence);
    }

    const production = await Promise.race([
      rust!.request(prepared.input) as Promise<EvaluationPayload>,
      new Promise<never>((_, reject) => {
        requestTimer = setTimeout(() => {
          resourceError = new Error(`${scenario.id} Rust request timeout`);
          rust?.dispose();
          reject(resourceError);
        }, 10_000);
      })
    ]);
    clearTimeout(requestTimer);
    assertPointOracle(production, observedElement.id);
    const observedProjection = (payload: EvaluationPayload) => ({
      geometry: payload.computedGeometry.filter((geometry) => geometry.elementId === observedElement.id),
      errors: payload.errors
    });
    expect(normalizeParityPayload(observedProjection(production))).toEqual(normalizeParityPayload(observedProjection(reference)));

    const member = scenario.collection ? indexedMember(compiledInputTarget) : compiledInputTarget;
    expect(member).toBeDefined();
    if (member?.kind === "coordinate") {
      expect(member.anchor).toMatchObject({ mode: "coordinate", x: 3, y: 4 });
      expect(member).not.toHaveProperty("elementId");
    } else if (member?.kind === "geometryValue") {
      for (const payload of [reference, production]) {
        const sourceValue = payload.computedGeometryValues?.find((entry) =>
          entry.occurrence.sourceStatementId === member.occurrence.sourceStatementId
        )?.value;
        expect(sourceValue, `${scenario.id} immutable point value`).toMatchObject({ kind: "point", x: 3, y: 4 });
        expect(sourceValue).not.toHaveProperty("elementId");
      }
    }

    const wrongReference = structuredClone(reference);
    const referencePoint = wrongReference.computedGeometry.find((geometry) => geometry.elementId === observedElement.id);
    if (referencePoint?.kind === "point") referencePoint.x += 1;
    expect(() => assertPointOracle(wrongReference, observedElement.id), "oracle rejects a wrong coordinate").toThrow();
    const wrongProduction = structuredClone(production);
    const productionPoint = wrongProduction.computedGeometry.find((geometry) => geometry.elementId === observedElement.id);
    if (productionPoint?.kind === "point") productionPoint.x += 1;
    expect(() => assertPointOracle(wrongProduction, observedElement.id), "Rust oracle rejects a wrong coordinate").toThrow();
  }
}, 60_000);
