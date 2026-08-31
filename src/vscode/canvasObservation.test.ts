import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { CadElement } from "../types/geometry";
import type { VscodeCanvasObservationElementSource } from "./canvasObservationProtocol";
import {
  canvasObservationSnapshot,
  selectedElementSourcesForCanvasObservation
} from "./canvasObservation";

const evaluationState = (
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation: {
    computedGeometry: new Map(),
    errors: [],
    warnings: []
  } as EvaluationEngineState["evaluation"],
  evaluationRevision: 12,
  evaluationRequestRevision: 34,
  mode: "rust",
  source: "rust",
  status: "ready",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const compileMaterializedModuleDocument = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `live:${index}`] as const))
  });
};

const snapshot = (input: {
  state?: EvaluationEngineState;
  selectionSubject?: { kind: "elements" } | { kind: "binding"; bindingId: string };
  selectedElementId?: string | null;
  selectedElementIds?: readonly string[];
  selectedElementSources?: readonly VscodeCanvasObservationElementSource[];
  elements?: readonly CadElement[];
  moduleMaterialization?: ModuleMaterialization;
  previewActive?: boolean;
  compiledDocumentRevision?: number;
} = {}) => canvasObservationSnapshot({
  documentVersion: 7,
  selectedElementId: input.selectedElementId,
  selectedElementIds: input.selectedElementIds ?? ["point-a", "line-b"],
  selectedElementSources: input.selectedElementSources ?? [],
  elements: input.elements,
  moduleMaterialization: input.moduleMaterialization,
  selectionSubject: input.selectionSubject ?? { kind: "elements" },
  compiledDocumentRevision: input.compiledDocumentRevision ?? 12,
  previewActive: input.previewActive ?? false,
  evaluationState: input.state ?? evaluationState()
});

