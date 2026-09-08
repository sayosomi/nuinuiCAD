import { describe, expect, it } from "vitest";
import {
  activatePickModeDraftEntry,
  movePickModeDraftEntry,
  pickModeDraftEntryForOption,
  pickModeSessionForTarget
} from "./pickModeSession";

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
});
