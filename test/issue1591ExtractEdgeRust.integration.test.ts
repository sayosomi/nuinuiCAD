import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { runtimeGeometryDiagnostics } from "../src/geometry/runtimeGeometryDiagnostics";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = process.cwd();
const sourceFixture = "issue-1591/extract-inverse-edge.nui";
let rust: ReturnType<typeof createRustStdioParityClient> | undefined;

beforeAll(() => {
  rust = createRustStdioParityClient(repoRoot);
}, 120_000);

afterAll(() => {
  rust?.dispose();
});

const sourceFromFixture = (): string => readFileSync(join(repoRoot, "test", "fixtures", sourceFixture), "utf8");
const compileFixture = (source = sourceFromFixture()): EvaluationFixture => {
  const fixture = fixtureFromSource(source);
  expect(fixture.compiled?.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  return fixture;
};

async function evaluateBoth(fixture: EvaluationFixture) {
  if (!rust) throw new Error("persistent Rust process was not started");
  const options = optionsFor(fixture);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rustPayload: EvaluationPayload;
  try {
    rustPayload = await Promise.race([
      rust.evaluate(fixture.elements, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          rust?.dispose();
          reject(new Error("Issue #1591 persistent Rust request exceeded 15 seconds"));
        }, 15_000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const typescriptPayload = evaluateElementsReferencePayload(fixture.elements, options);
  return {
    options,
    rustPayload,
    typescriptPayload,
    rustResult: evaluationPayloadToResult(rustPayload),
    typescriptResult: evaluationPayloadToResult(typescriptPayload)
  };
}

const geometryByName = (result: ReturnType<typeof evaluationPayloadToResult>, name: string) => {
  const geometry = [...result.computedGeometry.values()].find(candidate => candidate.name === name);
  expect(geometry, `computed geometry ${name}`).toBeTruthy();
  return geometry!;
};

const scalarForName = (fixture: EvaluationFixture, result: ReturnType<typeof evaluationPayloadToResult>, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(candidate => candidate.name === name);
  expect(binding, `scalar binding ${name}`).toBeTruthy();
  const evaluation = result.computedScalarBindings?.get(binding!.id);
  expect(evaluation, `scalar result ${name}`).toBeTruthy();
  return evaluation!;
};

const expectScalarNumber = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  name: string,
  expected: number
) => {
  const evaluation = scalarForName(fixture, result, name);
  expect(evaluation).toMatchObject({ status: "ok", value: { kind: "number", value: expected } });
};

// Compare the shared geometry contract. Rust and the TypeScript reference
// currently differ in optional joinedPath provenance fields, so keep those
// metadata fields out of this task-scoped parity projection.
const stripExtractProvenance = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripExtractProvenance);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["baseLineIds", "extractionStations", "pathIds"].includes(key))
    .map(([key, nested]) => [key, stripExtractProvenance(nested)]));
};

const expectPureIntersection = (fixture: EvaluationFixture, result: ReturnType<typeof evaluationPayloadToResult>) => {
  const statementIndex = fixture.compiled!.doc.statements.findIndex(statement =>
    statement.kind === "typedDeclaration" && statement.name === "PureHit");
  expect(statementIndex).toBeGreaterThanOrEqual(0);
  const statementId = fixture.compiled!.doc.statementMap.statementIdByStatementIndex?.get(statementIndex);
  expect(statementId).toBeTruthy();
  const entry = [...(result.computedGeometryValues?.values() ?? [])]
    .find(candidate => candidate.occurrence.sourceStatementId === statementId);
  // Independent exact oracle: the source cubic is collinear on y=0 from x=0
  // to x=10. Its start tangent extends left and meets x=-5 at (-5, 0).
  expect(entry?.value).toMatchObject({ kind: "point", x: -5, y: 0 });
};

