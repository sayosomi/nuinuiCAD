import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { cycleElementActivity, setElementActivity, setElementsActivity } from "./selectionCommands";

const twoPointsAndVariableSource = [
  "nui 2",
  "point A = coordinate(x: 0 y: 0)",
  "point B = coordinate(x: 1 y: 1)",
  "var W = 10"
].join("\n");

const elementNamed = (name: string) => useCadDocumentStore.getState().elements.find((element) => element.name === name)!;

describe("activity commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(twoPointsAndVariableSource, "test");
  });

  it("cycles a drawable element through all three states back to the start", () => {
    const pointA = elementNamed("A");

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ visible: false, enabled: true });

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ visible: true, enabled: false });

    cycleElementActivity(pointA.id);
    expect(elementNamed("A")).toMatchObject({ visible: true, enabled: true });
  });

  it("skips hidden when cycling a non-drawable element, and recovers forward from a legacy hidden state", () => {
    const variable = elementNamed("W");

    cycleElementActivity(variable.id);
    expect(elementNamed("W")).toMatchObject({ visible: true, enabled: false });

    cycleElementActivity(variable.id);
    expect(elementNamed("W")).toMatchObject({ visible: true, enabled: true });

    useCadDocumentStore.setState({
      elements: useCadDocumentStore.getState().elements.map((element) =>
        element.id === variable.id ? { ...element, visible: false, enabled: true } : element
      )
    });
    cycleElementActivity(variable.id);
    expect(elementNamed("W")).toMatchObject({ visible: true, enabled: false });
  });

  it("applies a single-element direct-set through setElementActivity", () => {
    const pointA = elementNamed("A");

    setElementActivity(pointA.id, "disabled");

    expect(elementNamed("A")).toMatchObject({ visible: true, enabled: false });
  });

  it("applies a multi-selection direct-set in exactly one Undo entry", () => {
    const pointA = elementNamed("A");
    const pointB = elementNamed("B");
    useCadUiStore.getState().setSelectedElementIds([pointA.id, pointB.id]);
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementsActivity("hidden");

    expect(elementNamed("A")).toMatchObject({ visible: false, enabled: true });
    expect(elementNamed("B")).toMatchObject({ visible: false, enabled: true });
    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore + 1);
  });

  it("does not commit when a single-element direct-set targets the current state", () => {
    const pointA = elementNamed("A");
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementActivity(pointA.id, "visible");

    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore);
  });

  it("does not commit when a hidden direct-set only targets non-drawable elements", () => {
    const variable = elementNamed("W");
    useCadUiStore.getState().setSelectedElementIds([variable.id]);
    const pastLengthBefore = useCadDocumentStore.getState().past.length;

    setElementsActivity("hidden");

    expect(elementNamed("W")).toMatchObject({ visible: true, enabled: true });
    expect(useCadDocumentStore.getState().past.length).toBe(pastLengthBefore);
  });

  it("skips only the non-drawable member of a mixed selection when setting hidden", () => {
    const pointA = elementNamed("A");
    const variable = elementNamed("W");
    useCadUiStore.getState().setSelectedElementIds([pointA.id, variable.id]);

    setElementsActivity("hidden");

    expect(elementNamed("A")).toMatchObject({ visible: false, enabled: true });
    expect(elementNamed("W")).toMatchObject({ visible: true, enabled: true });
  });
});
