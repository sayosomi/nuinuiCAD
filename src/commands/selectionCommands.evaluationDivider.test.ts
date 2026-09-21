import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  moveEvaluationDividerByOffset,
  moveEvaluationDividerToEnd
} from "./selectionCommands";

const noStopSource = [
  "nui 1",
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
    expect(after.sourceText).not.toContain("stop");
    expect(after.past).toHaveLength(pastLength);
  });

  it("is a complete noop when an offset reaches document end without stop", () => {
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

});
