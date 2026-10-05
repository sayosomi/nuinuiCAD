import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import {
  emptyDocument,
  geometryValueOccurrenceKey,
  moduleCarryBindingIdFor,
  propertyBindingOccurrenceKey,
  resolveTypedDependencyGraphRuntime,
  typedDependencyBindingHasActiveGeometryPrerequisite
} from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import type { GeometryInputTarget } from "../src/types/geometry";
import {
  evaluateWithRustFixture,
  isCurrentReleaseFixture,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  parityFixtureNames,
  readParityFixture,
  runtimeDiagnosticsFor,
  evaluateWithRustOptions,
  createRustStdioParityClient,
  evaluateWithRustStdioOptions,
  fixtureFromSource
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const fixtureNames = runRustParity ? parityFixtureNames(repoRoot) : [];

const scalarBindingFor = (
  fixture: ReturnType<typeof readParityFixture>,
  payload: ReturnType<typeof evaluateWithRustFixture>,
  name: string
) => {
  const binding = fixture.compiled?.doc?.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const expectScalarNumberClose = (
  value: ReturnType<typeof scalarBindingFor>,
  expected: number
): void => {
  expect(value?.status).toBe("ok");
  if (value?.status !== "ok" || value.value.kind !== "number") throw new Error("expected a numeric scalar success");
  expect(value.value.value).toBeCloseTo(expected, 10);
};

const isGeometryInputTargetList = (
  target: GeometryInputTarget | readonly GeometryInputTarget[]
): target is readonly GeometryInputTarget[] => Array.isArray(target);

const say433Expected = {
  DirectBaseLength: 10,
  DirectNamedLength: 20,
  DirectFinalLength: 40,
  BaseOneLength: 10,
  BaseTwoLength: 10,
  NamedOneLength: 20,
  NamedTwoLength: 20,
  FinalAliasLength: 40
} as const;

type Say433EvaluationCase = {
  fixture: ReturnType<typeof fixtureFromSource>;
  options: ReturnType<typeof optionsFor>;
  tsPayload: ReturnType<typeof evaluateElementsReferencePayload>;
};

const buildSay433TypeScriptCases = () => {
  const expected = say433Expected;
  const aliases = [
    "const BaseOne: line = @A.base",
    "const BaseTwo: line = @BaseOne",
    "const NamedOne: line = @A.first",
    "const NamedTwo: line = @NamedOne",
    "const FinalAlias: line = @A.final"
  ];
  const propertyReads = [
    "const DirectBaseLength: number = @A.base.length",
    "const DirectNamedLength: number = @A.first.length",
    "const DirectFinalLength: number = @A.final.length",
    "const BaseOneLength: number = @BaseOne.length",
    "const BaseTwoLength: number = @BaseTwo.length",
    "const NamedOneLength: number = @NamedOne.length",
    "const NamedTwoLength: number = @NamedTwo.length",
    "const FinalAliasLength: number = @FinalAlias.length"
  ];
  const stages = [
    "move A as first (from: (0, 0), to: (10, 0), scale: 2)",
    "move A as finished (from: (10, 0), to: (20, 0), scale: 2)"
  ];
  const padding = (label: string) => [`// SAY-433 ${label} ${"padding ".repeat(12)}`, ""];
  const sourceFor = (
    stagePlacement: "stages-first" | "reads-before-stages",
    insertUnrelated: boolean,
    padded: boolean
  ) => {
    const beforeAliases = [
      "line A = segment(start: (0, 0), end: (10, 0))",
      ...(insertUnrelated ? ["const Independent: number = 17"] : []),
      ...(padded ? padding("between-geometry-and-aliases") : [])
    ];
    const aliasesAndReads = [
      ...aliases,
      ...(padded ? padding("between-aliases-and-property-reads") : []),
      ...propertyReads
    ];
    return [
      "nui 1",
      ...(padded ? padding("leading") : []),
      ...beforeAliases,
      ...(stagePlacement === "stages-first"
        ? [...stages, ...(padded ? padding("between-stages-and-aliases") : []), ...aliasesAndReads]
        : [...aliasesAndReads, ...(padded ? padding("between-property-reads-and-stages") : []), ...stages])
    ].join("\n");
  };
  const valuesByVariant = new Map<string, Record<string, number>>();
  const compilerCases: Say433EvaluationCase[] = [];

  for (const stagePlacement of ["stages-first", "reads-before-stages"] as const) {
    for (const insertUnrelated of [false, true]) {
      for (const padded of [false, true]) {
        const fixture = fixtureFromSource(sourceFor(stagePlacement, insertUnrelated, padded));
        const options = optionsFor(fixture);
        const scalarProgram = options.scalarProgram;
        const geometryValueProgram = options.geometryValueProgram ?? [];
        if (!scalarProgram) throw new Error("missing compiler-authored scalar program");
        const bindingFor = (name: string) => {
          const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
            (candidate) => candidate.kind === "typed" && candidate.name === name
          );
          if (!binding) throw new Error(`typed binding "${name}" not found`);
          return binding;
        };
        const geometryValueFor = (name: string) => {
          const binding = bindingFor(name);
          const entry = geometryValueProgram.find((candidate) => candidate.sourceStatementIndex === binding.statementIndex);
          if (!entry) throw new Error(`geometry value for "${name}" not found`);
          return entry;
        };
        const initializerFor = (name: keyof typeof expected) => {
          const binding = bindingFor(name);
          const initializer = scalarProgram.statements.find((statement) => statement.bindingId === binding.id)?.declaration.initializer;
          if (!initializer || initializer.kind !== "geometryProperty") {
            throw new Error(`${name} must compile to a geometry-property expression`);
          }
          return initializer;
        };
        const aliasPropertyPairs = [
          ["BaseOneLength", "BaseOne", ["base"]],
          ["BaseTwoLength", "BaseTwo", ["base"]],
          ["NamedOneLength", "NamedOne", ["first"]],
          ["NamedTwoLength", "NamedTwo", ["first"]],
          ["FinalAliasLength", "FinalAlias", ["final"]]
        ] as const;
        const owner = fixture.elements.find((element) => element.name === "A");
        if (!owner) throw new Error("expected line A");
        for (const [propertyName, aliasName, stagePath] of aliasPropertyPairs) {
          const aliasEntry = geometryValueFor(aliasName);
          const initializer = initializerFor(propertyName);
          expect(initializer.elementId).toBe(owner.id);
          expect(initializer.stagePath).toEqual(stagePath);
          const aliasTarget = aliasEntry.construction.kind === "reference" ? aliasEntry.construction.target : null;
          const targetStagePath = aliasTarget && "stagePath" in aliasTarget ? aliasTarget.stagePath : undefined;
          const targetOccurrence = aliasTarget && aliasTarget.kind === "geometryValue" ? aliasTarget.occurrence : undefined;
          const precedingAlias = aliasName === "BaseTwo" ? geometryValueFor("BaseOne")
            : aliasName === "NamedTwo" ? geometryValueFor("NamedOne")
              : undefined;
          expect(
            targetStagePath?.join(".") === stagePath.join(".") ||
            (precedingAlias !== undefined && targetOccurrence !== undefined &&
              geometryValueOccurrenceKey(targetOccurrence) === geometryValueOccurrenceKey(precedingAlias.occurrence))
          ).toBe(true);
        }
        expect(initializerFor("DirectBaseLength").stagePath).toEqual(["base"]);
        expect(initializerFor("DirectNamedLength").stagePath).toEqual(["first"]);
        expect(initializerFor("DirectFinalLength").stagePath).toEqual(["final"]);

        const graph = fixture.compiled?.doc.typedDependencyGraph;
        if (!graph) throw new Error("missing compiler-authored typed dependency graph");
        const hasStageEdge = (fromId: string, stage: string) => graph.edges.some((edge) =>
          edge.from.kind === "geometry-value" && edge.from.id === fromId &&
          edge.to.kind === "geometry-stage" && edge.to.ownerId === owner.id &&
          edge.to.stagePath.join(".") === stage
        );
        const hasBindingStageEdge = (bindingName: string, stage: string) => {
          const binding = bindingFor(bindingName);
          return graph.edges.some((edge) =>
            edge.from.kind === "binding" && edge.from.id === binding.id &&
            edge.to.kind === "geometry-stage" && edge.to.ownerId === owner.id &&
            edge.to.stagePath.join(".") === stage
          );
        };
        const baseOne = geometryValueFor("BaseOne");
        const namedOne = geometryValueFor("NamedOne");
        const finalAlias = geometryValueFor("FinalAlias");
        expect(hasStageEdge(geometryValueOccurrenceKey(baseOne.occurrence), "base")).toBe(true);
        expect(hasStageEdge(geometryValueOccurrenceKey(namedOne.occurrence), "first")).toBe(true);
        expect(hasStageEdge(geometryValueOccurrenceKey(finalAlias.occurrence), "final")).toBe(true);
        for (const [propertyName, aliasName] of aliasPropertyPairs) {
          const stage = aliasName.startsWith("Base") ? "base"
            : aliasName.startsWith("Named") ? "first"
              : "final";
          expect(hasBindingStageEdge(propertyName, stage)).toBe(true);
          if (stage !== "final") expect(hasBindingStageEdge(propertyName, "final")).toBe(false);
        }
        expect(hasBindingStageEdge("DirectBaseLength", "base")).toBe(true);
        expect(hasBindingStageEdge("DirectNamedLength", "first")).toBe(true);
        expect(hasBindingStageEdge("DirectFinalLength", "final")).toBe(true);

        const rustInput = buildRustEvaluationInput(fixture.elements, options);
        for (const name of Object.keys(expected) as (keyof typeof expected)[]) {
          const binding = bindingFor(name);
          const initializer = rustInput.scalarProgram?.statements.find((statement) => statement.bindingId === binding.id)?.declaration.initializer ??
            rustInput.bindingVersions?.versions.find((version) => version.bindingId === binding.id)?.initializer as
              { kind?: string; stagePath?: readonly string[] } | undefined;
          if (!initializer || initializer.kind !== "geometryProperty") {
            throw new Error(`${name} must remain a geometry-property expression in the Rust input`);
          }
          const stage = name.includes("Base") ? "base"
            : name.includes("Named") ? "first"
              : "final";
          expect(initializer.stagePath).toEqual([stage]);
        }

        const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
        const tsResult = evaluationPayloadToResult(tsPayload);
        expect(tsResult.errors).toEqual([]);
        const values: Record<string, number> = {};
        for (const name of Object.keys(expected) as (keyof typeof expected)[]) {
          const value = scalarBindingFor(fixture, tsPayload, name);
          expectScalarNumberClose(value, expected[name]);
          if (value?.status !== "ok" || value.value.kind !== "number") {
            throw new Error(`expected ${name} to evaluate to a number`);
          }
          values[name] = value.value.value;
        }
        valuesByVariant.set(`${stagePlacement}:${insertUnrelated ? "inserted" : "plain"}:${padded ? "padded" : "compact"}`, values);
        compilerCases.push({ fixture, options, tsPayload });
      }
    }
  }

  for (const [variant, values] of valuesByVariant) {
    expect(values, variant).toEqual(expected);
  }
  return compilerCases;
};

it("preserves selected stages through immutable geometry aliases (TypeScript/compiler)", () => {
  expect(buildSay433TypeScriptCases()).toHaveLength(8);
});

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  });

  afterAll(() => {
    rustStdio?.dispose();
  });

  it("consumes authored-order selected drawable join snapshots in root and Module evaluation", async () => {
    const rootFixture = fixtureFromSource([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as shifted (from: (0, 0), to: (0, 20))",
      "move L as finish (from: (0, 20), to: (0, 50))",
      "line Tail = segment(start: (30, 20), end: (10, 20))",
      "line OnlyFinal = segment(start: (10, 50), end: (20, 50))",
      "line Shifted = join(paths: [@L.shifted], closed: false)",
      "line Base = join(paths: [@L.base], closed: false)",
      "line Final = join(paths: [@L.final], closed: false)",
      "line Ordered = join(paths: [@L.shifted, @Tail], closed: false)",
      "line FinalOnlyTail = join(paths: [@L.shifted, @OnlyFinal], closed: false)"
    ].join("\n"));
    const moduleFixture = fixtureFromSource([
      "nui 1",
      "module Draft() {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "  move L as shifted (from: (0, 0), to: (0, 20))",
      "  move L as finish (from: (0, 20), to: (0, 50))",
      "  line Tail = segment(start: (30, 20), end: (10, 20))",
      "  line OnlyFinal = segment(start: (10, 50), end: (20, 50))",
      "  line Shifted = join(paths: [@L.shifted], closed: false)",
      "  line Base = join(paths: [@L.base], closed: false)",
      "  line Final = join(paths: [@L.final], closed: false)",
      "  line Ordered = join(paths: [@L.shifted, @Tail], closed: false)",
      "  line FinalOnlyTail = join(paths: [@L.shifted, @OnlyFinal], closed: false)",
      "}",
      "instance Use = Draft()"
    ].join("\n"));

    const verify = async (fixture: ReturnType<typeof fixtureFromSource>, parentName?: string) => {
      const diagnostics = fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error") ?? [];
      expect(diagnostics).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const options = optionsFor(fixture);
      const rustInput = buildRustEvaluationInput(fixture.elements, options);
      const targetFor = (name: string) => {
        const parent = parentName ? fixture.elements.find((element) => element.name === parentName) : undefined;
        const element = fixture.elements.find((candidate) => candidate.name === name && (!parent || candidate.parentGroupId === parent.id));
        if (!element) throw new Error(`missing join ${name}`);
        const targets = options.geometryInputTargetsByElementId?.get(element.id)?.get("pathIds");
        return { element, targets };
      };
      const ordered = targetFor("Ordered");
      expect(Array.isArray(ordered.targets)).toBe(true);
      if (!Array.isArray(ordered.targets)) throw new Error("expected a complete ordered canonical target list");
      expect(ordered.targets.map((target) => target.kind === "drawable" ? target.stagePath : target.kind)).toEqual([
        ["shifted"], ["final"]
      ]);
      expect(rustInput.geometryInputTargets?.find((entry) => entry.elementId === ordered.element.id)?.parameters)
        .toEqual([{ parameterKey: "pathIds", target: ordered.targets }]);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluateInput(rustInput);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const result = evaluationPayloadToResult(tsPayload);
      const joinedFor = (name: string) => {
        const { element } = targetFor(name);
        const geometry = result.computedGeometry.get(element.id);
        if (!geometry || geometry.kind !== "joinedPath") throw new Error(`expected ${name} joined geometry`);
        return geometry;
      };
      const shifted = joinedFor("Shifted");
      expect(shifted).toMatchObject({ start: { x: 0, y: 20 }, end: { x: 10, y: 20 }, length: 10 });
      expect(joinedFor("Base")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, length: 10 });
      expect(joinedFor("Final")).toMatchObject({ start: { x: 0, y: 50 }, end: { x: 10, y: 50 }, length: 10 });
      expect(joinedFor("Ordered").segments.map((segment) => [segment.start.x, segment.start.y, segment.end.x, segment.end.y]))
        .toEqual([[0, 20, 10, 20], [10, 20, 30, 20]]);
      const finalOnly = targetFor("FinalOnlyTail").element;
      expect(result.computedGeometry.has(finalOnly.id)).toBe(false);
      expect(result.errors.some((error) => error.elementId === finalOnly.id)).toBe(true);
    };

    await verify(rootFixture);
    await verify(moduleFixture, "Use");
  }, 30000);

  it("accumulates independent point input diagnostics across the persistent Rust stdio boundary", async () => {
    const evaluateSource = async (source: string) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      const ts = evaluationPayloadToResult(tsPayload);
      const rust = evaluationPayloadToResult(rustPayload);
      expect(rust.errors).toEqual(ts.errors);
      return { fixture, ts, rust };
    };

    const bothAxes = await evaluateSource([
      "nui 1",
      "point A = coordinate(x: 1 / 0, y: sqrt(-1))"
    ].join("\n"));
    const bothAxesPoint = bothAxes.fixture.elements.find((element) => element.name === "A")!;
    for (const result of [bothAxes.ts, bothAxes.rust]) {
      expect(result.computedGeometry.has(bothAxesPoint.id)).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((error) => error.missingDependencyId)).toEqual(["1 / 0", "sqrt(-1)"]);
    }

    const diagnosticKeys = (result: { errors: readonly { elementName: string; missingDependencyId: string }[] }) =>
      result.errors.map(({ elementName, missingDependencyId }) => ({ elementName, missingDependencyId }));
    const typedBefore = await evaluateSource([
      "nui 1",
      "const Pad: number = 9",
      "point A = coordinate(x: 1 / 0, y: sqrt(-1))"
    ].join("\n"));
    const typedAfter = await evaluateSource([
      "nui 1",
      "point A = coordinate(x: 1 / 0, y: sqrt(-1))",
      "const Pad: number = 9"
    ].join("\n"));
    for (const evaluated of [typedBefore, typedAfter]) {
      const inputBindings = [...(evaluated.fixture.compiled?.doc.numericBindings?.values() ?? [])]
        .filter((binding) => binding.parameterKey === "x" || binding.parameterKey === "y");
      expect(inputBindings.map((binding) => binding.parameterKey)).toEqual(["x", "y"]);
      expect(inputBindings.every((binding) => binding.typedExpression !== undefined)).toBe(true);
    }
    for (const evaluated of [typedBefore, typedAfter]) {
      const point = evaluated.fixture.elements.find((element) => element.name === "A")!;
      for (const result of [evaluated.ts, evaluated.rust]) {
        expect(result.computedGeometry.has(point.id)).toBe(false);
        expect(diagnosticKeys(result)).toEqual([
          { elementName: "A", missingDependencyId: "1 / 0" },
          { elementName: "A", missingDependencyId: "sqrt(-1)" }
        ]);
      }
    }
    expect(diagnosticKeys(typedBefore.ts)).toEqual(diagnosticKeys(bothAxes.ts));
    expect(diagnosticKeys(typedAfter.ts)).toEqual(diagnosticKeys(bothAxes.ts));

    const multipleTyped = await evaluateSource([
      "nui 1",
      "const Pad: number = 9",
      "point First = coordinate(x: 1 / 0, y: sqrt(-1))",
      "point Second = coordinate(x: sqrt(-1), y: 1 / 0)"
    ].join("\n"));
    for (const result of [multipleTyped.ts, multipleTyped.rust]) {
      for (const name of ["First", "Second"]) {
        const point = multipleTyped.fixture.elements.find((element) => element.name === name)!;
        expect(result.computedGeometry.has(point.id)).toBe(false);
      }
      expect(diagnosticKeys(result)).toEqual([
        { elementName: "First", missingDependencyId: "1 / 0" },
        { elementName: "First", missingDependencyId: "sqrt(-1)" },
        { elementName: "Second", missingDependencyId: "sqrt(-1)" },
        { elementName: "Second", missingDependencyId: "1 / 0" }
      ]);
    }

    const oneTypedAxis = await evaluateSource([
      "nui 1",
      "const Pad: number = 9",
      "point A = coordinate(x: 1 / 0, y: 4)"
    ].join("\n"));
    const oneTypedAxisPoint = oneTypedAxis.fixture.elements.find((element) => element.name === "A")!;
    for (const result of [oneTypedAxis.ts, oneTypedAxis.rust]) {
      expect(result.computedGeometry.has(oneTypedAxisPoint.id)).toBe(false);
      expect(diagnosticKeys(result)).toEqual([{ elementName: "A", missingDependencyId: "1 / 0" }]);
    }

    const disabledTyped = await evaluateSource([
      "nui 1",
      "const Pad: number = 9",
      "point A = coordinate(x: 1 / 0, y: sqrt(-1), enabled: false)"
    ].join("\n"));
    const disabledTypedPoint = disabledTyped.fixture.elements.find((element) => element.name === "A")!;
    for (const result of [disabledTyped.ts, disabledTyped.rust]) {
      expect(result.computedGeometry.has(disabledTypedPoint.id)).toBe(false);
      expect(result.errors).toEqual([]);
    }

    const typedCascade = await evaluateSource([
      "nui 1",
      "const Pad: number = 9",
      "point Broken = coordinate(x: 1 / 0, y: 0)",
      "point Child = offset(from: @Broken, dx: sqrt(-1), dy: 1)"
    ].join("\n"));
    const typedBrokenPoint = typedCascade.fixture.elements.find((element) => element.name === "Broken")!;
    const typedChildPoint = typedCascade.fixture.elements.find((element) => element.name === "Child")!;
    for (const result of [typedCascade.ts, typedCascade.rust]) {
      expect(result.computedGeometry.has(typedBrokenPoint.id)).toBe(false);
      expect(result.computedGeometry.has(typedChildPoint.id)).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map(({ elementName, missingDependencyId }) => ({ elementName, missingDependencyId })))
        .toEqual([
          { elementName: "Broken", missingDependencyId: "1 / 0" },
          { elementName: "Child", missingDependencyId: typedBrokenPoint.id }
        ]);
      expect(result.errors.some((error) => error.missingDependencyId === "sqrt(-1)")).toBe(false);
    }

    const oneAxis = await evaluateSource([
      "nui 1",
      "point A = coordinate(x: 1 / 0, y: 4)"
    ].join("\n"));
    const oneAxisPoint = oneAxis.fixture.elements.find((element) => element.name === "A")!;
    for (const result of [oneAxis.ts, oneAxis.rust]) {
      expect(result.computedGeometry.has(oneAxisPoint.id)).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].missingDependencyId).toBe("1 / 0");
    }

    const disabled = await evaluateSource([
      "nui 1",
      "point A = coordinate(x: 1 / 0, y: sqrt(-1), enabled: false)"
    ].join("\n"));
    const disabledPoint = disabled.fixture.elements.find((element) => element.name === "A")!;
    for (const result of [disabled.ts, disabled.rust]) {
      expect(result.computedGeometry.has(disabledPoint.id)).toBe(false);
      expect(result.errors).toEqual([]);
    }

    const cascade = await evaluateSource([
      "nui 1",
      "point Broken = coordinate(x: 1 / 0, y: 0)",
      "point Child = offset(from: @Broken, dx: sqrt(-1), dy: 1)"
    ].join("\n"));
    const brokenPoint = cascade.fixture.elements.find((element) => element.name === "Broken")!;
    const childPoint = cascade.fixture.elements.find((element) => element.name === "Child")!;
    for (const result of [cascade.ts, cascade.rust]) {
      expect(result.computedGeometry.has(brokenPoint.id)).toBe(false);
      expect(result.computedGeometry.has(childPoint.id)).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((error) => error.elementId)).toEqual([brokenPoint.id, childPoint.id]);
      expect(result.errors[1].missingDependencyId).toBe(brokenPoint.id);
      expect(result.errors.some((error) => error.missingDependencyId === "sqrt(-1)")).toBe(false);
    }

    const offsetInputs = await evaluateSource([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Offset = offset(from: @Base, dx: 1 / 0, dy: sqrt(-1))"
    ].join("\n"));
    const offsetPoint = offsetInputs.fixture.elements.find((element) => element.name === "Offset")!;
    for (const result of [offsetInputs.ts, offsetInputs.rust]) {
      expect(result.computedGeometry.has(offsetPoint.id)).toBe(false);
      expect(result.errors.map((error) => error.missingDependencyId)).toEqual(["1 / 0", "sqrt(-1)"]);
    }

    const polarInputs = await evaluateSource([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Polar = polar(from: @Base, angle: 1 / 0, distance: sqrt(-1))"
    ].join("\n"));
    const polarPoint = polarInputs.fixture.elements.find((element) => element.name === "Polar")!;
    for (const result of [polarInputs.ts, polarInputs.rust]) {
      expect(result.computedGeometry.has(polarPoint.id)).toBe(false);
      expect(result.errors.map((error) => error.missingDependencyId)).toEqual(["1 / 0", "sqrt(-1)"]);
    }

    const divisionAnchors = await evaluateSource([
      "nui 1",
      "point Between = between(start: (1 / 0, sqrt(-1)), end: (1 / 0, sqrt(-1)), ratio: 0.5)"
    ].join("\n"));
    const divisionPoint = divisionAnchors.fixture.elements.find((element) => element.name === "Between")!;
    for (const result of [divisionAnchors.ts, divisionAnchors.rust]) {
      expect(result.computedGeometry.has(divisionPoint.id)).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors.map((error) => error.missingDependencyId)).toEqual([
        "1 / 0", "sqrt(-1)", "1 / 0", "sqrt(-1)"
      ]);
    }
  }, 30000);

  it("keeps immutable geometry values on the canonical dependency execution timeline", async () => {
    const evaluatePureCoordinate = async (source: string, expectForwardSourcePosition: boolean) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      const use = fixture.elements.find((element) => element.name === "Use");
      const selBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
        (binding) => binding.kind === "typed" && binding.name === "sel"
      );
      const selEntry = selBinding
        ? options.geometryValueProgram?.find((entry) => entry.sourceStatementIndex === selBinding.statementIndex)
        : undefined;
      const graph = fixture.compiled?.doc.typedDependencyGraph;
      if (!use || !selEntry || !graph) throw new Error("expected Use and sel geometry value with a compiled dependency graph");

      const useSourcePosition = options.scalarExecutionPositionByElementId?.get(use.id) ??
        options.statementInfoByElementId?.get(use.id)?.statementIndex;
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(useSourcePosition).toBeDefined();
      expect(selEntry.sourceExecutionPosition).toBeDefined();
      if (useSourcePosition !== undefined && selEntry.sourceExecutionPosition !== undefined) {
        expect(selEntry.sourceExecutionPosition > useSourcePosition).toBe(expectForwardSourcePosition);
      }
      const hasLinearMutationTimeline = Boolean(
        options.conditionalOwnerStatementIdByElementId?.size ||
        options.forGroupMutationOwnerByElementId?.size ||
        options.moduleConditionalOwnerStatementIdByElementId?.size ||
        options.moduleForGroupExecutionOwnerByElementId?.size ||
        options.bindingVersions?.immutableForGroups?.size ||
        options.bindingVersions?.moduleForGroupExecutionOwnersByStatementId?.size ||
        options.bindingVersions?.versions.some((version) =>
          version.predecessorId !== undefined || version.control.ownerChain.length > 0
        )
      );
      expect(hasLinearMutationTimeline).toBe(false);

      const dependencyOrder = resolveTypedDependencyGraphRuntime(graph, new Map()).dependencyOrder;
      const valueRank = dependencyOrder.indexOf(`geometry-value:${geometryValueOccurrenceKey(selEntry.occurrence)}`);
      const consumerRank = dependencyOrder.indexOf(`element:${use.id}`);
      expect(valueRank).toBeGreaterThanOrEqual(0);
      expect(consumerRank).toBeGreaterThanOrEqual(0);
      expect(valueRank).toBeLessThan(consumerRank);

      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      return {
        use,
        ts: evaluationPayloadToResult(tsPayload),
        rust: evaluationPayloadToResult(rustPayload)
      };
    };
    const pureCoordinateSource = (forward: boolean, padded: boolean) => {
      const lines = ["nui 1"];
      if (padded) lines.push("", "const UnrelatedBefore: number = 7", "", "const UnrelatedBeforeUse: number = 8", "");
      if (forward) {
        lines.push("point Use = from(source: @sel)");
        if (padded) lines.push("", "const UnrelatedBetween: number = 11", "");
        lines.push("const sel: point = coordinate(x: 3, y: 4)");
      } else {
        lines.push("const sel: point = coordinate(x: 3, y: 4)");
        if (padded) lines.push("", "const UnrelatedBetween: number = 11", "");
        lines.push("point Use = from(source: @sel)");
      }
      return lines.join("\n");
    };
    for (const [forward, padded] of [[true, false], [true, true], [false, false], [false, true]] as const) {
      const result = await evaluatePureCoordinate(pureCoordinateSource(forward, padded), forward);
      for (const evaluated of [result.ts, result.rust]) {
        expect(evaluated.errors).toEqual([]);
        expect(evaluated.warnings).toEqual([]);
        expect(evaluated.computedGeometry.get(result.use.id)).toMatchObject({ kind: "point", x: 3, y: 4 });
      }
    }

    const selectedLazySource = [
      "nui 1",
      "const sel: point = coordinate(x: 3, y: 4)",
      "const Selected: point =",
      "  if (true) {",
      "    @sel",
      "  } else {",
      "    coordinate(x: 1, y: 2)",
      "  }",
      "line Use = segment(start: @Selected, end: (0, 0))"
    ].join("\n");
    const selectedLazyValue = fixtureFromSource(selectedLazySource);
    const selectedLazyOptions = optionsFor(selectedLazyValue);
    const selectedLazyTsPayload = evaluateElementsReferencePayload(selectedLazyValue.elements, selectedLazyOptions);
    const selectedLazyRustPayload = await rustStdio!.evaluate(selectedLazyValue.elements, selectedLazyOptions);
    expect(selectedLazyValue.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(selectedLazyValue)).toBe(true);
    expect(normalizeParityPayload(selectedLazyRustPayload)).toEqual(normalizeParityPayload(selectedLazyTsPayload));
    const selectedUse = selectedLazyValue.elements.find((element) => element.name === "Use")!;
    for (const payload of [selectedLazyTsPayload, selectedLazyRustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.computedGeometry.get(selectedUse.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 0, y: 0 }
      });
    }

    const unavailableForwardValue = fixtureFromSource([
      "nui 1",
      "point Use = from(source: @sel)",
      "const sel: point = @Disabled",
      "point Disabled = coordinate(x: 3, y: 4, enabled: false)"
    ].join("\n"));
    const unavailableForwardOptions = optionsFor(unavailableForwardValue);
    const unavailableForwardTsPayload = evaluateElementsReferencePayload(unavailableForwardValue.elements, unavailableForwardOptions);
    const unavailableForwardRustPayload = await rustStdio!.evaluate(unavailableForwardValue.elements, unavailableForwardOptions);
    expect(unavailableForwardValue.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(unavailableForwardValue)).toBe(true);
    expect(normalizeParityPayload(unavailableForwardRustPayload)).toEqual(normalizeParityPayload(unavailableForwardTsPayload));
    const unavailableForwardUse = unavailableForwardValue.elements.find((element) => element.name === "Use")!;
    const disabledProducer = unavailableForwardValue.elements.find((element) => element.name === "Disabled")!;
    for (const payload of [unavailableForwardTsPayload, unavailableForwardRustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.computedGeometry.has(unavailableForwardUse.id)).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({
          elementId: unavailableForwardUse.id,
          missingDependencyId: unavailableForwardUse.id,
          message: expect.stringContaining("source geometry")
        })
      ]));
      expect(result.geometryValueErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: "Geometry value reference is unavailable at runtime." })
      ]));
      expect(result.computedGeometry.has(disabledProducer.id)).toBe(false);
    }

    const sourceFor = (padding: boolean) => [
      "nui 1",
      ...(padding ? ["const PaddingBefore: number = 3"] : []),
      "const Alias: point = @Later",
      ...(padding ? ["const PaddingBetween: number = 9"] : []),
      "line Use = segment(start: @Alias, end: (0, 0))",
      "point Later = coordinate(x: 20, y: 0)"
    ].join("\n");
    const evaluate = async (source: string) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      const ts = evaluationPayloadToResult(tsPayload);
      const rust = evaluationPayloadToResult(rustPayload);
      const use = fixture.elements.find((element) => element.name === "Use")!;
      const later = fixture.elements.find((element) => element.name === "Later")!;
      const aliasEntry = options.geometryValueProgram?.find((entry) =>
        entry.construction.kind === "reference" && entry.construction.target.statementId === later.id
      );

      expect(isRustEligibleFixture(fixture)).toBe(true);
      expect(aliasEntry).toBeDefined();
      expect(aliasEntry?.sourceExecutionPosition).toBeDefined();
      expect(aliasEntry?.executionPosition).not.toBe(aliasEntry?.sourceStatementIndex);
      expect(rust.errors).toEqual(ts.errors);
      expect(rust.warnings).toEqual(ts.warnings);
      for (const result of [ts, rust]) {
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.computedGeometry.get(use.id)).toMatchObject({
          kind: "line",
          start: { x: 20, y: 0 },
          end: { x: 0, y: 0 }
        });
      }
      return { fixture, ts, rust };
    };

    await evaluate(sourceFor(false));
    await evaluate(sourceFor(true));

    const typedAliasToLaterValue = fixtureFromSource([
      "nui 1",
      "const b: point = @a",
      "point Use = from(source: @b)",
      "const a: point = coordinate(x: 2, y: 3)"
    ].join("\n"));
    const typedAliasOptions = optionsFor(typedAliasToLaterValue);
    const typedAliasValues = typedAliasToLaterValue.compiled?.doc.moduleSemanticAnalysis?.geometryValues ?? [];
    const typedAliasB = typedAliasValues.find((value) => value.name === "b");
    const typedAliasA = typedAliasValues.find((value) => value.name === "a");
    const typedAliasEntry = typedAliasB
      ? typedAliasOptions.geometryValueProgram?.find((entry) => entry.sourceStatementId === typedAliasB.statementId)
      : undefined;
    expect(typedAliasToLaterValue.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(typedAliasB?.initializer?.target).toMatchObject({
      kind: "geometryValue",
      statementId: typedAliasA?.statementId,
      backingTarget: null
    });
    expect(typedAliasEntry?.construction).toMatchObject({
      kind: "reference",
      target: { kind: "geometryValue", statementId: typedAliasA?.statementId }
    });
    expect(isRustEligibleFixture(typedAliasToLaterValue)).toBe(true);
    const typedAliasTsPayload = evaluateElementsReferencePayload(typedAliasToLaterValue.elements, typedAliasOptions);
    const typedAliasRustPayload = await rustStdio!.evaluate(typedAliasToLaterValue.elements, typedAliasOptions);
    expect(normalizeParityPayload(typedAliasRustPayload)).toEqual(normalizeParityPayload(typedAliasTsPayload));
    const typedAliasUse = typedAliasToLaterValue.elements.find((element) => element.name === "Use")!;
    for (const payload of [typedAliasTsPayload, typedAliasRustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.computedGeometry.get(typedAliasUse.id)).toMatchObject({ kind: "point", x: 2, y: 3 });
    }

    const inactiveLaterBranch = fixtureFromSource([
      "nui 1",
      "const flag: boolean = false",
      "const Selected: point =",
      "  if (@flag) {",
      "    @Late",
      "  } else {",
      "    coordinate(x: 3, y: 4)",
      "  }",
      "line Use = segment(start: @Selected, end: (0, 0))",
      "point Late = coordinate(x: 20, y: 0)"
    ].join("\n"));
    const inactiveLaterOptions = {
      ...optionsFor(inactiveLaterBranch),
      evaluationLimitIndex: inactiveLaterBranch.elements.findIndex((element) => element.name === "Late")
    };
    const inactiveLaterTsPayload = evaluateElementsReferencePayload(inactiveLaterBranch.elements, inactiveLaterOptions);
    const inactiveLaterRustPayload = await rustStdio!.evaluate(inactiveLaterBranch.elements, inactiveLaterOptions);
    expect(inactiveLaterBranch.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(inactiveLaterBranch)).toBe(true);
    expect(normalizeParityPayload(inactiveLaterRustPayload)).toEqual(normalizeParityPayload(inactiveLaterTsPayload));
    for (const payload of [inactiveLaterTsPayload, inactiveLaterRustPayload]) {
      const result = evaluationPayloadToResult(payload);
      const use = inactiveLaterBranch.elements.find((element) => element.name === "Use")!;
      const late = inactiveLaterBranch.elements.find((element) => element.name === "Late")!;
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(result.evaluatedElementIds).toContain(use.id);
      expect(result.evaluatedElementIds).not.toContain(late.id);
      expect(result.computedGeometry.get(use.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 0, y: 0 }
      });
    }

    const laterDeclaration = fixtureFromSource([
      "nui 1",
      "line Use = segment(start: @Later, end: (0, 0))",
      "point Later = coordinate(x: 20, y: 0)"
    ].join("\n"));
    const laterOptions = optionsFor(laterDeclaration);
    const laterTs = evaluateElementsReferencePayload(laterDeclaration.elements, laterOptions);
    const laterRust = await rustStdio!.evaluate(laterDeclaration.elements, laterOptions);
    for (const payload of [laterTs, laterRust]) {
      const result = evaluationPayloadToResult(payload);
      const use = laterDeclaration.elements.find((element) => element.name === "Use")!;
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.computedGeometry.get(use.id)).toMatchObject({ kind: "line", start: { x: 20, y: 0 } });
    }
    expect(evaluationPayloadToResult(laterRust).errors).toEqual(evaluationPayloadToResult(laterTs).errors);
    expect(evaluationPayloadToResult(laterRust).warnings).toEqual(evaluationPayloadToResult(laterTs).warnings);

    const moduleFixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export const P: point = between(start: @Target.start, end: @Target.end, ratio: 0.5)",
      "  line Target = segment(start: (20, 0), end: (40, 0))",
      "}",
      "instance I = M()",
      "line Use = segment(start: @I::P, end: (0, 0))"
    ].join("\n"));
    const moduleOptions = optionsFor(moduleFixture);
    const moduleTs = evaluateElementsReferencePayload(moduleFixture.elements, moduleOptions);
    const moduleRust = await rustStdio!.evaluate(moduleFixture.elements, moduleOptions);
    expect(isRustEligibleFixture(moduleFixture)).toBe(true);
    expect(evaluationPayloadToResult(moduleRust).errors).toEqual(evaluationPayloadToResult(moduleTs).errors);
    expect(evaluationPayloadToResult(moduleRust).warnings).toEqual(evaluationPayloadToResult(moduleTs).warnings);
    for (const payload of [moduleTs, moduleRust]) {
      const result = evaluationPayloadToResult(payload);
      const use = moduleFixture.elements.find((element) => element.name === "Use")!;
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.computedGeometry.get(use.id)).toMatchObject({ kind: "line", start: { x: 30, y: 0 } });
    }

    const cycleSource = [
      "nui 1",
      "line A = segment(start: @B.end, end: (10, 0))",
      "line B = segment(start: @A.end, end: (20, 0))"
    ].join("\n");
    const cycleCompile = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), cycleSource);
    expect(cycleCompile.diagnostics.map((diagnostic) => diagnostic.code)).toContain("dependency-cycle");
  }, 30000);

  it("accepts explicit Module forGroup execution owners across the persistent Rust stdio boundary", async () => {
    const evaluateSource = async (source: string) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      return {
        fixture,
        options,
        tsPayload,
        rustPayload,
        ts: evaluationPayloadToResult(tsPayload),
        rust: evaluationPayloadToResult(rustPayload)
      };
    };
    const markRows = (result: ReturnType<typeof evaluationPayloadToResult>) =>
      result.forGroupGeneratedRows?.filter((row) => row.elementName.includes("Mark")) ?? [];
    const observableMarks = (result: ReturnType<typeof evaluationPayloadToResult>) =>
      markRows(result).map((row) => {
        const geometry = result.computedGeometry.get(row.generatedElementId);
        if (geometry?.kind !== "point") throw new Error("generated Mark must have computed point geometry");
        return {
          iterationIndex: row.iterationIndex,
          variableValue: row.variableValue,
          occurrenceIndexes: row.occurrencePath.map((step) => step.iterationIndex),
          x: geometry.x,
          y: geometry.y
        };
      });
    const expectCanonicalOccurrence = (
      fixture: ReturnType<typeof fixtureFromSource>,
      row: ReturnType<typeof markRows>[number]
    ) => {
      expect(row.occurrencePath).toHaveLength(1);
      expect(row.occurrencePath[0]?.iterationIndex).toBe(row.iterationIndex);
      expect(fixture.elements.some((element) =>
        element.type === "forGroup" && element.id === row.occurrencePath[0]?.templateForGroupId
      )).toBe(true);
    };

    const oneIteration = await evaluateSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 0, step: 1) {",
      "    point Mark = coordinate(x: @i, y: 0)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    const oneIterationInput = buildRustEvaluationInput(oneIteration.fixture.elements, oneIteration.options);
    expect(oneIterationInput.bindingVersions?.versions).toEqual([]);
    expect(oneIterationInput.bindingVersions?.immutableForGroups ?? []).toEqual([]);
    expect(oneIterationInput.bindingVersions?.forGroupOwners).toHaveLength(1);
    expect(oneIterationInput.bindingVersions?.forGroupOwners[0]).toMatchObject({ moduleExecutionOwner: true });
    for (const result of [oneIteration.ts, oneIteration.rust]) {
      expect(result.errors).toEqual([]);
      const rows = markRows(result);
      expect(rows).toHaveLength(1);
      expectCanonicalOccurrence(oneIteration.fixture, rows[0]!);
      expect(result.computedGeometry.get(rows[0]!.generatedElementId)).toMatchObject({ kind: "point", x: 0, y: 0 });
    }

    const twoIterations = await evaluateSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 1, step: 1) {",
      "    point Mark = coordinate(x: @i, y: 0)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    for (const result of [twoIterations.ts, twoIterations.rust]) {
      expect(result.errors).toEqual([]);
      const rows = markRows(result);
      expect(rows).toHaveLength(2);
      rows.forEach((row) => expectCanonicalOccurrence(twoIterations.fixture, row));
      expect(rows.map((row) => row.iterationIndex)).toEqual([0, 1]);
      expect(rows.map((row) => row.variableValue)).toEqual([0, 1]);
      expect(rows.map((row) => row.occurrencePath.map((step) => step.iterationIndex))).toEqual([[0], [1]]);
      expect(observableMarks(result).map((mark) => [mark.x, mark.y])).toEqual([[0, 0], [1, 0]]);
    }

    const repeatedInstances = await evaluateSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 0, step: 1) {",
      "    point Mark = coordinate(x: @i, y: 0)",
      "  }",
      "}",
      "instance First = M()",
      "instance Second = M()"
    ].join("\n"));
    const repeatedRows = markRows(repeatedInstances.rust);
    const moduleInstances = repeatedInstances.fixture.compiled?.doc.moduleSemanticAnalysis?.instances
      .filter((instance) => instance.name === "First" || instance.name === "Second") ?? [];
    const repeatedOrigins = repeatedRows.map((row) => ({
      row,
      origin: repeatedInstances.options.moduleMaterialization?.originByRuntimeElementId.get(row.forGroupId)
    }));
    expect(repeatedInstances.rust.errors).toEqual([]);
    expect(repeatedRows).toHaveLength(2);
    repeatedRows.forEach((row) => expectCanonicalOccurrence(repeatedInstances.fixture, row));
    expect(new Set(repeatedRows.map((row) => row.forGroupId)).size).toBe(2);
    expect(new Set(repeatedRows.map((row) => row.templateElementId)).size).toBe(2);
    expect(new Set(repeatedRows.map((row) => row.generatedElementId)).size).toBe(2);
    expect(repeatedRows.map((row) => row.iterationIndex)).toEqual([0, 0]);
    expect(repeatedRows.map((row) => row.occurrencePath.map((step) => step.iterationIndex))).toEqual([[0], [0]]);
    const owningInstances = repeatedOrigins.map(({ origin }) =>
      moduleInstances.find((instance) => origin?.instancePath.includes(instance.statementId))?.statementId
    );
    expect(owningInstances.every((statementId) => statementId !== undefined)).toBe(true);
    expect(new Set(owningInstances).size).toBe(2);

    const withoutLocal = await evaluateSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 1, step: 1) {",
      "    point Mark = coordinate(x: @i, y: 2)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    const withLocal = await evaluateSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 1, step: 1) {",
      "    const unrelated: number = @i + 100",
      "    point Mark = coordinate(x: @i, y: 2)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    for (const result of [withoutLocal.ts, withoutLocal.rust, withLocal.ts, withLocal.rust]) {
      expect(result.errors).toEqual([]);
      expect(markRows(result)).toHaveLength(2);
    }
    expect(observableMarks(withLocal.ts)).toEqual(observableMarks(withoutLocal.ts));
    expect(observableMarks(withLocal.rust)).toEqual(observableMarks(withoutLocal.rust));
    const withLocalInput = buildRustEvaluationInput(withLocal.fixture.elements, withLocal.options);
    expect(withLocalInput.bindingVersions?.forGroupOwners).toHaveLength(1);
    expect(withLocalInput.bindingVersions?.forGroupOwners[0]).toMatchObject({ moduleExecutionOwner: true });

    const rootLoop = await evaluateSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point Mark = coordinate(x: @i, y: 2)",
      "}"
    ].join("\n"));
    for (const result of [rootLoop.ts, rootLoop.rust]) {
      expect(result.errors).toEqual([]);
      expect(markRows(result)).toHaveLength(2);
      expect(observableMarks(result)).toEqual(observableMarks(twoIterations.ts).map((mark) => ({ ...mark, y: 2 })));
    }
    const ordinaryOwnerLoop = await evaluateSource([
      "nui 1",
      "for i in range(min: 0, max: 1, step: 1) carry total: number = 0 {",
      "  next total = @total + 1",
      "  point Mark = coordinate(x: @i, y: 0)",
      "}"
    ].join("\n"));
    const ordinaryOwnerInput = buildRustEvaluationInput(ordinaryOwnerLoop.fixture.elements, ordinaryOwnerLoop.options);
    expect(ordinaryOwnerInput.bindingVersions?.forGroupOwners).toHaveLength(1);
    expect(ordinaryOwnerInput.bindingVersions?.forGroupOwners[0]).not.toHaveProperty("moduleExecutionOwner");
    expect(ordinaryOwnerLoop.rust.errors).toEqual([]);

    const fabricatedInput = buildRustEvaluationInput(oneIteration.fixture.elements, oneIteration.options);
    const fabricatedOwner = fabricatedInput.bindingVersions?.forGroupOwners[0];
    expect(fabricatedOwner?.moduleExecutionOwner).toBe(true);
    if (!fabricatedOwner) throw new Error("expected the Module forGroup owner payload row");
    delete fabricatedOwner.moduleExecutionOwner;
    await expect(rustStdio!.evaluateInput(fabricatedInput)).rejects.toThrow(
      /scalar-payload-invalid-control-owner.*forGroupOwners contains an unused owner/
    );
  }, 60000);

  it("preserves collection statement-for binder values independently of generated ordinals", async () => {
    const evaluateSource = async (source: string) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      return {
        fixture,
        options,
        ts: evaluationPayloadToResult(tsPayload),
        rust: evaluationPayloadToResult(rustPayload)
      };
    };
    const markRows = (result: ReturnType<typeof evaluationPayloadToResult>) =>
      result.forGroupGeneratedRows.filter((row) => row.elementName.includes("Mark"));
    const markValues = (result: ReturnType<typeof evaluationPayloadToResult>) =>
      markRows(result).map((row) => {
        const geometry = result.computedGeometry.get(row.generatedElementId);
        if (geometry?.kind !== "point") throw new Error("generated Mark must have computed point geometry");
        return {
          iterationIndex: row.iterationIndex,
          occurrenceIndex: row.occurrencePath[0]?.iterationIndex,
          x: geometry.x
        };
      });
    const expectValuesAndOrdinals = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      expected: readonly number[]
    ) => {
      expect(result.errors).toEqual([]);
      const rows = markRows(result);
      expect(rows.map((row) => row.iterationIndex)).toEqual(expected.map((_, index) => index));
      expect(rows.map((row) => row.occurrencePath.map((step) => step.iterationIndex)))
        .toEqual(expected.map((_, index) => [index]));
      expect(markValues(result).map((row) => row.x)).toEqual(expected);
      expect(rows.every((row) => row.generatedElementId.endsWith(`:${row.iterationIndex}`))).toBe(true);
    };

    const singleton = await evaluateSource([
      "nui 1",
      "const xs: number[] = [2]",
      "for x in @xs {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    for (const result of [singleton.ts, singleton.rust]) expectValuesAndOrdinals(result, [2]);

    const multiMember = await evaluateSource([
      "nui 1",
      "const negative: number = -3",
      "const xs: number[] = [2, 7, @negative]",
      "for x in @xs {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    for (const result of [multiMember.ts, multiMember.rust]) expectValuesAndOrdinals(result, [2, 7, -3]);

    const iterationBinding = singleton.fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((binding) =>
      binding.kind === "iteration" && binding.name === "x"
    );
    const compiledNumericBinding = [...(singleton.fixture.compiled?.doc.numericBindings?.values() ?? [])]
      .find((binding) => binding.parameterKey === "x");
    expect(iterationBinding).toBeDefined();
    expect(compiledNumericBinding?.references.map((reference) => reference.bindingId)).toEqual([iterationBinding?.id]);
    const rustInput = buildRustEvaluationInput(singleton.fixture.elements, singleton.options);
    const markTemplate = singleton.fixture.elements.find((element) => element.name === "Mark");
    const payloadNumericBinding = rustInput.scalarExpressionPayload?.numericBindings.find((entry) =>
      entry.elementId === markTemplate?.id && entry.parameterKey === "x"
    );
    expect(payloadNumericBinding?.references.map((reference) => reference.bindingId)).toEqual([iterationBinding?.id]);

    const range = await evaluateSource([
      "nui 1",
      "for x in range(min: 2, max: 2, step: 1) {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    for (const result of [range.ts, range.rust]) expectValuesAndOrdinals(result, [2]);
    expect(markRows(range.ts).map((row) => row.variableValue)).toEqual([2]);

    const carried = await evaluateSource([
      "nui 1",
      "const negative: number = -3",
      "const xs: number[] = [2, 7, @negative]",
      "for x in @xs carry total: number = 0 {",
      "  next total = @total + 1",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    const negativeBinding = carried.fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "negative"
    );
    const negativeVersion = carried.options.bindingVersions?.versions.find(
      (version) => version.bindingId === negativeBinding?.id
    );
    const carriedDependencyOrder = carried.options.typedDependencyGraph
      ? resolveTypedDependencyGraphRuntime(carried.options.typedDependencyGraph, new Map()).dependencyOrder
      : undefined;
    if (!negativeBinding || !negativeVersion || !carriedDependencyOrder) {
      throw new Error("expected compiler products for the unranked carried-loop binding");
    }
    expect(carried.options.typedDependencyGraph?.edges.some((edge) =>
      edge.from.kind === "binding" && edge.from.id === negativeBinding.id
    )).toBe(false);
    expect(carriedDependencyOrder).not.toContain(`binding:${negativeBinding.id}`);
    for (const result of [carried.ts, carried.rust]) expectValuesAndOrdinals(result, [2, 7, -3]);

    const paddedAlias = await evaluateSource([
      "nui 1",
      "// harmless source padding",
      "const negative: number = -3",
      "const xs: number[] = [2, 7, @negative]",
      "const alias: number[] = @xs",
      "const unrelated: number = 100",
      "for x in @alias {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    for (const result of [paddedAlias.ts, paddedAlias.rust]) expectValuesAndOrdinals(result, [2, 7, -3]);
    expect(markValues(paddedAlias.ts).map((row) => row.x)).toEqual(markValues(multiMember.ts).map((row) => row.x));
    expect(markValues(paddedAlias.rust).map((row) => row.x)).toEqual(markValues(multiMember.rust).map((row) => row.x));

    const modulePlacement = await evaluateSource([
      "nui 1",
      "module M() {",
      "  const negative: number = -3",
      "  const items: number[] = [2, 7, @negative]",
      "  for x in @items {",
      "    point Mark = coordinate(x: @x, y: 0)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"));
    for (const result of [modulePlacement.ts, modulePlacement.rust]) expectValuesAndOrdinals(result, [2, 7, -3]);
  }, 60000);

  it("executes the carry-only Module owner case through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  for i in range(min: 0, max: 0, step: 1) carry n: number = 7 {",
      "    next n = @n + 1",
      "  }",
      "  export const output: number = @n",
      "}",
      "instance A = M()",
      "const result: number = @A::output"
    ].join("\n"));
    const options = optionsFor(fixture);
    const loop = fixture.elements.find((element) => element.type === "forGroup");
    if (!loop || loop.type !== "forGroup") throw new Error("missing carry-only Module forGroup");
    const owner = options.moduleForGroupExecutionOwnerByElementId?.get(loop.id);
    if (!owner) throw new Error("missing canonical carry-only Module execution owner");
    const plan = options.bindingVersions?.immutableForGroups?.get(owner.ownerStatementId);
    if (!plan?.executionOwner) throw new Error("missing carry-only Module immutable-for plan");
    expect(plan.executionOwner).toMatchObject({
      scopeId: owner.scopeId,
      exitSourceOrder: owner.exitSourceOrder,
      iterationBindingId: owner.iterationBindingId
    });
    expect(options.bindingVersions?.moduleForGroupExecutionOwnersByStatementId?.get(owner.ownerStatementId)).toMatchObject({
      kind: owner.kind,
      ownerStatementId: owner.ownerStatementId,
      scopeId: owner.scopeId,
      exitSourceOrder: owner.exitSourceOrder,
      ...(owner.entrySourceOrder !== undefined ? { entrySourceOrder: owner.entrySourceOrder } : {}),
      ...(owner.iterationBindingId ? { iterationBindingId: owner.iterationBindingId } : {})
    });
    expect(options.bindingVersions?.versions.some((version) =>
      version.control.ownerChain.some((candidate) => candidate.kind === "forGroup" && candidate.ownerStatementId === owner.ownerStatementId)
    )).toBe(false);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    expect(rustInput.bindingVersions?.forGroupOwners).toContainEqual(expect.objectContaining({
      ownerStatementId: owner.ownerStatementId,
      elementId: loop.id,
      moduleExecutionOwner: true
    }));
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const normalizeModulePayload = (payload: unknown): unknown => {
      const normalized = normalizeParityPayload(payload);
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
      const record = normalized as Record<string, unknown>;
      const sortEntries = (value: unknown, key: string) => Array.isArray(value)
        ? [...value].sort((left, right) => String((left as Record<string, unknown>)[key]).localeCompare(String((right as Record<string, unknown>)[key])))
        : value;
      return {
        ...record,
        computedScalarBindings: sortEntries(record.computedScalarBindings, "bindingId"),
        computedScalarBindingVersions: sortEntries(record.computedScalarBindingVersions, "versionId")
      };
    };
    expect(normalizeModulePayload(rustPayload)).toEqual(normalizeModulePayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "result"), 8);
    }
  }, 30000);

  it("executes Module point geometry carries with canonical integer source order", async () => {
    const exactSource = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 2, y: 3)",
      "  for i in range(min: 0, max: 0, step: 1) carry last: point = @P {",
      "    next last = @P",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance A = M()"
    ];
    const fixture = fixtureFromSource(exactSource.join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const compiledGeometryCarries = [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? []);
    expect(compiledGeometryCarries).toHaveLength(1);
    const compiledCarry = compiledGeometryCarries[0]!;
    expect(compiledCarry.nextSourceOrder).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(compiledCarry.nextSourceOrder)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const serializedCarry = rustInput.bindingVersions?.immutableForGroups
      ?.flatMap((plan) => plan.geometryCarries ?? [])
      .find((carry) => carry.bindingId === compiledCarry.bindingId);
    expect(serializedCarry).toMatchObject({
      bindingId: compiledCarry.bindingId,
      nextSourceOrder: compiledCarry.nextSourceOrder
    });

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === "A");
    if (!instance) throw new Error("missing Module instance A");
    const instancePathFor = (elementId: string) => options.moduleMaterialization?.originByRuntimeElementId.get(elementId)?.instancePath;
    const point = fixture.elements.find((element) => element.name.endsWith("P") &&
      instancePathFor(element.id)?.includes(instance.statementId));
    const loop = fixture.elements.find((element) => element.type === "forGroup" &&
      instancePathFor(element.id)?.includes(instance.statementId));
    if (!point || !loop || loop.type !== "forGroup") throw new Error("missing materialized Module P or carry loop");
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 2, y: 3 });
      const marks = result.forGroupGeneratedRows?.filter((row) =>
        row.forGroupId === loop.id && row.elementName.endsWith("Mark")
      ) ?? [];
      expect(marks).toHaveLength(1);
      expect(result.computedGeometry.get(marks[0]!.generatedElementId)).toMatchObject({
        kind: "point",
        x: 0,
        y: 0
      });
    }

    // Consume the final carried point through the existing compiled geometry
    // carry target identity; the exact reduced repro above stays unchanged.
    const observableSource = [
      ...exactSource.slice(0, 7),
      "  line CarryResult = segment(start: @last, end: (0, 0))",
      ...exactSource.slice(7)
    ].join("\n");
    const observableFixture = fixtureFromSource(observableSource);
    const observableOptions = optionsFor(observableFixture);
    expect(observableFixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(observableFixture)).toBe(true);
    const observableInstance = observableFixture.compiled?.doc.moduleSemanticAnalysis?.instances
      .find((candidate) => candidate.name === "A");
    if (!observableInstance) throw new Error("missing observable Module instance A");
    const observableInstancePathFor = (elementId: string) =>
      observableOptions.moduleMaterialization?.originByRuntimeElementId.get(elementId)?.instancePath;
    const carryResult = observableFixture.elements.find((element) => element.type === "line" &&
      element.name.endsWith("CarryResult") && observableInstancePathFor(element.id)?.includes(observableInstance.statementId));
    if (!carryResult) throw new Error("missing materialized Module CarryResult line");
    const observableCarry = [...(observableFixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? [])[0];
    if (!observableCarry) throw new Error("missing observable Module geometry carry");
    expect(observableOptions.geometryInputTargetsByElementId?.get(carryResult.id)?.get("startPoint")).toMatchObject({
      kind: "geometryCarry",
      bindingId: observableCarry.bindingId
    });
    const observableTs = evaluateElementsReferencePayload(observableFixture.elements, observableOptions);
    const observableRust = await rustStdio!.evaluate(observableFixture.elements, observableOptions);
    expect(normalizeParityPayload(observableRust)).toEqual(normalizeParityPayload(observableTs));
    for (const payload of [observableTs, observableRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(carryResult.id)).toMatchObject({
        kind: "line",
        start: { x: 2, y: 3 }
      });
    }

    const rootFixture = fixtureFromSource([
      "nui 1",
      "point P = coordinate(x: 2, y: 3)",
      "for i in range(min: 0, max: 0, step: 1) carry last: point = @P {",
      "  next last = @P",
      "}",
      "line CarryResult = segment(start: @last, end: (0, 0))"
    ].join("\n"));
    const rootOptions = optionsFor(rootFixture);
    expect(isRustEligibleFixture(rootFixture)).toBe(true);
    const rootCarryResult = rootFixture.elements.find((element) => element.type === "line" && element.name === "CarryResult");
    if (!rootCarryResult) throw new Error("missing root CarryResult line");
    const rootTs = evaluateElementsReferencePayload(rootFixture.elements, rootOptions);
    const rootRust = await rustStdio!.evaluate(rootFixture.elements, rootOptions);
    expect(normalizeParityPayload(rootRust)).toEqual(normalizeParityPayload(rootTs));
    for (const payload of [rootTs, rootRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(rootCarryResult.id)).toMatchObject({
        kind: "line",
        start: { x: 2, y: 3 }
      });
    }

    const malformedInput = structuredClone(rustInput);
    const malformedCarry = malformedInput.bindingVersions?.immutableForGroups
      ?.flatMap((plan) => plan.geometryCarries ?? [])
      .find((carry) => carry.bindingId === compiledCarry.bindingId);
    if (!malformedCarry) throw new Error("missing serialized Module geometry carry to corrupt");
    malformedCarry.nextSourceOrder = 2.5;
    await expect(rustStdio!.evaluateInput(malformedInput)).rejects.toThrow(
      /scalar-payload-invalid-source-order.*immutable geometry carry nextSourceOrder must be a non-negative integer/
    );
  }, 60000);

  it("keeps Module geometry carry identity and order paired across instances", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(seed: point) {",
      "  for i in range(min: 0, max: 0, step: 1) carry last: point = @seed {",
      "    next last = @seed",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "  line CarryResult = segment(start: @last, end: (0, 0))",
      "}",
      "point SeedA = coordinate(x: 2, y: 3)",
      "point SeedB = coordinate(x: 9, y: 7)",
      "instance A = M(seed: @SeedA)",
      "instance B = M(seed: @SeedB)",
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const sourceCarry = fixture.compiled?.doc.moduleSemanticAnalysis?.definitions
      .find((definition) => definition.name === "M")?.immutableCarries?.find((carry) => !carry.type);
    if (!sourceCarry) throw new Error("missing canonical Module geometry carry");
    const instances = fixture.compiled?.doc.moduleSemanticAnalysis?.instances
      .filter((instance) => instance.name === "A" || instance.name === "B") ?? [];
    const carryForInstance = (name: "A" | "B") => {
      const instance = instances.find((candidate) => candidate.name === name);
      if (!instance) throw new Error(`missing Module instance ${name}`);
      const loop = fixture.elements.find((element) => element.type === "forGroup" &&
        options.moduleMaterialization?.originByRuntimeElementId.get(element.id)?.instancePath.includes(instance.statementId));
      if (!loop || loop.type !== "forGroup") throw new Error(`missing materialized carry loop for ${name}`);
      const instancePath = options.moduleMaterialization?.originByRuntimeElementId.get(loop.id)?.instancePath;
      const owner = options.moduleForGroupExecutionOwnerByElementId?.get(loop.id);
      if (!instancePath || !owner) throw new Error(`missing runtime identity for carry loop ${name}`);
      const probe = fixture.elements.find((element) => element.type === "line" &&
        element.name.endsWith("CarryResult") &&
        options.moduleMaterialization?.originByRuntimeElementId.get(element.id)?.instancePath.includes(instance.statementId));
      if (!probe) throw new Error(`missing materialized CarryResult line for ${name}`);
      const plan = options.bindingVersions?.immutableForGroups?.get(owner.ownerStatementId);
      const carry = plan?.geometryCarries?.[0];
      if (!carry) throw new Error(`missing geometry carry plan for ${name}`);
      expect(carry.bindingId).toBe(moduleCarryBindingIdFor(instancePath, `${sourceCarry.bindingId}:${sourceCarry.name}`));
      expect(carry.nextSourceOrder).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(carry.nextSourceOrder)).toBe(true);
      expect(options.geometryInputTargetsByElementId?.get(probe.id)?.get("startPoint")).toMatchObject({
        kind: "geometryCarry",
        bindingId: carry.bindingId
      });
      return { loop, owner, carry, probe };
    };
    const carryA = carryForInstance("A");
    const carryB = carryForInstance("B");
    expect(carryA.carry.bindingId).not.toBe(carryB.carry.bindingId);
    expect(carryA.carry.nextSourceOrder).not.toBe(carryB.carry.nextSourceOrder);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const compiledPairs = [...(options.bindingVersions?.immutableForGroups ?? [])]
      .flatMap(([ownerStatementId, plan]) => (plan.geometryCarries ?? []).map((carry) =>
        `${ownerStatementId}\u0000${carry.bindingId}\u0000${carry.nextSourceOrder}`
      )).sort();
    const serializedPairs = (rustInput.bindingVersions?.immutableForGroups ?? [])
      .flatMap((plan) => (plan.geometryCarries ?? []).map((carry) =>
        `${plan.ownerStatementId}\u0000${carry.bindingId}\u0000${carry.nextSourceOrder}`
      )).sort();
    expect(compiledPairs).toHaveLength(2);
    expect(serializedPairs).toEqual(compiledPairs);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      for (const [instanceCarry, expected] of [[carryA, { x: 2, y: 3 }], [carryB, { x: 9, y: 7 }]] as const) {
        expect(result.computedGeometry.get(instanceCarry.probe.id)).toMatchObject({
          kind: "line",
          start: expected
        });
      }
      for (const loop of [carryA.loop, carryB.loop]) {
        const marks = result.forGroupGeneratedRows?.filter((row) =>
          row.forGroupId === loop.id && row.elementName.endsWith("Mark")
        ) ?? [];
        expect(marks).toHaveLength(1);
        expect(result.computedGeometry.get(marks[0]!.generatedElementId)).toMatchObject({
          kind: "point",
          x: 0,
          y: 0
        });
      }
    }
  }, 60000);

  it("evaluates optional record Module parameter members through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record R(x: number)",
      "module M(v: R?) {",
      "  export const answer: number = @v?.x ?? 11",
      "}",
      "const callerPresent: R? = R(x: 9)",
      "const callerAbsent: R? = none",
      "instance Inline = M(v: R(x: 7))",
      "instance Omitted = M()",
      "instance ExplicitNone = M(v: none)",
      "instance AliasPresent = M(v: @callerPresent)",
      "instance AliasAbsent = M(v: @callerAbsent)",
      "const inlineResult: number = @Inline::answer",
      "const omittedResult: number = @Omitted::answer",
      "const noneResult: number = @ExplicitNone::answer",
      "const aliasPresentResult: number = @AliasPresent::answer",
      "const aliasAbsentResult: number = @AliasAbsent::answer"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "inlineResult"), 7);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "omittedResult"), 11);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "noneResult"), 11);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "aliasPresentResult"), 9);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "aliasAbsentResult"), 11);
    }
  }, 30000);

  it("forwards parent-local Module record aliases with collection fields through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(scalar: number, xs: number[])",
      "module Leaf(input: Bundle) {",
      "  const childAlias: Bundle = @input",
      "  export const childScalar: number = @childAlias.scalar",
      "  export const childLength: number = @childAlias.xs.length",
      "}",
      "module Parent(input: Bundle) {",
      "  const alias: Bundle = @input",
      "  instance Child = Leaf(input: @alias)",
      "  export const childScalar: number = @Child::childScalar",
      "  export const childLength: number = @Child::childLength",
      "}",
      "instance Small = Parent(input: Bundle(scalar: 101, xs: [5, 11]))",
      "instance Large = Parent(input: Bundle(scalar: 203, xs: [3, 7, 13, 19]))",
      "const smallScalar: number = @Small::childScalar",
      "const smallLength: number = @Small::childLength",
      "const largeScalar: number = @Large::childScalar",
      "const largeLength: number = @Large::childLength"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      for (const [name, expected] of [
        ["smallScalar", 101],
        ["smallLength", 2],
        ["largeScalar", 203],
        ["largeLength", 4]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("preserves borrowed record-field event ownership across sibling Grandchild instances over persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(scalar: number, xs: number[])",
      "module Grandchild(input: Bundle) {",
      "  export const scalar: number = @input.scalar",
      "  export const length: number = @input.xs.length",
      "  export const first: number = @input.xs[0]",
      "  export const second: number = @input.xs[1]",
      "}",
      "module Child(input: Bundle) {",
      "  const alias: Bundle = @input",
      "  instance Direct = Grandchild(input: @input)",
      "  instance FromAlias = Grandchild(input: @alias)",
      "  export const directScalar: number = @Direct::scalar",
      "  export const directLength: number = @Direct::length",
      "  export const directFirst: number = @Direct::first",
      "  export const directSecond: number = @Direct::second",
      "  export const aliasScalar: number = @FromAlias::scalar",
      "  export const aliasLength: number = @FromAlias::length",
      "  export const aliasFirst: number = @FromAlias::first",
      "  export const aliasSecond: number = @FromAlias::second",
      "}",
      "module Parent(input: Bundle) {",
      "  instance ChildLevel = Child(input: @input)",
      "  export const directScalar: number = @ChildLevel::directScalar",
      "  export const directLength: number = @ChildLevel::directLength",
      "  export const directFirst: number = @ChildLevel::directFirst",
      "  export const directSecond: number = @ChildLevel::directSecond",
      "  export const aliasScalar: number = @ChildLevel::aliasScalar",
      "  export const aliasLength: number = @ChildLevel::aliasLength",
      "  export const aliasFirst: number = @ChildLevel::aliasFirst",
      "  export const aliasSecond: number = @ChildLevel::aliasSecond",
      "}",
      "instance Small = Parent(input: Bundle(scalar: 101, xs: [5, 11]))",
      "const smallDirectScalar: number = @Small::directScalar",
      "const smallDirectLength: number = @Small::directLength",
      "const smallDirectFirst: number = @Small::directFirst",
      "const smallDirectSecond: number = @Small::directSecond",
      "const smallAliasScalar: number = @Small::aliasScalar",
      "const smallAliasLength: number = @Small::aliasLength",
      "const smallAliasFirst: number = @Small::aliasFirst",
      "const smallAliasSecond: number = @Small::aliasSecond"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(fixture.compiled?.bindingIssueDiagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? []).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    const scalarResult = (payload: typeof tsPayload, name: string) => {
      const value = scalarBindingFor(fixture, payload, name);
      if (value?.status === "ok" && value.value.kind === "number") return value.value.value;
      if (value?.status === "error") return { status: value.status, issueCode: value.issueCode };
      return { status: value?.status };
    };
    const names = [
      "smallDirectScalar",
      "smallDirectLength",
      "smallDirectFirst",
      "smallDirectSecond",
      "smallAliasScalar",
      "smallAliasLength",
      "smallAliasFirst",
      "smallAliasSecond"
    ] as const;
    const outcomes = [tsPayload, rustPayload].map((payload) => {
      const result = evaluationPayloadToResult(payload);
      return {
        errorCount: result.errors.length,
        values: names.map((name) => scalarResult(payload, name))
      };
    });
    expect(outcomes).toEqual([
      {
        errorCount: 0,
        values: [101, 2, 5, 11, 101, 2, 5, 11]
      },
      {
        errorCount: 0,
        values: [101, 2, 5, 11, 101, 2, 5, 11]
      }
    ]);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("forwards whole-record values through all Parent and Child alias routes over persistent Rust stdio", async () => {
    const routes = [
      { name: "directDirect", childInstance: "Direct", childRoute: "direct" },
      { name: "directAlias", childInstance: "Direct", childRoute: "alias" },
      { name: "aliasDirect", childInstance: "FromAlias", childRoute: "direct" },
      { name: "aliasAlias", childInstance: "FromAlias", childRoute: "alias" }
    ] as const;
    const fields = ["Scalar", "Length", "First", "Second"] as const;
    const topLevels = [
      {
        name: "Small",
        prefix: "small",
        input: "Bundle(scalar: 101, xs: [5, 11])",
        expected: { Scalar: 101, Length: 2, First: 5, Second: 11 }
      },
      {
        name: "Large",
        prefix: "large",
        input: "Bundle(scalar: 203, xs: [3, 7, 13, 19])",
        expected: { Scalar: 203, Length: 4, First: 3, Second: 7 }
      }
    ] as const;
    const titleCase = (name: string) => `${name[0]!.toUpperCase()}${name.slice(1)}`;
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(scalar: number, xs: number[])",
      "module Grandchild(input: Bundle) {",
      "  export const scalar: number = @input.scalar",
      "  export const length: number = @input.xs.length",
      "  export const first: number = @input.xs[0]",
      "  export const second: number = @input.xs[1]",
      "}",
      "module Child(input: Bundle) {",
      "  const alias: Bundle = @input",
      "  instance Direct = Grandchild(input: @input)",
      "  instance FromAlias = Grandchild(input: @alias)",
      "  export const directScalar: number = @Direct::scalar",
      "  export const directLength: number = @Direct::length",
      "  export const directFirst: number = @Direct::first",
      "  export const directSecond: number = @Direct::second",
      "  export const aliasScalar: number = @FromAlias::scalar",
      "  export const aliasLength: number = @FromAlias::length",
      "  export const aliasFirst: number = @FromAlias::first",
      "  export const aliasSecond: number = @FromAlias::second",
      "}",
      "module Parent(input: Bundle) {",
      "  const alias: Bundle = @input",
      "  instance Direct = Child(input: @input)",
      "  instance FromAlias = Child(input: @alias)",
      ...routes.flatMap((route) => fields.map((field) =>
        `  export const ${route.name}${field}: number = @${route.childInstance}::${route.childRoute}${field}`
      )),
      "}",
      ...topLevels.map((instance) => `instance ${instance.name} = Parent(input: ${instance.input})`),
      ...topLevels.flatMap((instance) => routes.flatMap((route) => fields.map((field) =>
        `const ${instance.prefix}${titleCase(route.name)}${field}: number = @${instance.name}::${route.name}${field}`
      )))
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(fixture.compiled?.bindingIssueDiagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? []).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      for (const instance of topLevels) {
        for (const route of routes) {
          for (const field of fields) {
            const name = `${instance.prefix}${titleCase(route.name)}${field}`;
            expectScalarNumberClose(scalarBindingFor(fixture, payload, name), instance.expected[field]);
          }
        }
      }
    }
  }, 30000);

  it("indexes Module record-parameter collection fields through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(xs: number[])",
      "module Read(input: Bundle) {",
      "  const alias: Bundle = @input",
      "  export const first: number = @input.xs[0]",
      "  export const second: number = @input.xs[1]",
      "  export const aliasFirst: number = @alias.xs[0]",
      "  export const aliasSecond: number = @alias.xs[1]",
      "  export const inputLength: number = @input.xs.length",
      "}",
      "instance Short = Read(input: Bundle(xs: [5, 11]))",
      "instance Long = Read(input: Bundle(xs: [2, 17, 31]))",
      "const shortFirst: number = @Short::first",
      "const shortSecond: number = @Short::second",
      "const shortAliasFirst: number = @Short::aliasFirst",
      "const shortAliasSecond: number = @Short::aliasSecond",
      "const shortLength: number = @Short::inputLength",
      "const longFirst: number = @Long::first",
      "const longSecond: number = @Long::second",
      "const longAliasFirst: number = @Long::aliasFirst",
      "const longAliasSecond: number = @Long::aliasSecond",
      "const longLength: number = @Long::inputLength"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      for (const [name, expected] of [
        ["shortFirst", 5],
        ["shortSecond", 11],
        ["shortAliasFirst", 5],
        ["shortAliasSecond", 11],
        ["shortLength", 2],
        ["longFirst", 2],
        ["longSecond", 17],
        ["longAliasFirst", 2],
        ["longAliasSecond", 17],
        ["longLength", 3]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("evaluates optional record members in numeric geometry inputs through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record R(x: number)",
      "const value: R? = R(x: 7)",
      "const missing: R? = none",
      "point RootPresent = coordinate(x: @value?.x ?? 11, y: 0)",
      "point RootAbsent = coordinate(x: @missing?.x ?? 11, y: 0)",
      "module M(v: R?) {",
      "  point P = coordinate(x: @v?.x ?? 11, y: 0)",
      "}",
      "instance Present = M(v: R(x: 7))",
      "instance Absent = M()"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const rustPayload = await rustStdio!.evaluateInput(buildRustEvaluationInput(fixture.elements, options));
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const semantic = fixture.compiled!.doc.moduleSemanticAnalysis!;
    const rootPresent = fixture.elements.find((element) => element.name === "RootPresent")!;
    const rootAbsent = fixture.elements.find((element) => element.name === "RootAbsent")!;
    const modulePointFor = (instanceName: string) => {
      const instance = semantic.instances.find((candidate) => candidate.name === instanceName)!;
      const element = fixture.elements.find((candidate) =>
        candidate.name === "P" && options.moduleMaterialization?.originByRuntimeElementId.get(candidate.id)?.instancePath[0] === instance.statementId
      );
      if (!element) throw new Error(`missing materialized point for ${instanceName}`);
      return element;
    };
    const presentPoint = modulePointFor("Present");
    const absentPoint = modulePointFor("Absent");
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(rootPresent.id)).toMatchObject({ kind: "point", x: 7 });
      expect(result.computedGeometry.get(rootAbsent.id)).toMatchObject({ kind: "point", x: 11 });
      expect(result.computedGeometry.get(presentPoint.id)).toMatchObject({ kind: "point", x: 7 });
      expect(result.computedGeometry.get(absentPoint.id)).toMatchObject({ kind: "point", x: 11 });
    }
  }, 30000);

  it("executes optional Module scalar carries through TypeScript and persistent Rust", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(seed: number?) {",
      "  for i in range(min: 0, max: 2, step: 1) carry state: number? = none carry alias: number? = @seed carry observed: number = -1 {",
      "    next state = if (@i == 1) { none } else { @i }",
      "    next alias = 3",
      "    next observed = @state ?? -1",
      "  }",
      "  export const output: number = (@state ?? -1) + (@alias ?? 0) + @observed",
      "}",
      "instance A = M(seed: 8)",
      "const result: number = @A::output"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "result"), 4);
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    }
  }, 30000);

  it("executes Module-local optional scalar aliases through TypeScript and persistent Rust", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module OptionalAlias(v: number?) {",
      "  const echoed: number? = @v",
      "  const first: number? = @echoed",
      "  const second: number? = @first",
      "  export const directOutput: number = @echoed ?? 11",
      "  export const aliasOutput: number = @second ?? 13",
      "}",
      "instance Present = OptionalAlias(v: 7)",
      "instance Absent = OptionalAlias(v: none)",
      "const presentResult: number = @Present::directOutput",
      "const absentResult: number = @Absent::directOutput",
      "const presentAliasResult: number = @Present::aliasOutput",
      "const absentAliasResult: number = @Absent::aliasOutput",
      "module RequiredScalar(v: number) {",
      "  const echoed: number = @v",
      "  export const output: number = @echoed + 1",
      "}",
      "instance Required = RequiredScalar(v: 4)",
      "const requiredResult: number = @Required::output",
      "const rootOptional: number? = 7",
      "const rootResult: number = @rootOptional ?? 11"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const repeatedRustInput = buildRustEvaluationInput(fixture.elements, options);
    expect(rustInput.bindingVersions).toBeDefined();
    expect(JSON.stringify(repeatedRustInput.bindingVersions)).toBe(JSON.stringify(rustInput.bindingVersions));

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentResult"), 7);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentResult"), 11);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentAliasResult"), 7);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentAliasResult"), 13);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "requiredResult"), 5);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "rootResult"), 7);
    }
  }, 30000);

  it("executes root optional scalar carry transitions through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const start: number? = none",
      "for i in range(min: 0, max: 2, step: 1) carry maybe: number? = @start {",
      "  next maybe = if (@i == 0) { 9 } else { if (@i == 1) { none } else { 12 } }",
      "}",
      "const resolved: number = @maybe ?? 0"
    ].join("\n"));
    const options = optionsFor(fixture);
    const carry = [...(options.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries)[0];
    expect(carry?.declaredType).toEqual({ kind: "optional", valueType: { kind: "number" } });
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "resolved"), 12);
    }
  }, 30000);

  it("materializes Module-export geometry aliases and root alias chains across the persistent Rust stdio boundary", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module AliasProvider(input: point) {",
      "  export const Output: point = @input",
      "  line DirectConsumer = segment(start: @Output, end: (0, 0))",
      "}",
      "point SourceA = coordinate(x: 11, y: 2)",
      "point SourceB = coordinate(x: 20, y: 5)",
      "instance A = AliasProvider(input: @SourceA)",
      "instance B = AliasProvider(input: @SourceB)",
      "const RootA: point = @A::Output",
      "const ChainA: point = @RootA",
      "const RootB: point = @B::Output",
      "const ChainB: point = @RootB",
      "line UseA = segment(start: @ChainA, end: (0, 0))",
      "line UseB = segment(start: @ChainB, end: (0, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const compiled = fixture.compiled!.doc;
    const program = options.geometryValueProgram ?? [];
    const analysis = compiled.moduleSemanticAnalysis!;
    const moduleDefinition = analysis.definitions.find((definition) => definition.name === "AliasProvider");
    const exportedAlias = moduleDefinition?.localGeometryValues.find((value) => value.name === "Output");
    expect(exportedAlias).toBeDefined();
    const rootValue = (name: string) => analysis.geometryValues.find((value) =>
      value.ownerModuleDefinitionStatementId === null && value.name === name
    );
    const rootA = rootValue("RootA");
    const chainA = rootValue("ChainA");
    const rootB = rootValue("RootB");
    const chainB = rootValue("ChainB");
    expect([rootA, chainA, rootB, chainB].every(Boolean)).toBe(true);
    const entryFor = (statementId: string) => program.find((entry) => entry.sourceStatementId === statementId);
    const exportedEntries = program.filter((entry) => entry.sourceStatementId === exportedAlias!.statementId);
    expect(exportedEntries).toHaveLength(2);
    expect(new Set(exportedEntries.map((entry) => JSON.stringify(entry.occurrence.instancePath))).size).toBe(2);
    expect(exportedEntries.every((entry) => entry.construction.kind === "reference")).toBe(true);
    for (const value of [rootA, chainA, rootB, chainB]) {
      expect(entryFor(value!.statementId)?.construction.kind).toBe("reference");
    }

    const consumers = fixture.elements.filter((element) => ["DirectConsumer", "UseA", "UseB"].includes(element.name));
    const targetOccurrences = consumers.flatMap((element) =>
      [...(options.geometryInputTargetsByElementId?.get(element.id)?.values() ?? [])]
        .flatMap((target) => isGeometryInputTargetList(target) ? [...target] : [target])
        .filter((target) => target.kind === "geometryValue")
        .map((target) => target.occurrence)
    );
    expect(consumers).toHaveLength(4);
    expect(targetOccurrences).toHaveLength(2);
    expect(new Set(targetOccurrences.map((occurrence) => occurrence.sourceStatementId))).toEqual(new Set([
      chainA!.statementId,
      chainB!.statementId
    ]));
    const producedOccurrences = new Set(program.map((entry) => JSON.stringify(entry.occurrence)));
    for (const occurrence of targetOccurrences) {
      expect(producedOccurrences.has(JSON.stringify(occurrence))).toBe(true);
    }

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const useA = fixture.elements.find((element) => element.name === "UseA")!;
    const useB = fixture.elements.find((element) => element.name === "UseB")!;
    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      for (const consumer of consumers) expect(result.evaluatedElementIds.has(consumer.id)).toBe(true);
      expect(result.computedGeometry.get(useA.id)).toMatchObject({
        kind: "line",
        start: {
          kind: "point",
          elementId: `${useA.id}:start`,
          name: `${useA.name}.start`,
          x: 11,
          y: 2
        },
        startPointId: null,
        end: { x: 0, y: 0 }
      });
      expect(result.computedGeometry.get(useB.id)).toMatchObject({
        kind: "line",
        start: {
          kind: "point",
          elementId: `${useB.id}:start`,
          name: `${useB.name}.start`,
          x: 20,
          y: 5
        },
        startPointId: null,
        end: { x: 0, y: 0 }
      });
      expect(consumers.filter((element) => element.name === "DirectConsumer").every((element) =>
        result.computedGeometry.has(element.id)
      )).toBe(true);
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("projects compiler-resolved point aliases through the persistent Rust evaluator", async () => {
    const sourceFor = (padded: boolean) => [
      "nui 1",
      ...(padded ? ["const PaddingBefore: number = 3"] : []),
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "move AB as moved (from: (0, 0), to: (10, 0))",
      "const P: point = @AB.start",
      ...(padded ? ["const PaddingBetweenAliases: number = 9"] : []),
      "const P2: point = @P",
      "const P2X: number = @P2.x",
      "line Use = segment(start: @P2, end: (0, 0))",
      "const BaseStart: point = @AB.base.start",
      "const NamedStageStart: point = @AB.moved.start",
      "const FinalStart: point = @AB.final.start",
      ...(padded ? ["const PaddingAfterAliases: number = 15"] : [])
    ].join("\n");

    for (const padded of [false, true]) {
      const fixture = fixtureFromSource(sourceFor(padded));
      const options = optionsFor(fixture);
      const program = fixture.compiled?.doc.geometryValueProgram ?? [];
      expect(program).toHaveLength(5);
      expect(options.geometryValueProgram).toEqual(program);

      const referenceTargets = program.map((entry) => {
        expect(entry.declaredInterfaceType).toBe("point");
        if (entry.construction.kind !== "reference") {
          throw new Error("expected compiler-projected point Reference entry");
        }
        return entry.construction.target;
      });
      expect(referenceTargets.map((target) => target.pointKey)).toEqual([
        "start",
        "start",
        "start",
        "start",
        "start"
      ]);
      expect(referenceTargets.map((target) => target.stagePath)).toEqual([
        ["final"],
        ["final"],
        ["base"],
        ["moved"],
        ["final"]
      ]);

      const use = fixture.elements.find((element) => element.name === "Use")!;
      const useStartTarget = options.geometryInputTargetsByElementId?.get(use.id)?.get("startPoint");
      expect(useStartTarget).toMatchObject({
        kind: "geometryValue",
        occurrence: program[1]!.occurrence
      });
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      const tsResult = evaluationPayloadToResult(tsPayload);
      const rustResult = evaluationPayloadToResult(rustPayload);

      const valueFor = (
        result: ReturnType<typeof evaluationPayloadToResult>,
        occurrence: (typeof program)[number]["occurrence"]
      ) => [...(result.computedGeometryValues?.values() ?? [])].find((entry) =>
        entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.length === occurrence.instancePath.length &&
        entry.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index]) &&
        entry.occurrence.mappedMemberIndex === occurrence.mappedMemberIndex
      )?.value;

      const expectedPoints = [
        { kind: "point", x: 10, y: 0 },
        { kind: "point", x: 10, y: 0 },
        { kind: "point", x: 0, y: 0 },
        { kind: "point", x: 10, y: 0 },
        { kind: "point", x: 10, y: 0 }
      ];
      for (let index = 0; index < program.length; index += 1) {
        const occurrence = program[index]!.occurrence;
        const tsValue = valueFor(tsResult, occurrence);
        const rustValue = valueFor(rustResult, occurrence);
        expect(rustValue, "computed geometry value occurrence").toEqual(tsValue);
        expect(tsValue, "TypeScript point occurrence").toEqual(expectedPoints[index]);
        expect(rustValue, "Rust point occurrence").toEqual(expectedPoints[index]);
      }

      for (const [payload, result] of [[tsPayload, tsResult], [rustPayload, rustResult]] as const) {
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        expect(valueFor(result, program[0]!.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
        expect(valueFor(result, program[1]!.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
        expect(valueFor(result, program[2]!.occurrence)).toEqual({ kind: "point", x: 0, y: 0 });
        expect(valueFor(result, program[3]!.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
        expect(valueFor(result, program[4]!.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
        expect(result.computedGeometry.get(use.id)).toMatchObject({
          kind: "line",
          start: { x: 10, y: 0 },
          end: { x: 0, y: 0 }
        });
        expectScalarNumberClose(scalarBindingFor(fixture, payload, "P2X"), 10);
      }
    }
  }, 30000);

  it("projects immutable line and path references from compiler-selected stages through persistent Rust stdio", async () => {
    const sourceFor = (padded: boolean) => [
      "nui 1",
      "module StageProvider() {",
      "  line Internal = segment(start: (2, 7), end: (12, 7))",
      "  move Internal as first (from: (2, 7), to: (12, 7))",
      "  move Internal as finished (from: (12, 7), to: (22, 7))",
      "  curve InternalPath = bezier(start: (3, 9), end: (13, 9), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
      "  move InternalPath as pathFirst (from: (3, 9), to: (13, 9))",
      "  move InternalPath as pathFinished (from: (13, 9), to: (23, 9))",
      "  export const Output: line = @Internal.base",
      "  export const OutputPath: path = @InternalPath.base",
      "}",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as first (from: (0, 0), to: (10, 0))",
      "move A as finished (from: (10, 0), to: (20, 0))",
      "curve C = bezier(start: (0, 5), end: (10, 5), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
      "move C as pathFirst (from: (0, 5), to: (10, 5))",
      "move C as pathFinished (from: (10, 5), to: (20, 5))",
      ...(padded ? ["const PaddingBefore: number = 17", "", "point Unrelated = coordinate(x: 91, y: 37)", ""] : []),
      "instance Stage = StageProvider()",
      "const BaseLine: line = @A.base",
      ...(padded ? ["const PaddingBetweenAliases: number = 23", ""] : []),
      "const BaseLineAlias: line = @BaseLine",
      "const BaseLineChain: line = @BaseLineAlias",
      "const NamedLine: line = @A.first",
      "const ExplicitFinalLine: line = @A.final",
      "const ImplicitFinalLine: line = @A",
      "const BasePath: path = @C.base",
      "const BasePathAlias: path = @BasePath",
      "const BasePathChain: path = @BasePathAlias",
      "const NamedPath: path = @C.pathFirst",
      "const ExplicitFinalPath: path = @C.final",
      "const ImplicitFinalPath: path = @C",
      "const ModuleLine: line = @Stage::Output",
      "const ModuleLineAlias: line = @ModuleLine",
      "const ModulePath: path = @Stage::OutputPath",
      ...(padded ? ["", "const PaddingAfterAliases: number = 31"] : [])
    ].join("\n");

    const observedAcrossPadding: Record<string, unknown>[] = [];
    for (const padded of [false, true]) {
      const fixture = fixtureFromSource(sourceFor(padded));
      const options = optionsFor(fixture);
      const program = options.geometryValueProgram ?? [];
      const analysis = fixture.compiled?.doc.moduleSemanticAnalysis;
      if (!analysis) throw new Error("missing compiled geometry-value semantic analysis");
      const rootValue = (name: string) => analysis.geometryValues.find((value) =>
        value.ownerModuleDefinitionStatementId === null && value.name === name
      );
      const names = [
        "BaseLine", "BaseLineAlias", "BaseLineChain", "NamedLine", "ExplicitFinalLine", "ImplicitFinalLine",
        "BasePath", "BasePathAlias", "BasePathChain", "NamedPath", "ExplicitFinalPath", "ImplicitFinalPath",
        "ModuleLine", "ModuleLineAlias", "ModulePath"
      ];
      const occurrences = new Map(names.map((name) => {
        const value = rootValue(name);
        if (!value) throw new Error(`missing root geometry value ${name}`);
        const entry = program.find((candidate) => candidate.sourceStatementId === value.statementId);
        if (!entry) throw new Error(`missing geometry-value program entry for ${name}`);
        return [name, entry.occurrence] as const;
      }));
      const moduleDefinition = analysis.definitions.find((definition) => definition.name === "StageProvider");
      const exportedLine = moduleDefinition?.localGeometryValues.find((value) => value.name === "Output");
      const exportedPath = moduleDefinition?.localGeometryValues.find((value) => value.name === "OutputPath");
      if (!exportedLine || !exportedPath) throw new Error("missing exported Module geometry values");
      const moduleLineEntries = program.filter((entry) => entry.sourceStatementId === exportedLine.statementId);
      const modulePathEntries = program.filter((entry) => entry.sourceStatementId === exportedPath.statementId);
      expect(moduleLineEntries).toHaveLength(1);
      expect(modulePathEntries).toHaveLength(1);

      const targetFor = (name: string) => {
        const occurrence = occurrences.get(name)!;
        const entry = program.find((candidate) => candidate.occurrence.sourceStatementId === occurrence.sourceStatementId &&
          candidate.occurrence.instancePath.length === occurrence.instancePath.length &&
          candidate.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index]));
        if (entry?.construction.kind !== "reference") throw new Error(`${name} must be a compiler-resolved reference`);
        return entry.construction.target;
      };
      expect(targetFor("BaseLine").stagePath).toEqual(["base"]);
      expect(targetFor("NamedLine").stagePath).toEqual(["first"]);
      expect(targetFor("ExplicitFinalLine").stagePath).toEqual(["final"]);
      expect(targetFor("ImplicitFinalLine").stagePath).toEqual(["final"]);
      expect(targetFor("BasePath").stagePath).toEqual(["base"]);
      expect(targetFor("NamedPath").stagePath).toEqual(["pathFirst"]);
      expect(targetFor("ExplicitFinalPath").stagePath).toEqual(["final"]);
      expect(targetFor("ImplicitFinalPath").stagePath).toEqual(["final"]);
      expect(moduleLineEntries[0]?.construction.kind).toBe("reference");
      if (moduleLineEntries[0]?.construction.kind !== "reference" || modulePathEntries[0]?.construction.kind !== "reference") {
        throw new Error("Module exports must compile to geometry references");
      }
      expect(moduleLineEntries[0].construction.target.stagePath).toEqual(["base"]);
      expect(modulePathEntries[0].construction.target.stagePath).toEqual(["base"]);

      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const tsResult = evaluationPayloadToResult(tsPayload);
      const rustResult = evaluationPayloadToResult(rustPayload);
      const valueFor = (
        result: ReturnType<typeof evaluationPayloadToResult>,
        occurrence: (typeof program)[number]["occurrence"]
      ) => [...(result.computedGeometryValues?.values() ?? [])].find((entry) =>
        entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.length === occurrence.instancePath.length &&
        entry.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index]) &&
        entry.occurrence.mappedMemberIndex === occurrence.mappedMemberIndex
      )?.value;
      const referenceValue = (result: ReturnType<typeof evaluationPayloadToResult>, name: string) =>
        valueFor(result, occurrences.get(name)!);

      for (const result of [tsResult, rustResult]) {
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        for (const name of ["BaseLine", "BaseLineAlias", "BaseLineChain", "ModuleLine", "ModuleLineAlias"]) {
          expect(referenceValue(result, name)).toMatchObject({
            kind: "line", start: { x: name.startsWith("Module") ? 2 : 0, y: name.startsWith("Module") ? 7 : 0 },
            end: { x: name.startsWith("Module") ? 12 : 10, y: name.startsWith("Module") ? 7 : 0 }
          });
        }
        expect(referenceValue(result, "NamedLine")).toMatchObject({ kind: "line", start: { x: 10, y: 0 }, end: { x: 20, y: 0 } });
        for (const name of ["ExplicitFinalLine", "ImplicitFinalLine"]) {
          expect(referenceValue(result, name)).toMatchObject({ kind: "line", start: { x: 20, y: 0 }, end: { x: 30, y: 0 } });
        }
        for (const name of ["BasePath", "BasePathAlias", "BasePathChain"]) {
          expect(referenceValue(result, name)).toMatchObject({
            kind: "bezierCurve", segments: [{ start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }]
          });
        }
        expect(referenceValue(result, "NamedPath")).toMatchObject({
          kind: "bezierCurve", segments: [{ start: { x: 10, y: 5 }, end: { x: 20, y: 5 } }]
        });
        for (const name of ["ExplicitFinalPath", "ImplicitFinalPath"]) {
          expect(referenceValue(result, name)).toMatchObject({
            kind: "bezierCurve", segments: [{ start: { x: 20, y: 5 }, end: { x: 30, y: 5 } }]
          });
        }
        expect(referenceValue(result, "ModulePath")).toMatchObject({
          kind: "bezierCurve", segments: [{ start: { x: 3, y: 9 }, end: { x: 13, y: 9 } }]
        });

        const moduleLine = valueFor(result, moduleLineEntries[0]!.occurrence);
        const modulePath = valueFor(result, modulePathEntries[0]!.occurrence);
        expect(moduleLine).toMatchObject({ kind: "line", start: { x: 2, y: 7 }, end: { x: 12, y: 7 } });
        expect(modulePath).toMatchObject({
          kind: "bezierCurve", segments: [{ start: { x: 3, y: 9 }, end: { x: 13, y: 9 } }]
        });
      }
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      observedAcrossPadding.push(Object.fromEntries(names.map((name) => [name, referenceValue(tsResult, name)])));
    }
    expect(observedAcrossPadding[1]).toEqual(observedAcrossPadding[0]);
  }, 30000);

  it("preserves optional-member availability through the persistent Rust stdio boundary", async () => {
    const evaluateSource = async (lines: string[]) => {
      const fixture = fixtureFromSource(lines.join("\n"));
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const ts = evaluationPayloadToResult(tsPayload);
      const rust = evaluationPayloadToResult(rustPayload);
      expect(rust.errors).toEqual(ts.errors);
      expect(rust.warnings).toEqual(ts.warnings);
      return { fixture, options, tsPayload, rustPayload, ts, rust };
    };

    const firstPosition = await evaluateSource([
      "nui 1",
      "record Piece(amount: number)",
      "const input: Piece? = none",
      "const readAmount: number? = @input?.amount"
    ]);
    const firstBinding = firstPosition.fixture.compiled?.doc.bindingAnalysis.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "readAmount"
    );
    const firstStatement = firstPosition.options.scalarProgram?.statements.find(
      (statement) => statement.bindingId === firstBinding?.id
    );
    expect(firstStatement?.sourceOrder).toBe(0);
    expect(firstStatement?.declaration.initializer).toMatchObject({
      kind: "optionalMember",
      target: { kind: "recordField", targetSourceOrder: firstStatement?.sourceOrder }
    });
    for (const payload of [firstPosition.tsPayload, firstPosition.rustPayload]) {
      expect(scalarBindingFor(firstPosition.fixture, payload, "readAmount")).toMatchObject({
        status: "ok",
        value: { kind: "none" }
      });
    }

    const presentRecord = await evaluateSource([
      "nui 1",
      "record Piece(amount: number)",
      "const input: Piece? = Piece(amount: 17)",
      "const readAmount: number? = @input?.amount"
    ]);
    for (const payload of [presentRecord.tsPayload, presentRecord.rustPayload]) {
      expect(scalarBindingFor(presentRecord.fixture, payload, "readAmount")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 17 }
      });
    }

    const paddedAbsentRecord = await evaluateSource([
      "nui 1",
      "record Piece(amount: number)",
      "const paddingBefore: number = 101",
      "const input: Piece? = none",
      "const paddingBetween: number = 202",
      "const readAmount: number? = @input?.amount",
      "const paddingAfter: number = 303"
    ]);
    for (const payload of [paddedAbsentRecord.tsPayload, paddedAbsentRecord.rustPayload]) {
      expect(scalarBindingFor(paddedAbsentRecord.fixture, payload, "readAmount")).toMatchObject({
        status: "ok",
        value: { kind: "none" }
      });
    }
    expect(scalarBindingFor(paddedAbsentRecord.fixture, paddedAbsentRecord.tsPayload, "readAmount"))
      .toEqual(scalarBindingFor(firstPosition.fixture, firstPosition.tsPayload, "readAmount"));

    const nestedRecord = await evaluateSource([
      "nui 1",
      "record Metadata(label: string)",
      "record Piece(metadata: Metadata)",
      'const input: Piece? = Piece(metadata: Metadata(label: "nested"))',
      "const readLabel: string? = @input?.metadata.label"
    ]);
    const nestedBinding = nestedRecord.fixture.compiled?.doc.bindingAnalysis.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "readLabel"
    );
    const nestedInitializer = nestedRecord.options.scalarProgram?.statements.find(
      (statement) => statement.bindingId === nestedBinding?.id
    )?.declaration.initializer;
    expect(nestedInitializer).toMatchObject({
      kind: "optionalMember",
      target: { kind: "recordField", field: { fieldPath: expect.arrayContaining([expect.anything(), expect.anything()]) } }
    });
    for (const payload of [nestedRecord.tsPayload, nestedRecord.rustPayload]) {
      expect(scalarBindingFor(nestedRecord.fixture, payload, "readLabel")).toMatchObject({
        status: "ok",
        value: { kind: "string", value: "nested" }
      });
    }

    const presentCollection = await evaluateSource([
      "nui 1",
      "const items: number[]? = [1, 2, 3]",
      "const itemCount: number? = @items?.length"
    ]);
    for (const payload of [presentCollection.tsPayload, presentCollection.rustPayload]) {
      expect(scalarBindingFor(presentCollection.fixture, payload, "itemCount")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 3 }
      });
    }

    const absentCollection = await evaluateSource([
      "nui 1",
      "const items: number[]? = none",
      "const itemCount: number? = @items?.length"
    ]);
    for (const payload of [absentCollection.tsPayload, absentCollection.rustPayload]) {
      expect(scalarBindingFor(absentCollection.fixture, payload, "itemCount")).toMatchObject({
        status: "ok",
        value: { kind: "none" }
      });
    }
  }, 30000);

  it("evaluates direct scalar geometry-property reads from compiler-selected stages through persistent Rust stdio", async () => {
    const names = [
      "BaseLength", "NamedLength", "ExplicitFinalLength", "ImplicitFinalLength",
      "BaseEndX", "NamedEndX", "ExplicitFinalEndX", "ImplicitFinalEndX"
    ] as const;
    const expected = {
      BaseLength: 10,
      NamedLength: 20,
      ExplicitFinalLength: 40,
      ImplicitFinalLength: 40,
      BaseEndX: 10,
      NamedEndX: 30,
      ExplicitFinalEndX: 60,
      ImplicitFinalEndX: 60
    } as const;
    const scalarDeclarations = [
      "const BaseLength: number = @A.base.length",
      "const NamedLength: number = @A.first.length",
      "const ExplicitFinalLength: number = @A.final.length",
      "const ImplicitFinalLength: number = @A.length",
      "const BaseEndX: number = @A.base.endPoint.x",
      "const NamedEndX: number = @A.first.endPoint.x",
      "const ExplicitFinalEndX: number = @A.final.endPoint.x",
      "const ImplicitFinalEndX: number = @A.endPoint.x"
    ];
    const sourceFor = (declarationOrder: "producer-first" | "consumer-first", padded: boolean) => [
      "nui 1",
      ...(padded ? ["// unrelated source padding", "", "const PaddingBefore: number = 17"] : []),
      ...(declarationOrder === "consumer-first" ? scalarDeclarations : []),
      "line A = segment(start: (0, 0), end: (10, 0))",
      ...(padded ? ["", "const PaddingBetween: number = 23"] : []),
      "move A as first (from: (0, 0), to: (10, 0), scale: 2)",
      "move A as finished (from: (10, 0), to: (20, 0), scale: 2)",
      ...(declarationOrder === "producer-first" ? scalarDeclarations : []),
      ...(padded ? ["", "const PaddingAfter: number = 31"] : [])
    ].join("\n");
    const valuesByVariant = new Map<string, Record<string, number>>();

    for (const { declarationOrder, padded } of [
      { declarationOrder: "producer-first", padded: false },
      { declarationOrder: "producer-first", padded: true },
      { declarationOrder: "consumer-first", padded: false },
      { declarationOrder: "consumer-first", padded: true }
    ] as const) {
      const fixture = fixtureFromSource(sourceFor(declarationOrder, padded));
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const compiledProgram = options.scalarProgram;
      if (!compiledProgram) throw new Error("missing compiler-authored scalar program");
      const authoredStagePath = (name: (typeof names)[number]) => {
        const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
          (candidate) => candidate.kind === "typed" && candidate.name === name
        );
        if (!binding) throw new Error(`typed binding "${name}" not found`);
        const initializer = compiledProgram.statements.find(
          (statement) => statement.bindingId === binding.id
        )?.declaration.initializer;
        if (!initializer || initializer.kind !== "geometryProperty") {
          throw new Error(`${name} must compile to a direct geometry-property expression`);
        }
        return initializer.stagePath;
      };
      expect(authoredStagePath("BaseLength")).toEqual(["base"]);
      expect(authoredStagePath("NamedLength")).toEqual(["first"]);
      expect(authoredStagePath("ExplicitFinalLength")).toEqual(["final"]);
      expect(authoredStagePath("ImplicitFinalLength")).toEqual(["final"]);
      expect(authoredStagePath("BaseEndX")).toEqual(["base"]);
      expect(authoredStagePath("NamedEndX")).toEqual(["first"]);
      expect(authoredStagePath("ExplicitFinalEndX")).toEqual(["final"]);
      expect(authoredStagePath("ImplicitFinalEndX")).toEqual(["final"]);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const values: Record<string, number> = {};
      for (const payload of [tsPayload, rustPayload]) {
        expect(evaluationPayloadToResult(payload).errors).toEqual([]);
        for (const name of names) {
          const value = scalarBindingFor(fixture, payload, name);
          expectScalarNumberClose(value, expected[name]);
          if (value?.status !== "ok" || value.value.kind !== "number") {
            throw new Error(`expected ${name} to evaluate to a number`);
          }
          values[name] = value.value.value;
        }
      }
      valuesByVariant.set(`${declarationOrder}:${padded ? "padded" : "plain"}`, values);
    }

    expect(valuesByVariant.get("producer-first:plain")).toEqual(expected);
    expect(valuesByVariant.get("producer-first:padded")).toEqual(expected);
    expect(valuesByVariant.get("consumer-first:plain")).toEqual(expected);
    expect(valuesByVariant.get("consumer-first:padded")).toEqual(expected);
    expect(valuesByVariant.get("producer-first:padded")).toEqual(valuesByVariant.get("producer-first:plain"));
    expect(valuesByVariant.get("consumer-first:padded")).toEqual(valuesByVariant.get("consumer-first:plain"));
    expect(valuesByVariant.get("consumer-first:plain")).toEqual(valuesByVariant.get("producer-first:plain"));
    expect(valuesByVariant.get("consumer-first:padded")).toEqual(valuesByVariant.get("producer-first:padded"));
  }, 30000);

  it("evaluates direct immutable point properties through typed numeric bindings and persistent Rust stdio", async () => {
    const rootSource = (producerFirst: boolean, padded: boolean) => {
      const consumer = [
        "point Probe = coordinate(x: @P.x, y: @P.y)",
        "const X: number = @P.x",
        "const Y: number = @P.y",
        "point Lifted = coordinate(x: @X, y: @Y)"
      ];
      const producer = "const P: point = coordinate(x: 11, y: 23)";
      return [
        "nui 1",
        ...(padded ? ["// SAY-445 harmless padding", "", "const PaddingBefore: number = 5"] : []),
        ...(producerFirst ? [producer, ...consumer] : [consumer[0]!, ...(padded ? ["", "const PaddingBetween: number = 7"] : []), producer, ...consumer.slice(1)]),
        ...(padded ? ["", "const PaddingAfter: number = 9"] : [])
      ].join("\n");
    };
    const moduleSource = (moduleName: string, instanceName: string, padded: boolean, aliasFirst: boolean) => [
      "nui 1",
      `module ${moduleName}() {`,
      "  export const Published: point = coordinate(x: 11, y: 23)",
      "}",
      ...(padded ? ["", "// SAY-445 Module padding", "const PaddingBefore: number = 13", ""] : []),
      `instance ${instanceName} = ${moduleName}()`,
      ...(aliasFirst
        ? [
            `const Alias: point = @${instanceName}::Published`,
            `point Qualified = coordinate(x: @${instanceName}::Published.x, y: @${instanceName}::Published.y)`,
            "point Aliased = coordinate(x: @Alias.x, y: @Alias.y)"
          ]
        : [
            `point Qualified = coordinate(x: @${instanceName}::Published.x, y: @${instanceName}::Published.y)`,
            `const Alias: point = @${instanceName}::Published`,
            "point Aliased = coordinate(x: @Alias.x, y: @Alias.y)"
          ])
    ].join("\n");
    const cases = [
      {
        name: "root-producer-first",
        source: rootSource(true, false),
        directPointNames: ["Probe"],
        pointNames: ["Probe", "Lifted"]
      },
      {
        name: "root-consumer-first-padded",
        source: rootSource(false, true),
        directPointNames: ["Probe"],
        pointNames: ["Probe", "Lifted"]
      },
      {
        name: "module-qualified-export-and-alias",
        source: moduleSource("Provider", "Source", false, false),
        directPointNames: ["Qualified", "Aliased"],
        pointNames: ["Qualified", "Aliased"]
      },
      {
        name: "renamed-module-instance-padded",
        source: moduleSource("RenamedProvider", "RenamedSource", true, true),
        directPointNames: ["Qualified", "Aliased"],
        pointNames: ["Qualified", "Aliased"]
      }
    ] as const;

    const assertCompilerAuthoredNumericProperties = (
      fixture: ReturnType<typeof fixtureFromSource>,
      rustInput: ReturnType<typeof buildRustEvaluationInput>,
      elementName: string
    ) => {
      const doc = fixture.compiled?.doc;
      const element = fixture.elements.find((candidate) => candidate.name === elementName);
      if (!doc?.statementMap || !element) throw new Error(`missing compiled ${elementName} element`);
      const statementIndex = [...doc.statementMap.elementIdByStatementIndex]
        .find(([, elementId]) => elementId === element.id)?.[0];
      if (statementIndex === undefined) throw new Error(`missing source statement for ${elementName}`);
      for (const property of ["x", "y"] as const) {
        const compiledBinding = doc.numericBindings?.get(propertyBindingOccurrenceKey(statementIndex, property));
        const payloadBinding = rustInput.scalarExpressionPayload?.numericBindings.find((candidate) =>
          candidate.elementId === element.id && candidate.parameterKey === property
        );
        expect(compiledBinding?.references).toEqual([]);
        expect(compiledBinding?.typedExpression).toMatchObject({
          kind: "geometryProperty",
          elementId: null,
          property,
          geometryValueOccurrence: expect.objectContaining({ sourceStatementId: expect.any(String), instancePath: expect.any(Array) })
        });
        expect(payloadBinding?.typedExpression).toEqual(compiledBinding?.typedExpression);
        expect(payloadBinding?.references).toEqual([]);
        const expression = compiledBinding?.typedExpression;
        if (expression?.kind !== "geometryProperty" || !expression.geometryValueOccurrence) {
          throw new Error(`expected compiler-resolved immutable ${elementName}.${property}`);
        }
        const occurrenceId = geometryValueOccurrenceKey(expression.geometryValueOccurrence);
        expect(doc.geometryValueProgram?.some((entry) =>
          geometryValueOccurrenceKey(entry.occurrence) === occurrenceId
        )).toBe(true);
        expect(doc.typedDependencyGraph?.edges).toContainEqual(expect.objectContaining({
          kind: "geometry",
          from: expect.objectContaining({ kind: "element", id: element.id }),
          to: expect.objectContaining({ kind: "geometry-value", id: occurrenceId }),
          requiredness: "required"
        }));
        expect(rustInput.scalarExpressionPayload?.conditionalDependencyGraph?.edges).toContainEqual(expect.objectContaining({
          kind: "geometry",
          from: expect.objectContaining({ kind: "element", id: element.id }),
          to: expect.objectContaining({ kind: "geometry-value", id: occurrenceId }),
          requiredness: "required"
        }));
      }
    };

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      const options = optionsFor(fixture);
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
      expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);
      const rustInput = buildRustEvaluationInput(fixture.elements, options);
      for (const pointName of testCase.directPointNames) assertCompilerAuthoredNumericProperties(fixture, rustInput, pointName);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));
      const expectedPoints = testCase.pointNames.map((name) => [name, { kind: "point", x: 11, y: 23 }] as const);
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors, testCase.name).toEqual([]);
        for (const [name, expected] of expectedPoints) {
          const element = fixture.elements.find((candidate) => candidate.name === name);
          expect(element, `${testCase.name}:${name}`).toBeDefined();
          expect(result.computedGeometry.get(element!.id), `${testCase.name}:${name}`).toMatchObject(expected);
        }
      }
    }
  }, 30000);

  it("schedules forward geometry-alias property reads by canonical dependency order", async () => {
    const forward = [
      "nui 1",
      "const result: number = @v.length",
      "const v: line = @A",
      "line A = segment(start: (0, 0), end: (10, 0))"
    ].join("\n");
    const producerFirst = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const v: line = @A",
      "const result: number = @v.length"
    ].join("\n");
    const directForward = [
      "nui 1",
      "const result: number = @A.length",
      "line A = segment(start: (0, 0), end: (10, 0))"
    ].join("\n");
    const multiLevel = [
      "nui 1",
      "const result: number = @v.length",
      "const v: line = @w",
      "const w: line = @A",
      "line A = segment(start: (0, 0), end: (10, 0))"
    ].join("\n");
    const paddedWithUnrelated = [
      "nui 1",
      "// SAY-434 source padding comment",
      "",
      "const unrelated: number = 23",
      "",
      "const result: number = @v.length",
      "",
      "const v: line = @A",
      "",
      "line A = segment(start: (0, 0), end: (10, 0))"
    ].join("\n");
    const scheduled = fixtureFromSource(forward);
    const scheduledOptions = optionsFor(scheduled);
    const resultBinding = scheduled.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "result"
    );
    const resultVersion = scheduledOptions.bindingVersions?.versions.find(
      (version) => version.bindingId === resultBinding?.id
    );
    const scheduledGraph = scheduledOptions.typedDependencyGraph;
    const backingGeometry = scheduled.elements.find((element) => element.name === "A");
    if (!resultBinding || !resultVersion || !scheduledGraph || !backingGeometry) {
      throw new Error("expected compiler products for the SAY-434 forward alias fixture");
    }
    const scheduledDependencyOrder = resolveTypedDependencyGraphRuntime(scheduledGraph, new Map()).dependencyOrder;
    const resultExecutionPosition = scheduledDependencyOrder.indexOf(`binding:${resultBinding.id}`);
    const backingGeometryPosition = scheduledDependencyOrder.indexOf(`element:${backingGeometry.id}`);
    const backingGeometrySourceOrder = scheduledOptions.statementInfoByElementId?.get(backingGeometry.id)?.statementIndex;
    if (resultExecutionPosition < 0 || backingGeometrySourceOrder === undefined) {
      throw new Error("expected source and dependency execution positions for the forward property read");
    }
    expect(resultVersion.sourceOrder).toBeLessThan(backingGeometrySourceOrder);
    expect(backingGeometryPosition).toBeGreaterThanOrEqual(0);
    expect(resultExecutionPosition).toBeGreaterThan(backingGeometryPosition);
    const scheduledRustInput = buildRustEvaluationInput(scheduled.elements, scheduledOptions);
    const scheduledResultPayload = scheduledRustInput.bindingVersions?.versions.find((version) => version.bindingId === resultBinding.id);
    expect(scheduledResultPayload).toMatchObject({ sourceOrder: resultVersion.sourceOrder });
    expect(scheduledResultPayload).not.toHaveProperty("dependencyExecutionPosition");

    const multiFixture = fixtureFromSource(multiLevel);
    const multiOptions = optionsFor(multiFixture);
    const multiResultBinding = multiFixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "result"
    );
    const multiResultInitializer = multiOptions.scalarProgram?.statements.find(
      (statement) => statement.bindingId === multiResultBinding?.id
    )?.declaration.initializer;
    const multiGraph = multiOptions.typedDependencyGraph;
    if (!multiResultBinding || multiResultInitializer?.kind !== "geometryProperty" ||
      !multiResultInitializer.geometryValueOccurrence || !multiGraph) {
      throw new Error("expected the multi-level alias property dependency in compiler output");
    }
    const multiOccurrenceId = geometryValueOccurrenceKey(multiResultInitializer.geometryValueOccurrence);
    expect(multiGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: expect.objectContaining({ kind: "binding", id: multiResultBinding.id }),
        to: expect.objectContaining({ kind: "geometry-value", id: multiOccurrenceId })
      })
    ]));
    const multiDependencyOrder = resolveTypedDependencyGraphRuntime(multiGraph, new Map()).dependencyOrder;
    const multiVersion = multiOptions.bindingVersions?.versions.find((version) => version.bindingId === multiResultBinding.id);
    const multiResultExecutionPosition = multiDependencyOrder.indexOf(`binding:${multiResultBinding.id}`);
    if (!multiVersion || multiResultExecutionPosition < 0) {
      throw new Error("expected dependency execution position for the multi-level alias read");
    }
    expect(multiResultExecutionPosition).toBeGreaterThan(multiDependencyOrder.indexOf(`geometry-value:${multiOccurrenceId}`));

    const moduleFixture = fixtureFromSource([
      "nui 1",
      "module M(input: number) {",
      "  const local: number = @input + 1",
      "  export const output: number = @local",
      "}",
      "instance One = M(input: 10)",
      "const result: number = @One::output"
    ].join("\n"));
    const moduleOptions = optionsFor(moduleFixture);
    const moduleCatalog = moduleFixture.compiled?.doc.bindingAnalysis?.catalog;
    const appendBindingIds = new Set(moduleCatalog?.bindings
      .filter((binding) => binding.catalogOrder === "append")
      .map((binding) => binding.id));
    const appendedModuleVersion = moduleOptions.bindingVersions?.versions.find((version) =>
      appendBindingIds.has(version.bindingId)
    );
    if (!appendedModuleVersion) throw new Error("expected a Module-materialized binding version in the append catalog lane");
    expect(appendedModuleVersion.catalogOrder).toBe("append");
    expect(appendedModuleVersion.control.kind).toBe("linear");
    const moduleRustInput = buildRustEvaluationInput(moduleFixture.elements, moduleOptions);
    expect(moduleRustInput.bindingVersions?.versions.find((version) => version.bindingId === appendedModuleVersion.bindingId))
      .toMatchObject({ catalogOrder: "append" });

    const cases = [forward, producerFirst, directForward, multiLevel, paddedWithUnrelated];
    for (const source of cases) {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        expect(evaluationPayloadToResult(payload).errors).toEqual([]);
        expectScalarNumberClose(scalarBindingFor(fixture, payload, "result"), 10);
      }
    }

    const disabled = fixtureFromSource([
      "nui 1",
      "const result: number = @v.length",
      "const v: line = @A",
      "line A = segment(start: (0, 0), end: (10, 0), enabled: false)"
    ].join("\n"));
    const disabledOptions = optionsFor(disabled);
    expect(disabled.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(disabled)).toBe(true);
    const disabledTs = evaluateElementsReferencePayload(disabled.elements, disabledOptions);
    const disabledRust = await rustStdio!.evaluate(disabled.elements, disabledOptions);
    expect(normalizeParityPayload(disabledRust)).toEqual(normalizeParityPayload(disabledTs));
    for (const payload of [disabledTs, disabledRust]) {
      expect(scalarBindingFor(disabled, payload, "result")).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-property-unavailable"
      });
    }

    const cycleSource = [
      "nui 1",
      "const result: number = @v.x",
      "const v: point = @A",
      "point A = coordinate(x: @result, y: 0)"
    ].join("\n");
    const cycleCompile = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), cycleSource);
    expect(cycleCompile.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dependency-cycle", severity: "error" })
    ]));
  }, 30000);

  it("schedules forward Module geometry-property reads without changing append ownership", async () => {
    const forwardModule = [
      "module M() {",
      "  export const value: number = @Target.length",
      "  line Target = segment(start: (20, 0), end: (40, 0))",
      "}"
    ];
    const producerFirstModule = [
      "module M() {",
      "  line Target = segment(start: (20, 0), end: (40, 0))",
      "  export const value: number = @Target.length",
      "}"
    ];
    const ordinaryTail = [
      "instance I = M()",
      "const exported: number = @I::value",
      "point Use = coordinate(x: @exported, y: 0)"
    ];
    const source = (...lines: readonly string[]) => ["nui 1", ...lines].join("\n");
    const successCases = [
      { name: "forward", source: source(...forwardModule, ...ordinaryTail) },
      { name: "producer-before-consumer", source: source(...producerFirstModule, ...ordinaryTail) },
      {
        name: "unrelated-root-before-module",
        source: source("const unrelatedBefore: number = 101", ...forwardModule, ...ordinaryTail)
      },
      {
        name: "unrelated-root-between-module-and-instance",
        source: source(...forwardModule, "const unrelatedBetween: number = 202", ...ordinaryTail)
      },
      {
        name: "unrelated-root-after-instance",
        source: source(...forwardModule, "instance I = M()", "const unrelatedAfter: number = 303", ...ordinaryTail.slice(1))
      },
      {
        name: "renamed-module",
        source: source(
          ...forwardModule.map((line) => line.replace("module M()", "module Renamed()")),
          ...ordinaryTail.map((line) => line.replaceAll("M()", "Renamed()"))
        )
      },
      {
        name: "unrelated-module-inserted",
        source: source(
          "module Noise() {",
          "  const ignored: number = 909",
          "}",
          "instance Spare = Noise()",
          ...forwardModule,
          ...ordinaryTail
        )
      },
      {
        name: "unrelated-source-and-scalar-padding",
        source: source(
          "// SAY-441 leading source padding",
          "",
          "const unrelatedBefore: number = 404",
          "",
          "module M() {",
          "  const unrelatedLocal: number = 505",
          "  export const value: number = @Target.length",
          "  line Target = segment(start: (20, 0), end: (40, 0))",
          "  const unrelatedAfter: number = 606",
          "}",
          "",
          ...ordinaryTail
        )
      }
    ];

    for (const variant of successCases) {
      const fixture = fixtureFromSource(variant.source);
      const options = optionsFor(fixture);
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), variant.name).toEqual([]);
      expect(isRustEligibleFixture(fixture), variant.name).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), variant.name).toEqual(normalizeParityPayload(tsPayload));
      const use = fixture.elements.find((element) => element.name === "Use");
      if (!use) throw new Error(`expected the Module property consumer in ${variant.name}`);
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors, variant.name).toEqual([]);
        expectScalarNumberClose(scalarBindingFor(fixture, payload, "exported"), 20);
        expect(result.computedGeometry.get(use.id), variant.name).toMatchObject({
          kind: "point",
          x: 20,
          y: 0
        });
      }
    }

    const twoInstances = fixtureFromSource([
      "nui 1",
      "module M(distance: number) {",
      "  export const value: number = @Target.length",
      "  line Target = segment(start: (0, 0), end: (@distance, 0))",
      "  point Use = coordinate(x: @value, y: 0)",
      "}",
      "instance First = M(distance: 20)",
      "instance Second = M(distance: 35)",
      "const first: number = @First::value",
      "const second: number = @Second::value",
      "point UseFirst = coordinate(x: @first, y: 0)",
      "point UseSecond = coordinate(x: @second, y: 0)"
    ].join("\n"));
    const twoInstanceOptions = optionsFor(twoInstances);
    expect(isRustEligibleFixture(twoInstances)).toBe(true);
    const twoInstanceTs = evaluateElementsReferencePayload(twoInstances.elements, twoInstanceOptions);
    const twoInstanceRust = await rustStdio!.evaluate(twoInstances.elements, twoInstanceOptions);
    expect(normalizeParityPayload(twoInstanceRust)).toEqual(normalizeParityPayload(twoInstanceTs));
    const repeatedUseElements = twoInstances.elements.filter((element) => element.name === "Use");
    expect(repeatedUseElements).toHaveLength(2);
    for (const payload of [twoInstanceTs, twoInstanceRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(twoInstances, payload, "first"), 20);
      expectScalarNumberClose(scalarBindingFor(twoInstances, payload, "second"), 35);
      expect(repeatedUseElements.map((element) => result.computedGeometry.get(element.id))
        .map((geometry) => geometry?.kind === "point" ? geometry.x : undefined).sort((a, b) => (a ?? 0) - (b ?? 0)))
        .toEqual([20, 35]);
      expect(result.computedGeometry.get(twoInstances.elements.find((element) => element.name === "UseFirst")!.id))
        .toMatchObject({ kind: "point", x: 20, y: 0 });
      expect(result.computedGeometry.get(twoInstances.elements.find((element) => element.name === "UseSecond")!.id))
        .toMatchObject({ kind: "point", x: 35, y: 0 });
    }

    const localAndExported = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  const localValue: number = @Target.length",
      "  line Target = segment(start: (20, 0), end: (40, 0))",
      "  export const value: number = @Target.length",
      "}",
      "instance I = M()",
      "const exported: number = @I::value",
      "point ExportUse = coordinate(x: @exported, y: 0)"
    ].join("\n"));
    const localAndExportedOptions = optionsFor(localAndExported);
    const localAndExportedGeometryVersions = localAndExportedOptions.bindingVersions?.versions.filter((version) =>
      version.catalogOrder === "append" && version.initializer?.kind === "geometryProperty"
    ) ?? [];
    expect(localAndExportedGeometryVersions).toHaveLength(2);
    expect(isRustEligibleFixture(localAndExported)).toBe(true);
    const localExportTs = evaluateElementsReferencePayload(localAndExported.elements, localAndExportedOptions);
    const localExportRust = await rustStdio!.evaluate(localAndExported.elements, localAndExportedOptions);
    expect(normalizeParityPayload(localExportRust)).toEqual(normalizeParityPayload(localExportTs));
    for (const payload of [localExportTs, localExportRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(localAndExported, payload, "exported"), 20);
      for (const version of localAndExportedGeometryVersions) {
        expect(result.computedScalarBindings?.get(version.bindingId)).toMatchObject({
          status: "ok",
          value: { kind: "number", value: 20 }
        });
      }
      expect(result.computedGeometry.get(localAndExported.elements.find((element) => element.name === "ExportUse")!.id))
        .toMatchObject({ kind: "point", x: 20, y: 0 });
    }

    const appendOnly = fixtureFromSource([
      "nui 1",
      "module Plain() {",
      "  const local: number = 7",
      "  export const value: number = @local + 1",
      "  point Use = coordinate(x: @value, y: 0)",
      "}",
      "instance I = Plain()",
      "const exported: number = @I::value"
    ].join("\n"));
    const appendOnlyOptions = optionsFor(appendOnly);
    const appendOnlyGraph = appendOnlyOptions.typedDependencyGraph;
    const appendCatalogIds = new Set(appendOnly.compiled?.doc.bindingAnalysis?.catalog.bindings
      .filter((binding) => binding.catalogOrder === "append")
      .map((binding) => binding.id));
    const appendOnlyVersions = appendOnlyOptions.bindingVersions?.versions.filter((version) => appendCatalogIds.has(version.bindingId)) ?? [];
    expect(appendOnlyVersions.length).toBeGreaterThan(0);
    expect(appendOnlyVersions.every((version) => version.catalogOrder === "append")).toBe(true);
    expect(appendOnlyVersions.every((version) => !appendOnlyGraph ||
      !typedDependencyBindingHasActiveGeometryPrerequisite(appendOnlyGraph, version.bindingId, new Map()))).toBe(true);
    expect(isRustEligibleFixture(appendOnly)).toBe(true);
    const appendOnlyTs = evaluateElementsReferencePayload(appendOnly.elements, appendOnlyOptions);
    const appendOnlyRust = await rustStdio!.evaluate(appendOnly.elements, appendOnlyOptions);
    expect(normalizeParityPayload(appendOnlyRust)).toEqual(normalizeParityPayload(appendOnlyTs));
    for (const payload of [appendOnlyTs, appendOnlyRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(appendOnly, payload, "exported"), 8);
      expect(result.computedGeometry.get(appendOnly.elements.find((element) => element.name === "Use")!.id))
        .toMatchObject({ kind: "point", x: 8, y: 0 });
    }

    const unavailableCases = [
      {
        source: [
          "nui 1",
          "module M() {",
          "  export const value: number = @Target.length",
          "  line Target = segment(start: (20, 0), end: (40, 0), enabled: false)",
          "}",
          "instance I = M()"
        ].join("\n"),
        name: "disabled"
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  const invalid: number = sqrt(-1)",
          "  export const value: number = @Target.length",
          "  line Target = segment(start: (20, 0), end: (@invalid, 0))",
          "}",
          "instance I = M()"
        ].join("\n"),
        name: "failed"
      }
    ];
    for (const unavailable of unavailableCases) {
      const fixture = fixtureFromSource(unavailable.source);
      const options = optionsFor(fixture);
      const geometryPropertyVersions = options.bindingVersions?.versions.filter((version) =>
        version.catalogOrder === "append" && version.initializer?.kind === "geometryProperty"
      ) ?? [];
      expect(geometryPropertyVersions, unavailable.name).toHaveLength(1);
      expect(isRustEligibleFixture(fixture), unavailable.name).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), unavailable.name).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.computedScalarBindings?.get(geometryPropertyVersions[0]!.bindingId), unavailable.name).toMatchObject({
          status: "error",
          issueCode: "evaluation-geometry-property-unavailable"
        });
      }
    }

  }, 30000);

  it("preserves selected stages through immutable geometry aliases", async () => {
    const cases = buildSay433TypeScriptCases();
    for (const { fixture, options, tsPayload } of cases) {
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
      for (const name of Object.keys(say433Expected) as (keyof typeof say433Expected)[]) {
        expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), say433Expected[name]);
      }
    }
  }, 30000);

  it("matches a declarative transformation recipe chain and its immutable stage snapshots", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "reverse A ()",
      "extend A.moved.end as extended (to: (30, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const owner = fixture.elements.find((element) => element.name === "A");
    if (!owner) throw new Error("expected line A");
    expect(options.transformationRecipes).toHaveLength(3);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.transformationStageGeometry?.get(`${owner.id}\u0000*\u0000moved`)).toBeDefined();
      expect(result.transformationStageGeometry?.get(`${owner.id}\u0000*\u0000moved.extended`)).toBeDefined();
      expect(result.computedGeometry.get(owner.id)).toBeDefined();
    }
  }, 30000);

  it("matches root and per-instance Module scalar transformation inputs through persistent Rust stdio", async () => {
    const rootFixture = fixtureFromSource([
      "nui 1",
      "const dx: number = 3",
      "const factor: number = 2",
      "line L = segment(start: (0, 0), end: (2, 0))",
      "move L (from: (0, 0), to: (@dx, 10), scale: @factor)"
    ].join("\n"));
    const rootOptions = optionsFor(rootFixture);
    expect(rootFixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(rootFixture)).toBe(true);
    const rootInput = buildRustEvaluationInput(rootFixture.elements, rootOptions);
    expect(rootInput.transformationRecipes && !Array.isArray(rootInput.transformationRecipes)
      ? rootInput.transformationRecipes.numericBindings
      : []).toHaveLength(2);
    const rootTs = evaluateElementsReferencePayload(rootFixture.elements, rootOptions);
    const rootRust = await rustStdio!.evaluate(rootFixture.elements, rootOptions);
    expect(normalizeParityPayload(rootRust)).toEqual(normalizeParityPayload(rootTs));
    for (const payload of [rootTs, rootRust]) {
      const result = evaluationPayloadToResult(payload);
      const line = rootFixture.elements.find((element) => element.name === "L")!;
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(line.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 10 },
        end: { x: 7, y: 10 }
      });
    }

    const moduleFixture = fixtureFromSource([
      "nui 1",
      "module M(dx: number) {",
      "  const local: number = @dx + 1",
      "  line L = segment(start: (0, 0), end: (20, 0))",
      "  move L as direct (from: (0, 0), to: (@dx, 0))",
      "  move L.direct as localMove (from: (0, 0), to: (@local, 10))",
      "}",
      "instance First = M(dx: 3)",
      "instance Second = M(dx: 8)"
    ].join("\n"));
    const moduleOptions = optionsFor(moduleFixture);
    expect(moduleFixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(moduleFixture)).toBe(true);
    const moduleInput = buildRustEvaluationInput(moduleFixture.elements, moduleOptions);
    const moduleRecipeIds = new Set((moduleOptions.transformationRecipes ?? [])
      .filter((recipe) => recipe.stageName === "direct")
      .map((recipe) => recipe.id));
    const moduleNumericBindings = moduleInput.transformationRecipes && !Array.isArray(moduleInput.transformationRecipes)
      ? moduleInput.transformationRecipes.numericBindings.filter((entry) => moduleRecipeIds.has(entry.recipeId))
      : [];
    expect(moduleNumericBindings).toHaveLength(2);
    expect(new Set(moduleNumericBindings.map((entry) => entry.references[0]?.bindingId)).size).toBe(2);
    const moduleTs = evaluateElementsReferencePayload(moduleFixture.elements, moduleOptions);
    const moduleRust = await rustStdio!.evaluate(moduleFixture.elements, moduleOptions);
    expect(normalizeParityPayload(moduleRust)).toEqual(normalizeParityPayload(moduleTs));
    for (const payload of [moduleTs, moduleRust]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      for (const stageName of ["direct", "localMove"] as const) {
        const recipes = (moduleOptions.transformationRecipes ?? []).filter((recipe) => recipe.stageName === stageName);
        expect(recipes).toHaveLength(2);
        const y = stageName === "direct" ? 0 : 10;
        const expectedStarts = stageName === "direct" ? [3, 8] : [7, 17];
        const stageGeometries = recipes.map((recipe) => {
          const target = recipe.targets[0]!;
          const stagePath = [...target.stagePath, stageName].join(".");
          return result.transformationStageGeometry?.get(`${target.ownerId}\u0000*\u0000${stagePath}`);
        });
        expect(stageGeometries).toEqual(expect.arrayContaining(expectedStarts.map((x) =>
          expect.objectContaining({
            kind: "line",
            start: expect.objectContaining({ x, y }),
            end: expect.objectContaining({ x: x + 20, y })
          })
        )));
      }
    }
  }, 30000);

  it("lowers Module-local transformation argument anchors through persistent Rust stdio", async () => {
    const cases = [
      {
        source: [
          "nui 1",
          "module M() {",
          "  line L = segment(start: (11, 23), end: (20, 35))",
          "  line P = segment(start: (-31, 47), end: (-26, 59))",
          "  move L (from: @P.start, to: @P.end)",
          "}",
          "instance I = M()"
        ].join("\n"),
        targetName: "L",
        anchorName: "P",
        stagePaths: [["final"], ["final"]] as const,
        pointKeys: ["start", "end"] as const,
        expectedGeometry: { start: { x: 16, y: 35 }, end: { x: 25, y: 47 } }
      },
      {
        source: [
          "nui 1",
          "// unrelated source padding",
          "",
          "module M() {",
          "  line Target = segment(start: (11, 23), end: (20, 35))",
          "  // Local names and source positions do not define runtime identity.",
          "  move Target (from: @Anchor.start, to: @Anchor.end)",
          "  line Anchor = segment(start: (-31, 47), end: (-26, 59))",
          "}",
          "instance I = M()"
        ].join("\n"),
        targetName: "Target",
        anchorName: "Anchor",
        stagePaths: [["final"], ["final"]] as const,
        pointKeys: ["start", "end"] as const,
        expectedGeometry: { start: { x: 16, y: 35 }, end: { x: 25, y: 47 } }
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  line P = segment(start: (-31, 47), end: (-26, 59))",
          "  line L = segment(start: (11, 23), end: (20, 35))",
          "  move P as shifted (from: (0, 0), to: (3, 4))",
          "  move L (from: @P.base.start, to: @P.shifted.start)",
          "}",
          "instance I = M()"
        ].join("\n"),
        targetName: "L",
        anchorName: "P",
        stagePaths: [["base"], ["shifted"]] as const,
        pointKeys: ["start", "start"] as const,
        expectedGeometry: { start: { x: 14, y: 27 }, end: { x: 23, y: 39 } }
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source);
      const options = optionsFor(fixture);
      const target = fixture.elements.find((element) => element.name === testCase.targetName);
      const anchor = fixture.elements.find((element) => element.name === testCase.anchorName);
      if (!target || !anchor) throw new Error("expected materialized Module target and anchor geometry");
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const runtimeRecipe = options.transformationRecipes?.find((recipe) =>
        recipe.construction === "move" && recipe.targets.some((selector) => selector.ownerId === target.id)
      );
      if (!runtimeRecipe || runtimeRecipe.operation.kind !== "move") {
        throw new Error("expected the Module move recipe in runtime evaluation options");
      }
      const expectedRuntimeAnchors = {
        startPoint: {
          mode: "derived",
          elementId: anchor.id,
          pointKey: testCase.pointKeys[0],
          stagePath: testCase.stagePaths[0]
        },
        endPoint: {
          mode: "derived",
          elementId: anchor.id,
          pointKey: testCase.pointKeys[1],
          stagePath: testCase.stagePaths[1]
        }
      };
      expect(runtimeRecipe.targets[0]?.ownerId).toBe(target.id);
      expect(runtimeRecipe.operation).toMatchObject({ kind: "move", ...expectedRuntimeAnchors });
      const runtimeAnchorIdentities = [runtimeRecipe.operation.startPoint, runtimeRecipe.operation.endPoint].map((pointAnchor) =>
        pointAnchor.mode === "reference" ? pointAnchor.pointId : pointAnchor.mode === "derived" ? pointAnchor.elementId : "coordinate"
      );
      expect(runtimeAnchorIdentities.every((identity) => !identity.startsWith("@"))).toBe(true);

      const preparedRustInput = buildRustEvaluationInput(fixture.elements, options);
      const preparedRecipe = preparedRustInput.transformationRecipes?.recipes.find((recipe) => recipe.id === runtimeRecipe.id);
      expect(preparedRecipe).toMatchObject({
        targets: [expect.objectContaining({ ownerId: target.id })],
        operation: { kind: "move", ...expectedRuntimeAnchors }
      });

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors).toEqual([]);
        expect(result.computedGeometry.get(target.id)).toMatchObject({
          kind: "line",
          start: testCase.expectedGeometry.start,
          end: testCase.expectedGeometry.end
        });
      }
    }
  }, 30000);

  it("matches compiler-resolved final, base, and named-stage reads", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "line StageStart = segment(start: @A.moved.start, end: (20, 0))",
      "const finalLength: number = @A.length",
      "const explicitFinalLength: number = @A.final.length",
      "const baseLength: number = @A.base.length",
      "const movedLength: number = @A.moved.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "finalLength"), 10);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "explicitFinalLength"), 10);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "baseLength"), 10);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "movedLength"), 10);
      const stageStart = fixture.elements.find((element) => element.name === "StageStart");
      expect(stageStart && result.computedGeometry.get(stageStart.id)).toMatchObject({
        kind: "line",
        start: { x: 10, y: 0 },
        end: { x: 20, y: 0 }
      });
    }
  }, 30000);

  it("matches dynamic selected lazy-branch activation and cycle handling", () => {
    for (const controller of [true, false]) {
      const fixture = fixtureFromSource([
        "nui 1",
        `const controller: boolean = ${controller}`,
        "const selected: number = if (@controller) { @other } else { 10 }",
        "const other: number = @selected"
      ].join("\n"));
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

      const selected = scalarBindingFor(fixture, tsPayload, "selected");
      for (const payload of [tsPayload, rustPayload]) {
        const value = scalarBindingFor(fixture, payload, "selected");
        if (controller) {
          expect(value).toMatchObject({ status: "error", issueCode: "evaluation-binding-cycle-guard" });
        } else {
          expect(value).toMatchObject({ status: "ok", value: { value: 10 } });
        }
      }
      expect(selected).toBeDefined();
    }
  }, 30000);

  it("activates dynamic cross-domain geometry branches for readiness and cycles", () => {
    for (const controller of [true, false]) {
      const fixture = fixtureFromSource([
        "nui 1",
        `const controller: boolean = ${controller}`,
        "const gate: boolean = if (@controller) { @A.length > 0 } else { true }",
        "line A = segment(start: (0, 0), end: (10, 0), enabled: @gate)"
      ].join("\n"));
      const options = optionsFor(fixture);
      const graph = fixture.compiled?.doc.typedDependencyGraph;
      expect(graph?.edges.some((edge) => edge.activation?.guards.some((guard) => guard.controllerId))).toBe(true);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const tsResult = evaluationPayloadToResult(tsPayload);
      const rustResult = evaluationPayloadToResult(rustPayload);
      if (controller) {
        expect(tsResult.errors).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
        expect(rustResult.errors).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
      } else {
        expect(tsResult.errors).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
        expect(rustResult.errors).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
        expect(tsResult.computedGeometry.size).toBeGreaterThan(0);
        expect(rustResult.computedGeometry.size).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it("matches typed numeric lazy binding activation and cross-domain cycles", () => {
    for (const flag of [false, true]) {
      const fixture = fixtureFromSource([
        "nui 1",
        `const flag: boolean = ${flag}`,
        "point P = coordinate(x: if (@flag) { @later } else { 0 }, y: 0)",
        "const later: number = @P.x"
      ].join("\n"));
      const options = optionsFor(fixture);
      const point = fixture.elements.find((element) => element.name === "P")!;
      const later = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((binding) => binding.name === "later");
      if (!later) throw new Error("expected later binding");
      const numericEdges = fixture.compiled?.doc.typedDependencyGraph?.edges.filter((edge) =>
        edge.kind === "numeric-expression" && edge.from.kind === "element" && edge.from.id === point.id
      ) ?? [];
      const laterEdges = numericEdges.filter((edge) => edge.to.kind === "binding" && edge.to.id === later.id);
      expect(laterEdges).toHaveLength(1);
      expect(laterEdges[0]).toMatchObject({ requiredness: "conditional" });
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        if (flag) {
          expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "dependency-cycle" })
          ]));
          expect(result.errors).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "evaluation-binding-cycle-guard" })
          ]));
        } else {
          expect(result.errors).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "dependency-cycle" })
          ]));
          expect(result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 0, y: 0 });
          expectScalarNumberClose(scalarBindingFor(fixture, payload, "later"), 0);
        }
      }
    }
  }, 30000);

  it("schedules a selected dynamic forward geometry branch before its consumer", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const chooseLater: boolean = true",
      "const selectedLength: number = if (@chooseLater) { @Later.length } else { 0 }",
      "line Consumer = segment(start: (0, 0), end: (@selectedLength, 1))",
      "line Later = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const dependencyGraph = fixture.compiled?.doc.typedDependencyGraph;
    const selectedLengthBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
      (binding) => binding.kind === "typed" && binding.name === "selectedLength"
    );
    const selectedLengthGeometryEdge = dependencyGraph?.directByEndpointId
      .get(`binding:${selectedLengthBinding?.id}`)
      ?.find((edge) => edge.to.kind === "geometry-value" || edge.to.kind === "geometry-stage" || edge.to.kind === "module-occurrence");
    const geometryGuard = selectedLengthGeometryEdge?.activation?.guards[0];
    if (!dependencyGraph || !selectedLengthBinding || !geometryGuard) {
      throw new Error("expected a guarded geometry prerequisite for selectedLength");
    }
    expect(typedDependencyBindingHasActiveGeometryPrerequisite(dependencyGraph, selectedLengthBinding.id, new Map())).toBe(false);
    expect(typedDependencyBindingHasActiveGeometryPrerequisite(
      dependencyGraph,
      selectedLengthBinding.id,
      new Map([[geometryGuard.controllerId, geometryGuard.branch]])
    )).toBe(true);
    expect(typedDependencyBindingHasActiveGeometryPrerequisite(
      dependencyGraph,
      selectedLengthBinding.id,
      new Map([[geometryGuard.controllerId, geometryGuard.branch === "then" ? "else" : "then"]])
    )).toBe(false);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      const consumer = fixture.elements.find((element) => element.name === "Consumer")!;
      expect(result.computedGeometry.get(consumer.id)).toMatchObject({ end: { x: 10, y: 1 } });
    }
  }, 30000);

  it("matches conditionalGroup lazy geometry activation in TypeScript and Rust", () => {
    const sourceFor = (chooseLater: boolean) => [
      "nui 1",
      `const chooseLater: boolean = ${chooseLater}`,
      "if (if (@chooseLater) { @Later.length > 0 } else { false }) {",
      "  point Inside = coordinate(x: 1, y: 1)",
      "}",
      "line Later = segment(start: (0, 0), end: (10, 0))"
    ].join("\n");

    for (const chooseLater of [false, true]) {
      const fixture = fixtureFromSource(sourceFor(chooseLater));
      const options = optionsFor(fixture);
      const conditional = fixture.elements.find((element) => element.type === "conditionalGroup")!;
      const inside = fixture.elements.find((element) => element.name === "Inside")!;
      const later = fixture.elements.find((element) => element.name === "Later")!;
      const graphEdges = fixture.compiled?.doc.typedDependencyGraph?.edges.filter((edge) =>
        edge.from.kind === "element" &&
        edge.from.id === conditional.id &&
        edge.to.kind === "geometry-stage" &&
        edge.to.ownerId === later.id
      ) ?? [];
      expect(graphEdges).toHaveLength(1);
      expect(graphEdges[0]).toMatchObject({ kind: "geometry-property", requiredness: "conditional" });
      expect(fixture.compiled?.doc.typedDependencyGraph?.edges.some((edge) =>
        edge.from.kind === "element" &&
        edge.from.id === conditional.id &&
        edge.to.kind === "geometry-stage" &&
        edge.to.ownerId === later.id &&
        edge.kind === "geometry" &&
        edge.requiredness === "required"
      )).toBe(false);
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors).toEqual([]);
        expect(result.errors).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
        if (chooseLater) {
          const computedIds = [...result.computedGeometry.keys()];
          expect(result.computedGeometry.get(inside.id)).toMatchObject({ kind: "point", x: 1, y: 1 });
          expect(computedIds.indexOf(later.id) < computedIds.indexOf(inside.id)).toBe(true);
        } else {
          expect(result.computedGeometry.has(inside.id)).toBe(false);
        }
      }
    }
  }, 30000);

  it("matches numeric coalescing fallback activation in TypeScript and Rust", () => {
    for (const maybeValue of ["5", "none"] as const) {
      const fixture = fixtureFromSource([
        "nui 1",
        `const maybe: number? = ${maybeValue}`,
        "point P = coordinate(x: @maybe ?? @Later.length, y: 0)",
        "line Later = segment(start: (0, 0), end: (10, 0))"
      ].join("\n"));
      const options = optionsFor(fixture);
      const point = fixture.elements.find((element) => element.name === "P")!;
      const later = fixture.elements.find((element) => element.name === "Later")!;
      const fallbackEdges = fixture.compiled?.doc.typedDependencyGraph?.edges.filter((edge) =>
        edge.from.kind === "element" &&
        edge.from.id === point.id &&
        edge.to.kind === "geometry-stage" &&
        edge.to.ownerId === later.id &&
        edge.kind === "geometry-property"
      ) ?? [];
      expect(fallbackEdges).toHaveLength(1);
      expect(fallbackEdges[0]).toMatchObject({ requiredness: "conditional" });
      expect(fallbackEdges[0]!.activation?.guards[0]).toMatchObject({ branch: "right" });
      expect(fallbackEdges[0]!.activation?.guards[0]?.controllerExpression).toBeDefined();
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors).toEqual([]);
        expect(result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: maybeValue === "5" ? 5 : 10, y: 0 });
        const computedIds = [...result.computedGeometry.keys()];
        expect(computedIds.indexOf(later.id) < computedIds.indexOf(point.id)).toBe(maybeValue === "none");
      }
    }
  }, 30000);

  it("retries a geometry-dependent dynamic controller after its predecessor is ready", () => {
    const sourceFor = (condition: string) => [
      "nui 1",
      "const gateFromGeometry: boolean = @GateGeometry.length " + condition + " 0",
      "const selectedLength: number = if (@gateFromGeometry) { @Later.length } else { 0 }",
      "line Consumer = segment(start: (0, 0), end: (@selectedLength, 1))",
      "line Later = segment(start: (0, 0), end: (10, 0))",
      "line GateGeometry = segment(start: (0, 0), end: (5, 0))"
    ].join("\n");

    for (const [condition, expectedLength, branchIsSelected] of [[">", 10, true], ["<", 0, false]] as const) {
      const fixture = fixtureFromSource(sourceFor(condition));
      const options = optionsFor(fixture);
      const graph = fixture.compiled?.doc.typedDependencyGraph;
      expect(isRustEligibleFixture(fixture)).toBe(true);
      expect(graph?.edges.some((edge) =>
        edge.kind === "geometry-property" &&
        edge.from.kind === "binding" &&
        edge.activation?.guards.some((guard) => guard.controllerExpression)
      )).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      const consumer = fixture.elements.find((element) => element.name === "Consumer")!;
      const later = fixture.elements.find((element) => element.name === "Later")!;
      const gateGeometry = fixture.elements.find((element) => element.name === "GateGeometry")!;
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        const computedGeometryIds = [...result.computedGeometry.keys()];
        expect(result.errors).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "dependency-cycle" })
        ]));
        expect(result.computedGeometry.get(consumer.id)).toMatchObject({ end: { x: expectedLength, y: 1 } });
        const gateIndex = computedGeometryIds.indexOf(gateGeometry.id);
        const consumerIndex = computedGeometryIds.indexOf(consumer.id);
        const laterIndex = computedGeometryIds.indexOf(later.id);
        expect(gateIndex).toBeLessThan(consumerIndex);
        expect(laterIndex < consumerIndex).toBe(branchIsSelected);
      }
    }
  }, 30000);

  it("keeps colliding local lazy controller spans independent across bindings", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const flagA: boolean = false",
      "const flagB: boolean = true",
      "const valueA: number = if (@flagA) { @LaterA.length } else { 0 }",
      "const valueB: number = if (@flagB) { @LaterB.length } else { 0 }",
      "line ConsumerA = segment(start: (0, 0), end: (@valueA, 1))",
      "line ConsumerB = segment(start: (0, 0), end: (@valueB, 1))",
      "line LaterA = segment(start: (0, 0), end: (20, 0))",
      "line LaterB = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const graph = fixture.compiled?.doc.typedDependencyGraph;
    const guardedEdges = graph?.edges.filter((edge) =>
      edge.from.kind === "binding" &&
      (edge.from.name === "valueA" || edge.from.name === "valueB") &&
      edge.activation?.guards.some((guard) => guard.controllerExpression)
    ) ?? [];
    expect(guardedEdges).toHaveLength(2);
    expect(guardedEdges[0]!.activation!.guards[0]!.controllerExpression!.span.start)
      .toBe(guardedEdges[1]!.activation!.guards[0]!.controllerExpression!.span.start);
    expect(new Set(guardedEdges.map((edge) => edge.activation!.guards[0]!.controllerId))).toHaveLength(2);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const consumerA = fixture.elements.find((element) => element.name === "ConsumerA")!;
    const consumerB = fixture.elements.find((element) => element.name === "ConsumerB")!;
    const laterA = fixture.elements.find((element) => element.name === "LaterA")!;
    const laterB = fixture.elements.find((element) => element.name === "LaterB")!;
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "valueA"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "valueB"), 10);
      expect(result.computedGeometry.get(consumerA.id)).toMatchObject({ end: { x: 0, y: 1 } });
      expect(result.computedGeometry.get(consumerB.id)).toMatchObject({ end: { x: 10, y: 1 } });
      const computedGeometryIds = [...result.computedGeometry.keys()];
      expect(computedGeometryIds.indexOf(laterA.id) < computedGeometryIds.indexOf(consumerA.id)).toBe(false);
      expect(computedGeometryIds.indexOf(laterB.id) < computedGeometryIds.indexOf(consumerB.id)).toBe(true);
    }
  }, 30000);

  it("keeps same-element numeric lazy controller occurrences independent", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const flagX: boolean = false",
      "const flagY: boolean = true",
      "point P = coordinate(x: if (@flagX) { @LaterX.length } else { 0 }, y: if (@flagY) { @LaterY.length } else { 0 })",
      "line LaterX = segment(start: (0, 0), end: (20, 0))",
      "line LaterY = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const point = fixture.elements.find((element) => element.name === "P")!;
    const numericKeys = [...(fixture.compiled?.doc.numericBindings ?? [])]
      .map(([key]) => key)
      .filter((key) => key.endsWith(":x") || key.endsWith(":y"));
    const xKey = numericKeys.find((key) => key.endsWith(":x"));
    const yKey = numericKeys.find((key) => key.endsWith(":y"));
    expect(xKey).toBeDefined();
    expect(yKey).toBeDefined();
    expect(xKey).not.toBe(yKey);

    const guardedEdges = fixture.compiled?.doc.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "geometry-property" &&
      edge.from.kind === "element" &&
      edge.from.id === point.id &&
      edge.activation?.guards.some((guard) => guard.controllerExpression)
    ) ?? [];
    const xEdges = guardedEdges.filter((edge) => edge.to.name.startsWith("LaterX."));
    const yEdges = guardedEdges.filter((edge) => edge.to.name.startsWith("LaterY."));
    expect(xEdges).toHaveLength(1);
    expect(yEdges).toHaveLength(1);
    expect(xEdges[0]!.from.id).toBe(yEdges[0]!.from.id);
    expect(xEdges[0]!.activation!.guards[0]!.controllerExpression!.span.start)
      .toBe(yEdges[0]!.activation!.guards[0]!.controllerExpression!.span.start);
    expect(new Set(xEdges.map((edge) => edge.activation!.guards[0]!.controllerId))).toHaveLength(1);
    expect(new Set(yEdges.map((edge) => edge.activation!.guards[0]!.controllerId))).toHaveLength(1);
    expect(xEdges[0]!.activation!.guards[0]!.controllerId)
      .not.toBe(yEdges[0]!.activation!.guards[0]!.controllerId);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const laterX = fixture.elements.find((element) => element.name === "LaterX")!;
    const laterY = fixture.elements.find((element) => element.name === "LaterY")!;
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 0, y: 10 });
      const computedGeometryIds = [...result.computedGeometry.keys()];
      expect(computedGeometryIds.indexOf(laterX.id) < computedGeometryIds.indexOf(point.id)).toBe(false);
      expect(computedGeometryIds.indexOf(laterY.id) < computedGeometryIds.indexOf(point.id)).toBe(true);
    }
  }, 30000);

  it("preserves nested lazy guard ancestry and activates the inner cycle only on the selected path", () => {
    const sourceFor = (outer: boolean) => [
      "nui 1",
      `const outer: boolean = ${outer}`,
      "const inner: boolean = true",
      "const gate: boolean = if (@outer) { if (@inner) { @A.length > 0 } else { true } } else { true }",
      "line A = segment(start: (0, 0), end: (10, 0), enabled: @gate)"
    ].join("\n");

    for (const outer of [false, true]) {
      const fixture = fixtureFromSource(sourceFor(outer));
      const options = optionsFor(fixture);
      const graph = fixture.compiled?.doc.typedDependencyGraph;
      const guardedEdge = graph?.edges.find((edge) =>
        edge.kind === "geometry-property" && edge.from.kind === "binding" && edge.activation
      );
      expect(guardedEdge?.activation?.guards).toHaveLength(2);
      expect(guardedEdge?.activation?.guards.map((guard) => guard.branch)).toEqual(["then", "then"]);
      expect(guardedEdge?.activation?.guards.every((guard) => guard.controllerExpression)).toBe(true);
      expect(isRustEligibleFixture(fixture)).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
      for (const payload of [tsPayload, rustPayload]) {
        const result = evaluationPayloadToResult(payload);
        if (outer) {
          expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "dependency-cycle" })
          ]));
        } else {
          expect(result.errors).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "dependency-cycle" })
          ]));
          expect(result.computedGeometry.size).toBeGreaterThan(0);
        }
      }
    }
  }, 30000);

  it("matches forward transformation argument scheduling in TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A (from: @B.start, to: (10, 0))",
      "line B = segment(start: (5, 0), end: (6, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    const aId = fixture.elements.find((element) => element.name === "A")!.id;
    expect(evaluationPayloadToResult(tsPayload).computedGeometry.get(aId)).toBeDefined();
  }, 30000);

  it("keeps incompatible geometry-value construction in the occurrence-owned error channel", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const PointValue: point = coordinate(x: 1, y: 2)",
      "const LineValue: line = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected two geometry value program entries");
    const options = {
      ...optionsFor(fixture),
      geometryValueProgram: [
        { ...program[0]!, declaredInterfaceType: "line" as const },
        { ...program[1]!, declaredInterfaceType: "point" as const }
      ]
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(tsPayload.errors).toEqual([]);
    expect(tsPayload.computedGeometryValues).toBeUndefined();
    expect(tsPayload.geometryValueErrors).toEqual([
      {
        occurrence: program[0]!.occurrence,
        message: "Geometry value construction is incompatible with its declared interface type."
      },
      {
        occurrence: program[1]!.occurrence,
        message: "Geometry value construction is incompatible with its declared interface type."
      }
    ]);
  }, 30000);

  it("matches direct pure arc values and radius diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Valid: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "const Invalid: path = arc(center: (0, 0), radius: -5, start: 0, end: 90, direction: counterclockwise)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected valid and invalid pure arc program entries");
    const validEntry = program[0]!;
    const invalidEntry = program[1]!;
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      const validValue = valueFor(result, validEntry.occurrence);
      expect(validValue).toMatchObject({ kind: "arcLine", radius: 10, sweepAngleDeg: -270 });
      expect(validValue).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "円弧の半径は0より大きい値で指定してください。"
      }]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure transformCopy and mirrorCopy path values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 2, endAngle: -90, endLength: 2)",
      "const Transformed: path = transformCopy(startPoint: (0, 0), endPoint: (20, 10), scale: 2, angleDeg: 90, mirrorX: true, baseLines: [@Curve])",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Mirrored: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Arc])"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 4) throw new Error("expected four pure copy path program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])].map((entry) => entry.value);
      expect(values).toHaveLength(4);
      expect(values[0]).toMatchObject({ kind: "bezierCurve", segments: [{ control1: expect.any(Object), control2: expect.any(Object) }] });
      expect(values[1]).toMatchObject({
        kind: "offsetLine",
        start: { x: 20, y: 10 },
        end: { x: 20, y: -10 },
        segments: [{ kind: "bezier", control1: { x: 16, y: 10 }, control2: { x: 16, y: -10 } }]
      });
      expect(values[2]).toMatchObject({ kind: "arcLine", radius: 10, sweepAngleDeg: 90 });
      expect(values[3]).toMatchObject({ kind: "offsetLine", segments: [{ kind: "arc", radius: 10, sweepAngleDeg: -90 }] });
      expect(values.every((value) => !("elementId" in value) && !("name" in value) && !("baseLineIds" in value))).toBe(true);
      expect(values[1]).not.toHaveProperty("elementId");
      expect(values[3]).not.toHaveProperty("name");
      expect(result.geometryValueErrors).toEqual([]);
    }
  }, 30000);

  it("projects drawable and materialized geometry references to canonical identity-free values through Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Baseline = segment(start: (10, 10), end: (20, 10))",
      "arc Quarter = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "curve Bezier = bezier(start: (0, 10), end: (10, 10), startAngle: 90, startLength: 2, endAngle: -90, endLength: 2)",
      "line Outline = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: false)",
      "line Shifted = offset(sources: [@Quarter], distance: 2, side: right, closed: false)",
      "line Connector = segment(start: (0, 10), end: (10, 10))",
      "line Joined = join(paths: [@Quarter, @Connector, @Baseline], closed: false)",
      "const StrictLineAlias: line = @Baseline",
      "const StrictLineAliasCopy: line = @StrictLineAlias",
      "const PathAlias: path = @Quarter",
      "const OptionalPathAlias: path? = @Baseline",
      "const ArcAlias: path = @Quarter",
      "const BezierAlias: path = @Bezier",
      "const PolylineAlias: path = @Outline",
      "const OffsetAlias: path = @Shifted",
      "const JoinedAlias: path = @Joined"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected compiled geometry reference program");
    const referenceEntries = program.filter((entry) => entry.construction.kind === "reference");
    expect(referenceEntries).toHaveLength(9);

    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      payload: typeof tsPayload,
      occurrence: (typeof referenceEntries)[number]["occurrence"]
    ) => {
      const result = evaluationPayloadToResult(payload);
      return [...(result.computedGeometryValues?.values() ?? [])]
        .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
          entry.occurrence.instancePath.length === occurrence.instancePath.length &&
          entry.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index]))
        ?.value;
    };
    const expectKeys = (value: unknown, keys: string[]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("expected a structural geometry object");
      }
      expect(Object.keys(value).sort()).toEqual([...keys].sort());
      return value as Record<string, unknown>;
    };
    const expectCoordinate = (value: unknown) => {
      expectKeys(value, ["x", "y"]);
      const coordinate = value as { x: unknown; y: unknown };
      expect(typeof coordinate.x).toBe("number");
      expect(typeof coordinate.y).toBe("number");
    };
    const expectCanonicalShape = (value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("expected a geometry value object");
      }
      const geometry = value as Record<string, unknown>;
      switch (geometry.kind) {
        case "line": {
          expectKeys(value, ["kind", "start", "end", "length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"]);
          expectCoordinate(geometry.start);
          expectCoordinate(geometry.end);
          break;
        }
        case "arcLine": {
          expectKeys(value, ["kind", "center", "start", "end", "radius", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg", "sweepAngleDeg", "length"]);
          expectCoordinate(geometry.center);
          expectCoordinate(geometry.start);
          expectCoordinate(geometry.end);
          break;
        }
        case "bezierCurve": {
          expectKeys(value, ["kind", "segments", "length"]);
          expect(Array.isArray(geometry.segments)).toBe(true);
          for (const segment of geometry.segments as unknown[]) {
            const projected = expectKeys(segment, ["start", "control1", "control2", "end"]);
            for (const key of ["start", "control1", "control2", "end"]) expectCoordinate(projected[key]);
          }
          break;
        }
        case "polyline": {
          expectKeys(value, ["kind", "segments", "closed", "start", "end", "length", "startTangentAngleDeg", "endTangentAngleDeg"]);
          expect(Array.isArray(geometry.segments)).toBe(true);
          for (const segment of geometry.segments as unknown[]) {
            const projected = expectKeys(segment, ["start", "end", "length"]);
            expectCoordinate(projected.start);
            expectCoordinate(projected.end);
          }
          expectCoordinate(geometry.start);
          expectCoordinate(geometry.end);
          break;
        }
        case "offsetLine":
        case "joinedPath": {
          expectKeys(value, ["kind", "start", "end", "segments", "closed", "length", "startTangentAngleDeg", "endTangentAngleDeg"]);
          if (geometry.start !== null) expectCoordinate(geometry.start);
          if (geometry.end !== null) expectCoordinate(geometry.end);
          expect(Array.isArray(geometry.segments)).toBe(true);
          for (const segment of geometry.segments as unknown[]) {
            if (segment === null || typeof segment !== "object" || Array.isArray(segment)) {
              throw new Error("expected a path segment object");
            }
            const primitive = segment as Record<string, unknown>;
            if (primitive.kind === "line") {
              const projected = expectKeys(segment, ["kind", "start", "end", "length"]);
              expectCoordinate(projected.start);
              expectCoordinate(projected.end);
            } else if (primitive.kind === "bezier") {
              const projected = expectKeys(segment, ["kind", "start", "control1", "control2", "end", "length"]);
              for (const key of ["start", "control1", "control2", "end"]) expectCoordinate(projected[key]);
            } else if (primitive.kind === "arc") {
              const projected = expectKeys(segment, ["kind", "center", "start", "end", "radius", "startAngleDeg", "sweepAngleDeg", "length"]);
              for (const key of ["center", "start", "end"]) expectCoordinate(projected[key]);
            } else {
              throw new Error("unexpected path segment kind");
            }
          }
          break;
        }
        default:
          throw new Error(`unexpected geometry reference kind: ${String(geometry.kind)}`);
      }
    };

    const aliases = [tsPayload, rustPayload].map((payload) =>
      referenceEntries.map((entry) => valueFor(payload, entry.occurrence))
    );
    for (const values of aliases) {
      expect(values.every((value) => value !== undefined)).toBe(true);
      for (const value of values) expectCanonicalShape(value);

      expect(values[0]).toMatchObject({
        kind: "line", start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, length: 10,
        startAngleDeg: 0, endAngleDeg: 180, startTangentAngleDeg: 0, endTangentAngleDeg: 180
      });
      expect(values[0]).not.toHaveProperty("startPointId");
      expect(values[0]).not.toHaveProperty("endPointId");
      expect(values[1]).toMatchObject({ kind: "line", start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, length: 10 });
      expect(values[1]).not.toHaveProperty("startPointId");
      expect(values[1]).not.toHaveProperty("endPointId");
      expect(values[2]).toMatchObject({
        kind: "arcLine", radius: 10, start: { x: 10, y: 0 },
        end: { x: expect.closeTo(0, 10), y: 10 }, sweepAngleDeg: 90,
        startAngleDeg: 0, endAngleDeg: 90, startTangentAngleDeg: 90, endTangentAngleDeg: 0
      });
      expect(values[3]).toMatchObject({ kind: "line", start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, length: 10 });
      expect(values[3]).not.toHaveProperty("startPointId");
      expect(values[3]).not.toHaveProperty("endPointId");
      expect(values[4]).toMatchObject({ kind: "arcLine", radius: 10, sweepAngleDeg: 90, length: Math.PI * 5 });
      expect(values[5]).toMatchObject({
        kind: "bezierCurve",
        segments: [{ start: { x: 0, y: 10 }, control1: { x: expect.closeTo(0, 10), y: 12 }, control2: { x: 10, y: 12 }, end: { x: 10, y: 10 } }]
      });
      expect((values[5] as { length: number }).length).toBeGreaterThan(0);
      expect(values[6]).toMatchObject({
        kind: "polyline", closed: false, start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, length: 9,
        segments: [{ start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5 }, { start: { x: 3, y: 4 }, end: { x: 3, y: 0 }, length: 4 }],
        startTangentAngleDeg: expect.any(Number), endTangentAngleDeg: expect.any(Number)
      });
      expect(values[7]).toMatchObject({
        kind: "offsetLine", closed: false, start: { x: 8, y: 0 }, end: { x: expect.closeTo(0, 10), y: 8 },
        segments: [{ kind: "arc", radius: 8, startAngleDeg: 0, sweepAngleDeg: 90 }],
        startTangentAngleDeg: expect.any(Number), endTangentAngleDeg: expect.any(Number)
      });
      expect((values[7] as { length: number }).length).toBeGreaterThan(0);
      expect(values[8]).toMatchObject({
        kind: "joinedPath", closed: false, start: { x: 10, y: 0 }, end: { x: 20, y: 10 },
        segments: [
          { kind: "arc", radius: 10, sweepAngleDeg: 90 },
          { kind: "line", start: { x: 0, y: 10 }, end: { x: 10, y: 10 }, length: 10 },
          { kind: "line", start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, length: 10 }
        ],
        startTangentAngleDeg: expect.any(Number), endTangentAngleDeg: expect.any(Number)
      });
      expect((values[8] as { length: number }).length).toBeGreaterThan(0);
    }
  }, 30000);

  it("matches invalid copy path scale, mirror axis, and ordered sources across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line First = segment(start: (0, 0), end: (10, 0))",
      "line Second = segment(start: (20, 0), end: (30, 0))",
      "const BadScale: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 0, baseLines: [@First])",
      "const BadAxis: path = mirrorCopy(axis1: (0, 0), axis2: (0, 0), baseLines: [@First])",
      "const Discontinuous: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@First, @Second])",
      "const EmptyTransform: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [])",
      "const EmptyMirror: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [])"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 5) throw new Error("expected five invalid pure copy path program entries");
    const badScale = program.find((entry) => entry.sourceStatementIndex === 3);
    const badAxis = program.find((entry) => entry.sourceStatementIndex === 4);
    const discontinuous = program.find((entry) => entry.sourceStatementIndex === 5);
    const emptyTransform = program.find((entry) => entry.sourceStatementIndex === 6);
    const emptyMirror = program.find((entry) => entry.sourceStatementIndex === 7);
    if (!badScale || !badAxis || !discontinuous || !emptyTransform || !emptyMirror) throw new Error("expected invalid copy path entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometryValues).toEqual(new Map());
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: badScale.occurrence,
          message: "transformCopy geometry value construction scale must be a finite positive number."
        },
        {
          occurrence: badAxis.occurrence,
          message: "mirrorCopy geometry value construction requires two distinct axis points."
        },
        {
          occurrence: discontinuous.occurrence,
          message: "transformCopy geometry value construction baseLines are not continuous in the specified order."
        },
        {
          occurrence: emptyTransform.occurrence,
          message: "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
        },
        {
          occurrence: emptyMirror.occurrence,
          message: "mirrorCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure polar point and strict-line values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "const P: point = polar(from: @Base, angle: 90, distance: 20)",
      "const DefaultP: point = polar(from: @Base)",
      "const L: line = polar(start: @P, angle: 30, length: 100)",
      "const DefaultL: line = polar(start: @P)",
      "const Path: path = @L",
      "const Px: number = @P.x",
      "const Ly: number = @L.end.y"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 5) throw new Error("expected five pure polar geometry value program entries, including the Path alias");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(5);
      expect(values[0]?.value).toMatchObject({ kind: "point", x: expect.closeTo(10, 10), y: 40 });
      expect(values[1]?.value).toEqual({ kind: "point", x: 10, y: 20 });
      expect(values[2]?.value).toMatchObject({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, length: expect.closeTo(100, 10) });
      expect(values[3]?.value).toMatchObject({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, end: { x: expect.closeTo(110, 10), y: 40 }, length: expect.closeTo(100, 10) });
      expect(values[4]?.value).toMatchObject({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, end: { x: expect.closeTo(10 + Math.cos(Math.PI / 6) * 100, 10), y: 90 }, length: expect.closeTo(100, 10) });
      expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    }
  }, 30000);

  it("matches pure commonTangent solutions and pure arc inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point C1 = coordinate(x: 0, y: 0)",
      "point C2 = coordinate(x: 60, y: 0)",
      "arc A = arc(center: @C1, radius: 20, start: 40, end: 80)",
      "arc B = arc(center: @C2, radius: 10, start: 210, end: 250)",
      "const ExternalLeft: line = commonTangent(first: @A, second: @B, kind: external, side: left)",
      "const ExternalRight: line = commonTangent(first: @A, second: @B, kind: external, side: right)",
      "const InternalLeft: line = commonTangent(first: @A, second: @B, kind: internal, side: left)",
      "const InternalRight: line = commonTangent(first: @A, second: @B, kind: internal, side: right)",
      "const PureFirst: path = arc(center: (0, 0), radius: 20, start: 0, end: 90, direction: counterclockwise)",
      "const PureSecond: path = through(point1: (70, 0), point2: (60, 10), point3: (50, 0), start: 0, end: 90)",
      "const PureInputs: line = commonTangent(first: @PureFirst, second: @PureSecond, kind: external, side: left)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 7) throw new Error("expected seven pure commonTangent program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(7);
      expect(values.filter((entry) => entry.value.kind === "line")).toHaveLength(5);
      expect(values.filter((entry) => entry.value.kind === "line").every((entry) => {
        const value = entry.value;
        return value.kind === "line" && !(
          "elementId" in value || "name" in value
        );
      })).toBe(true);
      expect(values.at(-1)?.value).toMatchObject({ kind: "line", length: expect.any(Number) });
    }
  }, 30000);

  it("matches pure Bezier feature points from pure and drawable sources", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const PureExtreme: point = bezierExtremePoint(source: @Curve, segmentIndex: 0, direction: 450)",
      "const PureBulge: point = bezierBulgePoint(source: @Curve)",
      "curve Drawable = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const DrawableExtreme: point = bezierExtremePoint(source: @Drawable, direction: 90)",
      "const DrawableBulge: point = bezierBulgePoint(source: @Drawable)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 5) throw new Error("expected five pure Bezier feature-point program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(5);
      for (const entry of values.filter((candidate) => candidate.value.kind === "point")) {
        expect(entry.value).toMatchObject({
          kind: "point",
          x: expect.closeTo(5, 10),
          y: expect.closeTo(7.5, 10)
        });
        expect(entry.value).not.toHaveProperty("elementId");
        expect(entry.value).not.toHaveProperty("name");
      }
    }
  }, 30000);

  it("matches pure tangentOffset angle and curve-side values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Line: path = segment(start: (0, 0), end: (10, 0))",
      "const Base: point = coordinate(x: 0, y: 0)",
      "const Explicit: point = tangentOffset(line: @Line, base: @Base, angle: 90, distance: 2)",
      "const Default: point = tangentOffset(line: @Line, base: @Base, distance: 2)",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Convex: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: convex, distance: 1)",
      "const Concave: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: concave, distance: 1)",
      "line Use = segment(start: @Explicit, end: @Concave)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 7) throw new Error("expected seven pure tangentOffset program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(7);
      expect(values[2]?.value).toMatchObject({ kind: "point", x: expect.closeTo(0, 10), y: expect.closeTo(2, 10) });
      expect(values[3]?.value).toMatchObject({ kind: "point", x: expect.closeTo(2, 10), y: expect.closeTo(0, 10) });
      expect(values[5]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(8.5, 10) });
      expect(values[6]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(6.5, 10) });
      expect(values.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches pure between and onLine division points across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 100, y: 0)",
      "const BetweenRatio: point = between(start: @A, end: @B, ratio: 0.5)",
      "const BetweenDistance: point = between(start: @A, end: @B, distance: 25)",
      "const L: line = segment(start: @A, end: @B)",
      "const OnLineRatio: point = onLine(from: @L.start, ratio: 0.5)",
      "const OnLineDistance: point = onLine(from: @L.end, distance: 25)",
      "line Use = segment(start: @BetweenRatio, end: @OnLineDistance)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure division geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const betweenRatio = entryFor(3);
    const betweenDistance = entryFor(4);
    const line = entryFor(5);
    const onLineRatio = entryFor(6);
    const onLineDistance = entryFor(7);
    if (!betweenRatio || !betweenDistance || !line || !onLineRatio || !onLineDistance) {
      throw new Error("expected all pure division geometry value entries");
    }
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof betweenRatio.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      expect(valueFor(result, betweenRatio.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, betweenDistance.occurrence)).toEqual({ kind: "point", x: 25, y: 0 });
      expect(valueFor(result, line.occurrence)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, length: 100 });
      expect(valueFor(result, onLineRatio.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, onLineDistance.occurrence)).toEqual({ kind: "point", x: 75, y: 0 });
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
      expect([...result.computedGeometry.values()][0]).toMatchObject({ kind: "line", start: { x: 50, y: 0 }, end: { x: 75, y: 0 } });
    }
  }, 30000);

  it("preserves explicitly selected snapshots for pure onLine values across persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as shifted(from: (0, 0), to: (0, 20))",
      "move L as finish(from: (0, 20), to: (0, 50))",
      "const BaseStart: point = onLine(from: @L.base.start, ratio: 0)",
      "const ShiftedStart: point = onLine(from: @L.shifted.start, ratio: 0)",
      "const FinalStart: point = onLine(from: @L.final.start, ratio: 0)",
      "const ShiftedEnd: point = onLine(from: @L.shifted.end, distance: 2)",
      "const Alias: path = @L.shifted",
      "const AliasStart: point = onLine(from: @Alias.start, ratio: 0)",
      "module M(source: path) {",
      "  const LocalStart: point = onLine(from: @source.start, ratio: 0)",
      "  const LocalEnd: point = onLine(from: @source.end, distance: 2)",
      "}",
      "instance Base = M(source: @L.base)",
      "instance Shifted = M(source: @L.shifted)",
      "instance Final = M(source: @L.final)",
      "line Use = segment(start: @ShiftedStart, end: @ShiftedEnd)"
    ].join("\n"));
    const options = optionsFor(fixture);
    const program = options.geometryValueProgram ?? [];
    const analysis = fixture.compiled?.doc.moduleSemanticAnalysis;
    const rootValue = (name: string) => analysis?.geometryValues.find((value) =>
      value.ownerModuleDefinitionStatementId === null && value.name === name
    );
    const rootOccurrences = new Map(["BaseStart", "ShiftedStart", "FinalStart", "ShiftedEnd", "AliasStart"].map((name) => {
      const value = rootValue(name);
      if (!value) throw new Error(`missing root onLine geometry value ${name}`);
      const entry = program.find((candidate) => candidate.sourceStatementId === value.statementId);
      if (!entry) throw new Error(`missing geometry-value program entry for ${name}`);
      return [name, entry.occurrence] as const;
    }));
    const moduleDefinition = analysis?.definitions.find((definition) => definition.name === "M");
    const localStart = moduleDefinition?.localGeometryValues.find((value) => value.name === "LocalStart");
    const localEnd = moduleDefinition?.localGeometryValues.find((value) => value.name === "LocalEnd");
    if (!localStart || !localEnd) throw new Error("missing Module-local onLine geometry values");
    const localStartEntries = program.filter((entry) => entry.sourceStatementId === localStart.statementId);
    const localEndEntries = program.filter((entry) => entry.sourceStatementId === localEnd.statementId);
    expect(localStartEntries).toHaveLength(3);
    expect(localEndEntries).toHaveLength(3);

    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: (typeof program)[number]["occurrence"]
    ) => [...(result.computedGeometryValues?.values() ?? [])].find((entry) =>
      entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
      entry.occurrence.instancePath.length === occurrence.instancePath.length &&
      entry.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index]) &&
      entry.occurrence.mappedMemberIndex === occurrence.mappedMemberIndex
    )?.value;
    const valuesForSource = (result: ReturnType<typeof evaluationPayloadToResult>, statementId: string) =>
      [...(result.computedGeometryValues?.values() ?? [])]
        .filter((entry) => entry.occurrence.sourceStatementId === statementId)
        .map((entry) => entry.value);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(valueFor(result, rootOccurrences.get("BaseStart")!)).toEqual({ kind: "point", x: 0, y: 0 });
      expect(valueFor(result, rootOccurrences.get("ShiftedStart")!)).toEqual({ kind: "point", x: 0, y: 20 });
      expect(valueFor(result, rootOccurrences.get("FinalStart")!)).toEqual({ kind: "point", x: 0, y: 50 });
      expect(valueFor(result, rootOccurrences.get("ShiftedEnd")!)).toEqual({ kind: "point", x: 8, y: 20 });
      expect(valueFor(result, rootOccurrences.get("AliasStart")!)).toEqual({ kind: "point", x: 0, y: 20 });
      expect(valuesForSource(result, localStart.statementId)).toEqual(expect.arrayContaining([
        { kind: "point", x: 0, y: 0 },
        { kind: "point", x: 0, y: 20 },
        { kind: "point", x: 0, y: 50 }
      ]));
      expect(valuesForSource(result, localEnd.statementId)).toEqual(expect.arrayContaining([
        { kind: "point", x: 8, y: 0 },
        { kind: "point", x: 8, y: 20 },
        { kind: "point", x: 8, y: 50 }
      ]));
    }
  }, 30000);

  it("matches physical concrete-arc onLine traversal for drawable and pure values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "point DrawableStart = onLine(from: @Arc.start, ratio: 0)",
      "point DrawableEnd = onLine(from: @Arc.start, ratio: 1)",
      "point DrawableReverseEnd = onLine(from: @Arc.end, ratio: 1)",
      "point DrawableMid = onLine(from: @Arc.start, ratio: 0.5)",
      "const PureArc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const PureArcTangent: point = tangentOffset(line: @PureArc, base: @PureArc.start, angle: 0, distance: 10)",
      "const PureStart: point = onLine(from: @PureArc.start, ratio: 0)",
      "const PureEnd: point = onLine(from: @PureArc.start, ratio: 1)",
      "const PureReverseEnd: point = onLine(from: @PureArc.end, ratio: 1)",
      "const PureMid: point = onLine(from: @PureArc.start, ratio: 0.5)",
      "arc Clockwise = arc(center: (0, 0), radius: 7, start: 25, end: 255, direction: clockwise)",
      "point DrawableClockwiseMid = onLine(from: @Clockwise.start, ratio: 0.5)",
      "const PureClockwise: path = arc(center: (0, 0), radius: 7, start: 25, end: 255, direction: clockwise)",
      "const PureClockwiseMid: point = onLine(from: @PureClockwise.start, ratio: 0.5)",
      "line PureStarts = segment(start: @PureStart, end: @PureEnd)",
      "line PureEndpoints = segment(start: @PureEnd, end: @PureReverseEnd)",
      "line PureMids = segment(start: @PureMid, end: @PureClockwiseMid)",
      "line PureTangentUse = segment(start: (0, 0), end: @PureArcTangent)",
      "line Before = segment(start: (0, 0), end: (10, 0))",
      "line After = segment(start: (0, 10), end: (0, 30))",
      "line Joined = join(paths: [@Before, @Arc, @After], closed: false)",
      "point JoinedPastArc = onLine(from: @Joined.start, distance: @Arc.length + 15)",
      "point JoinedInsideArc = onLine(from: @Joined.start, distance: 10 + @Arc.length * 0.4)"
    ].join("\n"));
    const options = optionsFor(fixture);

    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const elementNamed = (name: string) => {
      const element = fixture.elements.find((candidate) => candidate.name === name);
      if (!element) throw new Error(`expected ${name} element`);
      return element;
    };
    const results = [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)];
    for (const result of results) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const pointFor = (name: string) => result.computedGeometry.get(elementNamed(name).id);
      expect(pointFor("DrawableStart")).toMatchObject({ kind: "point", x: 10, y: 0 });
      expect(pointFor("DrawableEnd")).toMatchObject({ kind: "point", x: expect.closeTo(0, 10), y: expect.closeTo(10, 10) });
      expect(pointFor("DrawableReverseEnd")).toMatchObject({ kind: "point", x: 10, y: 0 });
      expect(pointFor("DrawableMid")).toMatchObject({
        kind: "point",
        x: expect.closeTo(10 / Math.sqrt(2), 10),
        y: expect.closeTo(10 / Math.sqrt(2), 10)
      });
      const clockwiseMid = { x: 7 * Math.cos(-40 * Math.PI / 180), y: 7 * Math.sin(-40 * Math.PI / 180) };
      expect(pointFor("DrawableClockwiseMid")).toMatchObject({
        kind: "point",
        x: expect.closeTo(clockwiseMid.x, 10),
        y: expect.closeTo(clockwiseMid.y, 10)
      });
      expect(pointFor("PureEndpoints")).toMatchObject({
        kind: "line",
        start: { x: expect.closeTo(0, 10), y: expect.closeTo(10, 10) },
        end: { x: 10, y: 0 }
      });
      expect(pointFor("PureStarts")).toMatchObject({
        kind: "line",
        start: { x: 10, y: 0 },
        end: { x: expect.closeTo(0, 10), y: expect.closeTo(10, 10) }
      });
      expect(pointFor("PureMids")).toMatchObject({
        kind: "line",
        start: { x: expect.closeTo(10 / Math.sqrt(2), 10), y: expect.closeTo(10 / Math.sqrt(2), 10) },
        end: { x: expect.closeTo(clockwiseMid.x, 10), y: expect.closeTo(clockwiseMid.y, 10) }
      });
      expect(pointFor("PureTangentUse")).toMatchObject({
        kind: "line",
        end: { x: 10, y: 10 }
      });
      expect(pointFor("JoinedPastArc")).toMatchObject({ kind: "point", x: expect.closeTo(0, 10), y: 15 });
      expect(pointFor("JoinedInsideArc")).toMatchObject({
        kind: "point",
        x: expect.closeTo(10 * Math.cos(36 * Math.PI / 180), 10),
        y: expect.closeTo(10 * Math.sin(36 * Math.PI / 180), 10)
      });
    }
  }, 30000);

  it("matches pure intersection points, extensions, and path inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "const Default: point = intersection(line1: @Horizontal, line2: @Vertical)",
      "const Explicit: point = intersection(line1: @Horizontal, line2: @Vertical, index: 0, extensions: false)",
      "const Path: path = polyline(points: [(0, 0), (100, 0)], closed: false)",
      "const FromPath: point = intersection(line1: @Path, line2: @Vertical)",
      "line Far = segment(start: (150, -50), end: (150, 50))",
      "const NoIntersection: point = intersection(line1: @Horizontal, line2: @Far)",
      "const Extended: point = intersection(line1: @Horizontal, line2: @Far, extensions: true)",
      "line Use = segment(start: @Default, end: @FromPath)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const defaultEntry = entryFor(3);
    const explicitEntry = entryFor(4);
    const pathEntry = entryFor(5);
    const fromPathEntry = entryFor(6);
    const noIntersectionEntry = entryFor(8);
    const extendedEntry = entryFor(9);
    if (!defaultEntry || !explicitEntry || !pathEntry || !fromPathEntry || !noIntersectionEntry || !extendedEntry) {
      throw new Error("expected all pure intersection entries");
    }
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof defaultEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(valueFor(result, defaultEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, explicitEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, pathEntry.occurrence)).toMatchObject({ kind: "polyline", closed: false });
      expect(valueFor(result, fromPathEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, extendedEntry.occurrence)).toEqual({ kind: "point", x: 150, y: 0 });
      expect(result.geometryValueErrors).toEqual([{
        occurrence: noIntersectionEntry.occurrence,
        message: "intersection geometry value could not find an intersection between the referenced geometry inputs. Check line1, line2, or extensions."
      }]);
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches deterministic nonzero pure intersection indexes across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Horizontal = segment(start: (-20, 0), end: (20, 0))",
      "const Circle: path = arc(center: (0, 0), radius: 10, start: 0, end: 360, direction: counterclockwise)",
      "const First: point = intersection(line1: @Horizontal, line2: @Circle, index: 0, extensions: false)",
      "const Second: point = intersection(line1: @Horizontal, line2: @Circle, index: 1, extensions: false)",
      "line Use = segment(start: @First, end: @Second)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const firstEntry = program.find((entry) => entry.sourceStatementIndex === 3);
    const secondEntry = program.find((entry) => entry.sourceStatementIndex === 4);
    if (!firstEntry || !secondEntry) throw new Error("expected both indexed pure intersection entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof firstEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      expect(valueFor(result, firstEntry.occurrence)).toEqual({ kind: "point", x: -10, y: 0 });
      expect(valueFor(result, secondEntry.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches same-source alias rejection and unavailable intersection inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Source = segment(start: (0, 0), end: (100, 0))",
      "const First: path = @Source",
      "const Second: line = @Source",
      "const Same: point = intersection(line1: @First, line2: @Second)",
      "line Vertical = segment(start: (5, -10), end: (5, 10))",
      "const Invalid: path = polyline(points: [(0, 0), (10 / 0, 0)], closed: false)",
      "const Failed: point = intersection(line1: @Invalid, line2: @Vertical)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const firstEntry = program.find((entry) => entry.sourceStatementIndex === 2);
    const secondEntry = program.find((entry) => entry.sourceStatementIndex === 3);
    const sameEntry = program.find((entry) => entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.sourceStatementIndex === 6);
    const failedEntry = program.find((entry) => entry.sourceStatementIndex === 7);
    if (!firstEntry || !secondEntry || !sameEntry || !invalidEntry || !failedEntry) {
      throw new Error("expected both alias and unavailable intersection entries");
    }
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    const valueEntryFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof firstEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])].find((entry) =>
      entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
      entry.occurrence.instancePath.length === occurrence.instancePath.length &&
      entry.occurrence.instancePath.every((part, index) => part === occurrence.instancePath[index])
    );
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      const firstValue = valueEntryFor(result, firstEntry.occurrence);
      const secondValue = valueEntryFor(result, secondEntry.occurrence);
      expect(firstValue).toBeDefined();
      expect(secondValue).toBeDefined();
      expect(firstValue?.value).toMatchObject({
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 }
      });
      expect(secondValue?.value).toMatchObject({
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 }
      });
      const aliasValues = [firstValue, secondValue];
      expect(aliasValues.map((entry) => entry?.occurrence.sourceStatementId)).toEqual([
        firstEntry.occurrence.sourceStatementId,
        secondEntry.occurrence.sourceStatementId
      ]);
      expect([...result.computedGeometryValues!.values()]).toHaveLength(2);
      expect(aliasValues.every((entry) =>
        entry !== undefined && !("elementId" in entry.value) && !("name" in entry.value)
      )).toBe(true);
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: sameEntry.occurrence,
          message: "intersection geometry value cannot intersect the same source geometry twice."
        },
        {
          occurrence: invalidEntry.occurrence,
          message: "Polyline geometry value construction inputs are unavailable or invalid."
        },
        {
          occurrence: failedEntry.occurrence,
          message: "intersection geometry value inputs are unavailable or invalid."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure intersection source, index, and cardinality diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "const Same: point = intersection(line1: @Horizontal, line2: @Horizontal)",
      "const Negative: point = intersection(line1: @Horizontal, line2: @Vertical, index: -1)",
      "const Fractional: point = intersection(line1: @Horizontal, line2: @Vertical, index: 0.5)",
      "const OutOfRange: point = intersection(line1: @Horizontal, line2: @Vertical, index: 1)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const same = entryFor(3);
    const negative = entryFor(4);
    const fractional = entryFor(5);
    const outOfRange = entryFor(6);
    if (!same || !negative || !fractional || !outOfRange) throw new Error("expected all intersection diagnostic entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([
        { occurrence: same.occurrence, message: "intersection geometry value cannot intersect the same source geometry twice." },
        { occurrence: negative.occurrence, message: "intersection geometry value index must be a finite non-negative integer." },
        { occurrence: fractional.occurrence, message: "intersection geometry value index must be a finite non-negative integer." },
        { occurrence: outOfRange.occurrence, message: "intersection geometry value index 1 is unavailable. There are 1 intersections." }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure division-point degenerate diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 0, y: 0)",
      "const BetweenDistance: point = between(start: @A, end: @B, distance: 1)",
      "const L: line = segment(start: @A, end: @B)",
      "const OnLineDistance: point = onLine(from: @L.start, distance: 1)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure division geometry value program entries");
    const betweenDistance = program.find((entry) => entry.sourceStatementIndex === 3);
    const onLineDistance = program.find((entry) => entry.sourceStatementIndex === 5);
    if (!betweenDistance || !onLineDistance) throw new Error("expected degenerate division entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: betweenDistance.occurrence,
          message: "between construction cannot determine a distance direction because its endpoints coincide."
        },
        {
          occurrence: onLineDistance.occurrence,
          message: "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure through values and degenerate diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const P1: point = coordinate(x: 10, y: 0)",
      "const P2: point = coordinate(x: 0, y: 10)",
      "const P3: point = coordinate(x: -10, y: 0)",
      "const Valid: path = through(point1: @P1, point2: @P2, point3: @P3, start: 30, end: 120)",
      "const Invalid: path = through(point1: (0, 0), point2: (1, 1), point3: (2, 2))"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure through geometry value program entries");
    const validEntry = program.find((entry) => entry.construction.kind === "through" && entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.construction.kind === "through" && entry.sourceStatementIndex === 5);
    if (!validEntry || !invalidEntry) throw new Error("expected valid and invalid pure through program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。"
      }]);
      const validValue = valueFor(result, validEntry.occurrence);
      expect(validValue).toMatchObject({
        kind: "arcLine",
        center: { x: 0, y: 0 },
        radius: 10,
        startAngleDeg: 30,
        endAngleDeg: 120,
        sweepAngleDeg: 90,
        length: 10 * Math.PI / 2
      });
      expect(validValue).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure bezier values, intermediates, and invalid-input diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Start: point = coordinate(x: 0, y: 0)",
      "const Middle: point = coordinate(x: 5, y: 2)",
      "const End: point = coordinate(x: 10, y: 0)",
      "const Valid: path = bezier(start: @Start, end: @End, startAngle: 0, startLength: 3, endAngle: 180, endLength: 4, intermediates: [@Middle: 90: 1: 2])",
      "const Invalid: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 10 / 0, endAngle: 180, endLength: 2)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure bezier geometry value program entries");
    const validEntry = program.find((entry) => entry.construction.kind === "bezier" && entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.construction.kind === "bezier" && entry.sourceStatementIndex === 5);
    if (!validEntry || !invalidEntry) throw new Error("expected valid and invalid pure bezier program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "Bezier geometry value construction inputs are unavailable or invalid."
      }]);
      expect(valueFor(result, validEntry.occurrence)).toMatchObject({
        kind: "bezierCurve",
        segments: [
          { start: { x: 0, y: 0 }, control1: { x: 3, y: 0 }, control2: { x: 5, y: 1 }, end: { x: 5, y: 2 } },
          { start: { x: 5, y: 2 }, control1: { x: 5, y: 4 }, control2: { x: 14 }, end: { x: 10, y: 0 } }
        ]
      });
      expect(valueFor(result, validEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure polyline values and occurrence-owned cardinality diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Open: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: false)",
      "const Closed: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: true)",
      "const Invalid: path = polyline(points: [(0, 0)], closed: false)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure polyline geometry value program entries");
    const openEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 1);
    const closedEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 2);
    const invalidEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 3);
    if (!openEntry || !closedEntry || !invalidEntry) throw new Error("expected open, closed, and invalid pure polyline entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof openEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId && entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(valueFor(result, openEntry.occurrence)).toMatchObject({ kind: "polyline", closed: false, length: 9 });
      expect(valueFor(result, closedEntry.occurrence)).toMatchObject({ kind: "polyline", closed: true, length: 12, end: { x: 0, y: 0 } });
      expect(valueFor(result, openEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "Polyline geometry value construction requires at least 2 finite points."
      }]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure point and line offset values, joins, and occurrence diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point BasePoint = coordinate(x: 1, y: 2)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "line BC = segment(start: (10, 0), end: (10, 10))",
      "line CA = segment(start: (10, 10), end: (0, 0))",
      "line CD = segment(start: (20, 0), end: (30, 0))",
      "const Point: point = offset(from: @BasePoint, dx: 1 + 2, dy: -4)",
      "const Open: path = offset(sources: [@AB, @BC], distance: 2, side: right, closed: false, suppressTrimWarnings: false)",
      "const Closed: path = offset(sources: [@AB, @BC, @CA], distance: 2, side: right, closed: true, suppressTrimWarnings: false)",
      "const Invalid: path = offset(sources: [@AB, @CD], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "line Use = segment(start: @Point, end: @Open.start)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure offset geometry value program entries");
    const pointEntry = program.find((entry) => entry.construction.kind === "offsetPoint");
    const openEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 7);
    const closedEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 8);
    const invalidEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 9);
    if (!pointEntry || !openEntry || !closedEntry || !invalidEntry) throw new Error("expected point, open, closed, and invalid offset entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      payload: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof pointEntry.occurrence
    ) => [...(payload.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId && entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;
    for (const payload of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(payload.errors).toEqual([]);
      expect(valueFor(payload, pointEntry.occurrence)).toEqual({ kind: "point", x: 4, y: -2 });
      expect(valueFor(payload, pointEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(payload, openEntry.occurrence)).toMatchObject({ kind: "offsetLine", closed: false, start: { x: 0, y: -2 }, end: { x: 12, y: 10 } });
      expect(valueFor(payload, closedEntry.occurrence)).toMatchObject({ kind: "offsetLine", closed: true });
      expect(valueFor(payload, closedEntry.occurrence)).not.toHaveProperty("name");
      expect(valueFor(payload, invalidEntry.occurrence)).toBeUndefined();
      expect(payload.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "geometry value の sources は前の線.end から次の線.start へ連続していません。reverse を使うか順序を見直してください。"
      }]);
      expect(payload.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("evaluates construction-input aliases from the original input across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 3, y: 4)",
      "point B = offset(from: @A, dx: 100, dy: 0, visible: false, enabled: false)",
      "point C = offset(from: @B.input.from, dx: 2, dy: 3)"
    ].join("\n"));
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const pointB = fixture.elements.find((element) => element.name === "B");
    const pointC = fixture.elements.find((element) => element.name === "C");
    if (!pointB || !pointC) throw new Error("expected points B and C");
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.computedGeometry.get(pointB.id)).toBeUndefined();
      expect(result.computedGeometry.get(pointC.id)).toMatchObject({ kind: "point", x: 5, y: 7 });
    }
  }, 30000);

  it("matches root collection length evaluation across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const numbers: number[] = [1, 1, 2]",
      "const count: number = @numbers.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "count"), 3);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "count"), 3);
  }, 30000);

  it("matches optional collection literal length evaluation across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const xs: number?[] = [none]",
      "const present: number?[] = [2]",
      "const mixed: number?[] = [2, none]",
      "const result: number = @xs.length",
      "const presentResult: number = @present.length",
      "const mixedResult: number = @mixed.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "result"), 1);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentResult"), 1);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "mixedResult"), 2);
    }
  }, 30000);

  it("matches optional scalar collection indexing through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const values: number?[] = [7]",
      "const selected: number? = @values[0]",
      "const noneValues: number?[] = [none]",
      "const selectedNone: number? = @noneValues[0]",
      "const mixed: number?[] = [2, none, 5]",
      "const first: number? = @mixed[0]",
      "const middle: number? = @mixed[1]",
      "const last: number? = @mixed[2]",
      "const alias: number?[] = @mixed",
      "const aliasFirst: number? = @alias[0]",
      "const aliasNone: number? = @alias[1]",
      "const requiredValues: number[] = [3, 8]",
      "const required: number = @requiredValues[1]",
      "const widened: number? = @requiredValues[0]",
      "const count: number = @values.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const optionalNumber = { kind: "optional", valueType: { kind: "number" } } as const;
    const expected = new Map<string, ReturnType<typeof scalarBindingFor>>([
      ["selected", { status: "ok", type: optionalNumber, value: { kind: "number", value: 7 } }],
      ["selectedNone", { status: "ok", type: optionalNumber, value: { kind: "none" } }],
      ["first", { status: "ok", type: optionalNumber, value: { kind: "number", value: 2 } }],
      ["middle", { status: "ok", type: optionalNumber, value: { kind: "none" } }],
      ["last", { status: "ok", type: optionalNumber, value: { kind: "number", value: 5 } }],
      ["aliasFirst", { status: "ok", type: optionalNumber, value: { kind: "number", value: 2 } }],
      ["aliasNone", { status: "ok", type: optionalNumber, value: { kind: "none" } }],
      ["required", { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 8 } }],
      ["widened", { status: "ok", type: optionalNumber, value: { kind: "number", value: 3 } }],
      ["count", { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } }]
    ]);
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      for (const [name, value] of expected) expect(scalarBindingFor(fixture, payload, name)).toEqual(value);
    }
  }, 30000);

  it("matches scalar and choice value-if evaluation while skipping the unselected branch", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const flag: boolean = true",
      "const amount: number = if (@flag) { 10 } else { 1 / 0 }",
      "const side: choice(left, right) = if (@flag) { left } else { right }"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "amount"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "amount"), 10);
    expect(scalarBindingFor(fixture, tsPayload, "side")).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
    expect(scalarBindingFor(fixture, rustPayload, "side")).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
  }, 30000);

  it("matches geometry value if and exhaustive match while skipping unselected runtime failures", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const side: choice(left, right) = right",
      "const SelectedPoint: point = if (true) { coordinate(x: 1, y: 2) } else { between(start: @A, end: @B, ratio: 1 / 0) }",
      "const SelectedPath: path = match @side { left => arc(center: @A, radius: 0, start: 0, end: 90, direction: counterclockwise) right => segment(start: @A, end: @B) }"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected two dynamic geometry value program entries");
    const pointEntry = program.find((entry) => entry.sourceStatementIndex === 5);
    const pathEntry = program.find((entry) => entry.sourceStatementIndex === 6);
    if (!pointEntry || !pathEntry) throw new Error("expected point and path dynamic entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      payload: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof pointEntry.occurrence
    ) => [...(payload.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;
    for (const payload of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(payload.errors).toEqual([]);
      expect(payload.geometryValueErrors).toEqual([]);
      expect(valueFor(payload, pointEntry.occurrence)).toEqual({ kind: "point", x: 1, y: 2 });
      expect(valueFor(payload, pathEntry.occurrence)).toMatchObject({
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      });
    }
  }, 30000);

  it("matches Module collection length evaluation across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const values: number[] = [1, 2, 2]",
      "module M(items: number[]) {",
      "  const localLength: number = @items.length",
      "  export const output: number[] = @items",
      "}",
      "instance Use = M(items: @values)",
      "const exportLength: number = @Use::output.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const name of ["localLength", "exportLength"]) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), 3);
    }
  }, 30000);

  it("evaluates inline and optional Module collection arguments through persistent Rust parity", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const values: number[] = [12]",
      "module M(items: number[], optionalItems: number[]?) {",
      "  export const selected: number = @items[0]",
      "  const resolvedOptional: number[] = @optionalItems ?? [17]",
      "  export const optionalSelected: number = @resolvedOptional[0]",
      "}",
      "instance RequiredLiteral = M(items: [7])",
      "instance OptionalLiteral = M(items: [8], optionalItems: [9])",
      "instance OptionalNone = M(items: [10], optionalItems: none)",
      "instance OptionalOmitted = M(items: [11])",
      "instance Alias = M(items: @values)",
      "const requiredValue: number = @RequiredLiteral::selected",
      "const optionalLiteralValue: number = @OptionalLiteral::optionalSelected",
      "const optionalNoneValue: number = @OptionalNone::optionalSelected",
      "const optionalOmittedValue: number = @OptionalOmitted::optionalSelected",
      "const aliasValue: number = @Alias::selected"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "requiredValue"), 7);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "optionalLiteralValue"), 9);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "optionalNoneValue"), 17);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "optionalOmittedValue"), 17);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "aliasValue"), 12);
    }
  }, 30000);

  it("matches terminal Module descendant completion across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  if (false) {",
      "    line Inactive = segment(start: (0, 0), end: (1, 0))",
      "  }",
      "  arc Error = arc(center: (0, 0), radius: 0, start: 0, end: 90)",
      "  line Disabled = segment(start: (0, 0), end: (5, 0), enabled: false)",
      "  line Good = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance A = M()"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const instance = fixture.elements.find((element) => element.name === "A")!;
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.instanceBaseGeometry?.get(instance.id)).toHaveLength(1);
      expect(result.instanceBaseGeometry?.get(instance.id)?.[0]).toMatchObject({ name: "Good" });
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ elementName: "Error" })
      ]));
    }
  }, 30000);

  it("matches repeated Module conditional collection selectors across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const first: number[] = [2]",
      "const second: number[] = [0]",
      "module M(items: number[]) {",
      "  export const selected: number[] = if (@items[0] > 0) { [10] } else { [20, 30] }",
      "  export const count: number = @selected.length",
      "}",
      "instance A = M(items: @first)",
      "instance B = M(items: @second)",
      "const aItem: number = @A::selected[0]",
      "const aCount: number = @A::count",
      "const bItem: number = @B::selected[1]",
      "const bCount: number = @B::count"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const [name, expected] of [["aItem", 10], ["aCount", 1], ["bItem", 30], ["bCount", 2]] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
  }, 30000);

  it("matches conditional geometry collection length and consumers across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const n: number = 1",
      "const selected: point[] = if (@n > 0) { [@B, @A] } else { [@A] }",
      "const count: number = @selected.length",
      "line Use = segment(start: @selected[0], end: @selected[0])",
      "line Outline = polyline(points: @selected, closed: false)"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "count"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "count"), 2);
    const selected = fixture.elements.find((element) => element.name === "Use")!;
    const outline = fixture.elements.find((element) => element.name === "Outline")!;
    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(selected.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 3, y: 4 }
      });
      expect(result.computedGeometry.get(outline.id)).toMatchObject({
        kind: "polyline",
        segments: [{ start: { x: 3, y: 4 }, end: { x: 1, y: 2 } }]
      });
    }
  }, 30000);

  it("matches conditional scalar collection length and indexing across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const trueFlag: boolean = true",
      "const falseFlag: boolean = false",
      "const left: number[] = [1]",
      "const right: number[] = [2, 3]",
      "const selectedTrue: number[] = if (@trueFlag) { @left } else { @right }",
      "const selectedFalse: number[] = if (@falseFlag) { @left } else { @right }",
      "const trueCount: number = @selectedTrue.length",
      "const trueItem: number = @selectedTrue[0]",
      "const falseCount: number = @selectedFalse.length",
      "const falseItem: number = @selectedFalse[1]"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const [name, expected] of [["trueCount", 1], ["trueItem", 1], ["falseCount", 2], ["falseItem", 3]] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
  }, 30000);

  it("keeps scalar value-for binding order stable through persistent Rust stdio", async () => {
    const cases = [
      { name: "without records", beforeMap: [], betweenMapAndConsumer: [], afterConsumer: [] },
      { name: "one record before the map", beforeMap: ["record Before(x: number)"], betweenMapAndConsumer: [], afterConsumer: [] },
      { name: "one record between the map and consumer", beforeMap: [], betweenMapAndConsumer: ["record Between(x: number)"], afterConsumer: [] },
      { name: "one record after the declarations", beforeMap: [], betweenMapAndConsumer: [], afterConsumer: ["record After(x: number)"] },
      { name: "two records before the map", beforeMap: ["record BeforeA(x: number)", "record BeforeB(x: number)"], betweenMapAndConsumer: [], afterConsumer: [] },
      { name: "an unrelated scalar before the map", beforeMap: ["const unrelated: number = 9"], betweenMapAndConsumer: [], afterConsumer: [] },
      { name: "an unrelated empty Module", beforeMap: ["module Empty() {", "}"], betweenMapAndConsumer: [], afterConsumer: [] }
    ];

    for (const variant of cases) {
      const fixture = fixtureFromSource([
        "nui 1",
        "const values: number[] = [2]",
        ...variant.beforeMap,
        "const mapped: number[] = for item in @values { @item * 3 }",
        ...variant.betweenMapAndConsumer,
        "const result: number = @mapped[0]",
        ...variant.afterConsumer
      ].join("\n"));
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture), variant.name).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      expect(tsPayload.errors, variant.name).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "result"), 6);

      // This uses the production compiler payload through the persistent
      // Node -> Rust stdio client; the payload is not repaired in the test.
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(rustPayload.errors, variant.name).toEqual([]);
      expect(normalizeParityPayload(rustPayload), variant.name).toEqual(normalizeParityPayload(tsPayload));
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "result"), 6);
    }
  }, 60000);

  it("matches nominal-record collection value-for field projections across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(",
      "  x: number,",
      "  label: string,",
      ")",
      "const first: Pair = Pair(x: 1, label: \"one\")",
      "const second: Pair = Pair(x: 2, label: \"two\")",
      "const pairs: Pair[] = [@first, @second]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10, label: @item.label) }",
      "const selected: Pair = @mapped[1]",
      "const selectedX: number = @selected.x",
      "const selectedLabel: string = @selected.label"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "selectedX"), 12);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "selectedX"), 12);
    for (const payload of [tsPayload, rustPayload]) {
      const selectedLabel = scalarBindingFor(fixture, payload, "selectedLabel");
      expect(selectedLabel?.status).toBe("ok");
      if (selectedLabel?.status === "ok") expect(selectedLabel.value).toEqual({ kind: "string", value: "two" });
    }
  }, 30000);

  it("lowers Module nominal-record maps with integer order through persistent Rust stdio", async () => {
    const source = [
      "nui 1",
      "record Pair(amount: number, label: string)",
      'const first: Pair = Pair(amount: 2, label: "first")',
      'const second: Pair = Pair(amount: 7, label: "second")',
      "const left: Pair[] = [@first]",
      "const right: Pair[] = [@second]",
      "const rootMapped: Pair[] = for item in @left { @item }",
      "module Mapper(items: Pair[], offset: number) {",
      "  const mapped: Pair[] = for item in @items { Pair(amount: @item.amount + @offset, label: @item.label) }",
      "  export const output: Pair = @mapped[0]",
      "}",
      "instance A = Mapper(items: @left, offset: 10)",
      "instance B = Mapper(items: @right, offset: 20)",
      "const rootOutput: Pair = @rootMapped[0]",
      "const rootAmount: number = @rootOutput.amount",
      "const aOutput: Pair = @A::output",
      "const bOutput: Pair = @B::output",
      "const aAmount: number = @aOutput.amount",
      "const bAmount: number = @bOutput.amount",
      "const aLabel: string = @aOutput.label",
      "const bLabel: string = @bOutput.label"
    ].join("\n");
    const fixture = fixtureFromSource(source);
    const repeated = fixtureFromSource(source);
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const recordMapsFor = (doc: NonNullable<typeof fixture.compiled>["doc"]) =>
      doc.scalarProgram?.collectionValues?.filter((value) => value.kind === "recordMap") ?? [];
    const recordMaps = recordMapsFor(fixture.compiled!.doc);
    const repeatedRecordMaps = recordMapsFor(repeated.compiled!.doc);
    expect(recordMaps).toHaveLength(3);
    const descriptorOrder = (maps: typeof recordMaps) => maps.map(({ valueId, sourceOrder }) => ({ valueId, sourceOrder }));
    expect(recordMaps.map(({ sourceOrder }) => sourceOrder)).toEqual(
      repeatedRecordMaps.map(({ sourceOrder }) => sourceOrder)
    );
    for (const recordMap of recordMaps) {
      expect(Number.isInteger(recordMap.sourceOrder)).toBe(true);
      expect(recordMap.sourceOrder).toBeGreaterThanOrEqual(0);
    }

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const rustRecordMaps = (rustInput.scalarProgram?.collectionValues ?? rustInput.bindingVersions?.collectionValues ?? [])
      .filter((value) => value.kind === "recordMap");
    expect(descriptorOrder(rustRecordMaps)).toEqual(descriptorOrder(recordMaps));

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "rootAmount"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "aAmount"), 12);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "bAmount"), 27);
      expect(scalarBindingFor(fixture, payload, "aLabel")).toMatchObject({
        status: "ok",
        value: { kind: "string", value: "first" }
      });
      expect(scalarBindingFor(fixture, payload, "bLabel")).toMatchObject({
        status: "ok",
        value: { kind: "string", value: "second" }
      });
    }
  }, 30000);

  it("matches record-valued optional-match binder lowering through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record R(x: number)",
      "const present: number? = 7",
      "const absent: number? = none",
      "const selectedPresent: R = match @present { none => R(x: 0) some renamedUnused => R(x: 1) }",
      "const selectedAbsent: R = match @absent { none => R(x: 2) some absentUnused => R(x: 3) }",
      "const selectedBound: R = match @present { none => R(x: 0) some inputAmount => R(x: @inputAmount + 5) }",
      "const selectedLazy: R = match @absent { none => R(x: 11) some dormantValue => R(x: 1 / 0) }",
      "const presentResult: number = @selectedPresent.x",
      "const absentResult: number = @selectedAbsent.x",
      "const boundResult: number = @selectedBound.x",
      "const lazyResult: number = @selectedLazy.x"
    ].join("\n"));
    expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(fixture.compiled!.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("optional-match-missing-binder");
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const tsResult = evaluationPayloadToResult(tsPayload);
    expect(tsResult.errors).toEqual([]);
    for (const [name, expected] of [
      ["presentResult", 1],
      ["absentResult", 2],
      ["boundResult", 12],
      ["lazyResult", 11]
    ] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
    }

    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const rustResult = evaluationPayloadToResult(rustPayload);
    expect(rustResult.errors).toEqual([]);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "presentResult"), 1);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "absentResult"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "boundResult"), 12);
    // The division-by-zero expression belongs to the unselected some arm.
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "lazyResult"), 11);
  }, 30000);

  it("matches SAY-442 Module record-field optional-match materialization through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record R(x: number)",
      "module M(input: number?) {",
      "  const a: number? = @input",
      "  const chosen: R = match @a { none => R(x: 3) some unused => R(x: 7) }",
      "  const selectedBound: R = match @a { none => R(x: 3) some renamed => R(x: @renamed + 5) }",
      "  const absent: number? = none",
      "  const selectedLazy: R = match @absent { none => R(x: 11) some dormant => R(x: 1 / 0) }",
      "  const result: number = @chosen.x",
      "  export const output: number = @result",
      "  const boundResult: number = @selectedBound.x",
      "  export const boundOutput: number = @boundResult",
      "  const lazyResult: number = @selectedLazy.x",
      "  export const lazyOutput: number = @lazyResult",
      "}",
      "instance Present = M(input: 7)",
      "instance Absent = M(input: none)",
      "const present: number = @Present::output",
      "const absent: number = @Absent::output",
      "const presentBound: number = @Present::boundOutput",
      "const absentBound: number = @Absent::boundOutput",
      "const presentLazy: number = @Present::lazyOutput",
      "const absentLazy: number = @Absent::lazyOutput"
    ].join("\n"));

    expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);

    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["present", 7],
        ["absent", 3],
        ["presentBound", 12],
        ["absentBound", 3],
        ["presentLazy", 11],
        ["absentLazy", 11]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("matches optional coalescing for geometry, nominal records, and scalar collections", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point presentPoint = coordinate(x: 1, y: 2)",
      "point fallbackPoint = coordinate(x: 10, y: 20)",
      "const maybePoint: point? = @presentPoint",
      "const fallbackPointValue: point = @fallbackPoint",
      "const resolvedPoint: point = @maybePoint ?? @fallbackPointValue",
      "const nonePoint: point? = none",
      "const resolvedNonePoint: point = @nonePoint ?? @fallbackPointValue",
      "line selectedPresentPoint = segment(start: @resolvedPoint, end: @fallbackPoint)",
      "line selectedNonePoint = segment(start: @resolvedNonePoint, end: @fallbackPoint)",
      "record Pair(x: number)",
      "const presentPair: Pair = Pair(x: 7)",
      "const fallbackPair: Pair = Pair(x: 11)",
      "const maybePair: Pair? = @presentPair",
      "const resolvedPair: Pair = @maybePair ?? @fallbackPair",
      "const nonePair: Pair? = none",
      "const resolvedNonePair: Pair = @nonePair ?? @fallbackPair",
      "const resolvedPairX: number = @resolvedPair.x",
      "const resolvedNonePairX: number = @resolvedNonePair.x",
      "const presentNumbers: number[]? = [1, 2]",
      "const fallbackNumbers: number[] = [10, 20]",
      "const resolvedNumbers: number[] = @presentNumbers ?? @fallbackNumbers",
      "const noneNumbers: number[]? = none",
      "const resolvedNoneNumbers: number[] = @noneNumbers ?? @fallbackNumbers",
      "const resolvedNumber: number = @resolvedNumbers[0]",
      "const resolvedNoneNumber: number = @resolvedNoneNumbers[0]"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "selectedPresentPoint")!.id)).toMatchObject({
        kind: "line",
        start: { x: 1, y: 2 },
        end: { x: 10, y: 20 }
      });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "selectedNonePoint")!.id)).toMatchObject({
        kind: "line",
        start: { x: 10, y: 20 },
        end: { x: 10, y: 20 }
      });
    }
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "resolvedPairX"), 7);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "resolvedPairX"), 7);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "resolvedNonePairX"), 11);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "resolvedNonePairX"), 11);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "resolvedNumber"), 1);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "resolvedNumber"), 1);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "resolvedNoneNumber"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "resolvedNoneNumber"), 10);
  }, 30000);

  it("runs optional collection match some/none binders lazily through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const present: number? = 7",
      "const absent: number? = none",
      "const fromSome: number[]? = match @present { none => none some value => if (@value > 0) { [@value] } else { [0] } }",
      "const fromNone: number[] = match @absent { none => [3, 4] some value => if (1 / 0 > 0) { [@value] } else { [0] } }",
      "const emptyFromNone: number[]? = match @absent { none => none some value => [@value] }",
      "const coalescedSome: number[] = @fromSome ?? [90]",
      "const coalescedNone: number[] = @emptyFromNone ?? @fromNone",
      "const someLength: number = @coalescedSome.length",
      "const someIndex: number = @coalescedSome[0]",
      "const noneLength: number = @coalescedNone.length",
      "const noneFirst: number = @coalescedNone[0]",
      "const noneIndex: number = @coalescedNone[1]",
      "line Output = segment(start: (@someIndex, @noneIndex), end: (0, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    // This call uses the shared long-lived evaluation_stdio process started in beforeAll.
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Output")!.id)).toMatchObject({
        kind: "line",
        start: { x: 7, y: 4 },
        end: { x: 0, y: 0 }
      });
    }

    for (const [name, expected] of [["someLength", 1], ["someIndex", 7], ["noneLength", 2], ["noneFirst", 3], ["noneIndex", 4]] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
  }, 30000);

  it("matches whole optional collection scrutinees and required some binders through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const present: number[]? = [7]",
      "const absent: number[]? = none",
      "const alias: number[]? = @present",
      "const unusedSome: number = match @present { none => 0 some unused => 7 }",
      "const noneArm: number = match @absent { none => 9 some unused => 0 }",
      "const wholeCollection: number[] = match @present { none => [0] some items => @items }",
      "const wholeAliasCollection: number[] = match @alias { none => [0] some collection => @collection }",
      "const wholeNoneCollection: number[] = match @absent { none => [9] some ignored => @ignored }",
      "const wholeLength: number = @wholeCollection.length",
      "const wholeIndex: number = @wholeCollection[0]",
      "const wholeAliasIndex: number = @wholeAliasCollection[0]",
      "const wholeNoneIndex: number = @wholeNoneCollection[0]",
      "const someLength: number = match @present { none => 0 some items => @items.length }",
      "const someIndex: number = match @present { none => 0 some values => @values[0] }",
      "const aliasLength: number = match @alias { none => 0 some collection => @collection.length }",
      "const renamedBinder: number = match @present { none => 0 some renamed => @renamed[0] }"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      for (const [name, expected] of [
        ["unusedSome", 7],
        ["noneArm", 9],
        ["wholeLength", 1],
        ["wholeIndex", 7],
        ["wholeAliasIndex", 7],
        ["wholeNoneIndex", 9],
        ["someLength", 1],
        ["someIndex", 7],
        ["aliasLength", 1],
        ["renamedBinder", 7]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("matches Module optional collection binders through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M(optional: number[]?) {",
      "  const alias: number[]? = @optional",
      "  const unused: number = match @optional { none => 0 some ignored => 7 }",
      "  const length: number = match @alias { none => 0 some values => @values.length }",
      "  const first: number = match @optional { none => 0 some items => @items[0] }",
      "  const copied: number[] = match @alias { none => [3] some collection => @collection }",
      "  export const result: number = @unused + @length + @first + @copied[0]",
      "}",
      "instance Present = M(optional: [7, 8])",
      "instance Absent = M(optional: none)",
      "const presentResult: number = @Present::result",
      "const absentResult: number = @Absent::result"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentResult"), 23);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentResult"), 3);
    }
  }, 30000);

  it("matches optional Module geometry collection binders through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "module M(optional: point[]?) {",
      "  const binderLength: number = match @optional { none => 0 some items => @items.length }",
      "  export const result: number = @binderLength",
      "}",
      "instance Present = M(optional: [@A, @B])",
      "instance Absent = M(optional: none)",
      "const presentResult: number = @Present::result",
      "const absentResult: number = @Absent::result"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const collectionValues = rustInput.scalarProgram?.collectionValues ?? rustInput.bindingVersions?.collectionValues ?? [];
    const moduleCollectionAliases = collectionValues.filter((value) =>
      value.kind === "alias" && value.valueId.startsWith("module-collection-binder:")
    );
    const geometryCollectionNodesById = new Map(
      (rustInput.geometryCollectionNodes ?? []).map(({ collectionValueId, value }) => [collectionValueId, value])
    );
    expect(moduleCollectionAliases.every((alias) => geometryCollectionNodesById.has(alias.targetValueId))).toBe(true);
    expect(moduleCollectionAliases.some((alias) =>
      geometryCollectionNodesById.get(alias.targetValueId)?.kind === "none"
    )).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentResult"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentResult"), 0);
    }
  }, 30000);

  it("keeps present empty optional collections on the some arm through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const xs: number[]? = []",
      "const absent: number[]? = none",
      "const result: number = match @xs { none => 1 some items => 2 }",
      "const presentLength: number = match @xs { none => -1 some items => @items.length }",
      "const absentResult: number = match @absent { none => 1 some items => 2 }"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "result"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentLength"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentResult"), 1);
    }
  }, 30000);

  it("matches optional geometry collection binders through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const points: point[]? = [@A, @B]",
      "const absent: point[]? = none",
      "const selected: point[] = match @points { none => [] some items => @items }",
      "const absentSelected: point[] = match @absent { none => [@A] some items => @items }",
      "const presentLength: number = match @points { none => -1 some items => @items.length }",
      "const absentArm: number = match @absent { none => 1 some items => @items.length }",
      "line Selected = segment(start: @selected[0], end: @selected[1])",
      "line AbsentSelected = segment(start: @absentSelected[0], end: @absentSelected[0])"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    const selected = fixture.elements.find((element) => element.name === "Selected")!;
    const absentSelected = fixture.elements.find((element) => element.name === "AbsentSelected")!;
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentLength"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentArm"), 1);
      expect(result.computedGeometry.get(selected.id)).toMatchObject({
        kind: "line",
        start: { x: 1, y: 2 },
        end: { x: 3, y: 4 }
      });
      expect(result.computedGeometry.get(absentSelected.id)).toMatchObject({
        kind: "line",
        start: { x: 1, y: 2 },
        end: { x: 1, y: 2 }
      });
    }
  }, 30000);

  it("matches optional nominal-record collection binders through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const first: Pair = Pair(x: 1, label: "first")',
      'const second: Pair = Pair(x: 2, label: "second")',
      "const pairs: Pair[]? = [@first, @second]",
      "const absent: Pair[]? = none",
      "const selected: Pair[] = match @pairs { none => [] some items => @items }",
      "const presentLength: number = match @pairs { none => -1 some items => @items.length }",
      "const indexedX: number = @selected[1].x",
      "const selectedLabel: string = @selected[1].label",
      "const absentArm: number = match @absent { none => 1 some items => @items.length }"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentLength"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "indexedX"), 2);
      expect(scalarBindingFor(fixture, payload, "selectedLabel")).toMatchObject({
        status: "ok",
        value: { kind: "string", value: "second" }
      });
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentArm"), 1);
    }
  }, 30000);

  it("preserves optional scalar fields selected from nominal-record collections through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record R(x: number?)",
      "const first: R = R(x: 7)",
      "const absent: R = R(x: none)",
      "const third: R = R(x: 23)",
      "const xs: R[] = [@first, @absent, @third]",
      "const selected: R = @xs[0]",
      "const selectedAbsent: R = @xs[1]",
      "const selectedThird: R = @xs[2]",
      "const presentResult: number = @selected.x ?? 19",
      "const absentResult: number = @selectedAbsent.x ?? 19",
      "const laterResult: number = @selectedThird.x ?? 19"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentResult"), 7);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "absentResult"), 19);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "laterResult"), 23);
    }
  }, 30000);

  it("resolves optional geometry collection length through persistent Rust stdio", async () => {
    const cases: Array<{
      name: string;
      source: string[];
      bindingName: string;
      expected: number;
    }> = [
      {
        name: "absent optional geometry collection coalesces to 17",
        source: [
          "nui 1",
          "const maybe: point[]? = none",
          "const result: number = @maybe?.length ?? 17"
        ],
        bindingName: "result",
        expected: 17
      },
      {
        name: "present empty optional geometry collection has length zero",
        source: [
          "nui 1",
          "const maybe: point[]? = []",
          "const result: number? = @maybe?.length"
        ],
        bindingName: "result",
        expected: 0
      },
      {
        name: "present one-member optional geometry collection has length one",
        source: [
          "nui 1",
          "point A = coordinate(x: 0, y: 0)",
          "const maybe: point[]? = [@A]",
          "const result: number? = @maybe?.length"
        ],
        bindingName: "result",
        expected: 1
      },
      {
        name: "non-optional empty geometry collection keeps length zero",
        source: [
          "nui 1",
          "const maybe: point[] = []",
          "const result: number = @maybe.length"
        ],
        bindingName: "result",
        expected: 0
      },
      {
        name: "absent optional scalar collection remains none",
        source: [
          "nui 1",
          "const maybe: number[]? = none",
          "const result: number = @maybe?.length ?? 17"
        ],
        bindingName: "result",
        expected: 17
      },
      {
        name: "present empty optional scalar collection keeps length zero",
        source: [
          "nui 1",
          "const maybe: number[]? = []",
          "const result: number? = @maybe?.length"
        ],
        bindingName: "result",
        expected: 0
      }
    ];

    for (const testCase of cases) {
      const fixture = fixtureFromSource(testCase.source.join("\n"));
      const options = optionsFor(fixture);
      expect(
        fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        `${testCase.name} must compile without errors`
      ).toEqual([]);
      expect(isRustEligibleFixture(fixture), `${testCase.name} must use the production Rust route`).toBe(true);

      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      expect(normalizeParityPayload(rustPayload), testCase.name).toEqual(normalizeParityPayload(tsPayload));
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, testCase.bindingName), testCase.expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, testCase.bindingName), testCase.expected);

      const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
        (candidate) => candidate.kind === "typed" && candidate.name === testCase.bindingName
      );
      if (!binding) throw new Error(`typed binding "${testCase.bindingName}" not found`);
      const rustBinding = rustPayload.computedScalarBindings?.find(
        (candidate) => candidate.bindingId === binding.id
      );
      expect(rustBinding, `${testCase.name} must include the raw Rust binding payload`).toBeDefined();
      expect(rustBinding?.evaluation).toMatchObject({
        status: "ok",
        value: { kind: "number", value: testCase.expected }
      });
    }
  }, 30000);

  it("evaluates optional nested-record fields through TypeScript and persistent Rust", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Inner(x: number)",
      "record Box(inner: Inner?)",
      "const inner: Inner = Inner(x: 7)",
      "const direct: Box = Box(inner: Inner(x: 7))",
      "const directX: number? = @direct.inner?.x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "directX"), 7);
    }
  }, 30000);

  it("matches general optional member chaining for geometry, records, and collections", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Baseline = segment(start: @A, end: @B)",
      "const presentPath: path? = @Baseline",
      "const absentPath: path? = none",
      "const presentLength: number? = @presentPath?.length",
      "const absentLength: number? = @absentPath?.length",
      "record Piece(note: string?, outline: path?)",
      'const presentPiece: Piece? = Piece(note: "present", outline: @Baseline)',
      "const absentPiece: Piece? = none",
      "const presentNote: string? = @presentPiece?.note",
      "const absentNote: string? = @absentPiece?.note",
      'const presentRecord: Piece = Piece(note: "record", outline: @Baseline)',
      'const absentRecord: Piece = Piece(note: "record", outline: none)',
      "const presentRecordLength: number? = @presentRecord.outline?.length",
      "const absentRecordLength: number? = @absentRecord.outline?.length",
      "const presentNumbers: number[]? = [1, 2, 3]",
      "const absentNumbers: number[]? = none",
      "const presentCount: number? = @presentNumbers?.length",
      "const absentCount: number? = @absentNumbers?.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentLength"), 10);
      expect(scalarBindingFor(fixture, payload, "absentLength")).toMatchObject({ status: "ok", value: { kind: "none" } });
      expect(scalarBindingFor(fixture, payload, "presentNote")).toMatchObject({ status: "ok", value: { kind: "string", value: "present" } });
      expect(scalarBindingFor(fixture, payload, "absentNote")).toMatchObject({ status: "ok", value: { kind: "none" } });
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentRecordLength"), 10);
      expect(scalarBindingFor(fixture, payload, "absentRecordLength")).toMatchObject({ status: "ok", value: { kind: "none" } });
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "presentCount"), 3);
      expect(scalarBindingFor(fixture, payload, "absentCount")).toMatchObject({ status: "ok", value: { kind: "none" } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("matches generalized record geometry and collection projections across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point P = coordinate(x: 3, y: 4)",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Baseline = segment(start: @A, end: @B)",
      "record Piece(outline: path, edge: line, points: point[])",
      "const piece: Piece = Piece(outline: polyline(points: [@A, @B], closed: false), edge: segment(start: @A, end: @B), points: [@A, @B])",
      "const outlineLength: number = @piece.outline.length",
      "const distance: number = lineDistance(@P, @piece.edge)",
      "const selectedX: number = @piece.points[1].x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "distance"), 4);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "distance"), 4);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "outlineLength"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "outlineLength"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "selectedX"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "selectedX"), 10);
  }, 30000);

  it("matches lazy unrequested mapped record field failures across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const source: Pair = Pair(x: 2, label: "source")',
      'const labels: string[] = ["valid"]',
      "const pairs: Pair[] = [@source]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10, label: @labels[99]) }",
      "const selected: Pair = @mapped[0]",
      "const selectedX: number = @selected.x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "selectedX"), 12);
    }
  }, 30000);

  it("matches lazy unused source record binder field failures across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const labels: string[] = ["valid"]',
      "const source: Pair = Pair(x: 7, label: @labels[99])",
      "const pairs: Pair[] = [@source]",
      "const offset: number = 1",
      'const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + @offset, label: "mapped") }',
      "const selected: Pair = @mapped[0]",
      "const selectedX: number = @selected.x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "selectedX"), 8);
    }
  }, 30000);

  it("matches collection selector source-order capabilities across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const base: number[] = [2]",
      "const selectedByIndex: number[] = if (@base[0] > 0) { [10] } else { [20, 30] }",
      "const indexItem: number = @selectedByIndex[0]",
      "const selectedByLength: number[] = if (@base.length > 0) { [11] } else { [21, 31] }",
      "const lengthCount: number = @selectedByLength.length",
      "const lengthItem: number = @selectedByLength[0]",
      "const choices: choice(left, right)[] = [left]",
      "const selectedByMatch: number[] = match @choices[0] { left => [12] right => [22, 32] }",
      "const matchItem: number = @selectedByMatch[0]",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "const selectedByProperty: point[] = if (@AB.length > 0) { [@A, @B] } else { [@A] }",
      "const propertyCount: number = @selectedByProperty.length",
      "line PropertyUse = segment(start: @selectedByProperty[0], end: @selectedByProperty[1])",
      "const selectedByBuiltin: point[] = if (distance(@A, @B) > 0) { [@A, @B] } else { [@A] }",
      "const builtinCount: number = @selectedByBuiltin.length",
      "line BuiltinUse = segment(start: @selectedByBuiltin[0], end: @selectedByBuiltin[1])"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const name of ["indexItem", "lengthItem", "matchItem"] as const) {
      const expected = name === "indexItem" ? 10 : name === "lengthItem" ? 11 : 12;
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "lengthCount"), 1);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "lengthCount"), 1);
    for (const name of ["propertyCount", "builtinCount"] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), 2);
    }
    const propertyUse = fixture.elements.find((element) => element.name === "PropertyUse")!;
    const builtinUse = fixture.elements.find((element) => element.name === "BuiltinUse")!;
    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(propertyUse.id)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
      expect(result.computedGeometry.get(builtinUse.id)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    }
  }, 30000);

  it("matches typed dynamic geometry collection indexing across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const index: number = 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const points: point[] = [@A, @B]",
      "line Selected = segment(start: @points[@index], end: @points[@index - 1])"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const selected = fixture.elements.find((element) => element.name === "Selected")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(selected.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 1, y: 2 }
      });
    }
  }, 30000);

  it("matches invalid dynamic geometry collection indexes across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const badIndex: number = -1",
      "point A = coordinate(x: 1, y: 2)",
      "const points: point[] = [@A]",
      "line Invalid = segment(start: @points[@badIndex], end: @A)"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const invalid = fixture.elements.find((element) => element.name === "Invalid")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(invalid.id)).toBeUndefined();
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("evaluation-collection-index-invalid") })
      ]));
    }
  }, 30000);

  it.each(fixtureNames)("%s matches the TypeScript reference payload", (name: string) => {
    const fixture = readParityFixture(repoRoot, name);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    if (!isCurrentReleaseFixture(name)) return;
    expect(isRustEligibleFixture(fixture), `${name} must use the production Rust route`).toBe(true);
    expect(normalizeParityPayload(runtimeDiagnosticsFor(fixture, rustPayload))).toEqual(
      normalizeParityPayload(runtimeDiagnosticsFor(fixture, tsPayload))
    );
  }, 30000);

  it("matches the descending range fixture through the production evaluation stdio process", async () => {
    const fixture = readParityFixture(repoRoot, "nui1-statement-for-descending-range.nui");
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await evaluateWithRustStdioOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    for (const result of [tsResult, rustResult]) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("min は max 以下") })
      ]));
      expect(result.forGroupGeneratedRows).toEqual([]);
      expect(result.computedGeometry.size).toBe(0);
    }

    const tsRuntimeDiagnostics = runtimeDiagnosticsFor(fixture, tsPayload);
    const rustRuntimeDiagnostics = runtimeDiagnosticsFor(fixture, rustPayload);
    if (tsRuntimeDiagnostics.length > 0 || rustRuntimeDiagnostics.length > 0) {
      expect(normalizeParityPayload(rustRuntimeDiagnostics)).toEqual(
        normalizeParityPayload(tsRuntimeDiagnostics)
      );
    }
  }, 30000);

  it("executes collection-backed statement-for loops through the persistent Rust stdio boundary", async () => {
    const normalizeModuleCarryPayload = (payload: unknown): unknown => {
      const normalized = normalizeParityPayload(payload);
      if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
      const sortEntries = (value: unknown, key: string) => Array.isArray(value)
        ? [...value].sort((left, right) => String((left as Record<string, unknown>)[key]).localeCompare(String((right as Record<string, unknown>)[key])))
        : value;
      const record = normalized as Record<string, unknown>;
      return {
        ...record,
        computedScalarBindings: sortEntries(record.computedScalarBindings, "bindingId"),
        computedScalarBindingVersions: sortEntries(record.computedScalarBindingVersions, "versionId")
      };
    };
    const evaluateSource = async (source: string, sortModuleScalarOutputs = false) => {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      const normalize = sortModuleScalarOutputs ? normalizeModuleCarryPayload : normalizeParityPayload;
      expect(normalize(rustPayload)).toEqual(normalize(tsPayload));
      return {
        fixture,
        options,
        tsPayload,
        rustPayload,
        ts: evaluationPayloadToResult(tsPayload),
        rust: evaluationPayloadToResult(rustPayload)
      };
    };

    const strings = await evaluateSource([
      "nui 1",
      'const items: string[] = ["a", "b"]',
      'for item in @items carry last: string = "" {',
      "  next last = @item",
      "  point Mark = coordinate(x: 0, y: 0)",
      "}",
      "const result: string = @last"
    ].join("\n"));
    for (const result of [strings.ts, strings.rust]) {
      expect(result.errors).toEqual([]);
      expect(scalarBindingFor(strings.fixture, result === strings.ts ? strings.tsPayload : strings.rustPayload, "result"))
        .toMatchObject({ status: "ok", type: { kind: "string" }, value: { kind: "string", value: "b" } });
    }
    const stringLoop = strings.fixture.elements.find((element) => element.type === "forGroup")!;
    const markRows = strings.ts.forGroupGeneratedRows?.filter((row) => row.forGroupId === stringLoop.id) ?? [];
    expect(markRows.map((row) => row.iterationIndex)).toEqual([0, 1]);
    expect(markRows.map((row) => row.variableValue)).toEqual([0, 1]);
    expect(markRows.every((row) => row.occurrencePath.at(-1)?.iterationIndex === row.iterationIndex)).toBe(true);

    const geometry = await evaluateSource([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 2, y: 0)",
      "const items: point[] = [@A, @B]",
      "for item in @items carry cursor: point = @A {",
      "  next cursor = @item",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    for (const result of [geometry.ts, geometry.rust]) {
      expect(result.errors).toEqual([]);
      const payload = result === geometry.ts ? geometry.tsPayload : geometry.rustPayload;
      expectScalarNumberClose(scalarBindingFor(geometry.fixture, payload, "result"), 2);
    }

    const empty = await evaluateSource([
      "nui 1",
      "const items: number[] = []",
      "for item in @items carry total: number = 7 {",
      "  next total = @total + 1",
      "  point Mark = coordinate(x: 0, y: 0)",
      "}",
      "const result: number = @total"
    ].join("\n"));
    for (const result of [empty.ts, empty.rust]) {
      expect(result.errors).toEqual([]);
      const payload = result === empty.ts ? empty.tsPayload : empty.rustPayload;
      expectScalarNumberClose(scalarBindingFor(empty.fixture, payload, "result"), 7);
      const loop = empty.fixture.elements.find((element) => element.type === "forGroup")!;
      expect(result.forGroupGeneratedRows?.filter((row) => row.forGroupId === loop.id) ?? []).toEqual([]);
      expect([...result.computedGeometry.keys()].some((id) => id.includes(`@${loop.id}:`))).toBe(false);
    }

    const emptyModule = await evaluateSource([
      "nui 1",
      "module M() {",
      "  const items: number[] = []",
      "  for item in @items carry total: number = 7 {",
      "    next total = @total + 1",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "  export const output: number = @total",
      "}",
      "instance A = M()",
      "const result: number = @A::output"
    ].join("\n"));
    for (const [result, payload] of [
      [emptyModule.ts, emptyModule.tsPayload],
      [emptyModule.rust, emptyModule.rustPayload]
    ] as const) {
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(emptyModule.fixture, payload, "result"), 7);
      expect(result.forGroupGeneratedRows).toEqual([]);
    }
    const emptyModuleCarry = [...(emptyModule.fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries)[0];
    if (!emptyModuleCarry?.nextBindingId) throw new Error("expected the compiled Module carry next binding identity");
    const emptyModuleInput = buildRustEvaluationInput(emptyModule.fixture.elements, emptyModule.options);
    const serializedEmptyModuleCarries = emptyModuleInput.bindingVersions?.immutableForGroups?.flatMap((plan) => plan.carries) ?? [];
    expect(serializedEmptyModuleCarries).toHaveLength(1);
    expect(serializedEmptyModuleCarries[0]).toMatchObject({
      bindingId: emptyModuleCarry.bindingId,
      nextBindingId: emptyModuleCarry.nextBindingId
    });

    const rootCarry = await evaluateSource([
      "nui 1",
      "for i in range(min: 0, max: 2, step: 1) carry total: number = 0 {",
      "  next total = @total + 1",
      "}",
      "const result: number = @total"
    ].join("\n"));
    const rootCarryPlan = [...(rootCarry.fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries)[0];
    if (!rootCarryPlan?.nextBindingId) throw new Error("expected the root carry next binding identity");
    expect(rootCarryPlan.nextBindingId).toMatch(/^binding:next:/);
    const rootCarryInput = buildRustEvaluationInput(rootCarry.fixture.elements, rootCarry.options);
    const serializedRootCarry = rootCarryInput.bindingVersions?.immutableForGroups?.flatMap((plan) => plan.carries)[0];
    expect(serializedRootCarry).toMatchObject({
      bindingId: rootCarryPlan.bindingId,
      nextBindingId: rootCarryPlan.nextBindingId
    });
    for (const [result, payload] of [
      [rootCarry.ts, rootCarry.tsPayload],
      [rootCarry.rust, rootCarry.rustPayload]
    ] as const) {
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(rootCarry.fixture, payload, "result"), 3);
    }

    const moduleCarry = await evaluateSource([
      "nui 1",
      "module M(start: number) {",
      "  const items: number[] = [0, 1, 2]",
      "  for item in @items carry total: number = @start {",
      "    next total = @total + 1",
      "    point Mark = coordinate(x: @start, y: 0)",
      "  }",
      "  export const output: number = @total",
      "}",
      "instance A = M(start: 5)",
      "instance B = M(start: 20)",
      "const resultA: number = @A::output",
      "const resultB: number = @B::output"
    ].join("\n"), true);
    const moduleCarryPlans = [...(moduleCarry.fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.carries);
    expect(moduleCarryPlans).toHaveLength(2);
    expect(moduleCarryPlans.every((carry) => carry.bindingId.startsWith("module-binding:") && carry.nextBindingId?.startsWith("module-binding:"))).toBe(true);
    expect(moduleCarryPlans.every((carry) => Number.isInteger(carry.nextSourceOrder) && carry.nextSourceOrder >= 0)).toBe(true);
    expect(new Set(moduleCarryPlans.map((carry) => carry.bindingId)).size).toBe(2);
    expect(new Set(moduleCarryPlans.map((carry) => carry.nextBindingId)).size).toBe(2);
    const moduleCarryInput = buildRustEvaluationInput(moduleCarry.fixture.elements, moduleCarry.options);
    const serializedModuleCarryPlans = moduleCarryInput.bindingVersions?.immutableForGroups?.flatMap((plan) => plan.carries) ?? [];
    expect(serializedModuleCarryPlans).toHaveLength(2);
    const identityPairs = (carries: typeof moduleCarryPlans) => new Set(carries.map((carry) =>
      JSON.stringify([carry.bindingId, carry.nextBindingId])
    ));
    expect(identityPairs(serializedModuleCarryPlans)).toEqual(identityPairs(moduleCarryPlans));
    expect(serializedModuleCarryPlans.map(({ bindingId, nextBindingId, nextSourceOrder }) =>
      JSON.stringify([bindingId, nextBindingId, nextSourceOrder])
    ).sort()).toEqual(moduleCarryPlans.map(({ bindingId, nextBindingId, nextSourceOrder }) =>
      JSON.stringify([bindingId, nextBindingId, nextSourceOrder])
    ).sort());

    const moduleInstances = moduleCarry.fixture.compiled?.doc.moduleSemanticAnalysis?.instances
      .filter((instance) => instance.name === "A" || instance.name === "B") ?? [];
    const loopForInstance = (name: string) => {
      const instance = moduleInstances.find((candidate) => candidate.name === name);
      if (!instance) throw new Error(`missing Module instance ${name}`);
      const loop = moduleCarry.fixture.elements.find((element) => element.type === "forGroup" &&
        moduleCarry.options.moduleMaterialization?.originByRuntimeElementId.get(element.id)?.instancePath.includes(instance.statementId));
      if (!loop || loop.type !== "forGroup") throw new Error(`missing materialized carry loop for ${name}`);
      return loop;
    };
    const moduleRowsFor = (result: ReturnType<typeof evaluationPayloadToResult>, loopId: string) =>
      result.forGroupGeneratedRows?.filter((row) => row.forGroupId === loopId && row.elementName.endsWith("Mark")) ?? [];
    const markCoordinates = (result: ReturnType<typeof evaluationPayloadToResult>, loopId: string) =>
      moduleRowsFor(result, loopId).map((row) => {
        const geometry = result.computedGeometry.get(row.generatedElementId);
        if (geometry?.kind !== "point") throw new Error("generated Module Mark must have point geometry");
        return [row.iterationIndex, geometry.x, geometry.y];
      });
    const loopA = loopForInstance("A");
    const loopB = loopForInstance("B");
    const carryForLoop = (loopId: string) => {
      const owner = moduleCarry.options.moduleForGroupExecutionOwnerByElementId?.get(loopId);
      if (!owner) throw new Error(`missing Module carry owner for ${loopId}`);
      const plan = moduleCarry.fixture.compiled?.doc.bindingVersions?.immutableForGroups?.get(owner.ownerStatementId);
      if (!plan?.carries[0]) throw new Error(`missing Module carry plan for ${loopId}`);
      return plan.carries[0];
    };
    const carryA = carryForLoop(loopA.id);
    const carryB = carryForLoop(loopB.id);
    for (const [loop, carry] of [[loopA, carryA], [loopB, carryB]] as const) {
      const projectedOwner = moduleCarry.options.moduleForGroupExecutionOwnerByElementId?.get(loop.id);
      if (!projectedOwner) throw new Error(`missing projected owner for ${loop.id}`);
      const graphOwner = moduleCarry.options.bindingVersions?.versions
        .flatMap((version) => version.control.ownerChain)
        .find((owner) => owner.kind === "forGroup" && owner.ownerStatementId === projectedOwner.ownerStatementId);
      const moduleGraphOwner = moduleCarry.options.bindingVersions?.moduleForGroupExecutionOwnersByStatementId?.get(projectedOwner.ownerStatementId);
      const plan = moduleCarry.options.bindingVersions?.immutableForGroups?.get(projectedOwner.ownerStatementId);
      if (!moduleGraphOwner || !plan?.executionOwner) throw new Error(`missing graph execution owner for ${loop.id}`);
      expect(projectedOwner).toMatchObject(moduleGraphOwner);
      if (graphOwner?.kind === "forGroup") expect(moduleGraphOwner).toMatchObject(graphOwner);
      expect(plan?.carries).toContainEqual(expect.objectContaining({ bindingId: carry.bindingId }));
      expect(carry.nextSourceOrder).toBeLessThan(plan.executionOwner.exitSourceOrder);
      expect(plan.executionOwner).toMatchObject({
        scopeId: moduleGraphOwner.scopeId,
        exitSourceOrder: moduleGraphOwner.exitSourceOrder,
        iterationBindingId: moduleGraphOwner.iterationBindingId
      });
    }
    const sourceCarry = moduleCarry.fixture.compiled?.doc.moduleSemanticAnalysis?.definitions
      .find((definition) => definition.name === "M")?.immutableCarries?.[0];
    if (!sourceCarry) throw new Error("missing canonical Module source carry");
    for (const [loop, carry] of [[loopA, carryA], [loopB, carryB]] as const) {
      const instancePath = moduleCarry.options.moduleMaterialization?.originByRuntimeElementId.get(loop.id)?.instancePath;
      if (!instancePath) throw new Error(`missing Module instance path for ${loop.id}`);
      expect(carry.bindingId).toBe(moduleCarryBindingIdFor(instancePath, sourceCarry.bindingId));
      expect(carry.nextBindingId).toBe(moduleCarryBindingIdFor(
        instancePath,
        `binding:next:${sourceCarry.statementId}:${sourceCarry.nextStatementIndex}`
      ));
    }
    expect(carryA.bindingId).not.toBe(carryB.bindingId);
    expect(carryA.nextBindingId).not.toBe(carryB.nextBindingId);
    for (const [result, payload] of [
      [moduleCarry.ts, moduleCarry.tsPayload],
      [moduleCarry.rust, moduleCarry.rustPayload]
    ] as const) {
      expect(result.errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(moduleCarry.fixture, payload, "resultA"), 8);
      expectScalarNumberClose(scalarBindingFor(moduleCarry.fixture, payload, "resultB"), 23);
      expect(markCoordinates(result, loopA.id)).toEqual([[0, 5, 0], [1, 5, 0], [2, 5, 0]]);
      expect(markCoordinates(result, loopB.id)).toEqual([[0, 20, 0], [1, 20, 0], [2, 20, 0]]);
    }

    const gated = await evaluateSource([
      "nui 1",
      "const items: number[] = [1, 2]",
      "for item in @items {",
      "  point Hidden = coordinate(x: 0, y: 0, visible: false)",
      "}"
    ].join("\n"));
    for (const result of [gated.ts, gated.rust]) {
      expect(result.errors).toEqual([]);
      const loop = gated.fixture.elements.find((element) => element.type === "forGroup")!;
      const hiddenRows = result.forGroupGeneratedRows?.filter((row) =>
        row.forGroupId === loop.id && row.elementName.endsWith("Hidden")
      ) ?? [];
      expect(hiddenRows).toHaveLength(2);
      expect(hiddenRows.every((row) => result.computedGeometry.has(row.generatedElementId))).toBe(true);
      expect(hiddenRows.some((row) => result.effectiveVisibleElementIds.has(row.generatedElementId))).toBe(false);
    }

    const nested = await evaluateSource([
      "nui 1",
      "const outerItems: number[] = [7, 8]",
      'const innerItems: string[] = ["a", "b"]',
      "for outer in @outerItems {",
      "  for inner in @innerItems {",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    for (const result of [nested.ts, nested.rust]) {
      expect(result.errors).toEqual([]);
      const markRows = result.forGroupGeneratedRows?.filter((row) => row.elementName.endsWith("Mark")) ?? [];
      expect(markRows).toHaveLength(4);
      expect(markRows.map((row) => row.iterationIndex)).toEqual([0, 1, 0, 1]);
      expect(markRows.every((row) => row.occurrencePath.length === 2)).toBe(true);
    }

    const moduleCollections = await evaluateSource([
      "nui 1",
      "module M(first: number, second: number, word: string) {",
      "  const numbers: number[] = [@first, @second]",
      "  const words: string[] = [@word, \"tail\"]",
      "  for item in @numbers {",
      "    const value: number = @item",
      "    point Mark = coordinate(x: @value, y: 0)",
      "  }",
      '  for item in @words {',
      '    text WordItem = label(text: "${@item}", anchor: none, size: 3)',
      "  }",
      "}",
      "instance First = M(first: 2, second: 4, word: \"a\")",
      "instance Second = M(first: 7, second: 9, word: \"x\")"
    ].join("\n"));
    const moduleAnalysis = moduleCollections.fixture.compiled?.doc.moduleSemanticAnalysis;
    const moduleOptions = optionsFor(moduleCollections.fixture);
    expect(isRustEligibleFixture(moduleCollections.fixture)).toBe(true);
    const moduleLoops = moduleCollections.fixture.elements.filter((element) => element.type === "forGroup");
    const moduleLoopFor = (instanceName: string, elementKind: "number" | "string") => {
      const instance = moduleAnalysis?.instances.find((candidate) => candidate.name === instanceName);
      const loop = moduleLoops.find((element) => element.type === "forGroup" &&
        element.iterationElementValueType?.kind === elementKind &&
        instance !== undefined && moduleOptions.moduleMaterialization?.originByRuntimeElementId.get(element.id)?.instancePath.includes(instance.statementId)
      );
      if (!loop || loop.type !== "forGroup") throw new Error(`missing ${elementKind} loop for Module instance ${instanceName}`);
      return loop;
    };
    const firstNumberLoop = moduleLoopFor("First", "number");
    const secondNumberLoop = moduleLoopFor("Second", "number");
    const firstStringLoop = moduleLoopFor("First", "string");
    const secondStringLoop = moduleLoopFor("Second", "string");
    expect([...moduleOptions.moduleForGroupExecutionOwnerByElementId!.keys()].sort()).toEqual(moduleLoops.map((loop) => loop.id).sort());
    for (const owner of moduleOptions.moduleForGroupExecutionOwnerByElementId!.values()) {
      const graphOwner = moduleOptions.bindingVersions?.versions
        .flatMap((version) => version.control.ownerChain)
        .find((candidate) => candidate.kind === "forGroup" && candidate.ownerStatementId === owner.ownerStatementId);
      const moduleGraphOwner = moduleOptions.bindingVersions?.moduleForGroupExecutionOwnersByStatementId?.get(owner.ownerStatementId);
      expect(moduleGraphOwner).toBeDefined();
      expect(moduleGraphOwner).toMatchObject({
        scopeId: owner.scopeId,
        exitSourceOrder: owner.exitSourceOrder,
        iterationBindingId: owner.iterationBindingId
      });
      if (graphOwner?.kind === "forGroup") expect(moduleGraphOwner).toMatchObject(graphOwner);
    }
    expect(new Set([firstNumberLoop.iterationSourceValueId, secondNumberLoop.iterationSourceValueId]).size).toBe(2);
    expect(new Set([firstStringLoop.iterationSourceValueId, secondStringLoop.iterationSourceValueId]).size).toBe(2);
    for (const result of [moduleCollections.ts, moduleCollections.rust]) {
      expect(result.errors).toEqual([]);
      const pointValues = (loopId: string) => (result.forGroupGeneratedRows ?? [])
        .filter((row) => row.forGroupId === loopId)
        .map((row) => result.computedGeometry.get(row.generatedElementId))
        .map((geometry) => {
          if (geometry?.kind !== "point") throw new Error("expected generated Module point geometry");
          return geometry.x;
        });
      const textValues = (loopId: string) => (result.forGroupGeneratedRows ?? [])
        .filter((row) => row.forGroupId === loopId)
        .map((row) => result.computedGeometry.get(row.generatedElementId))
        .map((geometry) => {
          if (geometry?.kind !== "text") throw new Error("expected generated Module text geometry");
          return geometry.text;
        });
      expect(pointValues(firstNumberLoop.id)).toEqual([2, 4]);
      expect(pointValues(secondNumberLoop.id)).toEqual([7, 9]);
      expect(textValues(firstStringLoop.id)).toEqual(["a", "tail"]);
      expect(textValues(secondStringLoop.id)).toEqual(["x", "tail"]);
    }

    const unavailableSource = await evaluateSource([
      "nui 1",
      "const controller: boolean = true",
      'const items: string[] = if (@controller) { @other } else { ["a"] }',
      "const other: string[] = @items",
      'for item in @items carry last: string = "seed" {',
      "  next last = @item",
      "}",
      "const result: string = @last"
    ].join("\n"));
    for (const result of [unavailableSource.ts, unavailableSource.rust]) {
      expect(result.errors.some((error) => error.message.includes("collection iteration source"))).toBe(true);
      expect(result.errors.every((error) => !error.message.includes("min は max 以下"))).toBe(true);
    }

    const unavailableMember = await evaluateSource([
      "nui 1",
      "point Seed = coordinate(x: 0, y: 0)",
      "point Missing = coordinate(x: 10, y: 0, enabled: false)",
      "const items: point[] = [@Missing]",
      "for item in @items carry cursor: point = @Seed {",
      "  next cursor = @item",
      "}",
      "const result: number = @cursor.x"
    ].join("\n"));
    for (const result of [unavailableMember.ts, unavailableMember.rust]) {
      const payload = result === unavailableMember.ts
        ? unavailableMember.tsPayload
        : unavailableMember.rustPayload;
      expect(runtimeDiagnosticsFor(unavailableMember.fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "evaluation-geometry-property-unavailable", origin: "runtime" })
      ]));
      expect(result.errors.some((error) => error.message.includes("collection iteration source"))).toBe(false);
      expect(result.errors.every((error) => !error.message.includes("min は max 以下"))).toBe(true);
    }
  }, 30000);

  it("uses the materialized runtime position for Module geometry-property reads", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-value-module-runtime-order.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const use = fixture.elements.find((element) => element.name === "Use")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(use.id)).toMatchObject({
        kind: "line",
        start: { x: 7, y: 42 },
        end: { x: 0, y: 42 }
      });
    }
  }, 30000);

  it("evaluates Module-local pure point consumers across the persistent Rust stdio boundary", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  const v: point = coordinate(x: 3, y: 4)",
      "  point Probe = offset(from: @v, dx: 1, dy: 2)",
      "}",
      "instance i = M()"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    const tsDiagnostics = {
      errors: tsResult.errors,
      warnings: tsResult.warnings,
      geometryValueErrors: tsResult.geometryValueErrors ?? [],
      runtime: runtimeDiagnosticsFor(fixture, tsPayload)
    };
    const rustDiagnostics = {
      errors: rustResult.errors,
      warnings: rustResult.warnings,
      geometryValueErrors: rustResult.geometryValueErrors ?? [],
      runtime: runtimeDiagnosticsFor(fixture, rustPayload)
    };
    expect(normalizeParityPayload(rustDiagnostics)).toEqual(normalizeParityPayload(tsDiagnostics));
    expect(rustDiagnostics.errors).toEqual([]);
    expect(rustDiagnostics.geometryValueErrors).toEqual([]);

    const probe = fixture.elements.find((element) => element.name === "Probe");
    if (!probe) throw new Error("missing materialized Probe point");
    for (const result of [tsResult, rustResult]) {
      expect(result.computedGeometry.get(probe.id)).toMatchObject({ kind: "point", x: 4, y: 6 });
    }
  }, 30000);

  it("uses the discriminated geometry input target for immutable segment consumers", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-value-segment-consumer.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Tangent")!.id)).toMatchObject({ kind: "point" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Division")!.id)).toMatchObject({ kind: "point" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Transform")!.id)).toMatchObject({ kind: "offsetLine" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Mirror")!.id)).toMatchObject({ kind: "offsetLine" });
    }
  }, 30000);

  it("evaluates Label, Bare, and Boolean through the Rust-first declarations/templates fixture", () => {
    const fixture = readParityFixture(repoRoot, "nui1-declarations-templates.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const label = fixture.elements.find((element) => element.type === "text" && element.name === "Label")!;
    const bare = fixture.elements.find((element) => element.type === "text" && element.name === "Bare")!;
    const boolean = fixture.elements.find((element) => element.type === "text" && element.name === "Boolean")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.errors.filter((error) => [label.id, bare.id, boolean.id].includes(error.elementId))).toEqual([]);
      expect(result.computedGeometry.get(label.id)).toMatchObject({ kind: "text", text: "{draft} 前身頃 12.346\n" });
      expect(result.computedGeometry.get(bare.id)).toMatchObject({ kind: "text", text: "前身頃" });
      expect(result.computedGeometry.get(boolean.id)).toMatchObject({ kind: "text", text: "true false true true" });
    }
  }, 30000);

  it("evaluates reference-free boolean templates through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-reference-free-boolean-template.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const booleanLiteral = fixture.elements.find((element) => element.type === "text" && element.name === "BooleanLiteral")!;
    const booleanCall = fixture.elements.find((element) => element.type === "text" && element.name === "BooleanCall")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(booleanLiteral.id)).toMatchObject({ kind: "text", text: "false" });
      expect(result.computedGeometry.get(booleanCall.id)).toMatchObject({ kind: "text", text: "true" });
    }
  }, 30000);

  it("keeps tangentOffset curveSide literal, choice binding, and pathReverse parity", () => {
    const fixture = readParityFixture(repoRoot, "nui1-tangent-offset-curve-side.nui");
    const options = optionsFor(fixture);
    const ts = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options));
    const rust = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(rust.errors).toEqual(ts.errors);
    for (const name of ["Convex", "Concave", "Bound", "ReverseConvex"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "point" });
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset points");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
    const convex = fixture.elements.find((candidate) => candidate.name === "Convex")!;
    const concave = fixture.elements.find((candidate) => candidate.name === "Concave")!;
    const reverseConvex = fixture.elements.find((candidate) => candidate.name === "ReverseConvex")!;
    for (const [element, x, y] of [[convex, 5, 8.5], [concave, 5, 6.5], [reverseConvex, 5, 8.5]] as const) {
      const geometry = ts.computedGeometry.get(element.id);
      expect(geometry).toMatchObject({ kind: "point" });
      if (geometry?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(geometry.x).toBeCloseTo(x, 10);
      expect(geometry.y).toBeCloseTo(y, 10);
    }

    for (const name of ["Split", "TrimCurve", "ExtendCurve"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
      expect(rust.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
    }
    for (const name of ["SplitOffset", "TrimOffset", "ExtendOffset"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(tsPoint).toMatchObject({ kind: "point" });
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
  }, 30000);

  it("matches TS/Rust for selected Drawing Profile style deltas and disabled state", () => {
    const fixture = readParityFixture(repoRoot, "nui1-drawing-modifier-profiles.nui");
    const profile = fixture.compiled?.doc.document.drawingProfiles?.find((candidate) => candidate.name === "Print");
    if (!profile) throw new Error("Print Drawing Profile was not compiled");
    const options = optionsFor(fixture, profile.id);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture, profile.id);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const styled = fixture.elements.find((element) => element.name === "Styled");
    const disabled = fixture.elements.find((element) => element.name === "Disabled");
    const dependent = fixture.elements.find((element) => element.name === "Dependent");

    expect(isRustEligibleFixture(fixture, profile.id)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.effectiveDrawingModifierStrokes?.get(styled!.id)).toEqual({
      widthPx: 0.5,
      style: "dashed",
      color: { kind: "themeRole", role: "warning" }
    });
    expect(rust.effectiveDrawingModifierStrokes?.get(styled!.id)).toEqual(
      ts.effectiveDrawingModifierStrokes?.get(styled!.id)
    );
    expect(ts.effectiveVisibleElementIds).not.toContain(disabled!.id);
    expect(ts.effectiveEnabledElementIds).not.toContain(disabled!.id);
    expect(ts.computedGeometry.has(disabled!.id)).toBe(false);
    expect(ts.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: dependent!.id, missingDependencyId: disabled!.id })
    ]));
    expect(rust.effectiveVisibleElementIds).not.toContain(disabled!.id);
    expect(rust.effectiveEnabledElementIds).not.toContain(disabled!.id);
    expect(rust.computedGeometry.has(disabled!.id)).toBe(false);
  }, 30000);

  it("asserts nui1 builtin scalar values and runtime errors in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "absValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "minValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
      expect(scalarBindingFor(fixture, payload, "maxValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 20 } });
      expect(scalarBindingFor(fixture, payload, "sqrtValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "roundPositive")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "roundNegative")).toMatchObject({ status: "ok", value: { kind: "number", value: -2 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimalCoefficientBoundary")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 9484088218495944 }
      });
      expect(scalarBindingFor(fixture, payload, "roundCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "floorDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.34 } });
      expect(scalarBindingFor(fixture, payload, "floorCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "ceilDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "ceilCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1300 } });
      expect(scalarBindingFor(fixture, payload, "roundToValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.5 } });
      expect(scalarBindingFor(fixture, payload, "roundToNonFiniteResult")).toMatchObject({
        status: "error",
        issueCode: "evaluation-non-finite-result"
      });
      expect(scalarBindingFor(fixture, payload, "closeValue")).toMatchObject({ status: "ok", value: { kind: "boolean", value: true } });
      expect(scalarBindingFor(fixture, payload, "nestedValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "referenceArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "geometryArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "sqrtInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-sqrt-negative-input"
      });
      expect(scalarBindingFor(fixture, payload, "roundToInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-round-to-non-positive-step"
      });
      expect(scalarBindingFor(fixture, payload, "closeInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-is-close-negative-tolerance"
      });
      const offset = fixture.elements.find((element) => element.name === "BuiltinOffset")!;
      const template = fixture.elements.find((element) => element.name === "BuiltinTemplate")!;
      const evaluated = evaluationPayloadToResult(payload);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id || error.elementId === template.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "丸め=10" });
    }
  }, 30000);

  it("asserts the canonical pi number literal through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-builtin-constant-pi.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const piBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "piValue");
    expect(fixture.compiled?.doc.scalarProgram?.statements.find((statement) => statement.bindingId === piBinding?.id)?.declaration.initializer).toMatchObject({
      kind: "numberLiteral",
      value: Math.PI
    });
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piValue"), Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piScaled"), 2 * Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piRadius"), 6 * Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "builtinPiWithUserBinding"), Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "explicitUserPi"), 2);
      expect(scalarBindingFor(fixture, payload, "piComparison")).toMatchObject({
        status: "ok",
        value: { kind: "boolean", value: true }
      });
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piMutable"), Math.PI);
      const evaluated = evaluationPayloadToResult(payload);
      const point = fixture.elements.find((element) => element.name === "PiPoint")!;
      const template = fixture.elements.find((element) => element.name === "PiTemplate")!;
      expect(evaluated.errors.filter((error) => error.elementId === point.id || error.elementId === template.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: Math.PI, y: 2 * Math.PI });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "円周率=3.142" });
    }
  }, 30000);

  it("asserts public choice geometry properties through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-choice-geometry-properties.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "direction")).toEqual({
        status: "ok",
        type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
        value: { kind: "choice", options: ["counterclockwise", "clockwise"], value: "clockwise" }
      });
      expect(scalarBindingFor(fixture, payload, "isClockwise")).toMatchObject({
        status: "ok",
        value: { kind: "boolean", value: true }
      });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts current intermediate Bezier handle properties through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-bezier-intermediate-handle-properties.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "incomingAngle"), 225);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "incomingLength"), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "outgoingAngle"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "outgoingLength"), 4);
    }
  }, 30000);

  it("asserts nui1 trigonometric scalar, geometry, module, and text values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-trigonometric-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["sin30", 0.5], ["cos60", 0.5], ["tan45", 1],
        ["asinHalf", 30], ["acosHalf", 60], ["atanOne", 45],
        ["atan2Right", 0], ["atan2Up", 90], ["atan2Left", 180], ["atan2Down", 270],
        ["atan2Diagonal", 45], ["atan2Zero", 0], ["nestedTrig", 30], ["referenceTrig", -1]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      for (const name of ["tanInvalid90", "tanInvalid270", "tanInvalidNegative90"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-tan-odd-multiple-of-90"
        });
      }
      for (const name of ["asinInvalidLow", "asinInvalidHigh"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({ status: "error", issueCode: "evaluation-asin-out-of-range" });
      }
      for (const name of ["acosInvalidLow", "acosInvalidHigh"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({ status: "error", issueCode: "evaluation-acos-out-of-range" });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const offset = fixture.elements.find((element) => element.name === "TrigOffset")!;
      const template = fixture.elements.find((element) => element.name === "TrigTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      expect(evaluated.computedGeometry.get(origin.id)).toMatchObject({ kind: "point" });
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(0.5, 10);
      expect(originGeometry.y).toBeCloseTo(0.5, 10);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "sin30=0.5" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      expect(moduleGeometry).toMatchObject({ kind: "point", y: 0 });
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(0.5, 10);

    }
  }, 30000);

  it("asserts nui1 spreadAngle named arguments, domains, module, and text values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-spread-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const expected = 11.4783409545;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const name of ["spreadBasic", "spreadReversed", "spreadReferences", "spreadComputed"] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      expect(scalarBindingFor(fixture, payload, "spreadZero")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "spreadStraight")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      for (const name of [
        "spreadInvalidLengthZero",
        "spreadInvalidLengthNegative",
        "spreadInvalidNegative",
        "spreadInvalidTooLarge"
      ] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-invalid-builtin-argument"
        });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const template = fixture.elements.find((element) => element.name === "SpreadTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(expected, 10);
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "angle=11.478" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(expected, 10);

    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts nui1 geometry builtin values and mutation through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "distanceFive")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceZero")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceTen")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 10 }
      });
      expect(scalarBindingFor(fixture, payload, "disabledDistance")).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-builtin-disabled"
      });
      expect(scalarBindingFor(fixture, payload, "derivedDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 7 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedAngle")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 135 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedLineDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "angleRight")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "angleUp")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "angleLeft")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "angleDown")).toMatchObject({ status: "ok", value: { kind: "number", value: 270 } });
      expect(scalarBindingFor(fixture, payload, "angleDiagonal")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "angleSame")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "lineDistanceHorizontal")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 3 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceVertical")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      const diagonal = scalarBindingFor(fixture, payload, "lineDistanceDiagonal");
      expect(diagonal?.status).toBe("ok");
      if (diagonal?.status !== "ok" || diagonal.value.kind !== "number") {
        throw new Error("lineDistanceDiagonal must be a numeric success");
      }
      expect(diagonal.value.value).toBeCloseTo(Math.SQRT2, 12);
      expect(scalarBindingFor(fixture, payload, "lineDistanceOnLine")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceZero")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
      expect(scalarBindingFor(fixture, payload, "mutationValue")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "evaluation-geometry-builtin-disabled",
          message: "「Disabled」は評価OFFのためgeometry引数として利用できません。評価ONにするか、参照先を変更してください。",
          origin: "runtime"
        })
      ]));
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts lineAngle semantics and errors through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-line-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "parallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "diagonal45"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "perpendicular"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reversedParallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "directed135"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "spatiallySeparated"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseFirst"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseSecond"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "swapped"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "polarAngle"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "setValue"), 90);
      expect(scalarBindingFor(fixture, payload, "zeroFirst")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
      expect(scalarBindingFor(fixture, payload, "zeroSecond")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("matches optional value-if, optional match, coalescing, and choice control flow", () => {
    const fixture = readParityFixture(repoRoot, "nui1-optional-value-control-flow.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "missing")).toMatchObject({ status: "ok", value: { kind: "none" } });
      expect(scalarBindingFor(fixture, payload, "selected")).toMatchObject({ status: "ok", value: { kind: "string", value: "hello" } });
      expect(scalarBindingFor(fixture, payload, "resolved")).toMatchObject({ status: "ok", value: { kind: "string", value: "fallback" } });
      expect(scalarBindingFor(fixture, payload, "matched")).toMatchObject({ status: "ok", value: { kind: "string", value: "hello" } });
      expect(scalarBindingFor(fixture, payload, "choiceResult")).toMatchObject({ status: "ok", value: { kind: "string", value: "left" } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("resolves inline optional match binders in numeric geometry inputs through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const amount: number? = 2",
      "const absent: number? = none",
      "const heldNumber: number = match @amount { none => 0 some selectedValue => @selectedValue }",
      "point Direct = coordinate(x: match @amount { none => 0 some mm => @mm }, y: 0)",
      "point NoneCase = coordinate(x: match @absent { none => 9 some elementCount => @elementCount }, y: 0)",
      "point Intermediate = coordinate(x: @heldNumber, y: 0)",
      "point Lazy = coordinate(x: match @absent { none => 11 some neverSelected => @neverSelected / 0 }, y: 0)",
      "point Anchor = coordinate(x: 1, y: 2)",
      "point Translated = offset(from: @Anchor, dx: match @amount { none => 0 some shiftAmount => @shiftAmount }, dy: 1)"
    ].join("\n"));
    const doc = fixture.compiled!.doc;
    expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const numericBindingFor = (statementName: string, parameterKey: string) => {
      const statementIndex = doc.statements.findIndex((statement) => statement.name === statementName);
      if (statementIndex < 0) throw new Error(`statement "${statementName}" not found`);
      return doc.numericBindings?.get(propertyBindingOccurrenceKey(statementIndex, parameterKey));
    };
    expect(numericBindingFor("Direct", "x")?.references.map((reference) => reference.name)).toEqual(["amount"]);
    expect(numericBindingFor("NoneCase", "x")?.references.map((reference) => reference.name)).toEqual(["absent"]);
    expect(numericBindingFor("Lazy", "x")?.references.map((reference) => reference.name)).toEqual(["absent"]);
    expect(numericBindingFor("Translated", "dx")?.references.map((reference) => reference.name)).toEqual(["amount"]);
    expect(numericBindingFor("Direct", "x")?.typedExpression).toBeDefined();

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      for (const [name, point] of [
        ["Direct", { x: 2, y: 0 }],
        ["NoneCase", { x: 9, y: 0 }],
        ["Intermediate", { x: 2, y: 0 }],
        ["Lazy", { x: 11, y: 0 }],
        ["Translated", { x: 3, y: 3 }]
      ] as const) {
        const element = fixture.elements.find((candidate) => candidate.name === name)!;
        expect(result.computedGeometry.get(element.id)).toMatchObject({ kind: "point", ...point });
      }
    }

    const unresolved = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "const amount: number? = 2",
      "point Invalid = coordinate(x: @missing + match @amount { none => 0 some payload => @payload }, y: 0)"
    ].join("\n"));
    const unresolvedDiagnostics = unresolved.diagnostics.filter((diagnostic) =>
      diagnostic.code === "numeric-binding-unresolved"
    );
    expect(unresolvedDiagnostics).toHaveLength(1);
    expect(unresolvedDiagnostics[0]).toMatchObject({
      presentation: { key: "diagnostic.numeric-binding-unresolved", parameters: { name: "missing" } }
    });
  }, 30000);

  it("asserts module geometry builtin lowering values and parity through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "radius")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "direction")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "height")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "lineAngleValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "localDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarBindingFor(fixture, payload, "parameterStartDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "parameterEndAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "localEndpointLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "measured")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "rootLineAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("matches direct qualified Module scalar geometry inputs through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module M() {",
      "  export const value: number = 2",
      "}",
      "instance I = M()",
      "point Origin = coordinate(x: 0, y: 0)",
      "point Use = coordinate(x: @I::value, y: 0)",
      "point Shifted = offset(from: @Origin, dx: @I::value, dy: 3)"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const use = fixture.elements.find((element) => element.name === "Use")!;
    const shifted = fixture.elements.find((element) => element.name === "Shifted")!;

    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(ts.computedGeometry.get(use.id)).toMatchObject({ kind: "point", x: 2, y: 0 });
    expect(rust.computedGeometry.get(use.id)).toMatchObject({ kind: "point", x: 2, y: 0 });
    expect(ts.computedGeometry.get(shifted.id)).toMatchObject({ kind: "point", x: 2, y: 3 });
    expect(rust.computedGeometry.get(shifted.id)).toMatchObject({ kind: "point", x: 2, y: 3 });
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("preserves a Module-forwarded selected line stage for onLine through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L(from: (0, 0), to: (0, 10))",
      "module M(g: line) {",
      "  point P = onLine(from: @g.start, ratio: 0.5)",
      "}",
      "instance Base = M(g: @L.base)",
      "instance Final = M(g: @L.final)"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const child = (parentName: string, name: string) => {
      const parent = fixture.elements.find((element) => element.name === parentName);
      if (!parent) throw new Error(`missing instance ${parentName}`);
      const element = fixture.elements.find((candidate) =>
        candidate.name === name && candidate.parentGroupId === parent.id
      );
      if (!element) throw new Error(`missing ${parentName}::${name}`);
      return element;
    };

    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(child("Base", "P").id)).toMatchObject({ kind: "point", x: 10, y: 0 });
      expect(result.computedGeometry.get(child("Final", "P").id)).toMatchObject({ kind: "point", x: 10, y: 10 });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("matches immutable Module-local line and path endpoints through persistent Rust stdio", async () => {
    const cases = [
      {
        source: [
          "nui 1",
          "module M() {",
          "  line Use = segment(start: @L.start, end: @L.end)",
          "  const L: line = segment(start: (11, 23), end: (41, 63))",
          "}",
          "instance I = M()"
        ].join("\n")
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  const L: line = segment(start: (11, 23), end: (41, 63))",
          "  line Use = segment(start: @L.start, end: @L.end)",
          "}",
          "instance I = M()"
        ].join("\n")
      },
      {
        source: [
          "nui 1",
          "module M() {",
          "  line Use = segment(start: @L.start, end: @L.end)",
          "  const L: path = polyline(points: [(11, 23), (41, 63)], closed: false)",
          "}",
          "instance I = M()"
        ].join("\n")
      }
    ] as const;

    for (const { source } of cases) {
      const fixture = fixtureFromSource(source);
      const options = optionsFor(fixture);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
      const ts = evaluationPayloadToResult(tsPayload);
      const rust = evaluationPayloadToResult(rustPayload);
      const use = fixture.elements.find((element) => element.name === "Use");

      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.code === "undefined-geometry-reference")).toEqual([]);
      expect(isRustEligibleFixture(fixture)).toBe(true);
      expect(ts.errors).toEqual([]);
      expect(rust.errors).toEqual([]);
      expect(use).toBeDefined();
      for (const result of [ts, rust]) {
        expect(result.computedGeometry.get(use!.id)).toMatchObject({
          kind: "line",
          start: { x: 11, y: 23 },
          end: { x: 41, y: 63 },
          length: 50
        });
      }
      expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    }
  }, 30000);

  it("asserts the Module numeric geometry builtin through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-numeric-geometry-builtin.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    const modulePoint = fixture.elements.find((element) => element.name === "Q");

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(tsResult.errors).toEqual([]);
    expect(rustResult.errors).toEqual([]);
    expect(modulePoint).toBeDefined();
    expect(tsResult.computedGeometry.get(modulePoint!.id)).toMatchObject({ kind: "point", x: 7, y: 4 });
    expect(rustResult.computedGeometry.get(modulePoint!.id)).toMatchObject({ kind: "point", x: 7, y: 4 });
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "moduleCheck"), 0);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "moduleCheck"), 0);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts root immutable geometry builtin resolution with an unrelated module through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-root-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "distanceValue"), 5);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "angleValue"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineDistanceValue"), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineAngleValue"), 90);
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("runs scalar, collection, and geometry immutable carries through the Rust boundary", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 2, y: 0)",
      "const numsA: number[] = [1, 2]",
      "const numsB: number[] = [3, 4]",
      "const points: point[] = [@A, @B]",
      "for i in range(min: 0, max: 1, step: 1) carry a: number[] = @numsA carry b: number[] = @numsB carry cursor: point = @A carry path: point[] = @points {",
      "  line Edge = segment(start: @cursor, end: @B)",
      "  next a = @b",
      "  next b = @a",
      "  next cursor = @Edge.end",
      "  next path = @path",
      "}",
      "const swapped: number = @a[0] + @b[1]",
      "const cursorX: number = @cursor.x",
      "const pointCount: number = @path.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "swapped"), 5);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "swapped"), 5);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "cursorX"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "cursorX"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "pointCount"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "pointCount"), 2);
  }, 30000);

  it("runs generalized-record immutable carries through the Rust boundary", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 3, y: 4)",
      "line Edge = segment(start: (0, 0), end: (10, 0))",
      "record Metadata(label: string)",
      "record Piece(count: number, edge: line, points: point[], metadata: Metadata)",
      'const first: Piece = Piece(count: 1, edge: @Edge, points: [@A], metadata: Metadata(label: "ok"))',
      "for i in range(min: 0, max: 0, step: 1) carry last: Piece = @first {",
      '  next last = Piece(count: @last.count + 1, edge: @last.edge, points: @last.points, metadata: @last.metadata)',
      "}",
      "const count: number = @last.count",
      "const pointCount: number = @last.points.length",
      "const edgeLength: number = @last.edge.length",
      "const label: string = @last.metadata.label"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "count"), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "pointCount"), 1);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "edgeLength"), 10);
      const labelBinding = fixture.compiled?.doc?.bindingAnalysis?.catalog.bindings.find(
        (candidate) => candidate.kind === "typed" && candidate.name === "label"
      );
      const label = labelBinding
        ? evaluationPayloadToResult(payload).computedScalarBindings?.get(labelBinding.id)
        : undefined;
      expect(label).toMatchObject({ status: "ok", value: { kind: "string", value: "ok" } });
    }
  }, 30000);

  it("resolves Module collection-valued record field lengths through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Box(xs: number[], ys: number[])",
      "module Example(input: Box) {",
      "  const empty: Box = Box(xs: [], ys: [])",
      "  const one: Box = Box(xs: [7], ys: [8])",
      "  const two: Box = Box(xs: [7, 13], ys: [2, 4])",
      "  const three: Box = Box(xs: [7, 13, 19], ys: [3, 5, 7])",
      "  const alias: Box = @two",
      "  const boxes: Box[] = [@two, @three]",
      "  const selectedFieldLength: number = @boxes[1].xs.length",
      "  const emptyLength: number = @empty.xs.length",
      "  const oneLength: number = @one.xs.length",
      "  const twoLength: number = @two.xs.length",
      "  const threeLength: number = @three.xs.length",
      "  const aliasLength: number = @alias.xs.length",
      "  const twoFieldLength: number = @two.ys.length",
      "  const threeFieldLength: number = @three.ys.length",
      "  const inputLength: number = @input.xs.length",
      "  const ordinary: number[] = [1, 2, 3]",
      "  const ordinaryLength: number = @ordinary.length",
      "}",
      "instance Use = Example(input: Box(xs: [17, 19, 23, 29], ys: [1]))"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["emptyLength", 0],
        ["oneLength", 1],
        ["twoLength", 2],
        ["threeLength", 3],
        ["aliasLength", 2],
        ["selectedFieldLength", 3],
        ["twoFieldLength", 2],
        ["threeFieldLength", 3],
        ["inputLength", 4],
        ["ordinaryLength", 3]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("matches qualified Module exported record collection fields through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(amount: number, xs: number[])",
      "module M() {",
      "  export const output: Bundle = Bundle(amount: 3, xs: [5, 11])",
      "}",
      "module Direct(start: number, xs: number[]) {",
      "  export const output: Bundle = Bundle(amount: @start, xs: @xs)",
      "  export const ordinary: number[] = [1, 2]",
      "}",
      "module Alias(start: number, xs: number[]) {",
      "  const local: Bundle = Bundle(amount: @start, xs: @xs)",
      "  export const output: Bundle = @local",
      "}",
      "instance Use = M()",
      "instance A = Direct(start: 5, xs: [5, 11])",
      "instance B = Direct(start: 17, xs: [17, 19])",
      "instance AliasUse = Alias(start: 29, xs: [29, 31])",
      "const reducedFirst: number = @Use::output.xs[0]",
      "const reducedSecond: number = @Use::output.xs[1]",
      "const reducedLength: number = @Use::output.xs.length",
      "const first: number = @A::output.xs[0]",
      "const second: number = @A::output.xs[1]",
      "const length: number = @A::output.xs.length",
      "const otherFirst: number = @B::output.xs[0]",
      "const otherLength: number = @B::output.xs.length",
      "const aliasFirst: number = @AliasUse::output.xs[0]",
      "const aliasLength: number = @AliasUse::output.xs.length",
      "const directScalar: number = @A::output.amount",
      "const ordinaryExportIndex: number = @A::ordinary[1]",
      "const ordinaryExportLength: number = @A::ordinary.length",
      "const outOfRange: number = @A::output.xs[4]"
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    // Constructing this input exercises the unchanged Rust payload validator
    // with the canonical field-contents collection IDs and producer nodes.
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const rustCollections = rustInput.scalarProgram?.collectionValues ?? rustInput.bindingVersions?.collectionValues ?? [];
    const rustCollectionIds = new Set(rustCollections.map((collection) => collection.valueId));
    const compiledDoc = fixture.compiled!.doc;
    const initializerFor = (name: string) => {
      const binding = compiledDoc.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === name);
      return compiledDoc.scalarProgram?.statements.find((statement) => statement.bindingId === binding?.id)?.declaration.initializer;
    };
    for (const name of ["reducedFirst", "reducedSecond", "first", "second", "otherFirst", "aliasFirst", "outOfRange"]) {
      const initializer = initializerFor(name);
      expect(initializer?.kind).toBe("collectionIndex");
      if (initializer?.kind !== "collectionIndex") throw new Error(`expected ${name} to lower to a collection index`);
      expect(initializer.collectionValueId).toMatch(/^record-field-contents:/);
      expect(rustCollectionIds.has(initializer.collectionValueId!)).toBe(true);
      expect(Number.isInteger(initializer.targetSourceOrder)).toBe(true);
      expect(initializer.targetSourceOrder).toBeGreaterThanOrEqual(0);
    }
    for (const name of ["reducedLength", "length", "otherLength", "aliasLength"]) {
      const initializer = initializerFor(name);
      expect(initializer?.kind).toBe("geometryProperty");
      if (initializer?.kind !== "geometryProperty") throw new Error(`expected ${name} to lower to collection length`);
      expect(initializer.collectionValueId).toMatch(/^record-field-contents:/);
      expect(rustCollectionIds.has(initializer.collectionValueId!)).toBe(true);
      expect(Number.isInteger(initializer.targetSourceOrder)).toBe(true);
      expect(initializer.targetSourceOrder).toBeGreaterThanOrEqual(0);
    }
    for (const [indexName, lengthName] of [
      ["reducedFirst", "reducedLength"],
      ["first", "length"],
      ["otherFirst", "otherLength"],
      ["aliasFirst", "aliasLength"]
    ] as const) {
      expect(initializerFor(indexName)?.targetSourceOrder).toBe(initializerFor(lengthName)?.targetSourceOrder);
    }

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["reducedFirst", 5],
        ["reducedSecond", 11],
        ["reducedLength", 2],
        ["first", 5],
        ["second", 11],
        ["length", 2],
        ["otherFirst", 17],
        ["otherLength", 2],
        ["aliasFirst", 29],
        ["aliasLength", 2],
        ["directScalar", 5],
        ["ordinaryExportIndex", 2],
        ["ordinaryExportLength", 2]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      expect(scalarBindingFor(fixture, payload, "outOfRange")).toMatchObject({
        status: "error",
        issueCode: "evaluation-collection-index-invalid"
      });
    }
  }, 30000);

  it("matches chained indexed record-field collections through persistent Rust stdio", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Bundle(xs: number[])",
      "const source: Bundle = Bundle(xs: [3, 5])",
      "const values: Bundle[] = [@source]",
      "const rootFirst: number = @values[0].xs[0]",
      "const rootSecond: number = @values[0].xs[1]",
      "module M(items: Bundle[]) {",
      "  const mapped: Bundle[] = for item in @items { @item }",
      "  const recordIndex: number = 0",
      "  const fieldIndex: number = 1",
      "  export const first: number = @mapped[0].xs[0]",
      "  export const second: number = @mapped[0].xs[1]",
      "  export const ordinaryFirst: number = @items[0].xs[0]",
      "  export const ordinarySecond: number = @items[0].xs[1]",
      "  export const dynamic: number = @items[@recordIndex].xs[@fieldIndex]",
      "}",
      "instance Use = M(items: @values)",
      "const rootFirstResult: number = @rootFirst",
      "const rootSecondResult: number = @rootSecond",
      "const firstResult: number = @Use::first",
      "const secondResult: number = @Use::second",
      "const ordinaryFirstResult: number = @Use::ordinaryFirst",
      "const ordinarySecondResult: number = @Use::ordinarySecond",
      "const dynamicResult: number = @Use::dynamic"
    ].join("\n"));
    const diagnostics = fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error") ?? [];
    expect(diagnostics).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const collectionValues = fixture.compiled!.doc.scalarProgram?.collectionValues ?? [];
    const fieldIndexes = fixture.compiled!.doc.scalarProgram?.statements.flatMap((statement) => {
      const initializer = statement.declaration.initializer;
      return initializer.kind === "collectionIndex" && initializer.collectionValueId?.startsWith("record-field-contents:")
        ? [initializer]
        : [];
    }) ?? [];
    expect(fieldIndexes).toHaveLength(7);
    expect(fieldIndexes.every((initializer) => collectionValues.some((value) => value.valueId === initializer.collectionValueId))).toBe(true);
    expect(fieldIndexes.map((initializer) => initializer.collectionValueId?.startsWith("record-field-contents:"))).toEqual(Array(7).fill(true));

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const rustCollectionValues = rustInput.scalarProgram?.collectionValues ?? rustInput.bindingVersions?.collectionValues ?? [];
    expect(rustCollectionValues).toEqual(collectionValues);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["rootFirstResult", 3],
        ["rootSecondResult", 5],
        ["firstResult", 3],
        ["secondResult", 5],
        ["ordinaryFirstResult", 3],
        ["ordinarySecondResult", 5],
        ["dynamicResult", 5]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
    }
  }, 30000);

  it("matches collection-valued fields selected from Module record maps through persistent Rust stdio", async () => {
    const source = [
      "nui 1",
      "record Bundle(amount: number, label: string, xs: number[])",
      'const empty: Bundle = Bundle(amount: 0, label: "empty", xs: [])',
      'const one: Bundle = Bundle(amount: 1, label: "one", xs: [7])',
      'const multi: Bundle = Bundle(amount: 2, label: "multi", xs: [3, 5])',
      'const otherFirst: Bundle = Bundle(amount: 7, label: "other first", xs: [19])',
      'const otherSecond: Bundle = Bundle(amount: 8, label: "other second", xs: [23, 29])',
      'const other: Bundle = Bundle(amount: 9, label: "other", xs: [11, 13, 17])',
      "const inputA: Bundle[] = [@empty, @one, @multi]",
      "const inputB: Bundle[] = [@otherFirst, @otherSecond, @other]",
      "const rootMapped: Bundle[] = for item in @inputA { @item }",
      "const rootSelected: Bundle = @rootMapped[2]",
      "const rootAmount: number = @rootSelected.amount",
      "const rootLabel: string = @rootSelected.label",
      "module Mapper(items: Bundle[]) {",
      "  const mapped: Bundle[] = for item in @items { @item }",
      "  const transformed: Bundle[] = for item in @items { Bundle(amount: @item.amount + 10, label: @item.label, xs: [31]) }",
      "  const emptyLengthValue: number = @mapped[0].xs.length",
      "  const oneLengthValue: number = @mapped[1].xs.length",
      "  const multiLengthValue: number = @mapped[2].xs.length",
      "  const transformedLengthValue: number = @transformed[2].xs.length",
      "  export const selectedAmount: number = @mapped[2].amount",
      "  export const selectedLabel: string = @mapped[2].label",
      "  export const emptyLength: number = @emptyLengthValue",
      "  export const oneLength: number = @oneLengthValue",
      "  export const multiLength: number = @multiLengthValue",
      "  export const transformedAmount: number = @transformed[2].amount",
      "  export const transformedLabel: string = @transformed[2].label",
      "  export const transformedLength: number = @transformedLengthValue",
      "}",
      "instance A = Mapper(items: @inputA)",
      "instance B = Mapper(items: @inputB)",
      "const aAmount: number = @A::selectedAmount",
      "const aLabel: string = @A::selectedLabel",
      "const aEmptyLength: number = @A::emptyLength",
      "const aOneLength: number = @A::oneLength",
      "const aMultiLength: number = @A::multiLength",
      "const aTransformedAmount: number = @A::transformedAmount",
      "const aTransformedLabel: string = @A::transformedLabel",
      "const aTransformedLength: number = @A::transformedLength",
      "const bMultiLength: number = @B::multiLength",
    ].join("\n");
    const fixture = fixtureFromSource(source);
    const repeated = fixtureFromSource(source);
    const options = optionsFor(fixture);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);

    const collectionValues = fixture.compiled!.doc.scalarProgram?.collectionValues ?? [];
    const repeatedCollectionValues = repeated.compiled!.doc.scalarProgram?.collectionValues ?? [];
    const recordMaps = collectionValues.filter((value) => value.kind === "recordMap");
    const repeatedRecordMaps = repeatedCollectionValues.filter((value) => value.kind === "recordMap");
    expect(recordMaps).toHaveLength(5);
    expect(recordMaps.map(({ sourceOrder }) => sourceOrder)).toEqual(
      repeatedRecordMaps.map(({ sourceOrder }) => sourceOrder)
    );
    expect(recordMaps.every(({ sourceOrder }) => Number.isInteger(sourceOrder) && sourceOrder >= 0)).toBe(true);

    const collectionById = new Map(collectionValues.map((value) => [value.valueId, value]));
    const fieldContents = collectionValues.filter((value) => value.valueId.startsWith("record-field-contents:"));
    expect(fieldContents.length).toBeGreaterThan(0);
    for (const value of fieldContents) {
      if (value.kind === "alias") expect(collectionById.has(value.targetValueId)).toBe(true);
    }
    const fieldContentLiterals = fieldContents.filter((value) => value.kind === "literal");
    expect(fieldContentLiterals).toContainEqual(expect.objectContaining({ kind: "literal", members: [] }));
    expect(fieldContentLiterals).toContainEqual(expect.objectContaining({ kind: "literal", members: [{ kind: "literal", type: { kind: "number" }, value: { kind: "number", value: 7 } }] }));
    expect(fieldContentLiterals).toContainEqual(expect.objectContaining({ kind: "literal", members: [{ kind: "literal", type: { kind: "number" }, value: { kind: "number", value: 31 } }] }));

    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const rustCollectionValues = rustInput.scalarProgram?.collectionValues ?? rustInput.bindingVersions?.collectionValues ?? [];
    expect(rustCollectionValues).toEqual(collectionValues);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluateInput(rustInput);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["rootAmount", 2],
        ["rootLabel", "multi"],
        ["aAmount", 2],
        ["aLabel", "multi"],
        ["aEmptyLength", 0],
        ["aOneLength", 1],
        ["aMultiLength", 2],
        ["aTransformedAmount", 12],
        ["aTransformedLabel", "multi"],
        ["aTransformedLength", 1],
        ["bMultiLength", 3]
      ] as const) {
        if (typeof expected === "number") expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
        else expect(scalarBindingFor(fixture, payload, name)).toMatchObject({ status: "ok", value: { kind: "string", value: expected } });
      }
    }
  }, 30000);
});
