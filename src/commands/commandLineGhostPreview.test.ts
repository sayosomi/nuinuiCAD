import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { referenceAnchor } from "../model/pointAnchors";
import { creationRecipeForType } from "./creationRecipes";
import {
  commandLineGhostPreview
} from "./commandLineGhostPreview";
import { fillCurrentStep, skipCurrentStep, startSession } from "./commandLineSession";

const compiled = (source: string) => {
  const result = compileDslDocument(source);
  if (!result.document) throw new Error("fixture did not compile");
  return result.document;
};

const previewFor = (
  session: ReturnType<typeof startSession>,
  source = "nui 1"
) => {
  const document = compiled(source);
  return commandLineGhostPreview({
    session,
    elements: document.elements,
    evaluationLimitIndex: document.evaluationLimitIndex,
    groupFoldById: new Map()
  });
};

describe("command-line ghost preview", () => {
  it("does not turn angleLengthLine's factory-origin start point into a ghost", () => {
    const recipe = creationRecipeForType("angleLengthLine")!;
    const session = startSession(recipe, { insertionIndex: 0, revision: 1, elements: [] });

    expect(previewFor(session)).toBeNull();
  });

  it("waits for a defaulted number to be explicitly skipped before previewing", () => {
    const document = compiled(["nui 1", "line AB = (0, 0) -> (10, 0)"].join("\n"));
    const line = document.elements[0];
    const recipe = creationRecipeForType("lineDivisionPoint")!;
    let session = startSession(recipe, {
      insertionIndex: 1,
      revision: 1,
      elements: document.elements
    });
    session = fillCurrentStep(session, { lineId: line.id, endpointKey: "start" });

    expect(commandLineGhostPreview({
      session,
      elements: document.elements,
      evaluationLimitIndex: document.evaluationLimitIndex,
      groupFoldById: new Map()
    })).toBeNull();

    session = skipCurrentStep(session);
    expect(commandLineGhostPreview({
      session,
      elements: document.elements,
      evaluationLimitIndex: document.evaluationLimitIndex,
      groupFoldById: new Map()
    })?.elements.at(-1)).toMatchObject({ type: "lineDivisionPoint", ratio: 1 });
  });

  it("permits an omitted reference only when its parameter definition explicitly allows none", () => {
    const recipe = creationRecipeForType("text")!;
    const session = startSession(recipe, { insertionIndex: 0, revision: 1, elements: [] });

    expect(previewFor(session)?.elements).toHaveLength(1);
  });

  it("does not preview a fully supplied candidate inserted after @stop", () => {
    const document = compiled(["nui 1", "point A = (0, 0)", "@stop", "point B = (10, 0)"].join("\n"));
    const recipe = creationRecipeForType("line")!;
    let session = startSession(recipe, {
      insertionIndex: document.elements.length,
      revision: 1,
      elements: document.elements
    });
    session = fillCurrentStep(session, referenceAnchor(document.elements[0].id));
    session = fillCurrentStep(session, referenceAnchor(document.elements[1].id));

    expect(commandLineGhostPreview({
      session,
      elements: document.elements,
      evaluationLimitIndex: document.evaluationLimitIndex,
      groupFoldById: new Map()
    })).toBeNull();
  });
});
