import { describe, expect, it } from "vitest";
import {
  cancelReferencePickSession,
  confirmReferencePickSession,
  confirmedReferencePickResult,
  referencePickDraftKey,
  selectReferencePickDraft,
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

  it("replaces a single-value draft on each valid selection", () => {
    const initial = startReferencePickSession({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase",
      multiplicity: "single"
    });
    const first = selectReferencePickDraft(initial, hover("line-a", "LineA"));
    const second = selectReferencePickDraft(first, hover("line-b", "LineB"));

    expect(first.draftReferences).toEqual([{ base: "LineA" }]);
    expect(second.draftReferences).toEqual([{ base: "LineB" }]);
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
