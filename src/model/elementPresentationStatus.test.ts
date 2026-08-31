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
      "point Hidden = coordinate(x: 0, y: 0, state: hidden)",
      "point Disabled = coordinate(x: 1, y: 0, state: disabled)"
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
});
