import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { createStatementRangeIndex } from "./statementRangeIndex";
import {
  forGroupGeneratedWidgetSpecs,
  pickCandidateLines,
  visibleLineStatuses
} from "./sourceEditorEvaluationDecorations";
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

describe("visibleLineStatuses", () => {
  it("only returns statuses for ranges intersecting the given viewport", () => {
    const { doc, ranges, elements } = rangesFor("nui 1\npoint A = (0, 0)\npoint B = (1, 1)");
    const evaluation = baseEvaluation(elements);
    const pointB = elements.find((element) => element.name === "B")!;
    const line3 = doc.line(3);

    const statuses = visibleLineStatuses(ranges, elements, evaluation, new Map(), [
      { from: line3.from, to: line3.to }
    ]);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].elementId).toBe(pointB.id);
  });

  it("marks hasError/hasWarning/isEvaluated from the evaluation result", () => {
    const { doc, ranges, elements } = rangesFor("nui 1\npoint A = (0, 0)");
    const pointA = elements.find((element) => element.name === "A")!;
    const evaluation: EvaluationResult = {
      ...baseEvaluation([]),
      errors: [{ elementId: pointA.id, elementName: pointA.name, missingDependencyId: pointA.id, message: "boom" }],
      evaluatedElementIds: new Set()
    };
    const statuses = visibleLineStatuses(ranges, elements, evaluation, new Map(), [{ from: 0, to: doc.length }]);
    expect(statuses[0].hasError).toBe(true);
    expect(statuses[0].isEvaluated).toBe(false);
  });
});

const forGroupSource = [
  "nui 1",
  "for 繰返し i start=0 count=2 step=1 showGenerated=true {",
  "  point P = (i, 0)",
  "}"
].join("\n");

describe("forGroupGeneratedWidgetSpecs", () => {
  it("returns no widgets when nothing is generated or the group is collapsed", () => {
    const { doc, ranges, elements } = rangesFor(forGroupSource);
    const evaluation = baseEvaluation(elements);
    const specs = forGroupGeneratedWidgetSpecs(ranges, elements, evaluation, new Map(), [
      { from: 0, to: doc.length }
    ]);
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

    const specs = forGroupGeneratedWidgetSpecs(ranges, elements, evaluation, groupFoldById, [
      { from: 0, to: doc.length }
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0].forGroupId).toBe(forGroup.id);
    expect(specs[0].afterPos).toBe(ranges.get(child.id)!.to);
    expect(specs[0].rows).toEqual(generatedRows);
  });
});

describe("pickCandidateLines", () => {
  it("filters candidates to visible ranges and flags the cursor candidate", () => {
    const { doc, ranges, elements } = rangesFor("nui 1\npoint A = (0, 0)\npoint B = (1, 1)");
    const pointA = elements.find((element) => element.name === "A")!;
    const pointB = elements.find((element) => element.name === "B")!;
    const lines = pickCandidateLines(
      ranges,
      [
        { elementId: pointA.id, options: [] },
        { elementId: pointB.id, options: [] }
      ],
      pointB.id,
      [{ from: 0, to: doc.length }]
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.elementId === pointB.id)?.isCursor).toBe(true);
    expect(lines.find((line) => line.elementId === pointA.id)?.isCursor).toBe(false);
  });
});