const issue1591SemanticProjection = (
  fixture: EvaluationFixture,
  options: ReturnType<typeof optionsFor>,
  result: ReturnType<typeof evaluationPayloadToResult>
) => {
  const lower = geometryByName(result, "lower");
  const dart = geometryByName(result, "Dart");
  const edgeRecipe = options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
  const stages = result.transformationStageGeometry;
  const stageFor = (geometry: typeof lower | typeof dart) => edgeRecipe
    ? stages?.get(`${geometry.elementId}\u0000*\u0000${edgeRecipe.stageName}`)
    : undefined;
  const pureHitIndex = fixture.compiled!.doc.statements.findIndex(statement =>
    statement.kind === "typedDeclaration" && statement.name === "PureHit");
  const pureHitId = fixture.compiled!.doc.statementMap.statementIdByStatementIndex?.get(pureHitIndex);
  const pureHit = [...(result.computedGeometryValues?.values() ?? [])]
    .find(candidate => candidate.occurrence.sourceStatementId === pureHitId)?.value;

  return normalizeParityPayload({
    errors: result.errors,
    geometryValueErrors: result.geometryValueErrors ?? [],
    owners: [lower, dart].map(stripExtractProvenance),
    edgeStages: [stageFor(lower), stageFor(dart)].map(stripExtractProvenance),
    pureHit,
    probes: [
      scalarForName(fixture, result, "probe_extract"),
      scalarForName(fixture, result, "probe_dart")
    ]
  });
};

const expectSuccessfulParity = (fixture: EvaluationFixture, run: Awaited<ReturnType<typeof evaluateBoth>>) => {
  expect(run.rustResult.errors).toEqual([]);
  expect(run.rustResult.geometryValueErrors ?? []).toEqual([]);
  expect(run.typescriptResult.errors).toEqual([]);
  expect(run.typescriptResult.geometryValueErrors ?? []).toEqual([]);
  expect(
    issue1591SemanticProjection(fixture, run.options, run.rustResult),
    "production persistent Rust / TypeScript reference semantic parity"
  ).toEqual(issue1591SemanticProjection(fixture, run.options, run.typescriptResult));
  expectPureIntersection(fixture, run.rustResult);
  expectPureIntersection(fixture, run.typescriptResult);
};

