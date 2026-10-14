import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument, moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rustTargetDirectory = join(repoRoot, "rust-evaluator", "target", "issue1393-selected-stage-path-arrays");
type Fixture = ReturnType<typeof fixtureFromSource>;

const rootBindingId = (fixture: Fixture, name: string): string => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`missing root binding ${name}`);
  return binding.id;
};

const moduleBindingId = (fixture: Fixture, instanceName: string, outputName: string): string => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`missing instance ${instanceName}`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`missing Module output ${instanceName}::${outputName}`);
  return moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
};

const lineAngleCall = (fixture: Fixture, bindingId: string) => {
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`missing lineAngle call for ${bindingId}`);
  }
  return initializer;
};

const endpointArgumentsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(endpointArgumentsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "geometryEndpoint" ? [record] : []),
    ...Object.values(record).flatMap(endpointArgumentsIn)
  ];
};

const expectNumber = (payload: EvaluationPayload, bindingId: string, expected: number) => {
  const result = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId);
  expect(result, bindingId).toMatchObject({ status: "ok", value: { kind: "number" } });
  if (result?.status !== "ok" || result.value.kind !== "number") throw new Error(`invalid scalar ${bindingId}`);
  expect(result.value.value, bindingId).toBeCloseTo(expected, 7);
};

