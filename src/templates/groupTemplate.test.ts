import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  createTemplateFromGroup,
  instantiateGroupTemplate
} from "./groupTemplate";

const elements: CadElement[] = [
  {
    id: "bodice-point",
    name: "身頃点",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "bodice-line",
    name: "身頃線",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "bodice-point" },
    endPoint: { mode: "coordinate", x: 100, y: 0 }
  },
  {
    id: "sleeve",
    name: "袖",
    type: "group",
    visible: true,
    enabled: true,
  },
  {
    id: "sleeve-length",
    name: "袖丈",
    type: "variable",
    visible: true,
    enabled: true,
    parentGroupId: "sleeve",
    scope: "group",
    valueMode: "expression",
    expression: 55,
    point1: { mode: "reference", pointId: "bodice-point" },
    point2: { mode: "reference", pointId: "bodice-point" },
    point: { mode: "reference", pointId: "bodice-point" },
    lineId: "bodice-line"
  },
  {
    id: "sleeve-point",
    name: "袖点",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    parentGroupId: "sleeve",
    fromPoint: { mode: "reference", pointId: "bodice-point" },
    fromPointId: "bodice-point",
    dx: { kind: "expression", expression: "@袖丈" },
    dy: { kind: "expression", expression: "bodice-line.length / 2" }
  },
  {
    id: "sleeve-line",
    name: "袖線",
    type: "line",
    visible: true,
    enabled: true,
    parentGroupId: "sleeve",
    startPoint: { mode: "reference", pointId: "sleeve-point" },
    endPoint: { mode: "reference", pointId: "bodice-point" }
  }
];

