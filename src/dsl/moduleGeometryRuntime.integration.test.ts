import { describe, expect, it } from "vitest";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import {
  geometryValueOccurrenceKey,
  propertyBindingOccurrenceKey,
  sourceOwnerForRuntimeElementId
} from "@nuinuicad/nui-language";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";
import type { GeometryInputTarget } from "../types/geometry";
import { buildForGroupExecutionOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";

const compileWithIds = (source: string, prefix = "task7") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const errorsOf = (compiled: ReturnType<typeof compileWithIds>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const evaluateCompiled = (compiled: ReturnType<typeof compileWithIds>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");
  const elements = compiled.document.elements;
  return evaluateElements(elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    typedDependencyGraph: compiled.typedDependencyGraph,
    evaluationOrder: compiled.typedDependencyGraph?.evaluationOrder,
    scalarProgram: compiled.scalarProgram,
    geometryValueProgram: compiled.geometryValueProgram,
    geometryInputTargetsByElementId: new Map([
      ...(compiled.geometryInputTargetsByElementId ?? []),
      ...(compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId ?? [])
    ]),
    geometryCollectionNodesByValueId: compiled.moduleGeometryRuntime?.geometryCollectionNodesByValueId,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: compiled.scalarExecutionPositionByRuntimeElementId,
    forGroupMutationOwnerByElementId: compiled.bindingVersions
      ? new Map([
          ...forGroupMutationOwnerByElementId(buildForGroupExecutionOwners(
            compiled.bindingVersions,
            elements,
            compiled.statementMap.byElementId,
            compiled.statementMap.statementIdByStatementIndex,
            new Set(compiled.moduleForGroupExecutionOwnerByElementId
              ? [...compiled.moduleForGroupExecutionOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
              : [])
          )),
          ...(compiled.moduleForGroupExecutionOwnerByElementId ? [...compiled.moduleForGroupExecutionOwnerByElementId] : [])
        ])
      : undefined,
    moduleForGroupExecutionOwnerByElementId: compiled.moduleForGroupExecutionOwnerByElementId,
    propertyBindingEntries: compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries({
          propertyBindings: compiled.propertyBindings,
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedPropertyBindings: compiled.materializedPropertyBindings
        }, elements)
      : undefined,
    numericBindingEntries: compiled.scalarProgram
      ? buildNumericBindingRuntimeEntries({
          numericBindings: compiled.numericBindings ?? new Map(),
          elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
          materializedNumericBindings: compiled.materializedNumericBindings
        }, elements)
      : undefined
  });
};

const named = (compiled: ReturnType<typeof compileWithIds>, name: string) => {
  const element = compiled.document?.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const geometryInputTargetsFor = (compiled: ReturnType<typeof compileWithIds>, elementId: string): GeometryInputTarget[] => {
  const targets = compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId.get(elementId)
    ?? compiled.geometryInputTargetsByElementId?.get(elementId);
  return [...(targets?.values() ?? [])].flatMap((target) => Array.isArray(target)
    ? target as GeometryInputTarget[]
    : [target as GeometryInputTarget]);
};

const geometryValueTargetsFor = (compiled: ReturnType<typeof compileWithIds>, elementId: string) =>
  geometryInputTargetsFor(compiled, elementId).filter((target): target is Extract<GeometryInputTarget, { kind: "geometryValue" }> => target.kind === "geometryValue");

const expectGeometryValueDependency = (
  compiled: ReturnType<typeof compileWithIds>,
  elementId: string,
  occurrence: Extract<GeometryInputTarget, { kind: "geometryValue" }>["occurrence"]
) => {
  expect(compiled.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "geometry",
      from: expect.objectContaining({ kind: "element", id: elementId }),
      to: expect.objectContaining({
        kind: "geometry-value",
        id: geometryValueOccurrenceKey(occurrence)
      })
    })
  ]));
};

const expectValid = (compiled: ReturnType<typeof compileWithIds>) => {
  expect(errorsOf(compiled)).toEqual([]);
  expect(compiled.document).not.toBeNull();
};

