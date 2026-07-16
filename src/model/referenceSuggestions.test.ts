import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { PickCandidate } from "./pickCandidates";
import { pickRefForOption, pickRefKey } from "./pickReferences";
import { rankedReferenceSuggestions, referenceSuggestions } from "./referenceSuggestions";

const pointElement = (id: string, name: string, parentGroupId?: string): CadElement => ({
  id,
  name,
  type: "freePoint",
  visible: true,
  enabled: true,
  ...(parentGroupId ? { parentGroupId } : {}),
  x: 0,
  y: 0
});

describe("referenceSuggestions", () => {
  it("keeps direct points, derived points, and lines collision-free", () => {
    const refs = [
      pickRefForOption("same", {
        kind: "point",
        label: "same",
        anchor: { mode: "reference", pointId: "same" }
      }),
      pickRefForOption("same", {
        kind: "point",
        label: "same.start",
        anchor: { mode: "derived", elementId: "same", pointKey: "start" }
      }),
      pickRefForOption("same", { kind: "line", label: "same", lineId: "same" })
    ];

    expect(new Set(refs.map(pickRefKey)).size).toBe(3);
    expect(refs.map((ref) => ref.kind)).toEqual(["point:reference", "point:derived", "line"]);
  });

  it("separates qualified display labels, canonical DSL tokens, and search aliases", () => {
    const elements: CadElement[] = [
      { id: "left", name: "Left", type: "group", visible: true, enabled: true },
      pointElement("left-point", "Same", "left"),
      { id: "right", name: "Right", type: "group", visible: true, enabled: true },
      pointElement("right-point", "Same", "right")
    ];
    const candidates: PickCandidate[] = ["left-point", "right-point"].map((id) => ({
      elementId: id,
      options: [{ kind: "point", label: "Same", anchor: { mode: "reference", pointId: id } }]
    }));
    const suggestions = referenceSuggestions({ candidates, elements });

    expect(suggestions.map((item) => item.displayLabel)).toEqual(["Left::Same", "Right::Same"]);
    expect(suggestions.map((item) => item.canonicalToken)).toEqual(["Left::Same", "Right::Same"]);
    expect(rankedReferenceSuggestions(suggestions, "Same").map((item) => item.displayLabel))
      .toEqual(["Left::Same", "Right::Same"]);
  });

  it("caps at eight and preserves document order for equal-rank matches", () => {
    const elements = Array.from({ length: 12 }, (_, index) => pointElement(`p${index}`, `Point${index}`));
    elements[4] = { ...elements[4], visible: false };
    const candidates: PickCandidate[] = elements.map((element) => ({
      elementId: element.id,
      options: [{
        kind: "point",
        label: element.name,
        anchor: { mode: "reference", pointId: element.id }
      }]
    }));
    const ranked = rankedReferenceSuggestions(referenceSuggestions({ candidates, elements }), "Point");

    expect(ranked).toHaveLength(8);
    expect(ranked.map((item) => item.displayLabel)).toEqual(elements.slice(0, 8).map((element) => element.name));
    expect(ranked.map((item) => item.displayLabel)).toContain("Point4");
  });
});
