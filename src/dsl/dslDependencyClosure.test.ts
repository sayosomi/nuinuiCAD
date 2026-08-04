import { describe, expect, it } from "vitest";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { createDslExportSelection, dslExportAnnotationComment } from "./dslDependencyClosure";

const point = (id: string, patch: Partial<CadElement> = {}): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0,
  ...patch
} as CadElement);

const line = (
  id: string,
  startId: string,
  endId: string,
  patch: Partial<CadElement> = {}
): CadElement => ({
  id,
  name: id,
  type: "line",
  activity: "visible",
  startPoint: { mode: "reference", pointId: startId },
  endPoint: { mode: "reference", pointId: endId },
  ...patch
} as CadElement);

const group = (id: string, patch: Partial<CadElement> = {}): CadElement => ({
  id,
  name: id,
  type: "group",
  activity: "visible",
  ...patch
} as CadElement);

const emptyEvaluation = (errors: EvaluationResult["errors"] = []): EvaluationResult => ({
  computedGeometry: new Map(),
  errors,
  warnings: []
});

const origins = (selection: ReturnType<typeof createDslExportSelection>) =>
  Object.fromEntries(
    [...selection.annotationsByElementId].map(([id, annotation]) => [id, annotation.origin])
  );

describe("DSL dependency closure export", () => {
  it("includes mixed selection dependencies once in document order", () => {
    const elements = [
      point("a"),
      point("b"),
      line("ab", "a", "b"),
      point("c"),
      line("bc", "b", "c")
    ];

    const selection = createDslExportSelection({
      elements,
      selectedElementIds: ["bc", "ab"]
    });

    expect(selection.elements.map((element) => element.id)).toEqual(["a", "b", "ab", "c", "bc"]);
    expect(origins(selection)).toMatchObject({
      a: "dependency",
      b: "dependency",
      ab: "selected",
      c: "dependency",
      bc: "selected"
    });
  });

  it("exports selected groups with their content and external dependencies", () => {
    const elements = [
      point("outside"),
      group("g"),
      point("inside-a", { parentGroupId: "g" }),
      line("inside-line", "outside", "inside-a", { parentGroupId: "g" })
    ];

    const selection = createDslExportSelection({
      elements,
      selectedElementIds: ["g"]
    });

    expect(selection.elements.map((element) => element.id)).toEqual([
      "outside",
      "g",
      "inside-a",
      "inside-line"
    ]);
    expect(origins(selection)).toMatchObject({
      outside: "dependency",
      g: "selected",
      "inside-a": "group-content",
      "inside-line": "group-content"
    });
  });

  it("includes parent groups for selected children", () => {
    const elements = [
      group("g"),
      point("a", { parentGroupId: "g" }),
      point("b", { parentGroupId: "g" }),
      line("ab", "a", "b", { parentGroupId: "g" })
    ];

    const selection = createDslExportSelection({
      elements,
      selectedElementIds: ["ab"]
    });

    expect(selection.elements.map((element) => element.id)).toEqual(["g", "a", "b", "ab"]);
    expect(origins(selection)).toMatchObject({
      g: "parent",
      a: "dependency",
      b: "dependency",
      ab: "selected"
    });
  });

  it("keeps too-late references in document order and marks the pulled dependency", () => {
    const elements = [
      line("ab", "a", "b"),
      point("a"),
      point("b")
    ];

    const selection = createDslExportSelection({
      elements,
      selectedElementIds: ["ab"]
    });

    expect(selection.elements.map((element) => element.id)).toEqual(["ab", "a", "b"]);
    expect(selection.annotationsByElementId.get("a")?.warnings).toContain("too-late");
    expect(selection.annotationsByElementId.get("b")?.warnings).toContain("too-late");
  });

  it("reports disabled and invalid pulled dependencies", () => {
    const elements = [
      point("a", { activity: "disabled" }),
      point("b"),
      line("ab", "a", "b")
    ];
    const selection = createDslExportSelection({
      elements,
      selectedElementIds: ["ab"],
      evaluation: emptyEvaluation([
        {
          elementId: "a",
          elementName: "a",
          missingDependencyId: "a",
          missingDependencyName: "a",
          message: "invalid"
        }
      ])
    });

    expect(selection.annotationsByElementId.get("a")?.warnings).toEqual(["disabled", "invalid"]);
    expect(selection.warningCounts).toMatchObject({ disabled: 1, invalid: 1, "too-late": 0 });
  });

  it("serializes export annotation comments", () => {
    expect(dslExportAnnotationComment({
      origin: "dependency",
      warnings: ["too-late"]
    })).toBe("# @dsl-export: dependency warning=too-late 選択要素の評価に必要");
  });
});
