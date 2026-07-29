import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

describe("SourceEditorController source preservation", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  it("keeps escaped literal braces unchanged in the CodeMirror buffer", () => {
    const source = [
      "nui 3",
      'text Label = label(text: "\\{draft\\}" anchor: none size: 3)',
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(controller.getText()).toBe(source);

    controller.destroy();
  });
});
