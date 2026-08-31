import { describe, expect, it } from "vitest";
import {
  cancelReferencePickSession,
  confirmReferencePickSession,
  confirmedReferencePickResult,
  referencePickDraftKey,
  selectReferencePickDraft,
  selectReferencePickNumericGeometry,
  selectReferencePickNumericProperty,
  setReferencePickHover,
  startReferencePickSession,
  type ReferencePickHover
} from "./referencePickSession";

const hover = (
  candidateElementId: string,
  base: string,
  pointKey?: string
): ReferencePickHover => ({
  candidateElementId,
  reference: { base, ...(pointKey ? { pointKey } : {}) }
});

describe("referencePickSession", () => {
  it("tracks hover without changing the draft", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "point",
      role: "geometry",
      multiplicity: "single"
    });
    const next = setReferencePickHover(initial, hover("a", "A"));

    expect(next.hover).toEqual(hover("a", "A"));
    expect(next.draftReferences).toEqual([]);
    expect(initial.hover).toBeNull();
  });

  it("requires numeric property selection before a single-value draft can confirm", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single",
      numericProperty: { kind: "propertySelectionRequired" }
    });
    expect(confirmReferencePickSession(initial)).toBe(initial);

    const first = selectReferencePickNumericGeometry(initial, hover("line-a", "LineA"), ["length", "startTangentAngleDeg"]);
    expect(first.draftReferences).toEqual([]);
    expect(first.numericProperty?.stage).toBe("propertySelection");
    expect(confirmReferencePickSession(first)).toBe(first);

    const drafted = selectReferencePickNumericProperty(first, "length");
    expect(drafted.numericProperty?.draft).toEqual({
      candidateElementId: "line-a",
      reference: { base: "LineA" },
      property: "length"
    });
    expect(confirmReferencePickSession(drafted).status).toBe("confirmed");
    expect(confirmedReferencePickResult(drafted)).toBeNull();
    expect(confirmedReferencePickResult(confirmReferencePickSession(drafted))).toBeNull();
  });

  it("always requires numeric property selection after geometry selection", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single",
      numericProperty: { kind: "propertySelectionRequired" }
    });
    const selected = selectReferencePickNumericGeometry(initial, hover("line-b", "LineB"), ["length"]);
    expect(selected.numericProperty?.stage).toBe("propertySelection");
    expect(selected.numericProperty?.draft).toBeNull();
  });

  it("seeds, adds, removes, and deduplicates a multiple-value draft by authored reference", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "path",
      role: "geometry",
      multiplicity: "multiple",
      seedReferences: [{ base: "A" }, { base: "A" }, { base: "Curve", pointKey: "start" }]
    });
    const added = selectReferencePickDraft(initial, hover("runtime-b", "B"));
    const removed = selectReferencePickDraft(added, hover("another-runtime-a", "A"));

    expect(initial.draftReferences).toEqual([
      { base: "A" },
      { base: "Curve", pointKey: "start" }
    ]);
    expect(added.draftReferences).toEqual([
      { base: "A" },
      { base: "Curve", pointKey: "start" },
      { base: "B" }
    ]);
    expect(removed.draftReferences).toEqual([
      { base: "Curve", pointKey: "start" },
      { base: "B" }
    ]);
    expect(referencePickDraftKey({ base: "A" })).toBe(referencePickDraftKey({ base: "A" }));
  });

  it("ignores invalid selections and makes confirm/cancel terminal without source ownership", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "point",
      role: "endpoint",
      multiplicity: "single"
    });
    expect(selectReferencePickDraft(initial, null)).toBe(initial);

    const drafted = selectReferencePickDraft(initial, hover("line", "Line", "start"));
    const confirmed = confirmReferencePickSession(drafted);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.hover).toBeNull();
    expect(confirmedReferencePickResult(confirmed)).toEqual([{ base: "Line", pointKey: "start" }]);
    expect(selectReferencePickDraft(confirmed, hover("other", "Other"))).toBe(confirmed);
    expect(cancelReferencePickSession(confirmed)).toBe(confirmed);

    const canceled = cancelReferencePickSession(drafted);
    expect(canceled.status).toBe("canceled");
    expect(confirmedReferencePickResult(canceled)).toBeNull();
    expect(confirmReferencePickSession(canceled)).toBe(canceled);
  });
});
