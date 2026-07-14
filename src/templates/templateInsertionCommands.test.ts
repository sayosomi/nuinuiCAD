import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { GroupTemplate } from "./groupTemplate";
import {
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
});
