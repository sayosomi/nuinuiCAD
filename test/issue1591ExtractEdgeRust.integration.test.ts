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
const representativeSourceFixture = "issue-1591/extract-rotated-interior-edge.nui";
let rust: ReturnType<typeof createRustStdioParityClient> | undefined;

beforeAll(() => {
  rust = createRustStdioParityClient(repoRoot);
}, 120_000);

afterAll(() => {
  rust?.dispose();
});

const sourceFromFixture = (path = sourceFixture): string => readFileSync(join(repoRoot, "test", "fixtures", path), "utf8");
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

const expectScalarNumberClose = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  name: string,
  expected: number
) => {
  const evaluation = scalarForName(fixture, result, name);
  expect(evaluation).toMatchObject({ status: "ok", value: { kind: "number" } });
  if (evaluation.status !== "ok" || evaluation.value.kind !== "number") {
    throw new Error(`scalar result ${name} is not a number`);
  }
  expect(evaluation.value.value).toBeCloseTo(expected, 10);
};

const geometryValueForName = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  name: string
) => {
  const statementIndex = fixture.compiled!.doc.statements.findIndex(statement =>
    statement.kind === "typedDeclaration" && statement.name === name);
  expect(statementIndex).toBeGreaterThanOrEqual(0);
  const statementId = fixture.compiled!.doc.statementMap.statementIdByStatementIndex?.get(statementIndex);
  expect(statementId).toBeTruthy();
  return [...(result.computedGeometryValues?.values() ?? [])]
    .find(candidate => candidate.occurrence.sourceStatementId === statementId)?.value;
};

const expectPureIntersection = (
  fixture: EvaluationFixture,
  result: ReturnType<typeof evaluationPayloadToResult>,
  x = -5,
  y = 0,
  name = "PureHit"
) => {
  // Each fixture supplies its own independently checked geometric oracle.
  const value = geometryValueForName(fixture, result, name);
  expect(value).toMatchObject({ kind: "point" });
  if (value?.kind !== "point") throw new Error(`missing point result ${name}`);
  expect(value.x).toBeCloseTo(x, 10);
  expect(value.y).toBeCloseTo(y, 10);
};