const expectSuccessfulEdgeStages = (
  fixture: EvaluationFixture,
  run: Awaited<ReturnType<typeof evaluateBoth>>
) => {
  expectSuccessfulParity(fixture, run);
  expectScalarNumber(fixture, run.rustResult, "probe_extract", -5);
  expectScalarNumber(fixture, run.rustResult, "probe_dart", -5);
  expectScalarNumber(fixture, run.typescriptResult, "probe_extract", -5);
  expectScalarNumber(fixture, run.typescriptResult, "probe_dart", -5);

  const lower = geometryByName(run.rustResult, "lower");
  const dart = geometryByName(run.rustResult, "Dart");
  expect(lower).toMatchObject({ kind: "joinedPath", closed: false, start: { x: -5, y: 0 } });
  expect(dart).toMatchObject({ kind: "line", end: { x: -5, y: 0 } });

  const edgeRecipe = run.options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
  expect(edgeRecipe).toBeTruthy();
  const stages = run.rustResult.transformationStageGeometry;
  expect(stages?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .toMatchObject({ kind: "joinedPath", start: { x: -5, y: 0 } });
  expect(stages?.get(`${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .toMatchObject({ kind: "line", end: { x: -5, y: 0 } });
}

describe("Issue #1591 extract -> inverse move -> edge on persistent Rust", () => {
  it("connects both owners, publishes their stages, and stays stable on a warm reevaluation", async () => {
    const fixture = compileFixture();
    const cold = await evaluateBoth(fixture);
    expectSuccessfulEdgeStages(fixture, cold);

    const warm = await evaluateBoth(fixture);
    expectSuccessfulEdgeStages(fixture, warm);
    expect(issue1591SemanticProjection(fixture, warm.options, warm.rustResult))
      .toEqual(issue1591SemanticProjection(fixture, cold.options, cold.rustResult));
    expect(issue1591SemanticProjection(fixture, warm.options, warm.typescriptResult))
      .toEqual(issue1591SemanticProjection(fixture, cold.options, cold.typescriptResult));
  }, 30_000);

  const neighboringControls: Array<[string, (source: string) => string, number, number]> = [
    ["without the preceding successful edge", source => source.replace(
      /line GuideH[\s\S]*?edge \[@GuideH\.end, @GuideV\.start\]\(index: 0\)\n\n/,
      ""
    ), -5, -5],
    ["with a direct Bezier as the pure-intersection control", source => source.replace(
      "line1: @Extracted::lower, line2: @Dart",
      "line1: @Outline, line2: @Dart"
    ), -5, -5],
    ["with the established extend control", source => source.replace(
      "edge [@Extracted::lower.start, @Dart.end](index: 0)",
      "extend @Dart.end(to: (-5, 0))"
    ), 0, -5],
    ["with multiline edge formatting", source => source.replace(
      "edge [@Extracted::lower.start, @Dart.end](index: 0)",
      "edge [\n  @Extracted::lower.start,\n  @Dart.end\n](index: 0)"
    ), -5, -5]
  ];

  it.each(neighboringControls)("keeps the neighboring control passing %s", async (_name, edit, expectedExtractX, expectedDartX) => {
    const source = edit(sourceFromFixture());
    const fixture = compileFixture(source);
    const run = await evaluateBoth(fixture);
    expectSuccessfulParity(fixture, run);
    expectScalarNumber(fixture, run.rustResult, "probe_extract", expectedExtractX);
    expectScalarNumber(fixture, run.rustResult, "probe_dart", expectedDartX);
    expectScalarNumber(fixture, run.typescriptResult, "probe_extract", expectedExtractX);
    expectScalarNumber(fixture, run.typescriptResult, "probe_dart", expectedDartX);
  }, 30_000);

  it("projects an invalid edge index to its authored statement and rolls back both targets", async () => {
    const source = sourceFromFixture().replace(
      "edge [@Extracted::lower.start, @Dart.end](index: 0)",
      "edge [@Extracted::lower.start, @Dart.end](index: 999)"
    );
    const fixture = compileFixture(source);
    const run = await evaluateBoth(fixture);
    expect(run.rustResult.errors).toHaveLength(1);
    expect(run.rustResult.errors[0]!.message).toContain("999");
    expect(run.typescriptResult.errors).toHaveLength(1);
    expect(
      issue1591SemanticProjection(fixture, run.options, run.rustResult),
      "production persistent Rust / TypeScript reference semantic parity for failed edge"
    ).toEqual(issue1591SemanticProjection(fixture, run.options, run.typescriptResult));

    const edgeRecipe = run.options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
    expect(edgeRecipe).toBeTruthy();
    const statementIndex = edgeRecipe!.sourceStatementIndex;
    const statement = fixture.compiled!.doc.statements[statementIndex];
    expect(statement?.kind).toBe("transformation");
    const [diagnostic] = runtimeGeometryDiagnostics({
      errors: run.rustResult.errors,
      geometryValueErrors: run.rustResult.geometryValueErrors,
      compiledDocument: fixture.compiled!.doc
    });
    expect(diagnostic).toMatchObject({
      severity: "error",
      origin: "runtime",
      line: statement!.line,
      statementIndex,
      physicalSpan: statement!.physicalSpan,
      exactSpanOnly: true,
      navigationTarget: { kind: "sourceSpan", physicalSpan: statement!.physicalSpan }
    });
    expect(diagnostic?.message).toBe(run.rustResult.errors[0]!.message);
    expect(diagnostic).not.toHaveProperty("elementId");

    const lower = geometryByName(run.rustResult, "lower");
    const dart = geometryByName(run.rustResult, "Dart");
    expect(lower).toMatchObject({ kind: "joinedPath", closed: false, start: { x: 0, y: 0 } });
    expect(dart).toMatchObject({ kind: "line", end: { x: -5, y: 2 } });
    expect(run.rustResult.transformationStageGeometry?.has(
      `${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`
    )).toBe(false);
    expect(run.rustResult.transformationStageGeometry?.has(
      `${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`
    )).toBe(false);
    expect([
      scalarForName(fixture, run.rustResult, "probe_extract").issueCode,
      scalarForName(fixture, run.rustResult, "probe_dart").issueCode
    ]).toEqual(["evaluation-geometry-property-unavailable", "evaluation-geometry-property-unavailable"]);
  }, 30_000);
});
