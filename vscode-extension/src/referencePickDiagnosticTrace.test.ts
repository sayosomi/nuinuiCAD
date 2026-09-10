import { describe, expect, it } from "vitest";
import { VscodeReferencePickDiagnosticTraceStore } from "./referencePickDiagnosticTrace";

const eventFor = (documentUri: string, index: number) => ({
  documentUri,
  documentVersion: 3,
  stage: "tryStartActive" as const,
  outcome: "observed" as const,
  details: { index }
});

describe("VscodeReferencePickDiagnosticTraceStore", () => {
  it("preserves order, bounds each document, and keeps documents independent", () => {
    const store = new VscodeReferencePickDiagnosticTraceStore();
    for (let index = 0; index < 65; index += 1) store.record(eventFor("file:///a.nui", index));
    store.record(eventFor("file:///b.nui", 99));

    const a = store.traceFor("file:///a.nui");
    expect(a).toHaveLength(64);
    expect(a[0]?.details).toEqual({ index: 1 });
    expect(a.at(-1)?.details).toEqual({ index: 64 });
    expect(a.map((entry) => entry.sequence)).toEqual([...Array(64)].map((_, index) => index + 2));
    expect(store.traceFor("file:///b.nui")).toHaveLength(1);
    expect(store.traceFor("file:///b.nui")[0]?.details).toEqual({ index: 99 });
  });

  it("clears one document without affecting another", () => {
    const store = new VscodeReferencePickDiagnosticTraceStore();
    store.record(eventFor("file:///a.nui", 1));
    store.record(eventFor("file:///b.nui", 2));

    store.clearDocument("file:///a.nui");

    expect(store.traceFor("file:///a.nui")).toEqual([]);
    expect(store.traceFor("file:///b.nui")).toHaveLength(1);
  });
});
