import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { createRustStdioParityClient, normalizeParityPayload } from "./evaluationParitySupport";
import { bundle } from "./issue1486Support";
import { canonicalRegressionSource } from "./canonicalRegressionSource";
import { geometryValueOccurrenceKey } from "@nuinuicad/nui-language";

const repoRoot = process.cwd();
const fixtureDir = join(repoRoot, "test", "fixtures", "issue-1649");
const rootName = "notch_repro_test.nui";
const libraryName = "notch_repro_lib.nui";
const fixtureFiles = () => ({
  [rootName]: canonicalRegressionSource(readFileSync(join(fixtureDir, rootName), "utf8")),
  [libraryName]: canonicalRegressionSource(readFileSync(join(fixtureDir, libraryName), "utf8"))
});

const upperOnlyFiles = () => {
  const files = fixtureFiles();
  files[rootName] = files[rootName]!.replace(
    /\n {4}instance lower = notchLib::convex_notch\([\s\S]*?\n {4}\)/,
    ""
  );
  return files;
};

const pointControlFiles = () => {
  const files = fixtureFiles();
  files[libraryName] = files[libraryName]!
    .replace("const end1: point = intersection(", "point end1 = intersection(")
    .replace("const end2: point = intersection(", "point end2 = intersection(");
  return files;
};

const end2ProbeFiles = () => {
  const files = fixtureFiles();
  const end2Declaration = `  const end2: point = intersection(
    line1: side2,
    line2: trimLine,
    extensions: false,
  )`;
  files[libraryName] = files[libraryName]!.replace(
    end2Declaration,
    `${end2Declaration}\n  point end2_probe = from(source: end2)`
  );
  return files;
};

const sameDocumentFiles = () => {
  const files = fixtureFiles();
  const moduleStart = files[libraryName]!.indexOf("export module convex_notch(");
  const moduleSource = files[libraryName]!.slice(moduleStart).replace("export module convex_notch(", "module convex_notch(");
  const rootSource = files[rootName]!
    .replace(`import "./${libraryName}" as notchLib\n`, "")
    .replaceAll("notchLib::convex_notch", "convex_notch")
    .replace(/^nui 1\n/, "");
  return { [rootName]: `nui 1\n\n${moduleSource}\n\n${rootSource}` };
};

const rootPointSource = (trimX: number) => `nui 1
point root_start = coordinate(x: 0, y: 0)
point root_end = coordinate(x: 10, y: 0)
point trim_start = coordinate(x: ${trimX}, y: -1)
point trim_end = coordinate(x: ${trimX}, y: 1)
line root_side2 = segment(start: root_start, end: root_end)
line trim = segment(start: trim_start, end: trim_end)
const root_end2: point = intersection(
  line1: root_side2,
  line2: trim,
  extensions: false,
)
extend root_side2.end(to: root_end2)
`;

