import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  moveEvaluationDividerByOffset,
  moveEvaluationDividerToEnd
} from "./selectionCommands";

const noStopSource = [
  "nui 3",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 1, y: 1)"
].join("\n");

describe("evaluation divider commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("is a complete noop when moving an implicit boundary to document end", () => {
    useCadDocumentStore.getState().commitText(noStopSource, "test");
    const before = useCadDocumentStore.getState();
    const sourceText = before.sourceText;
    const pastLength = before.past.length;

    moveEvaluationDividerToEnd();

    const after = useCadDocumentStore.getState();
    expect(after.evaluationLimitIndex).toBeUndefined();
    expect(after.sourceText).toBe(sourceText);
    expect(after.sourceText).not.toContain("@stop");
    expect(after.past).toHaveLength(pastLength);
  });

  it("is a complete noop when an offset reaches document end without @stop", () => {
    useCadDocumentStore.getState().commitText(noStopSource, "test");
    const before = useCadDocumentStore.getState();
    const sourceText = before.sourceText;
    const pastLength = before.past.length;

    moveEvaluationDividerByOffset(1);

    const after = useCadDocumentStore.getState();
    expect(after.evaluationLimitIndex).toBeUndefined();
    expect(after.sourceText).toBe(sourceText);
    expect(after.past).toHaveLength(pastLength);
  });

  it("keeps an explicit terminal @stop when a middle divider moves to the end", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "@stop",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n"), "test");

    moveEvaluationDividerToEnd();

    const after = useCadDocumentStore.getState();
    expect(after.evaluationLimitIndex).toBe(after.elements.length);
    expect(after.sourceText.split("\n").filter((line) => line === "@stop")).toHaveLength(1);
    expect(after.sourceText.trimEnd().endsWith("@stop")).toBe(true);
  });

  it("continues to move an explicit divider between elements", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "@stop",
      "point B = coordinate(x: 1, y: 1)",
      "point C = coordinate(x: 2, y: 2)"
    ].join("\n"), "test");

    moveEvaluationDividerByOffset(1);

    const after = useCadDocumentStore.getState();
    const lines = after.sourceText.split("\n");
    expect(after.evaluationLimitIndex).toBe(2);
    expect(lines.indexOf("@stop")).toBeGreaterThan(lines.findIndex((line) => line.startsWith("point B")));
    expect(lines.indexOf("@stop")).toBeLessThan(lines.findIndex((line) => line.startsWith("point C")));
  });
});