describe("module geometry runtime", () => {
  it("evaluates a Module geometry value from its source-owned named checkpoint", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  move L as shifted(from: (0, 0), to: (7, -3))",
      "  const Out: line = @L.shifted",
      "}",
      "instance I = M()"
    ].join("\n"), "say447-module-named-stage");
    expectValid(compiled);

    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "M")!;
    const output = definition.localGeometryValues.find((candidate) => candidate.name === "Out")!;
    const instance = compiled.moduleSemanticAnalysis!.instances.find((candidate) => candidate.name === "I")!;
    expect(output.initializer?.target).toMatchObject({
      kind: "sourceGeometry",
      statementId: "say447-module-named-stage:2",
      stagePath: ["shifted"]
    });

    const evaluation = evaluateElements(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled as LastGoodDslDocument,
      evaluationLimitIndex: undefined
    }));
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryValueErrors ?? []).toEqual([]);
    const evaluatedOutput = [...(evaluation.computedGeometryValues?.values() ?? [])].find((entry) =>
      entry.occurrence.sourceStatementId === output.statementId &&
      entry.occurrence.instancePath.length === 1 &&
      entry.occurrence.instancePath[0] === instance.statementId
    );
    expect(evaluatedOutput?.value).toMatchObject({
      kind: "line",
      start: { x: 18, y: 20 },
      end: { x: 27, y: 32 }
    });
  });

  it("preserves selected stages for immutable line and path values consumed by from(source:)", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (11, 23), end: (20, 35))",
      "move A as moved (from: (11, 23), to: (31, 45))",
      "curve C = bezier(start: (2, 7), end: (12, 7), startAngle: 45, startLength: 3, endAngle: 135, endLength: 3)",
      "move C as moved (from: (2, 7), to: (22, 27))",
      "module M(g: line, p: path) {",
      "  line Material = from(source: @g)",
      "  path PathMaterial = from(source: @p)",
      "}",
      "instance First = M(g: @A.base, p: @C.base)",
      "instance Second = M(g: @A.moved, p: @C.moved)",
      "const RootBase: line = @A.base",
      "line RootMaterial = from(source: @RootBase)"
    ].join("\n");
    const compiled = compileWithIds(source, "say446-module-stage");
    expectValid(compiled);

    const productionOptions = {
      geometryInputTargetsByElementId: new Map([
        ...(compiled.geometryInputTargetsByElementId ?? []),
        ...(compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId ?? [])
      ])
    };
    const targetsFor = (name: string) => {
      return compiled.document!.elements.filter((element) => element.name === name)
        .flatMap((element) => [...(productionOptions.geometryInputTargetsByElementId.get(element.id)?.values() ?? [])])
        .flatMap((target) => Array.isArray(target) ? target : [target]);
    };
    expect(targetsFor("Material").map((target) => target.stagePath)).toEqual(expect.arrayContaining([["base"], ["moved"]]));
    expect(targetsFor("PathMaterial").map((target) => target.stagePath)).toEqual(expect.arrayContaining([["base"], ["moved"]]));
    expect(targetsFor("RootMaterial")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "drawable", elementId: named(compiled, "A").id, stagePath: ["base"] })
    ]));

    const evaluation = evaluateElements(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled as LastGoodDslDocument,
      evaluationLimitIndex: undefined
    }));
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedGeometry.get(named(compiled, "Material").id)).toMatchObject({
      start: { x: 11, y: 23 }, end: { x: 20, y: 35 }
    });
    expect(evaluation.computedGeometry.get(named(compiled, "PathMaterial").id)).toMatchObject({
      kind: "bezierCurve", segments: [{ start: { x: 2, y: 7 }, end: { x: 12, y: 7 } }]
    });
    expect(evaluation.computedGeometry.get(named(compiled, "RootMaterial").id)).toMatchObject({
      start: { x: 11, y: 23 }, end: { x: 20, y: 35 }
    });

    const reordered = compileWithIds(source.replace(
      "instance First = M(g: @A.base, p: @C.base)\ninstance Second = M(g: @A.moved, p: @C.moved)",
      "instance Second = M(g: @A.moved, p: @C.moved)\ninstance First = M(g: @A.base, p: @C.base)"
    ), "say446-module-stage-reordered");
    expectValid(reordered);
    const reorderedEvaluation = evaluateElements(reordered.document!.elements, buildEvaluationOptions({
      compiledDocument: reordered as LastGoodDslDocument,
      evaluationLimitIndex: undefined
    }));
    expect(reorderedEvaluation.errors).toEqual([]);
    const geometriesNamed = (result: typeof reorderedEvaluation, name: string) => reordered.document!.elements
      .filter((element) => element.name === name)
      .map((element) => result.computedGeometry.get(element.id));
    expect(geometriesNamed(reorderedEvaluation, "Material")).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: expect.objectContaining({ x: 11, y: 23 }), end: expect.objectContaining({ x: 20, y: 35 }) }),
      expect.objectContaining({ start: expect.objectContaining({ x: 31, y: 45 }), end: expect.objectContaining({ x: 40, y: 57 }) })
    ]));
    expect(geometriesNamed(reorderedEvaluation, "PathMaterial")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "bezierCurve", segments: [expect.objectContaining({ start: expect.objectContaining({ x: 2, y: 7 }), end: expect.objectContaining({ x: 12, y: 7 }) })] }),
      expect.objectContaining({ kind: "bezierCurve", segments: [expect.objectContaining({ start: expect.objectContaining({ x: 22, y: 27 }), end: expect.objectContaining({ x: 32, y: 27 }) })] })
    ]));
  });

  it("projects Module-local pure point inputs into the canonical geometry dependency graph", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  const v: point = coordinate(x: 3, y: 4)",
      "  point Probe = offset(from: @v, dx: 1, dy: 2)",
      "}",
      "instance i = M()"
    ].join("\n"), "module-pure-point-target");
    expectValid(compiled);

    const probe = named(compiled, "Probe");
    const targets = compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId.get(probe.id);
    const geometryValueTarget = [...(targets?.values() ?? [])]
      .flatMap((target) => Array.isArray(target) ? target : [target])
      .find((target) => target.kind === "geometryValue");
    expect(geometryValueTarget).toMatchObject({
      kind: "geometryValue",
      occurrence: { sourceStatementId: "module-pure-point-target:2", instancePath: ["module-pure-point-target:5"] },
      geometryType: "point"
    });
    if (!geometryValueTarget || geometryValueTarget.kind !== "geometryValue") throw new Error("expected a structured pure point target");

    const graph = compiled.typedDependencyGraph;
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "geometry",
        from: expect.objectContaining({ kind: "element", id: probe.id }),
        to: expect.objectContaining({
          kind: "geometry-value",
          id: geometryValueOccurrenceKey(geometryValueTarget.occurrence)
        })
      })
    ]));

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(probe.id)).toMatchObject({ kind: "point", x: 4, y: 6 });
  });

  it("keeps pure point consumer results stable across source order, aliases, and Module renames", () => {
    const sourceFor = ({
      moduleName,
      consumerFirst,
      alias
    }: {
      moduleName: string;
      consumerFirst: boolean;
      alias: boolean;
    }) => {
      const producer = "  const v: point = coordinate(x: 3, y: 4)";
      const localAlias = "  const localAlias: point = @v";
      const consumer = `  point Probe = offset(from: @${alias ? "localAlias" : "v"}, dx: 1, dy: 2)`;
      return [
        "nui 1",
        `module ${moduleName}() {`,
        ...(consumerFirst ? [consumer, ...(alias ? [localAlias] : []), producer] : [producer, ...(alias ? [localAlias] : []), consumer]),
        "}",
        `instance i = ${moduleName}()`
      ].join("\n");
    };
    const variants = [
      { moduleName: "M", consumerFirst: false, alias: false },
      { moduleName: "M", consumerFirst: true, alias: false },
      { moduleName: "M", consumerFirst: false, alias: true },
      { moduleName: "Renamed", consumerFirst: false, alias: false }
    ] as const;

    for (const [index, variant] of variants.entries()) {
      const compiled = compileWithIds(sourceFor(variant), `module-pure-point-variant-${index}`);
      expectValid(compiled);
      const probe = named(compiled, "Probe");
      const target = geometryValueTargetsFor(compiled, probe.id)[0];
      expect(target).toBeDefined();
      if (!target) throw new Error("expected a resolved immutable point target");
      expect(compiled.geometryValueProgram?.some((entry) =>
        geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(target.occurrence)
      )).toBe(true);
      expectGeometryValueDependency(compiled, probe.id, target.occurrence);

      const result = evaluateCompiled(compiled);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(probe.id)).toMatchObject({ kind: "point", x: 4, y: 6 });
    }
  });

  it("projects pure line and path inputs through the existing list target path", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  const LineValue: line = segment(start: (0, 0), end: (10, 0))",
      "  const PathValue: path = polyline(points: [(0, 0), (10, 0)], closed: false)",
      "  line LineUse = offset(sources: [@LineValue], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "  line PathUse = offset(sources: [@PathValue], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance i = M()"
    ].join("\n"), "module-pure-line-path-targets");
    expectValid(compiled);

    for (const name of ["LineUse", "PathUse"]) {
      const consumer = named(compiled, name);
      const target = geometryValueTargetsFor(compiled, consumer.id)[0];
      expect(target).toBeDefined();
      if (!target) throw new Error(`expected a pure geometry target for ${name}`);
      expectGeometryValueDependency(compiled, consumer.id, target.occurrence);
    }

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "LineUse").id)).toMatchObject({ kind: "offsetLine" });
    expect(result.computedGeometry.get(named(compiled, "PathUse").id)).toMatchObject({ kind: "offsetLine" });
  });

  it("projects immutable line and path endpoints to point-shaped geometry-value targets", () => {
    const runEndpointCase = (
      name: string,
      geometryType: "line" | "path",
      producerFirst: boolean
    ) => {
      const producer = geometryType === "line"
        ? "  const L: line = segment(start: (11, 23), end: (41, 63))"
        : "  const L: path = polyline(points: [(11, 23), (41, 63)], closed: false)";
      const consumer = "  line Use = segment(start: @L.start, end: @L.end)";
      const body = producerFirst ? [producer, consumer] : [consumer, producer];
      const compiled = compileWithIds([
        "nui 1",
        "module M() {",
        ...body,
        "}",
        "instance I = M()"
      ].join("\n"), name);
      expectValid(compiled);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "undefined-geometry-reference")).toEqual([]);

      const use = named(compiled, "Use");
      const targets = geometryInputTargetsFor(compiled, use.id);
      expect(targets.every((target) => target.kind === "geometryValue")).toBe(true);
      const endpointTargets = targets.filter((target): target is Extract<GeometryInputTarget, { kind: "geometryValue" }> =>
        target.kind === "geometryValue"
      );
      expect(endpointTargets).toHaveLength(2);
      expect(endpointTargets.map((target) => ({ geometryType: target.geometryType, pointKey: target.pointKey })))
        .toEqual([
          { geometryType: "point", pointKey: "start" },
          { geometryType: "point", pointKey: "end" }
        ]);

      const occurrence = endpointTargets[0]!.occurrence;
      expect(endpointTargets[1]!.occurrence).toEqual(occurrence);
      expect(occurrence.sourceStatementId).toBe(`${name}:${producerFirst ? 2 : 3}`);
      expect(occurrence.instancePath).toEqual([`${name}:5`]);
      expect(compiled.geometryValueProgram?.some((entry) =>
        geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(occurrence)
      )).toBe(true);
      expectGeometryValueDependency(compiled, use.id, occurrence);

      const result = evaluateCompiled(compiled);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(use.id)).toMatchObject({
        kind: "line",
        start: { x: 11, y: 23 },
        end: { x: 41, y: 63 },
        length: 50
      });
    };

    runEndpointCase("module-immutable-line-endpoint-forward", "line", false);
    runEndpointCase("module-immutable-line-endpoint-reverse", "line", true);
    runEndpointCase("module-immutable-path-endpoint-forward", "path", false);

    const drawable = compileWithIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (41, 63))",
      "  line Use = segment(start: @L.start, end: @L.end)",
      "}",
      "instance I = M()"
    ].join("\n"), "module-drawable-line-endpoint-control");
    expectValid(drawable);
    const drawableUse = named(drawable, "Use");
    const drawableLine = named(drawable, "L");
    expect(drawableUse).toMatchObject({
      startPoint: { mode: "derived", elementId: drawableLine.id, pointKey: "start" },
      endPoint: { mode: "derived", elementId: drawableLine.id, pointKey: "end" }
    });
    expect(geometryInputTargetsFor(drawable, drawableUse.id)).toEqual([]);
    const drawableResult = evaluateCompiled(drawable);
    expect(drawableResult.errors).toEqual([]);
    expect(drawableResult.computedGeometry.get(drawableUse.id)).toMatchObject({
      kind: "line",
      start: { x: 11, y: 23 },
      end: { x: 41, y: 63 },
      length: 50
    });
  });

  it("preserves local, exported, and parameter-backed occurrences across isolated Module instances", () => {
    const compiled = compileWithIds([
      "nui 1",
      "const Seed: point = coordinate(x: 2, y: 3)",
      "module Producer() {",
      "  export const Published: point = coordinate(x: 7, y: 8)",
      "}",
      "module M(anchor: point, x: number) {",
      "  const Local: point = coordinate(x: @x, y: 4)",
      "  instance Source = Producer()",
      "  point LocalUse = offset(from: @Local, dx: 1, dy: 2)",
      "  point ParameterUse = offset(from: @anchor, dx: 1, dy: 2)",
      "  point ExportUse = offset(from: @Source::Published, dx: 1, dy: 2)",
      "}",
      "instance First = M(anchor: @Seed, x: 3)",
      "instance Second = M(anchor: @Seed, x: 10)"
    ].join("\n"), "module-pure-value-routes");
    expectValid(compiled);

    const instance = (name: string) => named(compiled, name);
    const child = (parentName: string, childName: string) => {
      const parent = instance(parentName);
      const element = compiled.document!.elements.find((candidate) =>
        candidate.name === childName && candidate.parentGroupId === parent.id
      );
      if (!element) throw new Error(`missing ${parentName}::${childName}`);
      return element;
    };
    const targetsFor = (parentName: string, childName: string) => {
      const consumer = child(parentName, childName);
      const target = geometryValueTargetsFor(compiled, consumer.id)[0];
      expect(target).toBeDefined();
      if (!target) throw new Error(`missing geometry value target for ${parentName}::${childName}`);
      expect(compiled.geometryValueProgram?.some((entry) =>
        geometryValueOccurrenceKey(entry.occurrence) === geometryValueOccurrenceKey(target.occurrence)
      )).toBe(true);
      expectGeometryValueDependency(compiled, consumer.id, target.occurrence);
      return { consumer, target };
    };

    const firstLocal = targetsFor("First", "LocalUse");
    const secondLocal = targetsFor("Second", "LocalUse");
    expect(firstLocal.target.occurrence.sourceStatementId).toBe(secondLocal.target.occurrence.sourceStatementId);
    expect(firstLocal.target.occurrence.instancePath).not.toEqual(secondLocal.target.occurrence.instancePath);
    expect(geometryValueOccurrenceKey(firstLocal.target.occurrence)).not.toBe(geometryValueOccurrenceKey(secondLocal.target.occurrence));

    const firstParameter = targetsFor("First", "ParameterUse");
    const secondParameter = targetsFor("Second", "ParameterUse");
    expect(firstParameter.target.occurrence).toMatchObject({ sourceStatementId: "module-pure-value-routes:1", instancePath: [] });
    expect(secondParameter.target.occurrence).toEqual(firstParameter.target.occurrence);

    const firstExport = targetsFor("First", "ExportUse");
    const secondExport = targetsFor("Second", "ExportUse");
    expect(firstExport.target.occurrence.sourceStatementId).toBe(secondExport.target.occurrence.sourceStatementId);
    expect(firstExport.target.occurrence.instancePath).not.toEqual(secondExport.target.occurrence.instancePath);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(firstLocal.consumer.id)).toMatchObject({ kind: "point", x: 4, y: 6 });
    expect(result.computedGeometry.get(secondLocal.consumer.id)).toMatchObject({ kind: "point", x: 11, y: 6 });
    expect(result.computedGeometry.get(firstParameter.consumer.id)).toMatchObject({ kind: "point", x: 3, y: 5 });
    expect(result.computedGeometry.get(secondParameter.consumer.id)).toMatchObject({ kind: "point", x: 3, y: 5 });
    expect(result.computedGeometry.get(firstExport.consumer.id)).toMatchObject({ kind: "point", x: 8, y: 10 });
    expect(result.computedGeometry.get(secondExport.consumer.id)).toMatchObject({ kind: "point", x: 8, y: 10 });
  });

  it("keeps drawable-point consumers and root pure-value consumers on their existing paths", () => {
    const moduleDrawable = compileWithIds([
      "nui 1",
      "module M() {",
      "  point Base = coordinate(x: 3, y: 4)",
      "  point Probe = offset(from: @Base, dx: 1, dy: 2)",
      "}",
      "instance i = M()"
    ].join("\n"), "module-drawable-point-baseline");
    expectValid(moduleDrawable);
    const drawableProbe = named(moduleDrawable, "Probe");
    expect(evaluateCompiled(moduleDrawable).computedGeometry.get(drawableProbe.id)).toMatchObject({ kind: "point", x: 4, y: 6 });

    const rootPureValue = compileWithIds([
      "nui 1",
      "const v: point = coordinate(x: 3, y: 4)",
      "point Probe = offset(from: @v, dx: 1, dy: 2)"
    ].join("\n"), "root-pure-point-baseline");
    expectValid(rootPureValue);
    const rootProbe = named(rootPureValue, "Probe");
    const rootTarget = geometryValueTargetsFor(rootPureValue, rootProbe.id)[0];
    expect(rootTarget).toBeDefined();
    if (!rootTarget) throw new Error("expected the existing root pure-value target");
    expectGeometryValueDependency(rootPureValue, rootProbe.id, rootTarget.occurrence);
    const rootResult = evaluateCompiled(rootPureValue);
    expect(rootResult.errors).toEqual([]);
    expect(rootResult.computedGeometry.get(rootProbe.id)).toMatchObject({ kind: "point", x: 4, y: 6 });
  });

  it("preserves geometry collection identity and exact element type in a Module loop", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 2, y: 0)",
      "  const items: point[] = [@A, @B]",
      "  for item in @items {",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance Use = M()"
    ].join("\n"), "module-geometry-collection-for-group");
    expectValid(compiled);
    const loop = compiled.document!.elements.find((element) => element.type === "forGroup");
    expect(loop).toMatchObject({
      iterationSourceValueId: expect.any(String),
      iterationSourceOrder: expect.any(Number),
      iterationElementValueType: { kind: "point" }
    });
    if (!loop || loop.type !== "forGroup") throw new Error("expected a materialized Module collection loop");
    expect(loop).not.toHaveProperty("iterationElementType");
    expect(compiled.moduleGeometryRuntime?.geometryCollectionNodesByValueId?.has(loop.iterationSourceValueId!)).toBe(true);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.forGroupGeneratedRows?.filter((row) => row.forGroupId === loop.id)).toHaveLength(2);
  });

  it("selects conditional geometry collections for length, indexed, and whole-list consumers", () => {
    const compiled = compileWithIds([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const n: number = 1",
      "const selected: point[] = if (@n > 0) { [@B, @A] } else { [@A] }",
      "const count: number = @selected.length",
      "line Use = segment(start: @selected[0], end: @selected[0])",
      "line Outline = polyline(points: @selected, closed: false)"
    ].join("\n"), "conditional-geometry-consumers");
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const countBinding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === "count");
    expect(countBinding ? result.computedScalarBindings?.get(countBinding.id) : undefined).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 2 }
    });
    expect(result.computedGeometry.get(named(compiled, "Use").id)).toMatchObject({
      kind: "line",
      start: { x: 3, y: 4 },
      end: { x: 3, y: 4 }
    });
    expect(result.computedGeometry.get(named(compiled, "Outline").id)).toMatchObject({
      kind: "polyline",
      segments: [{ start: { x: 3, y: 4 }, end: { x: 1, y: 2 } }]
    });
  });

  it("selects a conditional point collection before geometry consumers use it", () => {
    const compiled = compileWithIds([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const chooseA: boolean = true",
      "const selected: point[] = if (@chooseA) { [@A] } else { [@B, @A] }",
      "line Use = segment(start: @selected[0], end: @selected[0])"
    ].join("\n"), "conditional-geometry-array");
    expectValid(compiled);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Use").id)).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 1, y: 2 }
    });
  });

  it("lowers actual, derived, coordinate, forwarded, and repeated point aliases", () => {
    const compiled = compileWithIds([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (20, 0))",
      "module Inner(p: point) {",
      "  point P = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "module Outer(p: point) {",
      "  instance Nested = Inner(p: @p)",
      "}",
      "instance Actual = Outer(p: @Base)",
      "instance Derived = Inner(p: @Guide.start)",
      "instance Coordinate = Inner(p: (7, 8))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()]
      .filter((geometry): geometry is Extract<typeof geometry, { kind: "point" }> => geometry.kind === "point" && geometry.elementId !== named(compiled, "Base").id)
      .map((geometry) => [geometry.x, geometry.y]))
      .toEqual([[11, 22], [1, 2], [8, 10]]);
  });

  it("keeps path aliases broad and lowers endpoint/list references", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module M(path: path) {",
      "  point P = onLine(from: @path.end, ratio: 0.5)",
      "  line Copy = offset(sources: [@path], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance BaseInstance = M(path: @Base)",
      "instance ArcInstance = M(path: @A)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].filter((geometry) => geometry.kind === "point")).toHaveLength(2);
    const base = named(compiled, "Base");
    const arc = named(compiled, "A");
    const baseCopy = compiled.document!.elements.find((element) => element.name === "Copy" && element.parentGroupId === named(compiled, "BaseInstance").id)!;
    const arcCopy = compiled.document!.elements.find((element) => element.name === "Copy" && element.parentGroupId === named(compiled, "ArcInstance").id)!;
    expect((baseCopy as Extract<typeof baseCopy, { type: "offsetLine" }>).baseLineIds).toEqual([base.id]);
    expect((arcCopy as Extract<typeof arcCopy, { type: "offsetLine" }>).baseLineIds).toEqual([arc.id]);
  });

  it("checks strict line and broad path interfaces at direct Module argument boundaries", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Straight = segment(start: (0, 0), end: (10, 0))",
      "line Polar = polar(start: (0, 0), angle: 0, length: 10)",
      "curve Bezier = bezier(start: (0, 0), end: (10, 0))",
      "arc Arc = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance StraightCall = Strict(input: @Straight)",
      "instance PolarCall = Strict(input: @Polar)",
      "instance ArcCall = Strict(input: @Arc)",
      "instance BezierCall = Strict(input: @Bezier)",
      "instance ArcPathCall = Broad(input: @Arc)",
      "instance BezierPathCall = Broad(input: @Bezier)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(2);
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("uses the public geometry interface in direct Module argument diagnostics", () => {
    const compiled = compileWithIds([
      "nui 1",
      "point Point = coordinate(x: 0, y: 0)",
      "module Broad(input: path) {",
      "}",
      "module Strict(input: line) {",
      "}",
      "instance BroadCall = Broad(input: @Point)",
      "instance StrictCall = Strict(input: @Point)"
    ].join("\n"));
    const mismatches = errorsOf(compiled).filter((diagnostic) => diagnostic.code === "module-geometry-type-mismatch");

    expect(mismatches).toHaveLength(2);
    expect(mismatches.find((diagnostic) => diagnostic.message.includes("期待: path"))?.message).toBe(
      "geometry reference「Point」の型が一致しません(期待: path)。"
    );
    expect(mismatches.find((diagnostic) => diagnostic.message.includes("期待: line"))?.message).toBe(
      "geometry reference「Point」の型が一致しません(期待: line)。"
    );
  });

  it("checks line-to-path and path-to-line parameter forwarding directionally", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Straight = segment(start: (0, 0), end: (10, 0))",
      "module AcceptPath(input: path) {",
      "}",
      "module AcceptLine(input: line) {",
      "}",
      "module ForwardLine(input: line) {",
      "  instance Nested = AcceptPath(input: @input)",
      "}",
      "module ForwardPath(input: path) {",
      "  instance Nested = AcceptLine(input: @input)",
      "}",
      "instance LineCall = ForwardLine(input: @Straight)",
      "instance PathCall = ForwardPath(input: @Straight)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(1);
    expect(errorsOf(compiled)[0]).toMatchObject({ code: "module-geometry-type-mismatch" });
  });

  it("applies the same interface check to qualified exported geometry", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Producer() {",
      "  export line Straight = segment(start: (0, 0), end: (10, 0))",
      "  export curve Bezier = bezier(start: (0, 0), end: (10, 0))",
      "  export arc Arc = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "}",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance Source = Producer()",
      "instance StraightLine = Strict(input: @Source::Straight)",
      "instance StraightPath = Broad(input: @Source::Straight)",
      "instance ArcPath = Broad(input: @Source::Arc)",
      "instance BezierPath = Broad(input: @Source::Bezier)",
      "instance ArcLine = Strict(input: @Source::Arc)",
      "instance BezierLine = Strict(input: @Source::Bezier)"
    ].join("\n"));

    expect(errorsOf(compiled)).toHaveLength(2);
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("resolves exported root and nested geometry through instance-local namespaces", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  export line L = segment(start: @Child::P, end: (10, 4))",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()",
      "point Root = offset(from: @First::L.start, dx: 1, dy: 1)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const root = result.computedGeometry.get(named(compiled, "Root").id);
    expect(root).toMatchObject({ kind: "point", x: 4, y: 5 });
    const firstLine = compiled.document!.elements.find((element) => element.name === "L" && element.parentGroupId === named(compiled, "First").id)!;
    const secondLine = compiled.document!.elements.find((element) => element.name === "L" && element.parentGroupId === named(compiled, "Second").id)!;
    expect(firstLine.id).not.toBe(secondLine.id);
    expect((firstLine as Extract<typeof firstLine, { type: "line" }>).startPoint).not.toEqual((secondLine as Extract<typeof secondLine, { type: "line" }>).startPoint);
  });

  it("lowers line and point geometry properties to stable targets", () => {
    const compiled = compileWithIds([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "line Guide = segment(start: (0, 0), end: (12, 0))",
      "module M(p: point, path: line) {",
      "  const px: number = @p.x",
      "  const py: number = @p.y",
      "  const length: number = @path.length",
      "  point Result = coordinate(x: @px + @length, y: @py)",
      "}",
      "instance Actual = M(p: @Base, path: @Guide)",
      "instance Derived = M(p: @Guide.start, path: @Guide)"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const points = compiled.document!.elements
      .filter((element) => element.name === "Result")
      .map((element) => result.computedGeometry.get(element.id));
    expect(points).toEqual([
      expect.objectContaining({ x: 22, y: 20 }),
      expect.objectContaining({ x: 12, y: 0 })
    ]);
  });

  it("lowers nested export properties through the same runtime target path", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Inner() {",
      "  export line L = segment(start: (0, 0), end: (9, 0))",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  const length: number = @Child::L.length",
      "  point Result = coordinate(x: @length, y: 0)",
      "}",
      "instance X = Outer()"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ kind: "point", x: 9 });
  });

  it("validates exported point properties and category-aware derived points", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module Inner() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "  export arc A = arc(center: (5, 6), radius: 2, start: 0, end: 90)",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "  const px: number = @Child::P.x",
      "  const py: number = @Child::P.y",
      "  point PointProperty = coordinate(x: @px, y: @py)",
      "  point LineStart = offset(from: @Child::L.start, dx: 0, dy: 0)",
      "  point LineEnd = offset(from: @Child::L.end, dx: 0, dy: 0)",
      "  point ArcCenter = offset(from: @Child::A.center, dx: 0, dy: 0)",
      "}",
      "instance X = Outer()"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "PointProperty").id)).toMatchObject({ kind: "point", x: 3, y: 4 });
    expect(result.computedGeometry.get(named(compiled, "LineStart").id)).toMatchObject({ kind: "point", x: 0, y: 0 });
    expect(result.computedGeometry.get(named(compiled, "LineEnd").id)).toMatchObject({ kind: "point", x: 10, y: 0 });
    expect(result.computedGeometry.get(named(compiled, "ArcCenter").id)).toMatchObject({ kind: "point", x: 5, y: 6 });
  });

  it.each([
    ["ordinary line center", "export line L = segment(start: (0, 0), end: (10, 0))", "@X::L.center"],
    ["curve center", "export curve C = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 2, endAngle: 180, endLength: 2)", "@X::C.center"],
    ["point start", "export point P = coordinate(x: 3, y: 4)", "@X::P.start"]
  ])("rejects invalid exported derived point accessor: %s", (_label, exported, reference) => {
    const compiled = compileWithIds([
      "nui 1",
      "module M() {",
      `  ${exported}`,
      "}",
      "instance X = M()",
      `point Root = offset(from: ${reference}, dx: 1, dy: 1)`
    ].join("\n"));

    expect(compiled.document).toBeNull();
    expect(errorsOf(compiled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-geometry-type-mismatch" })
    ]));
  });

  it("lowers caller-qualified Module export line and path stages to their selected snapshots", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line Root = segment(start: (0, 0), end: (9, 12))",
      "move Root as rootShifted(from: (0, 0), to: (2, 3))",
      "line RootBase = from(source: @Root.base)",
      "line RootNamed = from(source: @Root.rootShifted)",
      "module Producer() {",
      "  export line L = segment(start: (0, 0), end: (9, 12))",
      "  move L as shifted(from: (0, 0), to: (5, 7))",
      "  move L as finish(from: (5, 7), to: (8, 11))",
      "  export curve P = bezier(start: (1, 2), end: (7, 2), startAngle: 45, startLength: 2, endAngle: 135, endLength: 2)",
      "  move P as pathShifted(from: (1, 2), to: (3, 4))",
      "  move P as pathFinish(from: (3, 4), to: (6, 8))",
      "  export const Selected: line = @L.shifted",
      "}",
      "instance I = Producer()",
      "line PlainLine = from(source: @I::L)",
      "line BaseLine = from(source: @I::L.base)",
      "line FinalLine = from(source: @I::L.final)",
      "line NamedLine = from(source: @I::L.shifted)",
      "path BasePath = from(source: @I::P.base)",
      "path FinalPath = from(source: @I::P.final)",
      "path NamedPath = from(source: @I::P.pathShifted)",
      "line SelectedLine = from(source: @I::Selected)",
      "point Start = offset(from: @I::L.start, dx: 0, dy: 0)",
      "point End = offset(from: @I::L.end, dx: 0, dy: 0)",
      "line Caller = segment(start: (0, 0), end: (9, 12))",
      "move Caller as viaExport(from: @I::L.start, to: @I::L.end)"
    ].join("\n"), "say453-qualified-stage");
    expectValid(compiled);

    const analysis = compiled.moduleSemanticAnalysis!;
    const rootReferences = [...analysis.rootGeometryReferencesByStatementId.values()].flat().map((site) => site.reference);
    const referenceFor = (source: string) => rootReferences.find((reference) => reference.source.includes(source));
    for (const [source, stagePath] of [
      ["@I::L.base", ["base"]],
      ["@I::L.final", ["final"]],
      ["@I::L.shifted", ["shifted"]],
      ["@I::P.base", ["base"]],
      ["@I::P.final", ["final"]],
      ["@I::P.pathShifted", ["pathShifted"]]
    ] as const) {
      expect(referenceFor(source)?.target).toMatchObject({ kind: "deferredModuleExport", stagePath });
      expect(referenceFor(source)?.target).not.toHaveProperty("pointKey");
    }
    expect(referenceFor("@I::L")?.target).toMatchObject({ kind: "deferredModuleExport", exportName: "L" });
    expect(referenceFor("@I::L")?.target).not.toHaveProperty("stagePath");
    expect(referenceFor("@I::L.start")).toMatchObject({ role: "derivedPoint", target: { pointKey: "start", stagePath: ["final"] } });
    expect(referenceFor("@I::L.end")).toMatchObject({ role: "derivedPoint", target: { pointKey: "end", stagePath: ["final"] } });

    const result = evaluateElements(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: compiled as LastGoodDslDocument,
      evaluationLimitIndex: undefined
    }));
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors ?? []).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "BaseLine").id)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 9, y: 12 } });
    expect(Math.hypot(9, 12)).toBe(15);
    expect(result.computedGeometry.get(named(compiled, "FinalLine").id)).toMatchObject({ start: { x: 8, y: 11 }, end: { x: 17, y: 23 } });
    expect(result.computedGeometry.get(named(compiled, "NamedLine").id)).toMatchObject({ start: { x: 5, y: 7 }, end: { x: 14, y: 19 } });
    expect(result.computedGeometry.get(named(compiled, "PlainLine").id)).toMatchObject({ start: { x: 8, y: 11 }, end: { x: 17, y: 23 } });
    expect(result.computedGeometry.get(named(compiled, "SelectedLine").id)).toMatchObject({ start: { x: 5, y: 7 }, end: { x: 14, y: 19 } });
    expect(result.computedGeometry.get(named(compiled, "RootBase").id)).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 9, y: 12 } });
    expect(result.computedGeometry.get(named(compiled, "RootNamed").id)).toMatchObject({ start: { x: 2, y: 3 }, end: { x: 11, y: 15 } });
    expect(result.computedGeometry.get(named(compiled, "BasePath").id)).toMatchObject({
      kind: "bezierCurve",
      segments: [expect.objectContaining({
        start: expect.objectContaining({ x: 1, y: 2 }),
        end: expect.objectContaining({ x: 7, y: 2 })
      })]
    });
    expect(result.computedGeometry.get(named(compiled, "NamedPath").id)).toMatchObject({
      kind: "bezierCurve",
      segments: [expect.objectContaining({
        start: expect.objectContaining({ x: 3, y: 4 }),
        end: expect.objectContaining({ x: 9, y: 4 })
      })]
    });
    expect(result.computedGeometry.get(named(compiled, "FinalPath").id)).toMatchObject({
      kind: "bezierCurve",
      segments: [expect.objectContaining({
        start: expect.objectContaining({ x: 6, y: 8 }),
        end: expect.objectContaining({ x: 12, y: 8 })
      })]
    });
    expect(result.computedGeometry.get(named(compiled, "Start").id)).toMatchObject({ kind: "point", x: 8, y: 11 });
    expect(result.computedGeometry.get(named(compiled, "End").id)).toMatchObject({ kind: "point", x: 17, y: 23 });
  });

  it("keeps module coordinate aliases on the existing numeric binding path", () => {
    const compiled = compileWithIds([
      "nui 1",
      "const x: number = 6",
      "module M(p: point) {",
      "  point Result = offset(from: @p, dx: 1, dy: 2)",
      "}",
      "instance X = M(p: (@x, 4))"
    ].join("\n"));
    expectValid(compiled);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(named(compiled, "Result").id)).toMatchObject({ x: 7, y: 6 });
  });

  it("resolves direct numeric properties from qualified immutable Module exports and caller aliases", () => {
    const sourceFor = ({
      moduleName,
      instanceName,
      padded,
      aliasFirst
    }: {
      moduleName: string;
      instanceName: string;
      padded: boolean;
      aliasFirst: boolean;
    }) => [
      "nui 1",
      `module ${moduleName}() {`,
      "  export const Published: point = coordinate(x: 11, y: 23)",
      "}",
      ...(padded ? ["", "// SAY-445 padding", "const Padding: number = 5", ""] : []),
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
    const variants = [
      { moduleName: "Provider", instanceName: "Source", padded: false, aliasFirst: false },
      { moduleName: "RenamedProvider", instanceName: "RenamedSource", padded: true, aliasFirst: true }
    ] as const;

    for (const [index, variant] of variants.entries()) {
      const compiled = compileWithIds(sourceFor(variant), `say445-module-${index}`);
      expectValid(compiled);
      const qualified = named(compiled, "Qualified");
      const qualifiedIndex = [...(compiled.statementMap?.elementIdByStatementIndex ?? [])]
        .find(([, elementId]) => elementId === qualified.id)?.[0] ?? -1;
      for (const property of ["x", "y"] as const) {
        const binding = compiled.numericBindings?.get(propertyBindingOccurrenceKey(qualifiedIndex, property));
        expect(binding, JSON.stringify({ qualifiedIndex, numericBindingKeys: [...(compiled.numericBindings?.keys() ?? [])] })).toBeDefined();
        expect(binding?.references).toEqual([]);
        expect(binding?.typedExpression).toMatchObject({
          kind: "geometryProperty",
          property,
          geometryValueOccurrence: { sourceStatementId: expect.any(String), instancePath: expect.any(Array) }
        });
        const expression = binding?.typedExpression;
        if (expression?.kind !== "geometryProperty" || !expression.geometryValueOccurrence) {
          throw new Error(`expected resolved qualified Module ${property} property`);
        }
        expect(expression.geometryValueOccurrence.instancePath.length).toBeGreaterThan(0);
        const occurrenceId = geometryValueOccurrenceKey(expression.geometryValueOccurrence);
        expect(compiled.typedDependencyGraph?.edges).toContainEqual(expect.objectContaining({
          kind: "geometry",
          from: expect.objectContaining({ kind: "element", id: qualified.id }),
          to: expect.objectContaining({ kind: "geometry-value", id: occurrenceId }),
          requiredness: "required"
        }));
        expect(compiled.geometryValueProgram?.some((entry) =>
          geometryValueOccurrenceKey(entry.occurrence) === occurrenceId
        )).toBe(true);
      }

      const result = evaluateCompiled(compiled);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(qualified.id)).toMatchObject({ kind: "point", x: 11, y: 23 });
      expect(result.computedGeometry.get(named(compiled, "Aliased").id)).toMatchObject({ kind: "point", x: 11, y: 23 });
    }
  });

  it("captures distinct pre-mutation Bezier snapshots for materialized Module occurrences", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(origin: point) {",
      "  curve Curve = bezier(start: @origin, end: (100, 0), startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)",
      "}",
      "instance First = M(origin: (0, 0))",
      "instance Second = M(origin: (40, 20))"
    ].join("\n"));
    expectValid(compiled);
    if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");

    const result = evaluateCompiled(compiled);
    const elements = compiled.document.elements;
    const first = named(compiled, "First");
    const second = named(compiled, "Second");
    const firstCurve = elements.find((element) => element.name === "Curve" && element.parentGroupId === first.id);
    const secondCurve = elements.find((element) => element.name === "Curve" && element.parentGroupId === second.id);
    if (!firstCurve || !secondCurve) throw new Error("expected materialized Bezier occurrences");

    const firstSnapshot = result.preMutationGeometry?.get(firstCurve.id);
    const secondSnapshot = result.preMutationGeometry?.get(secondCurve.id);
    expect(firstCurve.id).not.toBe(secondCurve.id);
    expect(result.errors).toEqual([]);
    expect(firstSnapshot).toMatchObject({
      elementId: firstCurve.id,
      segments: [{ start: { x: 0, y: 0 }, control1: { x: 20, y: 0 } }]
    });
    expect(secondSnapshot).toMatchObject({
      elementId: secondCurve.id,
      segments: [{ start: { x: 40, y: 20 }, control1: { x: 60, y: 20 } }]
    });
    expect(firstSnapshot).not.toEqual(secondSnapshot);
    expect([...result.preMutationGeometry?.keys() ?? []]).toEqual([firstCurve.id, secondCurve.id]);

    const ownershipDocument = { ...compiled, statementMap: compiled.statementMap };
    expect(sourceOwnerForRuntimeElementId(ownershipDocument, firstCurve.id)).toMatchObject({
      kind: "moduleBody",
      sourceStatementId: "task7:2",
      sourceStatementIndex: 2
    });
    expect(sourceOwnerForRuntimeElementId(ownershipDocument, secondCurve.id)).toMatchObject({
      kind: "moduleBody",
      sourceStatementId: "task7:2",
      sourceStatementIndex: 2
    });
  });

  it("reports private, undefined, and geometry-kind export diagnostics", () => {
    const privateMember = compileWithIds([
      "nui 1",
      "module M() {",
      "  point Private = coordinate(x: 1, y: 2)",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Private, dx: 1, dy: 1)"
    ].join("\n"));
    expect(privateMember.document).toBeNull();
    expect(errorsOf(privateMember).some((diagnostic) => diagnostic.code === "module-private-member")).toBe(true);

    const undefinedMember = compileWithIds([
      "nui 1",
      "module M() {",
      "  export point Public = coordinate(x: 1, y: 2)",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Missing, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(undefinedMember).some((diagnostic) => diagnostic.code === "module-undefined-export")).toBe(true);

    const mismatch = compileWithIds([
      "nui 1",
      "module M() {",
      "  export line Public = segment(start: (0, 0), end: (1, 0))",
      "}",
      "instance X = M()",
      "point Root = offset(from: @X::Public, dx: 1, dy: 1)"
    ].join("\n"));
    expect(errorsOf(mismatch).some((diagnostic) => diagnostic.code === "module-geometry-type-mismatch")).toBe(true);
  });

  it("allows module-local recipes without making geometry parameters mutable owners", () => {
    const uninstantiated = compileWithIds([
      "nui 1",
      "module DefinitionOnly(path: line) {",
      "  reverse path ()",
      "}"
    ].join("\n"));
    expect(errorsOf(uninstantiated).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);

    for (const mutation of [
      "edge [path.start, path.end] ()",
      "extend path.start (to: @input)",
      "move path (from: @input, to: @input)",
      "mirrorMove path (axis1: @input, axis2: @input)",
      "reverse path ()"
    ]) {
      const compiled = compileWithIds([
        "nui 1",
        "point Input = coordinate(x: 0, y: 0)",
        "module M(path: line, input: point) {",
        `  ${mutation}`,
        "}",
        "line Base = segment(start: (0, 0), end: (10, 0))",
        "instance X = M(path: @Base, input: @Input)"
      ].join("\n"));
      expect(errorsOf(compiled).some((diagnostic) => diagnostic.code === "module-geometry-parameter-mutation")).toBe(true);
    }

    const allowed = compileWithIds([
      "nui 1",
      "module M(path: line) {",
      "  line Copy = transformCopy(startPoint: @path.start, endPoint: @path.end, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@path])",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance X = M(path: @Base)"
    ].join("\n"));
    expect(errorsOf(allowed)).toEqual([]);
  });
});
