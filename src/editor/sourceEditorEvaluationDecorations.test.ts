import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { createStatementRangeIndex } from "./statementRangeIndex";
import { createEvaluationDecorationIndex, entriesInVisibleRanges } from "./sourceEditorEvaluationIndex";
import { defaultDocumentPalette } from "../palette/palette";
import type { CadElement, EvaluationResult, ForGroupGeneratedRow } from "../types/geometry";

const rangesFor = (source: string) => {
  const result = compileDslDocument(source);
  expect(result.document).not.toBeNull();
  expect(result.statementMap).not.toBeNull();
  const doc = Text.of(source.split("\n"));
  return { doc, ranges: createStatementRangeIndex(doc, result.statementMap!), elements: result.document!.elements };
};

const baseEvaluation = (elements: CadElement[]): EvaluationResult => ({
  computedGeometry: new Map(),
  computedVariables: new Map(),
  errors: [],
  warnings: [],
  evaluatedElementIds: new Set(elements.map((element) => element.id))
});

const indexFor = (ranges: ReturnType<typeof rangesFor>["ranges"], elements: CadElement[], evaluation: EvaluationResult, folds = new Map()) =>
  createEvaluationDecorationIndex({
    ranges,
    elements,
    evaluation,
    groupFoldById: folds,
    palette: defaultDocumentPalette(),
    visibilityProfiles: [],
    activeVisibilityProfileId: "",
    pickCandidates: []
  });

describe("Evaluation decoration viewport index", () => {
  it("uses a sorted lookup for a distant viewport instead of scanning every document line", () => {
    let reads = 0;
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      from: index * 10,
      get to() {
        reads += 1;
        return index * 10 + 8;
      }
    }));
    const result = entriesInVisibleRanges(entries, [{ from: 9900, to: 9908 }]);

    expect(result).toHaveLength(1);
    expect(reads).toBeLessThan(30);
  });

  it("only returns statuses for ranges intersecting the given viewport", () => {
    const { doc, ranges, elements } = rangesFor("nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)");
    const evaluation = baseEvaluation(elements);
    const pointB = elements.find((element) => element.name === "B")!;
    const line3 = doc.line(3);

    const index = indexFor(ranges, elements, evaluation);
    const statuses = entriesInVisibleRanges(index.statuses, [
      { from: line3.from, to: line3.to }
    ]);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].elementId).toBe(pointB.id);
  });

  it("marks hasError/hasWarning/isEvaluated from the evaluation result", () => {
    const { doc, ranges, elements } = rangesFor("nui 2\npoint A = coordinate(x: 0 y: 0)");
    const pointA = elements.find((element) => element.name === "A")!;
    const evaluation: EvaluationResult = {
      ...baseEvaluation([]),
      errors: [{ elementId: pointA.id, elementName: pointA.name, missingDependencyId: pointA.id, message: "boom" }],
      evaluatedElementIds: new Set()
    };
    const statuses = entriesInVisibleRanges(indexFor(ranges, elements, evaluation).statuses, [{ from: 0, to: doc.length }]);
    expect(statuses[0].hasError).toBe(true);
    expect(statuses[0].isEvaluated).toBe(false);
  });

  it("keeps own element state separate from ancestor and evaluation state", () => {
    const { doc, ranges, elements } = rangesFor("nui 2\npoint A = coordinate(x: 0 y: 0)");
    const point = { ...elements[0], visible: false, enabled: false };
    const status = entriesInVisibleRanges(indexFor(ranges, [point], {
      ...baseEvaluation([point]),
      evaluatedElementIds: new Set()
    }).statuses, [{ from: 0, to: doc.length }])[0];

    expect(status).toMatchObject({ hiddenSelf: true, disabledSelf: true, isEvaluated: false });
  });
});

const forGroupSource = [
  "nui 2",
  "for 繰返し (i from: 0 count: 2 step: 1 showGenerated: true) {",
  "  point P = coordinate(x: i y: 0)",
  "}"
].join("\n");

describe("for-group generated widget index", () => {
  it("returns no widgets when nothing is generated or the group is collapsed", () => {
    const { doc, ranges, elements } = rangesFor(forGroupSource);
    const evaluation = baseEvaluation(elements);
    const specs = entriesInVisibleRanges(indexFor(ranges, elements, evaluation).generatedWidgets.map((spec) => ({ ...spec, from: spec.afterPos, to: spec.afterPos })), [{ from: 0, to: doc.length }]);
    expect(specs).toHaveLength(0);
  });

  it("anchors the widget to the last visible descendant when the group is expanded and has generated rows", () => {
    const { doc, ranges, elements } = rangesFor(forGroupSource);
    const forGroup = elements.find((element) => element.type === "forGroup")!;
    const child = elements.find((element) => element.parentGroupId === forGroup.id)!;
    const generatedRows: ForGroupGeneratedRow[] = [
      {
        forGroupId: forGroup.id,
        templateElementId: child.id,
        generatedElementId: "gen-1",
        iterationIndex: 0,
        variableName: "i",
        variableValue: 0,
        elementName: "P (i=0)",
        elementType: "freePoint"
      }
    ];
    const evaluation: EvaluationResult = { ...baseEvaluation(elements), forGroupGeneratedRows: generatedRows };
    const groupFoldById = new Map([[forGroup.id, { expanded: true }]]);

    const specs = entriesInVisibleRanges(indexFor(ranges, elements, evaluation, groupFoldById).generatedWidgets.map((spec) => ({ ...spec, from: spec.afterPos, to: spec.afterPos })), [{ from: 0, to: doc.length }]);

    expect(specs).toHaveLength(1);
    expect(specs[0].forGroupId).toBe(forGroup.id);
    expect(specs[0].afterPos).toBe(ranges.get(child.id)!.to);
    expect(specs[0].rows).toEqual(generatedRows);
  });
});

describe("pick candidate index", () => {
  it("filters candidates to visible ranges and flags the cursor candidate", () => {
    const { doc, ranges, elements } = rangesFor("nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)");
    const pointA = elements.find((element) => element.name === "A")!;
    const pointB = elements.find((element) => element.name === "B")!;
    const index = createEvaluationDecorationIndex({
      ranges,
      elements,
      evaluation: baseEvaluation(elements),
      groupFoldById: new Map(),
      palette: defaultDocumentPalette(),
      visibilityProfiles: [],
      activeVisibilityProfileId: "",
      pickCandidates: [
        { elementId: pointA.id, options: [] },
        { elementId: pointB.id, options: [] }
      ]
    });
    const lines = entriesInVisibleRanges(index.pickLines, [{ from: 0, to: doc.length }]);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.elementId === pointB.id)).toBeTruthy();
    expect(lines.find((line) => line.elementId === pointA.id)).toBeTruthy();
  });
});
