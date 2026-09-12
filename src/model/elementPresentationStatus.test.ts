import { beforeEach, describe, expect, it } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { createElementPresentationStatusIndex } from "./elementPresentationStatus";

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
});

describe("createElementPresentationStatusIndex", () => {
  it("exposes hidden and disabled activity without requiring legacy print fields", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point Hidden = coordinate(x: 0, y: 0, visible: false)",
      "point Disabled = coordinate(x: 1, y: 0, enabled: false)"
    ].join("\n"), "test");
    const state = useCadDocumentStore.getState();
    const status = createElementPresentationStatusIndex({
      elements: state.elements,
      evaluation: emptyEvaluationResult(state.elements),
      groupFoldById: new Map(),
      visibilityProfiles: state.visibilityProfiles,
      activeVisibilityProfileId: state.activeVisibilityProfileId
    });

    const hidden = state.elements.find((element) => element.name === "Hidden")!;
    const disabled = state.elements.find((element) => element.name === "Disabled")!;
    expect(status.get(hidden.id)).toMatchObject({ hiddenSelf: true, disabledSelf: false });
    expect(status.get(disabled.id)).toMatchObject({ hiddenSelf: false, disabledSelf: true });
  });

  it("does not project occurrence-owned geometry value errors onto drawable elements or groups", () => {
    const state = initialCadDocumentState();
    const elements = [
      { id: "group", name: "G", type: "group" as const, activity: "visible" as const },
      { id: "point", name: "P", type: "freePoint" as const, activity: "visible" as const, parentGroupId: "group", x: 0, y: 0 }
    ];
    const status = createElementPresentationStatusIndex({
      elements,
      evaluation: {
        ...emptyEvaluationResult(elements),
        geometryValueErrors: [{
          occurrence: { sourceStatementId: "statement:value", instancePath: ["instance:one"] },
          message: "Geometry value construction is incompatible with its declared interface type."
        }]
      },
      groupFoldById: new Map(),
      visibilityProfiles: state.visibilityProfiles,
      activeVisibilityProfileId: state.activeVisibilityProfileId
    });

    expect(status.get(elements[1]!.id)?.hasError).toBe(false);
    expect(status.get(elements[0]!.id)?.hasError).toBe(false);
  });
});
