import { describe, expect, it } from "vitest";
import type { GroupTemplate } from "./groupTemplate";
import {
  defaultTemplateInputValues,
  nextTemplateInputId,
  templateInputProgress,
  templateInsertionCanConfirm,
  type ActiveTemplateInsertion
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

const insertion = (inputValues = defaultTemplateInputValues(template)): ActiveTemplateInsertion => ({
  template,
  inputValues,
  currentInputId: "point:p",
  insertionIndex: 0,
  sourceInsertion: null,
  error: null
});

describe("template insertion mode", () => {
  it("defaults numeric inputs and leaves point and line inputs empty", () => {
    const values = defaultTemplateInputValues(template);

    expect(values).toEqual({
      "point:p": "",
      "line:l": "",
      "numeric:v": 55
    });
    expect(templateInputProgress(insertion(values))).toEqual({ completed: 1, total: 3 });
    expect(templateInsertionCanConfirm(insertion(values))).toBe(false);
  });

  it("cycles through template inputs", () => {
    const state = insertion();

    expect(nextTemplateInputId(state, 1)).toBe("line:l");
    expect(nextTemplateInputId({ ...state, currentInputId: "numeric:v" }, 1)).toBe("point:p");
    expect(nextTemplateInputId(state, -1)).toBe("numeric:v");
  });

  it("allows confirmation after required point and line inputs are filled", () => {
    const state = insertion({
      ...defaultTemplateInputValues(template),
      "point:p": { mode: "reference", pointId: "p2" },
      "line:l": "l2"
    });

    expect(templateInputProgress(state)).toEqual({ completed: 3, total: 3 });
    expect(templateInsertionCanConfirm(state)).toBe(true);
  });
});