const issue1591SemanticProjection = (
  fixture: EvaluationFixture,
  options: ReturnType<typeof optionsFor>,
  result: ReturnType<typeof evaluationPayloadToResult>,
  pureHitName = "PureHit",
  probeNames: readonly [string, string] = ["probe_extract", "probe_dart"]
) => {
  const lower = geometryByName(result, "lower");
  const dart = geometryByName(result, "Dart");
  const edgeRecipe = options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
  const stages = result.transformationStageGeometry;
  const stageFor = (geometry: typeof lower | typeof dart) => edgeRecipe
    ? stages?.get(`${geometry.elementId}\u0000*\u0000${edgeRecipe.stageName}`)
    : undefined;
  const pureHit = geometryValueForName(fixture, result, pureHitName);

  return normalizeParityPayload({
    errors: result.errors,
    geometryValueErrors: result.geometryValueErrors ?? [],
    owners: [lower, dart],
    edgeStages: [stageFor(lower), stageFor(dart)],
    pureHit,
    probes: [
      scalarForName(fixture, result, probeNames[0]),
      scalarForName(fixture, result, probeNames[1])
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
  expect(lower).toHaveProperty("pathIds", []);
  expect(lower).toHaveProperty("extractionStations");
  expect(lower).not.toHaveProperty("baseLineIds");
  expect(dart).toMatchObject({ kind: "line", end: { x: -5, y: 0 } });

  const edgeRecipe = run.options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
  expect(edgeRecipe).toBeTruthy();
  const stages = run.rustResult.transformationStageGeometry;
  expect(stages?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .toMatchObject({ kind: "joinedPath", start: { x: -5, y: 0 } });
  expect(stages?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .toHaveProperty("pathIds", []);
  expect(stages?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .not.toHaveProperty("baseLineIds");
  expect(stages?.get(`${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
    .toMatchObject({ kind: "line", end: { x: -5, y: 0 } });
}

const representativeProjection = (
  fixture: EvaluationFixture,
  options: ReturnType<typeof optionsFor>,
  result: ReturnType<typeof evaluationPayloadToResult>
) => {
  const lower = geometryByName(result, "lower");
  const inverseMove = options.transformationRecipes?.find(recipe =>
    recipe.construction === "move" && recipe.targets.some(target => target.source === "@Extracted::lower"));
  const preEdgeExtract = inverseMove?.stageName
    ? result.transformationStageGeometry?.get(`${lower.elementId}\u0000*\u0000${inverseMove.stageName}`)
    : undefined;
  return normalizeParityPayload({
    semantic: issue1591SemanticProjection(
      fixture,
      options,
      result,
      "PureHit",
      ["probe_extract_x", "probe_dart_y"]
    ),
    sourcePositionValues: {
      cut: geometryValueForName(fixture, result, "Cut"),
      beforeExtract: geometryValueForName(fixture, result, "BeforeExtract"),
      beforeDart: geometryValueForName(fixture, result, "BeforeDart"),
      preEdgeExtract
    }
  });
};

const expectRepresentativeSuccess = (
  fixture: EvaluationFixture,
  run: Awaited<ReturnType<typeof evaluateBoth>>
) => {
  for (const result of [run.rustResult, run.typescriptResult]) {
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors ?? []).toEqual([]);
    expectPureIntersection(fixture, result, -5, 12);

    const cut = geometryValueForName(fixture, result, "Cut");
    expect(cut).toMatchObject({ kind: "point" });
    if (cut?.kind !== "point") throw new Error("missing interior Cut intersection");
    expect(cut.x).toBeCloseTo(0, 10);
    const beforeExtract = geometryValueForName(fixture, result, "BeforeExtract");
    const beforeDart = geometryValueForName(fixture, result, "BeforeDart");
    expect(beforeExtract).toMatchObject({ kind: "joinedPath", start: { x: 5 } });
    if (beforeExtract?.kind !== "joinedPath" || !beforeExtract.start) {
      throw new Error("missing pre-edge extracted path");
    }
    expect(beforeExtract.start.y).toBeCloseTo(12, 10);
    expect(beforeDart).toMatchObject({ kind: "line", start: { x: -5, y: -2 }, end: { x: -5, y: 2 } });
    const lower = geometryByName(result, "lower");
    const inverseMove = run.options.transformationRecipes?.find(recipe =>
      recipe.construction === "move" && recipe.targets.some(target => target.source === "@Extracted::lower"));
    expect(inverseMove?.stageName).toBeTruthy();
    const preEdgeExtract = result.transformationStageGeometry?.get(
      `${lower.elementId}\u0000*\u0000${inverseMove!.stageName}`
    );
    expect(preEdgeExtract?.kind).toBe("joinedPath");
    if (preEdgeExtract?.kind !== "joinedPath") throw new Error("missing inverse-move extract stage");
    expect(preEdgeExtract.extractionStations?.left).toMatchObject({ segmentIndex: 0, t: 0 });
    expect(preEdgeExtract.extractionStations?.right.segmentIndex).toBe(0);
    expect(preEdgeExtract.extractionStations?.right.t).toBeGreaterThan(0);
    expect(preEdgeExtract.extractionStations?.right.t).toBeLessThan(1);
    const pureHit = geometryValueForName(fixture, result, "PureHit");
    expect(pureHit).toMatchObject({ kind: "point", x: -5 });
    expect(pureHit?.kind).toBe("point");
    if (pureHit?.kind !== "point") throw new Error("missing pre-edge intersection point");
    if (beforeDart?.kind !== "line") throw new Error("missing pre-edge dart geometry");
    expect(pureHit.x).toBeLessThan(beforeExtract.start.x);
    expect(pureHit.y).toBeGreaterThan(beforeDart.end.y);

    const dart = geometryByName(result, "Dart");
    expect(lower).toMatchObject({ kind: "joinedPath", closed: false, start: { x: -5 } });
    expect(dart).toMatchObject({ kind: "line", end: { x: -5 } });
    if (lower.kind !== "joinedPath" || !lower.start || dart.kind !== "line") {
      throw new Error("missing final owner endpoint geometry");
    }
    expect(lower.start.y).toBeCloseTo(12, 10);
    expect(dart.end.y).toBeCloseTo(12, 10);
    expect(lower.kind).toBe("joinedPath");
    if (lower.kind !== "joinedPath") throw new Error("missing final joined path");
    const sourceOutline = fixture.elements.find(element => element.name === "Outline");
    expect(sourceOutline).toBeTruthy();
    expect(lower.pathIds).toEqual(preEdgeExtract.pathIds);
    expect(lower).toHaveProperty("extractionStations");
    expect(lower).not.toHaveProperty("baseLineIds");
    expect(lower.segments.map(segment => segment.kind)).toEqual(["line", "bezier"]);
    const retainedBezier = lower.segments.find(segment => segment.kind === "bezier");
    expect(retainedBezier).toBeTruthy();
    if (!retainedBezier || retainedBezier.kind !== "bezier") throw new Error("missing retained extracted Bezier");
    const chordX = retainedBezier.end.x - retainedBezier.start.x;
    const chordY = retainedBezier.end.y - retainedBezier.start.y;
    const controlCross = chordX * (retainedBezier.control1.y - retainedBezier.start.y)
      - chordY * (retainedBezier.control1.x - retainedBezier.start.x);
    expect(Math.abs(controlCross)).toBeGreaterThan(0.1);

    expectScalarNumberClose(fixture, result, "probe_extract_x", -5);
    expectScalarNumberClose(fixture, result, "probe_dart_y", 12);
  }

  const edgeRecipe = run.options.transformationRecipes?.filter(recipe => recipe.construction === "edge").at(-1);
  expect(edgeRecipe).toBeTruthy();
  const rustLower = geometryByName(run.rustResult, "lower");
  const inverseMove = run.options.transformationRecipes?.find(recipe =>
    recipe.construction === "move" && recipe.targets.some(target => target.source === "@Extracted::lower"));
  expect(inverseMove?.stageName).toBeTruthy();
  const beforeExtract = run.rustResult.transformationStageGeometry?.get(
    `${rustLower.elementId}\u0000*\u0000${inverseMove!.stageName}`
  );
  expect(beforeExtract?.kind).toBe("joinedPath");
  if (beforeExtract?.kind !== "joinedPath") throw new Error("missing source extraction provenance");
  for (const result of [run.rustResult, run.typescriptResult]) {
    const lower = geometryByName(result, "lower");
    const dart = geometryByName(result, "Dart");
    expect(result.transformationStageGeometry?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
      .toMatchObject({ kind: "joinedPath", start: { x: -5 }, pathIds: beforeExtract.pathIds });
    expect(result.transformationStageGeometry?.get(`${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`))
      .toMatchObject({ kind: "line", end: { x: -5 } });
    const lowerStage = result.transformationStageGeometry?.get(`${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`);
    const dartStage = result.transformationStageGeometry?.get(`${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`);
    if (lowerStage?.kind !== "joinedPath" || !lowerStage.start || dartStage?.kind !== "line") {
      throw new Error("missing representative edge stage snapshots");
    }
    expect(lowerStage.start.y).toBeCloseTo(12, 10);
    expect(dartStage.end.y).toBeCloseTo(12, 10);
  }
  expect(representativeProjection(fixture, run.options, run.rustResult))
    .toEqual(representativeProjection(fixture, run.options, run.typescriptResult));

  const cutStatementIndex = fixture.compiled!.doc.statements.findIndex(statement =>
    statement.kind === "typedDeclaration" && statement.name === "Cut");
  const pureHitStatementIndex = fixture.compiled!.doc.statements.findIndex(statement =>
    statement.kind === "typedDeclaration" && statement.name === "PureHit");
  expect(cutStatementIndex).toBeGreaterThanOrEqual(0);
  const extractMove = run.options.transformationRecipes?.find(recipe =>
    recipe.construction === "move" && recipe.targets.some(target => target.source === "@Extracted::lower"));
  const dartElement = fixture.elements.find(element => element.name === "Dart");
  expect(extractMove).toBeTruthy();
  expect(dartElement).toBeTruthy();
  expect(extractMove!.sourceStatementIndex).toBeGreaterThan(cutStatementIndex);
  expect(extractMove!.sourceStatementIndex).toBeLessThan(pureHitStatementIndex);
  expect(extractMove!.operation.kind).toBe("move");
  if (extractMove!.operation.kind !== "move") throw new Error("inverse move recipe was not compiled");
  expect(extractMove!.operation.endPoint).toMatchObject({
    mode: "derived",
    elementId: dartElement!.id,
    pointKey: "end",
    stagePath: ["base"]
  });
  expect(pureHitStatementIndex).toBeLessThan(edgeRecipe!.sourceStatementIndex);
  for (const probeName of ["probe_extract_x", "probe_dart_y"]) {
    const probeStatementIndex = fixture.compiled!.doc.statements.findIndex(statement =>
      statement.kind === "typedDeclaration" && statement.name === probeName);
    expect(probeStatementIndex).toBeGreaterThan(edgeRecipe!.sourceStatementIndex);
  }
};

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

  it("connects an interior non-collinear extract after inverse rotation around a dynamic dart endpoint", async () => {
    const fixture = compileFixture(sourceFromFixture(representativeSourceFixture));
    const cold = await evaluateBoth(fixture);
    expectRepresentativeSuccess(fixture, cold);

    const warm = await evaluateBoth(fixture);
    expectRepresentativeSuccess(fixture, warm);
    expect(representativeProjection(fixture, warm.options, warm.rustResult))
      .toEqual(representativeProjection(fixture, cold.options, cold.rustResult));
    expect(representativeProjection(fixture, warm.options, warm.typescriptResult))
      .toEqual(representativeProjection(fixture, cold.options, cold.typescriptResult));
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

  it("keeps representative index failures actionable and rolls back the dynamically moved owners", async () => {
    const source = sourceFromFixture(representativeSourceFixture).replace(
      "edge [@Extracted::lower.start, @Dart.end](index: 0)",
      "edge [@Extracted::lower.start, @Dart.end](index: 999)"
    );
    const fixture = compileFixture(source);
    const run = await evaluateBoth(fixture);
    expect(run.rustResult.errors).toHaveLength(1);
    expect(run.rustResult.errors[0]!.message).toContain("999");
    expect(run.typescriptResult.errors).toHaveLength(1);
    expect(representativeProjection(fixture, run.options, run.rustResult))
      .toEqual(representativeProjection(fixture, run.options, run.typescriptResult));

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
    expect(lower).toMatchObject({ kind: "joinedPath", closed: false, start: { x: 5 } });
    if (lower.kind !== "joinedPath" || !lower.start) throw new Error("missing pre-edge lower path");
    expect(lower.start.y).toBeCloseTo(12, 10);
    const inverseMove = run.options.transformationRecipes?.find(recipe =>
      recipe.construction === "move" && recipe.targets.some(target => target.source === "@Extracted::lower"));
    expect(inverseMove?.stageName).toBeTruthy();
    const beforeExtract = run.rustResult.transformationStageGeometry?.get(
      `${lower.elementId}\u0000*\u0000${inverseMove!.stageName}`
    );
    expect(beforeExtract?.kind).toBe("joinedPath");
    if (beforeExtract?.kind !== "joinedPath") throw new Error("missing extracted path stage");
    expect(lower.pathIds).toEqual(beforeExtract.pathIds);
    expect(lower).not.toHaveProperty("baseLineIds");
    expect(dart).toMatchObject({ kind: "line", end: { x: -5, y: 2 } });
    expect(run.rustResult.transformationStageGeometry?.has(
      `${lower.elementId}\u0000*\u0000${edgeRecipe!.stageName}`
    )).toBe(false);
    expect(run.rustResult.transformationStageGeometry?.has(
      `${dart.elementId}\u0000*\u0000${edgeRecipe!.stageName}`
    )).toBe(false);
    expect([
      scalarForName(fixture, run.rustResult, "probe_extract_x").issueCode,
      scalarForName(fixture, run.rustResult, "probe_dart_y").issueCode
    ]).toEqual(["evaluation-geometry-property-unavailable", "evaluation-geometry-property-unavailable"]);
  }, 30_000);
});
