import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { GroupTemplate } from "./groupTemplate";
import {
  confirmTemplateInsertion,
  selectTemplateInsertionInputByOffset,
  startTemplateInsertion,
  startTemplateNumericReferenceInsertPick
} from "./templateInsertionCommands";
import {
  TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
  TEMPLATE_INSERTION_PICK_TARGET_ID
} from "./templateInsertionMode";

const template: GroupTemplate = {
  id: "template",
  name: "袖",
  rootGroupId: "group",
  elements: [],
  inputs: [
    { id: "point:p", kind: "point", label: "基準点", sourceElementId: "p" },
    { id: "line:l", kind: "line", label: "基準線", sourceElementId: "l" },
    {
      id: "numeric:v",
      kind: "numeric",
      label: "袖丈",
      variableElementId: "v",
      defaultValue: 55
    }
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("template insertion pick targets", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("stamps the virtual pick targets with the planned insertion index", () => {
    const elementCount = useCadDocumentStore.getState().elements.length;
    startTemplateInsertion({ template, insertionIndex: elementCount });

    expect(useCadUiStore.getState().activePointPickTarget).toEqual({
      elementId: TEMPLATE_INSERTION_PICK_TARGET_ID,
      parameterKey: "point:p",
      insertionIndex: elementCount
    });

    selectTemplateInsertionInputByOffset(1);
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activeLinePickTarget).toEqual({
      elementId: TEMPLATE_INSERTION_PICK_TARGET_ID,
      parameterKey: "line:l",
      insertionIndex: elementCount
    });

    expect(startTemplateNumericReferenceInsertPick({
      inputId: "numeric:v",
      property: "length",
      displayedExpression: "55",
      selectionStart: null,
      selectionEnd: null
    })).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      elementId: TEMPLATE_INSERTION_NUMERIC_TARGET_ID,
      parameterKey: "numeric:v",
      insertionIndex: elementCount
    });
  });

  it("splices a complete template tree at its captured Source Editor line", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0 y: 0)",
      "# insert template here",
      "point B = coordinate(x: 10 y: 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const document = useCadDocumentStore.getState();
    const treeTemplate: GroupTemplate = {
      ...template,
      id: "tree-template",
      rootGroupId: "tree-group",
      inputs: [],
      elements: [
        { id: "tree-group", name: "袖", type: "group", visible: true, enabled: true },
        {
          id: "tree-point",
          name: "袖点",
          type: "freePoint",
          visible: true,
          enabled: true,
          parentGroupId: "tree-group",
          x: 10,
          y: 20
        }
      ]
    };

    expect(startTemplateInsertion({
      template: treeTemplate,
      sourceInsertion: {
        sourceRevision: document.sourceRevision,
        insertionTarget: { insertionIndex: 1 },
        sourceInsertionLine: 3
      }
    })).toBe(true);
    expect(confirmTemplateInsertion()).toBe(true);

    const next = useCadDocumentStore.getState();
    expect(next.sourceText.indexOf("group 袖 {")).toBeLessThan(next.sourceText.indexOf("# insert template here"));
    expect(next.sourceText).toContain("  point 袖点 = coordinate(");
    expect(next.sourceText).toContain("    x: 10");
    expect(next.sourceText).toContain("    y: 20");
    expect(next.elements.map((element) => element.name)).toEqual(["A", "袖", "袖点", "B"]);
  });

  it("cancels a source-anchored template after an external document change", () => {
    useCadDocumentStore.getState().commitText("nui 3\npoint A = coordinate(x: 0 y: 0)", "test");
    const document = useCadDocumentStore.getState();
    expect(startTemplateInsertion({
      template: { ...template, inputs: [] },
      sourceInsertion: {
        sourceRevision: document.sourceRevision,
        insertionTarget: { insertionIndex: 1 },
        sourceInsertionLine: 3
      }
    })).toBe(true);
    useCadDocumentStore.getState().commitText("nui 3\npoint A = coordinate(x: 0 y: 0)\n# changed", "test");

    expect(confirmTemplateInsertion()).toBe(false);
    expect(useCadUiStore.getState().activeTemplateInsertion).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("文書が変更されたため");
  });
});