describe("group templates", () => {
  it("creates inputs for external point and line references plus selected variables", () => {
    const template = createTemplateFromGroup({
      elements,
      groupId: "sleeve",
      numericVariableElementIds: ["sleeve-length"]
    });

    expect(template.elements.map((element) => element.id)).toEqual([
      "sleeve",
      "sleeve-length",
      "sleeve-point",
      "sleeve-line"
    ]);
    expect(template.inputs).toEqual([
      {
        id: "point:bodice-point",
        kind: "point",
        label: "身頃点",
        sourceElementId: "bodice-point"
      },
      {
        id: "line:bodice-line",
        kind: "line",
        label: "身頃線",
        sourceElementId: "bodice-line"
      },
      {
        id: "numeric:sleeve-length",
        kind: "numeric",
        label: "袖丈",
        variableElementId: "sleeve-length",
        defaultValue: 55
      }
    ]);
  });

  it("instantiates templates by remapping internal references and applying inputs", () => {
    const template = createTemplateFromGroup({
      elements,
      groupId: "sleeve",
      numericVariableElementIds: ["sleeve-length"]
    });
    const change = instantiateGroupTemplate({
      elements,
      template,
      inputValues: {
        "point:bodice-point": "bodice-point",
        "line:bodice-line": "bodice-line",
        "numeric:sleeve-length": { kind: "expression", expression: "bodice-line.length + 10" }
      },
      insertionIndex: elements.length
    });
    const inserted = change.elements.slice(elements.length);
    const insertedGroup = inserted.find((element) => element.type === "group");
    const insertedVariable = inserted.find((element) => element.type === "variable");
    const insertedPoint = inserted.find((element) => element.type === "offsetPoint");
    const insertedLine = inserted.find((element) => element.type === "line");

    expect(inserted).toHaveLength(4);
    expect(insertedGroup?.id).not.toBe("sleeve");
    expect(insertedVariable).toMatchObject({
      type: "variable",
      parentGroupId: insertedGroup?.id,
      expression: { kind: "expression", expression: "bodice-line.length + 10" }
    });
    expect(insertedPoint).toMatchObject({
      type: "offsetPoint",
      parentGroupId: insertedGroup?.id,
      fromPoint: { mode: "reference", pointId: "bodice-point" },
      fromPointId: "bodice-point",
      dy: { kind: "expression", expression: "bodice-line.length / 2" }
    });
    expect(insertedLine).toMatchObject({
      type: "line",
      parentGroupId: insertedGroup?.id,
      startPoint: { mode: "reference", pointId: insertedPoint?.id },
      endPoint: { mode: "reference", pointId: "bodice-point" }
    });
  });

  it("remaps variable id references inside inserted template numeric expressions", () => {
    const sourceElements: CadElement[] = [
      {
        id: "anchor",
        name: "基準点",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "guide",
        name: "印刷ガイド",
        type: "group",
        visible: true,
        enabled: true,
      },
      {
        id: "scale",
        name: "倍率",
        type: "variable",
        visible: true,
        enabled: true,
        parentGroupId: "guide",
        scope: "group",
        valueMode: "expression",
        expression: 1,
        point1: { mode: "reference", pointId: "anchor" },
        point2: { mode: "reference", pointId: "anchor" },
        point: { mode: "reference", pointId: "anchor" },
        lineId: ""
      },
      {
        id: "print-size",
        name: "印刷時のサイズ",
        type: "variable",
        visible: true,
        enabled: true,
        parentGroupId: "guide",
        scope: "group",
        valueMode: "expression",
        expression: 50,
        point1: { mode: "reference", pointId: "anchor" },
        point2: { mode: "reference", pointId: "anchor" },
        point: { mode: "reference", pointId: "anchor" },
        lineId: ""
      },
      {
        id: "draw-size",
        name: "描画サイズ",
        type: "variable",
        visible: true,
        enabled: true,
        parentGroupId: "guide",
        scope: "group",
        valueMode: "expression",
        expression: { kind: "expression", expression: "@print-size * @scale" },
        point1: { mode: "reference", pointId: "anchor" },
        point2: { mode: "reference", pointId: "anchor" },
        point: { mode: "reference", pointId: "anchor" },
        lineId: ""
      },
      {
        id: "draw-point",
        name: "描画点",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        parentGroupId: "guide",
        fromPoint: { mode: "reference", pointId: "anchor" },
        fromPointId: "anchor",
        dx: { kind: "expression", expression: "@draw-size" },
        dy: 0
      }
    ];
    const template = createTemplateFromGroup({
      elements: sourceElements,
      groupId: "guide",
      numericVariableElementIds: []
    });

    const change = instantiateGroupTemplate({
      elements: sourceElements,
      template,
      inputValues: {
        "point:anchor": "anchor"
      },
      insertionIndex: sourceElements.length
    });
    const inserted = change.elements.slice(sourceElements.length);
    const insertedScale = inserted[1];
    const insertedPrintSize = inserted[2];
    const insertedDrawSize = inserted[3];
    const insertedPoint = inserted[4];

    expect(insertedDrawSize).toMatchObject({
      type: "variable",
      expression: {
        kind: "expression",
        expression: `@${insertedPrintSize?.id} * @${insertedScale?.id}`
      }
    });
    expect(insertedPoint).toMatchObject({
      type: "offsetPoint",
      dx: {
        kind: "expression",
        expression: `@${insertedDrawSize?.id}`
      }
    });
  });

  it("applies picked point anchors to point template inputs", () => {
    const template = createTemplateFromGroup({
      elements,
      groupId: "sleeve",
      numericVariableElementIds: []
    });
    const change = instantiateGroupTemplate({
      elements,
      template,
      inputValues: {
        "point:bodice-point": { mode: "derived", elementId: "bodice-line", pointKey: "end" },
        "line:bodice-line": "bodice-line"
      },
      insertionIndex: elements.length
    });
    const inserted = change.elements.slice(elements.length);
    const insertedPoint = inserted.find((element) => element.type === "offsetPoint");
    const insertedLine = inserted.find((element) => element.type === "line");

    expect(insertedPoint).toMatchObject({
      type: "offsetPoint",
      fromPoint: { mode: "derived", elementId: "bodice-line", pointKey: "end" }
    });
    expect(insertedPoint).toHaveProperty("fromPointId", undefined);
    expect(insertedLine).toMatchObject({
      type: "line",
      endPoint: { mode: "derived", elementId: "bodice-line", pointKey: "end" }
    });
  });

  it("places the inserted template root inside the target parent group", () => {
    const template = createTemplateFromGroup({
      elements,
      groupId: "sleeve",
      numericVariableElementIds: []
    });
    const change = instantiateGroupTemplate({
      elements,
      template,
      inputValues: {
        "point:bodice-point": "bodice-point",
        "line:bodice-line": "bodice-line"
      },
      insertionIndex: elements.length,
      parentGroupId: "outer"
    });
    const inserted = change.elements.slice(elements.length);
    const insertedGroup = inserted.find((element) => element.type === "group");
    const insertedChild = inserted.find((element) => element.type === "offsetPoint");

    expect(insertedGroup).toMatchObject({
      type: "group",
      parentGroupId: "outer"
    });
    expect(insertedChild).toMatchObject({
      type: "offsetPoint",
      parentGroupId: insertedGroup?.id
    });
  });

  it("places the inserted template root in the target conditional branch", () => {
    const template = createTemplateFromGroup({
      elements,
      groupId: "sleeve",
      numericVariableElementIds: []
    });
    const change = instantiateGroupTemplate({
      elements,
      template,
      inputValues: {
        "point:bodice-point": "bodice-point",
        "line:bodice-line": "bodice-line"
      },
      insertionIndex: elements.length,
      parentGroupId: "if",
      conditionalBranch: "else"
    });
    const inserted = change.elements.slice(elements.length);
    const insertedGroup = inserted.find((element) => element.type === "group");
    const insertedChild = inserted.find((element) => element.type === "line");

    expect(insertedGroup).toMatchObject({
      type: "group",
      parentGroupId: "if",
      conditionalBranch: "else"
    });
    expect(insertedChild).toMatchObject({
      type: "line",
      parentGroupId: insertedGroup?.id
    });
  });
});
