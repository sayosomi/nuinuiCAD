import { describe, expect, it } from "vitest";
import {
  activatePickModeDraftEntry,
  movePickModeDraftEntry,
  pickModeDraftForLineIds,
  pickModeDraftForPointAnchors,
  pickModeDraftEntryForOption,
  pickModeSessionForTarget
} from "./pickModeSession";
import { derivedAnchor } from "./pointAnchors";
import type { PickCandidate } from "./pickCandidates";

const pointEntry = (id: string) => pickModeDraftEntryForOption(id, {
  kind: "point",
  label: id,
  anchor: { mode: "reference", pointId: id }
});

const lineEntry = (id: string) => pickModeDraftEntryForOption(id, {
  kind: "line",
  label: id,
  lineId: id
});

describe("Pick Mode session draft", () => {
  it("replaces a different single entry and clears the same entry", () => {
    const target = { elementId: "target", parameterKey: "point" };
    const first = pointEntry("A");
    const second = pointEntry("B");
    const session = pickModeSessionForTarget("point", target)!;

    const selected = activatePickModeDraftEntry(session, first);
    expect(selected.draft).toEqual([first]);
    expect(activatePickModeDraftEntry(selected, second).draft).toEqual([second]);
    expect(activatePickModeDraftEntry(selected, first).draft).toEqual([]);
  });

  it("adds, removes, and re-appends ordered entries without duplicates", () => {
    const target = { elementId: "target", parameterKey: "lines", selectionCardinality: "ordered-multiple" as const };
    const a = lineEntry("A");
    const b = lineEntry("B");
    const session = pickModeSessionForTarget("line", target)!;

    const selected = activatePickModeDraftEntry(
      activatePickModeDraftEntry(session, a),
      b
    );
    expect(activatePickModeDraftEntry(selected, a).draft).toEqual([b]);
    expect(activatePickModeDraftEntry(activatePickModeDraftEntry(selected, a), a).draft).toEqual([b, a]);
  });

  it("moves an existing entry in order without changing identity", () => {
    const a = lineEntry("A");
    const b = lineEntry("B");
    const c = lineEntry("C");
    expect(movePickModeDraftEntry([a, b, c], a.key, 2)).toEqual([b, c, a]);
    expect(movePickModeDraftEntry([a, b, c], "missing", 0)).toEqual([a, b, c]);
  });

  it("seeds a qualified point through the current candidate identity", () => {
    const candidates = [{
      elementId: "runtime-line",
      options: [{
        kind: "point" as const,
        label: "I::Out.start",
        anchor: derivedAnchor("runtime-line", "start"),
        sourceReference: { base: "I::Out", pointKey: "start" }
      }]
    }] satisfies PickCandidate[];
    const seeded = pickModeDraftForPointAnchors(
      [derivedAnchor("I::Out", "start")],
      candidates
    );
    const session = pickModeSessionForTarget("point", {
      elementId: "target",
      parameterKey: "points",
      selectionCardinality: "ordered-multiple"
    }, "ordered-multiple", seeded);

    expect(seeded[0]?.key).toBe(pickModeDraftEntryForOption("runtime-line", candidates[0].options[0]).key);
    expect(seeded[0]).toMatchObject({
      sourceReference: { base: "I::Out", pointKey: "start" }
    });
    const cleared = activatePickModeDraftEntry(session!, seeded[0]!);
    expect(cleared.draft).toEqual([]);
    expect(activatePickModeDraftEntry(cleared, seeded[0]!).draft).toEqual([seeded[0]]);
  });

  it("seeds a qualified line through the current candidate identity", () => {
    const candidates = [{
      elementId: "runtime-line",
      options: [{
        kind: "line" as const,
        label: "I::Out",
        lineId: "runtime-line",
        sourceReference: { base: "I::Out" }
      }]
    }] satisfies PickCandidate[];
    const seeded = pickModeDraftForLineIds(["I::Out"], candidates);
    expect(seeded[0]?.key).toBe(pickModeDraftEntryForOption("runtime-line", candidates[0].options[0]).key);
    expect(seeded[0]).toMatchObject({
      lineId: "runtime-line",
      sourceReference: { base: "I::Out" }
    });
    expect(activatePickModeDraftEntry({
      ...pickModeSessionForTarget("line", {
        elementId: "target",
        parameterKey: "lines",
        selectionCardinality: "ordered-multiple"
      }, "ordered-multiple", seeded)!,
      draft: []
    }, seeded[0]!).draft).toEqual([seeded[0]]);
  });
});