describe("canvasObservationSnapshot", () => {
  it("publishes Select Instance availability from the primary materialized Module body selection", () => {
    const source = [
      "nui 1",
      "module Inner() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module Outer() {",
      "  instance Nested = Inner()",
      "}",
      "instance Root = Outer()",
      "point Outside = coordinate(x: 3, y: 4)"
    ].join("\n");
    const compiled = compileMaterializedModuleDocument(source);
    expect(compiled.document).not.toBeNull();
    const nested = compiled.document!.elements.find((element) => element.name === "Nested");
    const body = compiled.document!.elements.find((element) =>
      element.name === "P" && element.parentGroupId === nested?.id
    );
    expect(nested).toBeDefined();
    expect(body).toBeDefined();

    const result = snapshot({
      selectedElementId: body!.id,
      selectedElementIds: [body!.id, nested!.id],
      elements: compiled.document!.elements,
      moduleMaterialization: compiled.moduleMaterialization
    });

    expect(result.canvasCanSelectInstance).toBe(true);
  });

  it("follows the primary selection and fails closed for ordinary, instance, and stale materialization", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance First = M()",
      "point Outside = coordinate(x: 3, y: 4)"
    ].join("\n");
    const compiled = compileMaterializedModuleDocument(source);
    expect(compiled.document).not.toBeNull();
    const instance = compiled.document!.elements.find((element) => element.name === "First")!;
    const body = compiled.document!.elements.find((element) =>
      element.name === "P" && element.parentGroupId === instance.id
    )!;
    const ordinary = compiled.document!.elements.find((element) => element.name === "Outside")!;
    const common = {
      selectedElementIds: [body.id, ordinary.id],
      elements: compiled.document!.elements,
      moduleMaterialization: compiled.moduleMaterialization
    };

    expect(snapshot({ ...common, selectedElementId: body.id }).canvasCanSelectInstance).toBe(true);
    expect(snapshot({ ...common, selectedElementId: ordinary.id }).canvasCanSelectInstance).toBe(false);
    expect(snapshot({ ...common, selectedElementId: instance.id }).canvasCanSelectInstance).toBe(false);
    expect(snapshot({
      ...common,
      selectedElementId: body.id,
      moduleMaterialization: undefined
    }).canvasCanSelectInstance).toBe(false);
  });

  it("publishes current canonical selection and compact evaluation metadata", () => {
    const result = snapshot({
      state: evaluationState({
        evaluation: {
          computedGeometry: new Map(),
          errors: [{
            elementId: "point-a",
            elementName: "A",
            missingDependencyId: "missing",
            message: "Missing dependency"
          }],
          warnings: [{
            elementId: "line-b",
            elementName: "B",
            message: "Trim warning"
          }]
        } as EvaluationEngineState["evaluation"]
      })
    });

    expect(result).toMatchObject({
      documentVersion: 7,
      selectedElementIds: ["point-a", "line-b"],
      selectedElementSources: [],
      selectionSubject: { kind: "elements" },
      compiledDocumentRevision: 12,
      evaluationRevision: 12,
      evaluationRequestRevision: 34,
      evaluationStatus: "ready",
      evaluationSource: "rust",
      rustEligible: true,
      isStale: false,
      isCurrent: true,
      errorCount: 1,
      warningCount: 1,
      errorSummaries: [{ elementId: "point-a", elementName: "A", message: "Missing dependency" }],
      warningSummaries: [{ elementId: "line-b", elementName: "B", message: "Trim warning" }]
    });
    expect(result).not.toHaveProperty("computedGeometry");
  });

  it("publishes ordinary selected runtime-element source ownership", () => {
    const compiled = compileDslDocument([
      "nui 1",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}"
    ].join("\n"));
    const group = compiled.document?.elements.find((element) => element.name === "G");
    const line = compiled.document?.elements.find((element) => element.name === "AB");
    expect(compiled.statementMap).not.toBeNull();
    expect(group).toBeDefined();
    expect(line).toBeDefined();

    const sources = selectedElementSourcesForCanvasObservation(
      [group!.id, line!.id],
      compiled,
      compiled.document!.elements
    );

    expect(sources).toEqual([{
      runtimeElementId: group!.id,
      sourceStatementIndex: 1,
      elementType: "group"
    }, {
      runtimeElementId: line!.id,
      sourceStatementIndex: 2,
      elementType: "line"
    }]);
    expect(snapshot({
      selectedElementIds: [group!.id, line!.id],
      selectedElementSources: sources
    }).selectedElementSources).toEqual(sources);
  });

  it("publishes complete Module instance and body identity paths for repeated nested selections", () => {
    const source = [
      "nui 1",
      "module Inner() {",
      "  group Body {",
      "    point P = coordinate(x: 1, y: 2)",
      "  }",
      "}",
      "module Outer() {",
      "  instance Nested = Inner()",
      "  point Q = coordinate(x: 3, y: 4)",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    const parsed = parseDsl(source);
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `live:${index}`] as const))
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const elements = compiled.document!.elements;
    const first = elements.find((element) => element.name === "First")!;
    const second = elements.find((element) => element.name === "Second")!;
    const firstNested = elements.find((element) => element.name === "Nested" && element.parentGroupId === first.id)!;
    const secondNested = elements.find((element) => element.name === "Nested" && element.parentGroupId === second.id)!;
    const firstBody = elements.find((element) => element.name === "Body" && element.parentGroupId === firstNested.id)!;
    const secondBody = elements.find((element) => element.name === "Body" && element.parentGroupId === secondNested.id)!;
    const firstPoint = elements.find((element) => element.name === "P" && element.parentGroupId === firstBody.id)!;

    const selected = [first, second, firstNested, secondBody, firstPoint];
    expect(selected.every(Boolean)).toBe(true);
    expect(selectedElementSourcesForCanvasObservation(selected.map((element) => element.id), compiled, elements)).toEqual([
      { runtimeElementId: first.id, runtimeKind: "moduleInstance", sourceStatementPath: [10] },
      { runtimeElementId: second.id, runtimeKind: "moduleInstance", sourceStatementPath: [11] },
      { runtimeElementId: firstNested.id, runtimeKind: "moduleInstance", sourceStatementPath: [10, 7] },
      { runtimeElementId: secondBody.id, runtimeKind: "moduleBody", sourceStatementPath: [11, 7, 2] },
      { runtimeElementId: firstPoint.id, runtimeKind: "moduleBody", sourceStatementPath: [10, 7, 3] }
    ]);
  });

  it("treats missing issue arrays in partial evaluation fixtures as empty observation facts", () => {
    const result = snapshot({
      state: evaluationState({
        evaluation: { computedGeometry: new Map() } as EvaluationEngineState["evaluation"]
      })
    });

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.errorSummaries).toEqual([]);
    expect(result.warningSummaries).toEqual([]);
  });

  it("updates element selection without changing the evaluation identity", () => {
    const result = snapshot({ selectedElementIds: ["line-c"] });
    expect(result.selectedElementIds).toEqual(["line-c"]);
    expect(result.evaluationRequestRevision).toBe(34);
  });

  it("does not leak stale element selection or source ownership for a binding selection", () => {
    const result = snapshot({
      selectionSubject: { kind: "binding", bindingId: "binding:waist" },
      selectedElementIds: ["stale-element"],
      selectedElementSources: [{
        runtimeElementId: "stale-element",
        sourceStatementIndex: 2,
        elementType: "line"
      }]
    });
    expect(result.selectionSubject).toEqual({ kind: "binding", bindingId: "binding:waist" });
    expect(result.selectedElementIds).toEqual([]);
    expect(result.selectedElementSources).toEqual([]);
  });

  it("preserves evaluationStateIsCurrentFor semantics", () => {
    expect(snapshot({
      state: evaluationState({ status: "evaluating", source: "reference" })
    }).isCurrent).toBe(true);
    expect(snapshot({
      state: evaluationState({ status: "evaluating", source: "rust" })
    }).isCurrent).toBe(false);
    expect(snapshot({
      state: evaluationState({ status: "ready", isStale: true })
    }).isCurrent).toBe(false);
    expect(snapshot({
      state: evaluationState({ status: "failed", source: "fallback" })
    }).isCurrent).toBe(true);
    expect(snapshot({
      state: evaluationState({ evaluationRevision: 11 })
    }).isCurrent).toBe(false);
  });

  it("marks preview-active without changing canonical evaluation provenance", () => {
    const result = snapshot({ previewActive: true });
    expect(result.previewActive).toBe(true);
    expect(result.evaluationRevision).toBe(12);
    expect(result.evaluationSource).toBe("rust");
  });
});
