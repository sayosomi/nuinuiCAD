import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { compileDslDocument, createModuleRuntimeContext, parseDslSnapshot } from "@nuinuicad/nui-language";
import { isLastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { createRustStdioParityClient, normalizeParityPayload } from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(repoRoot, "test/fixtures/issue-1718");
const rootPath = join(fixtureDir, "root.nui");
const libraryPath = join(fixtureDir, "library.nui");
const preparedPath = join(fixtureDir, "prepared-rust-input.json");
const oraclePath = join(fixtureDir, "oracle.json");
const captureFixture = process.env.ISSUE1718_CAPTURE_FIXTURE === "1";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let rust: ReturnType<typeof createRustStdioParityClient> | undefined;
beforeAll(() => { rust = createRustStdioParityClient(repoRoot); }, 120_000);
afterAll(() => rust?.dispose());

const idsFor = (source: string, label: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
  return new Map(parsed.statements.map((_, index) => [index, `issue1718:${label}:${index}`]));
};

const scalar = (compiled: ReturnType<typeof compileDslDocument>, payload: EvaluationPayload, name: string) => {
  const binding = compiled.bindingAnalysis?.catalog.bindings.find(
    candidate => candidate.kind === "typed" && candidate.name === name
  );
  assert.ok(binding, `typed binding ${name} exists`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

it("reaches Rust controller candidates from a saved-import source and preserves the independent oracle", async () => {
  const rootSource = readFileSync(rootPath, "utf8");
  const librarySource = readFileSync(libraryPath, "utf8");
  expect(rootSource.split("\n")).toHaveLength(2001);

  const rootId = documentIdFromHost("/issue-1718/root.nui");
  const libraryId = documentIdFromHost("/issue-1718/library.nui");
  const rootStatementIds = idsFor(rootSource, "root");
  const libraryStatementIds = idsFor(librarySource, "library");
  const graph = await buildMultiDocumentImportGraph({
    root: { kind: "root-current", documentId: rootId, normalizedSource: rootSource, sourceRevision: 1 },
    rootStatementIdByStatementIndex: rootStatementIds,
    loader: {
      async loadSavedDependency(importer, relativePath) {
        const dependencyPath = posix.normalize(posix.join(posix.dirname(importer), relativePath));
        if (posix.basename(dependencyPath) !== "library.nui") return { status: "failed" as const, reason: "missing" as const };
        return { status: "loaded" as const, snapshot: {
          kind: "dependency-saved" as const,
          documentId: libraryId,
          normalizedSource: librarySource,
          savedSourceFingerprint: savedSourceFingerprintFromHost(sha256(librarySource))
        } };
      }
    },
    savedDependencyStatementIdsForDocument: () => libraryStatementIds,
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleContext = createModuleRuntimeContext(graph, analysis);
  expect(graph.valid, JSON.stringify({
    graphDiagnostics: graph.diagnostics,
    nodes: [...graph.nodes.values()].map(node => ({
      id: node.documentId,
      valid: node.valid,
      sourceDiagnostics: node.sourceDiagnostics,
      publicApiDiagnostics: node.publicApiDiagnostics
    }))
  })).toBe(true);
  expect(graph.nodes.size).toBe(2);
  expect([...graph.nodes.values()].some(node => node.documentId === rootId && node.artifact.source.kind === "root-current")).toBe(true);
  expect([...graph.nodes.values()].some(node => node.documentId === libraryId && node.artifact.source.kind === "dependency-saved")).toBe(true);
  expect(analysis.valid).toBe(true);
  expect(moduleContext.valid).toBe(true);

  const rootArtifact = graph.nodes.get(rootId)!.artifact;
  const compiled = compileDslDocument(rootSource, {
    preparsed: rootArtifact.parsed,
    sourceRevision: 1,
    assignedStatementIds: rootArtifact.statementIdByStatementIndex,
    moduleRuntimeContext: moduleContext
  });
  const compilerErrors = [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])]
    .filter(diagnostic => diagnostic.severity === "error");
  expect(compilerErrors).toEqual([]);
  expect(isLastGoodDslDocument(compiled)).toBe(true);
  if (!isLastGoodDslDocument(compiled)) throw new Error("Issue #1718 fixture did not compile to a last-good document");

  const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible).toBe(true);
  const graphEdges = prepared.input.scalarExpressionPayload?.conditionalDependencyGraph?.edges ?? [];
  const guardedEdges = graphEdges.filter(edge => (edge.activation?.guards.length ?? 0) > 0);
  expect(graphEdges.length).toBeGreaterThan(1000);
  expect(guardedEdges.length).toBeGreaterThan(100);
  expect(guardedEdges.some(edge => edge.from.kind === "binding" &&
    ["geometry-value", "geometry-stage", "element"].includes(edge.to.kind))).toBe(true);

  const preparedText = `${JSON.stringify(prepared.input, null, 2)}\n`;
  if (captureFixture) writeFileSync(preparedPath, preparedText);
  else expect(readFileSync(preparedPath, "utf8")).toBe(preparedText);

  const reference = evaluateElementsReferencePayload(compiled.document.elements, options);
  const production = await rust!.evaluateInput(prepared.input) as EvaluationPayload;
  expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference));

  for (const [name, value] of [["Forwarded", 128], ["Nested", 130], ["Static", 135], ["ChoiceValue", 11], ["Noise1199", 1200]] as const) {
    const actual = scalar(compiled, production, name);
    expect(actual, `${name}: ${JSON.stringify(actual)}`).toMatchObject({ status: "ok", value: { kind: "number", value } });
  }
  for (let index = 0; index < 80; index++) {
    const delta = 1000 + index;
    const expected = 128 + (128 > index * 4 ? delta : -delta);
    expect(scalar(compiled, production, `Probe${String(index).padStart(3, "0")}`))
      .toMatchObject({ status: "ok", value: { kind: "number", value: expected } });
  }
  const result = evaluationPayloadToResult(production);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors ?? []).toEqual([]);
  expect(result.warnings).toEqual([]);
  const outlines = [...result.computedGeometry.values()].filter(geometry => geometry.name === "Outline");
  expect(outlines).toHaveLength(1);
  expect(outlines[0]).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 128, y: 0 } });

  const actualOracle = {
    rootSourceSha256: sha256(rootSource),
    librarySourceSha256: sha256(librarySource),
    rootSourceLineCount: 2000,
    compilerErrorCount: compilerErrors.length,
    graphAuthority: { root: "root-current", importedDependency: "dependency-saved" },
    rustEligible: prepared.rustEligible,
    totalGraphEdges: graphEdges.length,
    guardedGraphEdges: guardedEdges.length,
    expected: {
      outline: { start: [0, 0], end: [128, 0] },
      forwarded: 128,
      nested: 130,
      static: 135,
      choice: "@left",
      choiceValue: 11,
      lastNoise: 1200,
      probeValues: Array.from({ length: 80 }, (_, index) => 128 + (128 > index * 4 ? 1000 + index : -(1000 + index))),
      errors: [],
      geometryValueErrors: [],
      warnings: []
    },
    preparedRustInputSha256: sha256(preparedText),
    normalizedRustOutputSha256: sha256(JSON.stringify(normalizeParityPayload(production)))
  };
  if (captureFixture) writeFileSync(oraclePath, `${JSON.stringify(actualOracle, null, 2)}\n`);
  else {
    const oracle = JSON.parse(readFileSync(oraclePath, "utf8")) as typeof actualOracle;
    expect(actualOracle).toEqual(oracle);
  }
  console.info(`#1718 source-backed evidence ${JSON.stringify(actualOracle)}`);
});