const compile = async (files = fixtureFiles(), revision = 1) => {
  const imported = await bundle(files, rootName, revision);
  expect(imported.graph.valid, JSON.stringify(imported.graph.diagnostics)).toBe(true);
  expect(imported.analysis.valid, JSON.stringify(imported.analysis.diagnostics)).toBe(true);
  expect(imported.compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  const document = imported.compiled;
  const options = buildEvaluationOptions({
    compiledDocument: document,
    evaluationLimitIndex: document.document?.evaluationLimitIndex
  });
  return { imported, document, options, elements: document.document!.elements };
};

const evaluateRust = async (fixture: Awaited<ReturnType<typeof compile>>): Promise<EvaluationPayload> => {
  const client = createRustStdioParityClient(repoRoot);
  try {
    return await client.evaluate(fixture.elements, fixture.options);
  } finally {
    client.dispose();
  }
};

const evaluateBoth = async (fixture: Awaited<ReturnType<typeof compile>>) => {
  const typescriptPayload = evaluateElementsReferencePayload(fixture.elements, fixture.options);
  const rustPayload = await evaluateRust(fixture);
  return {
    typescriptPayload,
    rustPayload,
    typescript: evaluationPayloadToResult(typescriptPayload),
    rust: evaluationPayloadToResult(rustPayload)
  };
};

const side2Measurements = (
  fixture: Awaited<ReturnType<typeof compile>>,
  result: ReturnType<typeof evaluationPayloadToResult>
) => (fixture.options.transformationRecipes ?? [])
  .filter(recipe => recipe.construction === "extend" && recipe.targets.some(target => target.source === "side2.end"))
  .map(recipe => {
    const target = recipe.targets.find(candidate => candidate.source === "side2.end");
    const geometry = target ? result.computedGeometry.get(target.ownerId) : undefined;
    if (!geometry || geometry.kind !== "line") throw new Error(`missing side2 result for recipe ${recipe.id}`);
    return {
      recipeIndex: fixture.options.transformationRecipes!.indexOf(recipe),
      recipeId: recipe.id,
      ownerId: target!.ownerId,
      instancePath: recipe.runtimeInstancePath ?? [],
      length: geometry.length,
      end: { x: geometry.end.x, y: geometry.end.y }
    };
  });

const extendMeasurements = (
  fixture: Awaited<ReturnType<typeof compile>>,
  result: ReturnType<typeof evaluationPayloadToResult>
) => (fixture.options.transformationRecipes ?? [])
  .flatMap((recipe, recipeIndex) => {
    if (recipe.construction !== "extend") return [];
    const target = recipe.targets.find(candidate => candidate.source.endsWith(".end"));
    const geometry = target ? result.computedGeometry.get(target.ownerId) : undefined;
    if (!target || !geometry || geometry.kind !== "line") return [];
    return [{
      recipeIndex,
      source: target.source,
      instancePath: recipe.runtimeInstancePath ?? [],
      length: geometry.length,
      end: { x: geometry.end.x, y: geometry.end.y }
    }];
  });

const expectExtendParity = (
  fixture: Awaited<ReturnType<typeof compile>>,
  typescript: ReturnType<typeof evaluationPayloadToResult>,
  rustResult: ReturnType<typeof evaluationPayloadToResult>
) => {
  const reference = extendMeasurements(fixture, typescript);
  const production = extendMeasurements(fixture, rustResult);
  expect(production).toHaveLength(reference.length);
  for (const expected of reference) {
    const actual = production.find(candidate => candidate.recipeIndex === expected.recipeIndex);
    expect(actual, `Rust result for ${expected.source} at ${expected.instancePath.join("/")}`).toBeTruthy();
    expect(actual!.length).toBeCloseTo(expected.length, 8);
    expect(actual!.end.x).toBeCloseTo(expected.end.x, 8);
    expect(actual!.end.y).toBeCloseTo(expected.end.y, 8);
  }
};

const expectNoEvaluationErrors = (
  typescript: ReturnType<typeof evaluationPayloadToResult>,
  rustResult: ReturnType<typeof evaluationPayloadToResult>
) => {
  expect(typescript.errors).toEqual([]);
  expect(typescript.geometryValueErrors ?? []).toEqual([]);
  expect(rustResult.errors).toEqual([]);
  expect(rustResult.geometryValueErrors ?? []).toEqual([]);
};

const geometryTimelineVersionProjection = (
  fixture: Awaited<ReturnType<typeof compile>>,
  payload: EvaluationPayload
) => {
  const geometryTimelineBindingIds = new Set(
    fixture.options.bindingVersions?.versions
      .filter(version => version.control.kind === "linear" && version.bindingId.startsWith("binding:"))
      .map(version => version.bindingId) ?? []
  );
  return (payload.computedScalarBindingVersions ?? [])
    .filter(version => geometryTimelineBindingIds.has(version.bindingId));
};

const assertSide2OccurrenceIdentity = (
  fixture: Awaited<ReturnType<typeof compile>>,
  expectedInstances = 2
) => {
  const recipes = (fixture.options.transformationRecipes ?? []).flatMap((recipe, recipeIndex) =>
    recipe.construction === "extend" && recipe.targets.some(target => target.source === "side2.end")
      ? [{ recipe, recipeIndex }]
      : []
  );
  expect(recipes).toHaveLength(expectedInstances);
  expect(new Set(recipes.map(({ recipe }) => JSON.stringify(recipe.runtimeInstancePath))).size).toBe(expectedInstances);
  for (const { recipe, recipeIndex } of recipes) {
    if (recipe.operation.kind !== "extend" || recipe.operation.point.mode !== "geometryValue") {
      throw new Error(`side2 recipe ${recipeIndex} does not consume an immutable point occurrence`);
    }
    const occurrence = recipe.operation.point.occurrence;
    const occurrenceKey = geometryValueOccurrenceKey(occurrence);
    const programEntry = fixture.options.geometryValueProgram?.find(entry =>
      geometryValueOccurrenceKey(entry.occurrence) === occurrenceKey
    );
    const plan = fixture.options.transformationDependencyPlans?.find(candidate => candidate.recipeIndex === recipeIndex);
    const recipeValueEdge = fixture.options.typedDependencyGraph?.edges.find(edge =>
      edge.from.kind === "transformation-recipe" &&
      edge.from.ownerId === recipe.targets.find(target => target.source === "side2.end")?.ownerId &&
      edge.to.kind === "geometry-value" && edge.to.id === occurrenceKey
    );
    expect(programEntry?.occurrence).toEqual(occurrence);
    expect(programEntry?.sourceStatementId).toBe(occurrence.sourceStatementId);
    expect(recipe.runtimeInstancePath).toEqual(occurrence.instancePath);
    expect(plan?.geometryValuePrerequisites?.map(geometryValueOccurrenceKey)).toContain(occurrenceKey);
    expect(recipeValueEdge?.to.id).toBe(occurrenceKey);
  }
};

describe("Issue #1649 imported const point extend", () => {
  it("captures the imported two-instance const baseline against the independent TS result", async () => {
    const fixture = await compile();
    assertSide2OccurrenceIdentity(fixture);
    expect(fixture.options.bindingVersions?.versions.length).toBeGreaterThan(0);
    const run = await evaluateBoth(fixture);
    expectNoEvaluationErrors(run.typescript, run.rust);
    expectExtendParity(fixture, run.typescript, run.rust);
    expect(normalizeParityPayload(run.rustPayload.computedScalarBindings))
      .toEqual(normalizeParityPayload(run.typescriptPayload.computedScalarBindings));
    expect(normalizeParityPayload(geometryTimelineVersionProjection(fixture, run.rustPayload)))
      .toEqual(normalizeParityPayload(geometryTimelineVersionProjection(fixture, run.typescriptPayload)));

    const typescriptSide2 = side2Measurements(fixture, run.typescript);
    const rustSide2 = side2Measurements(fixture, run.rust);
    expect(rustSide2).toHaveLength(typescriptSide2.length);
    const mismatches = typescriptSide2.flatMap(reference => {
      const production = rustSide2.find(candidate => candidate.recipeIndex === reference.recipeIndex);
      return production && Math.abs(production.length - reference.length) > 1e-8
        ? [{ reference, production }]
        : [];
    });
    expect(mismatches, JSON.stringify({ typescriptSide2, rustSide2 })).toEqual([]);
  }, 120_000);

  it("reproduces the upper-only 5.832 mm numerical oracle", async () => {
    const fixture = await compile(upperOnlyFiles());
    assertSide2OccurrenceIdentity(fixture, 1);
    const run = await evaluateBoth(fixture);
    expectNoEvaluationErrors(run.typescript, run.rust);
    expectExtendParity(fixture, run.typescript, run.rust);
    const [typescriptSide2] = side2Measurements(fixture, run.typescript);
    const [rustSide2] = side2Measurements(fixture, run.rust);

    expect(typescriptSide2?.length).toBeCloseTo(5.832489178468742, 10);
    expect(typescriptSide2?.end.x).toBeCloseTo(61.53275876146343, 10);
    expect(typescriptSide2?.end.y).toBeCloseTo(-116.92405014616746, 10);
    expect(rustSide2?.length, JSON.stringify({ typescriptSide2, rustSide2 })).toBeCloseTo(typescriptSide2!.length, 10);
  }, 120_000);

  it("keeps the drawable point and end2 probe controls shortened in both instances", async () => {
    for (const [files, hasImmutablePoint] of [[pointControlFiles(), false], [end2ProbeFiles(), true]] as const) {
      const fixture = await compile(files);
      if (hasImmutablePoint) assertSide2OccurrenceIdentity(fixture);
      const run = await evaluateBoth(fixture);
      expectNoEvaluationErrors(run.typescript, run.rust);
      expectExtendParity(fixture, run.typescript, run.rust);
      expect(side2Measurements(fixture, run.rust).every(measurement => measurement.length < 10)).toBe(true);
    }
  }, 120_000);

  it("preserves imported evaluation with extensions enabled", async () => {
    const files = fixtureFiles();
    files[libraryName] = files[libraryName]!.replaceAll("extensions: false", "extensions: true");
    const fixture = await compile(files);
    assertSide2OccurrenceIdentity(fixture);
    const run = await evaluateBoth(fixture);
    expectNoEvaluationErrors(run.typescript, run.rust);
    expectExtendParity(fixture, run.typescript, run.rust);
  }, 120_000);

  it("matches root and same-document Module const-point controls", async () => {
    const rootFixture = await compile({ [rootName]: rootPointSource(5) });
    const rootRun = await evaluateBoth(rootFixture);
    expectNoEvaluationErrors(rootRun.typescript, rootRun.rust);
    expectExtendParity(rootFixture, rootRun.typescript, rootRun.rust);
    expect(extendMeasurements(rootFixture, rootRun.rust)[0]?.length).toBeCloseTo(5, 10);

    const moduleFixture = await compile(sameDocumentFiles());
    assertSide2OccurrenceIdentity(moduleFixture);
    const moduleRun = await evaluateBoth(moduleFixture);
    expectNoEvaluationErrors(moduleRun.typescript, moduleRun.rust);
    expectExtendParity(moduleFixture, moduleRun.typescript, moduleRun.rust);
  }, 120_000);

  it("retains diagnostics for missing and invalid root intersections", async () => {
    const missingFixture = await compile({ [rootName]: rootPointSource(20) });
    const missingRun = await evaluateBoth(missingFixture);
    expect(missingRun.typescript.geometryValueErrors?.length).toBeGreaterThan(0);
    expect(missingRun.rust.geometryValueErrors?.length).toBeGreaterThan(0);
    expect(normalizeParityPayload(missingRun.rustPayload.geometryValueErrors))
      .toEqual(normalizeParityPayload(missingRun.typescriptPayload.geometryValueErrors));

    const invalidFixture = await compile({
      [rootName]: rootPointSource(5).replace(
        "point root_end = coordinate(x: 10, y: 0)",
        "point root_end = coordinate(x: 0, y: 0)"
      )
    });
    const invalidRun = await evaluateBoth(invalidFixture);
    expect(invalidRun.typescript.geometryValueErrors?.length).toBeGreaterThan(0);
    expect(invalidRun.rust.geometryValueErrors?.length).toBeGreaterThan(0);
    expect(normalizeParityPayload(invalidRun.rustPayload.geometryValueErrors))
      .toEqual(normalizeParityPayload(invalidRun.typescriptPayload.geometryValueErrors));
  }, 120_000);

  it("keeps scalar timeline and Module results stable across warm requests and a source update", async () => {
    const initialFixture = await compile(upperOnlyFiles());
    expect(initialFixture.options.bindingVersions?.versions.length).toBeGreaterThan(0);
    const client = createRustStdioParityClient(repoRoot);
    try {
      const reference = evaluateElementsReferencePayload(initialFixture.elements, initialFixture.options);
      const cold = await client.evaluate(initialFixture.elements, initialFixture.options) as EvaluationPayload;
      const warm = await client.evaluate(initialFixture.elements, initialFixture.options) as EvaluationPayload;
      expectExtendParity(initialFixture, evaluationPayloadToResult(reference), evaluationPayloadToResult(cold));
      expectExtendParity(initialFixture, evaluationPayloadToResult(reference), evaluationPayloadToResult(warm));
      expect(normalizeParityPayload(geometryTimelineVersionProjection(initialFixture, cold)))
        .toEqual(normalizeParityPayload(geometryTimelineVersionProjection(initialFixture, reference)));
      expect(normalizeParityPayload(geometryTimelineVersionProjection(initialFixture, warm)))
        .toEqual(normalizeParityPayload(geometryTimelineVersionProjection(initialFixture, reference)));

      const changedFiles = upperOnlyFiles();
      changedFiles[rootName] = changedFiles[rootName]!.replace(
        "    distance: 33,\n    steps: [distance: 1],",
        "    distance: 34,\n    steps: [distance: 1],"
      );
      const updatedFixture = await compile(changedFiles, 2);
      const updatedReference = evaluateElementsReferencePayload(updatedFixture.elements, updatedFixture.options);
      const updatedRust = await client.evaluate(updatedFixture.elements, updatedFixture.options) as EvaluationPayload;
      expectExtendParity(updatedFixture, evaluationPayloadToResult(updatedReference), evaluationPayloadToResult(updatedRust));
      expectNoEvaluationErrors(evaluationPayloadToResult(updatedReference), evaluationPayloadToResult(updatedRust));
      expect(side2Measurements(updatedFixture, evaluationPayloadToResult(updatedRust))[0]?.end)
        .not.toEqual(side2Measurements(initialFixture, evaluationPayloadToResult(warm))[0]?.end);
    } finally {
      client.dispose();
    }
  }, 120_000);
});