describe("Issue #1393 selected stages in geometry path arrays", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot, { targetDirectory: rustTargetDirectory });
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string) => {
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), "production persistent-Rust parity").toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) expect(evaluationPayloadToResult(payload).errors).toEqual([]);
    return { fixture, rustInput, options, payloads: [tsPayload, rustPayload] };
  };

  it("compiles the retained K2 source and resolves the direct base-stage array endpoint to zero degrees", async () => {
    const { fixture, rustInput, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Paths: path[] = [@L.base]",
      "const result: number = lineAngle(@Paths[0].start, @Axis.start)"
    ].join("\n") + "\n");

    const semantic = fixture.compiled!.doc.sourceLexicalNamespace!.geometryArraySemanticAnalysis!;
    const paths = semantic.values.find((value) => value.name === "Paths")!;
    const lineId = fixture.elements.find((element) => element.name === "L")?.id;
    expect(paths.value).toMatchObject({
      kind: "literal",
      members: [{
        interfaceType: "line",
        target: { kind: "geometry", statementId: lineId, interfaceType: "line", stagePath: ["base"] }
      }]
    });

    const endpoint = lineAngleCall(fixture, rootBindingId(fixture, "result")).args[0];
    expect(endpoint).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: lineId, geometryType: "path", stagePath: ["base"] }
    });
    expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
    for (const payload of payloads) expectNumber(payload, rootBindingId(fixture, "result"), 0);
  }, 120_000);

  it("preserves base, named, and final stage identities through ordered arrays, aliases, and Module indexing", async () => {
    const { fixture, rustInput, options, payloads } = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "curve C = bezier(start: (0, 0), end: (80, 25), startAngle: 20, startLength: 40, endAngle: 120, endLength: 30)",
      "move C as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "move C as turned (from: (0, 0), to: (0, 0), angleDeg: 20)",
      "const Direct: path[] = [@C.base, @C.tilted, @C.final, @C.base]",
      "const ImmutableAlias: path[] = @Direct",
      "const zero: number = 0",
      "const one: number = 1",
      "const two: number = 2",
      "const directBase: number = lineAngle(@Direct[@zero].start, @Axis.start)",
      "const directNamed: number = lineAngle(@Direct[@one].end, @Axis.start)",
      "const directFinal: number = lineAngle(@Direct[@two].start, @Axis.start)",
      "const aliasBase: number = lineAngle(@ImmutableAlias[@zero].start, @Axis.start)",
      "const aliasNamed: number = lineAngle(@ImmutableAlias[@one].end, @Axis.start)",
      "const aliasFinal: number = lineAngle(@ImmutableAlias[@two].start, @Axis.start)",
      "const endpoints: point[] = [@C.base.start, @C.tilted.end, @C.start]",
      "const Lines: line[] = [@L]",
      "const Covariant: path[] = @Lines",
      "module Producer() {",
      "  export curve Exported = bezier(start: (0, 0), end: (80, 25), startAngle: 20, startLength: 40, endAngle: 120, endLength: 30)",
      "  move Exported as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "  move Exported as turned (from: (0, 0), to: (0, 0), angleDeg: 20)",
      "}",
      "instance Source = Producer()",
      "module Measure(paths: path[], axis: line) {",
      "  const Local: path[] = @paths",
      "  export const angle: number = lineAngle(@Local[0].start, @axis.start)",
      "  export const namedAngle: number = lineAngle(@Local[1].end, @axis.start)",
      "  export const finalAngle: number = lineAngle(@Local[2].start, @axis.start)",
      "}",
      "instance UseBase = Measure(paths: [@C.base, @C.tilted, @C.final], axis: @Axis)",
      "instance UseQualified = Measure(paths: [@Source::Exported.base, @Source::Exported.tilted, @Source::Exported.final], axis: @Axis)",
      "const moduleBase: number = @UseBase::angle",
      "const moduleNamed: number = @UseBase::namedAngle",
      "const moduleFinal: number = @UseBase::finalAngle",
      "const qualifiedBase: number = @UseQualified::angle",
      "const qualifiedNamed: number = @UseQualified::namedAngle",
      "const qualifiedFinal: number = @UseQualified::finalAngle"
    ].join("\n") + "\n");

    const semantic = fixture.compiled!.doc.sourceLexicalNamespace!.geometryArraySemanticAnalysis!;
    const direct = semantic.values.find((value) => value.name === "Direct")!;
    const immutableAlias = semantic.values.find((value) => value.name === "ImmutableAlias")!;
    const curveId = fixture.elements.find((element) => element.name === "C")?.id;
    expect(direct.value).toMatchObject({
      kind: "literal",
      members: [
        { interfaceType: "path", target: { kind: "geometry", statementId: curveId, interfaceType: "path", stagePath: ["base"] } },
        { interfaceType: "path", target: { kind: "geometry", statementId: curveId, interfaceType: "path", stagePath: ["tilted"] } },
        { interfaceType: "path", target: { kind: "geometry", statementId: curveId, interfaceType: "path", stagePath: ["final"] } },
        { interfaceType: "path", target: { kind: "geometry", statementId: curveId, interfaceType: "path", stagePath: ["base"] } }
      ]
    });
    expect(immutableAlias.value).toMatchObject({ kind: "alias", targetValueId: direct.statementId });
    expect(semantic.values.find((value) => value.name === "endpoints")?.value).toMatchObject({
      kind: "literal",
      type: { elementType: "point" },
      members: [
        { interfaceType: "point", target: { kind: "geometry", interfaceType: "path", pointKey: "start", stagePath: ["base"] } },
        { interfaceType: "point", target: { kind: "geometry", interfaceType: "path", pointKey: "end", stagePath: ["tilted"] } },
        { interfaceType: "point", target: { kind: "geometry", interfaceType: "path", pointKey: "start", stagePath: ["final"] } }
      ]
    });
    expect(semantic.values.find((value) => value.name === "Covariant")?.value).toMatchObject({
      kind: "alias", targetValueId: semantic.values.find((value) => value.name === "Lines")?.statementId
    });

    for (const [name, stagePath, memberIndex] of [
      ["directBase", ["base"], 0], ["directNamed", ["tilted"], 1], ["directFinal", ["final"], 2],
      ["aliasBase", ["base"], 0], ["aliasNamed", ["tilted"], 1], ["aliasFinal", ["final"], 2]
    ] as const) {
      const endpoint = lineAngleCall(fixture, rootBindingId(fixture, name)).args[0];
      expect(endpoint).toMatchObject({
        kind: "geometryEndpoint",
        target: { kind: "geometryCollectionIndex", collectionValueId: expect.any(String) }
      });
      expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
      const sourceValueId = endpoint.kind === "geometryEndpoint" && endpoint.target?.kind === "geometryCollectionIndex"
        ? endpoint.target.collectionValueId
        : "";
      const node = options.geometryCollectionNodesByValueId?.get(sourceValueId);
      expect(node?.kind).toBe("leaf");
      if (node?.kind !== "leaf") throw new Error(`missing lowered collection node for ${name}`);
      expect(node.targets.map((target) => "stagePath" in target ? target.stagePath : undefined)).toEqual([
        ["base"], ["tilted"], ["final"], ["base"]
      ]);
      expect(node.targets[memberIndex]).toMatchObject({
        kind: "drawable", elementId: curveId, geometryType: "path", stagePath
      });
      expect(rustInput.geometryCollectionNodes).toContainEqual({
        collectionValueId: sourceValueId,
        value: options.geometryCollectionNodesByValueId?.get(sourceValueId)
      });
    }
    const expectModuleCollectionEndpoint = (instanceName: string, outputName: string) => {
      const endpoint = lineAngleCall(fixture, moduleBindingId(fixture, instanceName, outputName)).args[0];
      expect(endpoint).toMatchObject({
        kind: "geometryEndpoint",
        target: { kind: "geometryCollectionIndex", collectionValueId: expect.any(String) }
      });
      expect(endpointArgumentsIn(rustInput)).toContainEqual(endpoint);
      if (endpoint.kind !== "geometryEndpoint" || endpoint.target?.kind !== "geometryCollectionIndex") {
        throw new Error(`missing lowered Module collection endpoint for ${instanceName}::${outputName}`);
      }
      const collection = options.geometryCollectionNodesByValueId?.get(endpoint.target.collectionValueId);
      expect(collection).toMatchObject({
        kind: "leaf",
        targets: [
          { kind: "drawable", geometryType: "path", stagePath: ["base"] },
          { kind: "drawable", geometryType: "path", stagePath: ["tilted"] },
          { kind: "drawable", geometryType: "path", stagePath: ["final"] }
        ]
      });
      expect(rustInput.geometryCollectionNodes).toContainEqual({
        collectionValueId: endpoint.target.collectionValueId,
        value: collection
      });
    };
    expectModuleCollectionEndpoint("UseBase", "angle");
    expectModuleCollectionEndpoint("UseQualified", "angle");

    for (const payload of payloads) {
      for (const [name, expected] of Object.entries({
        directBase: 20, directNamed: 45, directFinal: 55,
        aliasBase: 20, aliasNamed: 45, aliasFinal: 55
      })) expectNumber(payload, rootBindingId(fixture, name), expected);
      for (const [instanceName, outputName, expected] of [
        ["UseBase", "angle", 20], ["UseBase", "namedAngle", 45], ["UseBase", "finalAngle", 55],
        ["UseQualified", "angle", 20], ["UseQualified", "namedAngle", 45], ["UseQualified", "finalAngle", 55]
      ] as const) expectNumber(payload, moduleBindingId(fixture, instanceName, outputName), expected);
    }
  }, 120_000);

  it("keeps point-only members, invalid-property diagnostics, covariance, and Module visibility rules", () => {
    const compile = (source: string) => compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const badPointToPath = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const Bad: path[] = [@L.start]"
    ].join("\n"));
    expect(badPointToPath.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error", code: "geometry-array-member-type-mismatch"
    }));

    const badProperty = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "const MissingStage: path[] = [@L.unknown]",
      "const MissingProperty: path[] = [@L.tilted.width]"
    ].join("\n"));
    expect(badProperty.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-array-member-type-mismatch")).toHaveLength(2);
    expect(badProperty.diagnostics.find((diagnostic) => diagnostic.code === "geometry-array-member-type-mismatch")?.message).toContain("property");

    const modulePrivacy = compile([
      "nui 1",
      "module M() {",
      "  const privateValue: number = 1",
      "  export const visibleValue: number = 2",
      "}",
      "instance Use = M()",
      "const visible: number = @Use::visibleValue",
      "const private: number = @Use::privateValue"
    ].join("\n"));
    expect(modulePrivacy.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error", code: "module-private-member"
    }));
  });
});
