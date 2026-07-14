import { describe, expect, it } from "vitest";
import { derivedAnchor, referenceAnchor } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";
import { creationRecipeForType } from "./creationRecipes";
import { fillCurrentStep, startSession } from "./commandLineSession";
import {
  directCommandLineReferenceIds,
  promoteDirectlyReferencedUnnamedElements
} from "./commandLineUnnamedPromotion";

const point = (id: string, name = ""): CadElement => ({
  id,
  name,
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0
});

const line = (id: string, name = ""): CadElement => ({
  id,
  name,
  type: "line",
  visible: true,
  enabled: true,
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  endPoint: { mode: "coordinate", x: 10, y: 0 }
});

describe("command-line unnamed promotion", () => {
  it("collects direct session references in recipe order without mistaking unknown numeric tokens for ids", () => {
    const elements = [point("first"), point("second"), line("base"), point("unrelated")];
    let session = startSession(creationRecipeForType("angleLengthLine")!, {
      insertionIndex: elements.length,
      revision: 1,
      elements
    });
    session = fillCurrentStep(session, {
      mode: "coordinate",
      x: { kind: "expression", expression: "second.length + unknown.length" },
      y: { kind: "expression", expression: "base.length" }
    });
    session = fillCurrentStep(session, { kind: "expression", expression: "first.length + second.length" });
    session = fillCurrentStep(session, 20);
    session = fillCurrentStep(session, "方向線");

    expect(directCommandLineReferenceIds(session, elements)).toEqual(["second", "base", "first"]);
  });

  it("uses existing value types, de-duplicates ids, and promotes only direct unnamed sources", () => {
    const elements = [point("named", "点"), point("first"), point("second"), line("base"), point("unrelated")];
    let session = startSession(creationRecipeForType("copyLine")!, {
      insertionIndex: elements.length,
      revision: 1,
      elements
    });
    session = fillCurrentStep(session, ["base", "base"]);
    session = fillCurrentStep(session, referenceAnchor("second"));
    session = fillCurrentStep(session, derivedAnchor("first", "end"));

    const promotion = promoteDirectlyReferencedUnnamedElements(session, elements);
    expect(promotion.promotedElementIds).toEqual(["base", "second", "first"]);
    expect(promotion.elements.map((element) => [element.id, element.name])).toEqual([
      ["named", "点"],
      ["first", "点 3"],
      ["second", "点 2"],
      ["base", "直線"],
      ["unrelated", ""]
    ]);
  });
});
