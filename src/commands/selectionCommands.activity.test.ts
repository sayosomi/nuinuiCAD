import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { cycleElementActivity, setElementActivity, setElementsActivity } from "./selectionCommands";

const twoPointsAndVariableSource = [
  "nui 3",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 1, y: 1)",
  "line AB = segment(start: A, end: B)",
  "extend(end: AB.start, to: A, id: W)"
].join("\n");

const elementNamed = (name: string) => useCadDocumentStore.getState().elements.find((element) => element.name === name)!;
const elementById = (id: string) => useCadDocumentStore.getState().elements.find((element) => element.id === id)!;

describe("activity commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(twoPointsAndVariableSource, "test");
  });

  it("cycles a drawable element through all three states back to the start", () => {
    const pointA = elementNamed("A");

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ activity: "hidden" });

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ activity: "disabled" });

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ activity: "visible" });
  });

  // A "legacy hidden state" recovery scenario (forcing `activity: "hidden"`
  // onto a non-drawable element via a raw setState, then cycling it forward)
  // used to be covered here too. It no longer applies: `state: hidden` on a
  // bare mutation-statement type (edge/extendTrim/move/symmetricMove/
  // pathReverse) is now a hard parse-time diagnostic (dslCallParser.ts's
  // validateArgs), so there is no legal DSL text this in-memory state could
  // ever have round-tripped through in the first place - forcing it via
  // setState only fabricates a store/text divergence that
  // regenerateCanonicalFromModel cannot recover from, which is exactly the
  // failure mode the diagnostic exists to make impossible. The pure
  // hidden -> disabled skip is still covered at the elementActivity.ts unit
  // level (see nextElementActivity("hidden", "extendTrim") in
  // elementActivity.test.ts).
  it("skips hidden when cycling a non-drawable element", () => {
    const variable = elementById("W");

    cycleElementActivity(variable.id);
    expect(elementById("W")).toMatchObject({ activity: "disabled" });

    cycleElementActivity(variable.id);
    expect(elementById("W")).toMatchObject({ activity: "visible" });
  });

  it("applies a single-element direct-set through setElementActivity", () => {
    const pointA = elementNamed("A");

    setElementActivity(pointA.id, "disabled");

    expect(elementNamed("A")).toMatchObject({ activity: "disabled" });
  });

  it("applies a multi-selection direct-set in exactly one Undo entry", () => {
    const pointA = elementNamed("A");
    const pointB = elementNamed("B");
    useCadUiStore.getState().setSelectedElementIds([pointA.id, pointB.id]);
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementsActivity("hidden");

    expect(elementNamed("A")).toMatchObject({ activity: "hidden" });
    expect(elementNamed("B")).toMatchObject({ activity: "hidden" });
    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore + 1);
  });

  it("does not commit when a single-element direct-set targets the current state", () => {
    const pointA = elementNamed("A");
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementActivity(pointA.id, "visible");

    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore);
  });

  it("does not commit when a hidden direct-set only targets non-drawable elements", () => {
    const variable = elementById("W");
    useCadUiStore.getState().setSelectedElementIds([variable.id]);
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementsActivity("hidden");

    expect(elementById("W")).toMatchObject({ activity: "visible" });
    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore);
  });

  it("skips only the non-drawable member of a mixed selection when setting hidden", () => {
    const pointA = elementNamed("A");
    const variable = elementById("W");
    useCadUiStore.getState().setSelectedElementIds([pointA.id, variable.id]);

    setElementsActivity("hidden");

    expect(elementNamed("A")).toMatchObject({ activity: "hidden" });
    expect(elementById("W")).toMatchObject({ activity: "visible" });
  });
});
