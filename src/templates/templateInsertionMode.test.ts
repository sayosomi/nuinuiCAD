import { describe, expect, it } from "vitest";
import type { GroupTemplate } from "./groupTemplate";
import {
  defaultTemplateInputValues,
  templateInsertionCanConfirm,
  templateInputProgress,
  type ActiveTemplateInsertion
} from "./templateInsertionMode";

const template: GroupTemplate = {
  id: "template",
  name: "袖",
  rootGroupId: "group",
  elements: [],
  inputs: [
    { id: "point:p", kind: "point", label: "基準点", sourceElementId: "p" },
    { id: "line:l", kind: "line", label: "基準線", sourceElementId: "l" }
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
  it("requires only point and line inputs", () => {
    expect(defaultTemplateInputValues(template)).toEqual({ "point:p": "", "line:l": "" });
    expect(templateInputProgress(insertion())).toEqual({ completed: 0, total: 2 });
    expect(templateInsertionCanConfirm(insertion())).toBe(false);
    expect(templateInsertionCanConfirm(insertion({ "point:p": "p", "line:l": "l" }))).toBe(true);
  });
});
