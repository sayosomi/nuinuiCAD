import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { DslDiagnostic } from "../dsl/dslTypes";
import {
  diagnosticColumnSpan,
  mapPositionedDiagnostics,
  mergeDiagnosticLayers,
  toBufferDiagnostics,
  toStaleDiagnostics
} from "./sourceEditorDiagnostics";

describe("diagnosticColumnSpan", () => {
  it("resolves the token starting at the given column", () => {
    const span = diagnosticColumnSpan("point A = (0, 0)", 7);
    expect(span).toEqual({ from: 6, to: 7 });
  });

  it("falls back to the line end when no token boundary matches", () => {
    const span = diagnosticColumnSpan("point A = (0, 0)", 999);
    expect(span).toEqual({ from: 998, to: 16 });
  });
});

describe("toBufferDiagnostics / toStaleDiagnostics", () => {
  const doc = Text.of(["nui 1", "point A = (0, 0)", "point = (1, 1)"]);
  const diagnostics: DslDiagnostic[] = [
    { severity: "error", line: 3, column: 1, message: "missing name" }
  ];

  it("positions a diagnostic against the given doc and tags it current", () => {
    const positioned = toBufferDiagnostics(doc, diagnostics);
    expect(positioned).toHaveLength(1);
    expect(positioned[0].origin).toBe("current");
    expect(positioned[0].from).toBe(doc.line(3).from);
  });

  it("tags the same conversion stale when used for the committed baseline", () => {
    const positioned = toStaleDiagnostics(doc, diagnostics);
    expect(positioned[0].origin).toBe("stale");
  });

  it("drops out-of-range line numbers instead of throwing", () => {
    const positioned = toBufferDiagnostics(doc, [{ severity: "error", line: 99, column: 1, message: "oob" }]);
    expect(positioned).toHaveLength(0);
  });
});

describe("mapPositionedDiagnostics", () => {
  it("shifts a diagnostic's range through an unrelated earlier edit", () => {
    const doc = Text.of(["nui 1", "point A = (0, 0)", "point = (1, 1)"]);
    const positioned = toStaleDiagnostics(doc, [{ severity: "error", line: 3, column: 1, message: "x" }]);
    const changes = ChangeSet.of({ from: 0, insert: "# note\n" }, doc.length);
    const mapped = mapPositionedDiagnostics(positioned, changes);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].from).toBeGreaterThan(positioned[0].from);
  });

  it("drops a diagnostic whose range is fully covered by an edit", () => {
    const doc = Text.of(["nui 1", "point A = (0, 0)", "point = (1, 1)"]);
    const line3 = doc.line(3);
    const positioned = toStaleDiagnostics(doc, [{ severity: "error", line: 3, column: 1, message: "x" }]);
    const changes = ChangeSet.of({ from: line3.from, to: line3.to, insert: "" }, doc.length);
    expect(mapPositionedDiagnostics(positioned, changes)).toHaveLength(0);
  });
});

describe("mergeDiagnosticLayers", () => {
  it("keeps non-overlapping stale diagnostics alongside current ones", () => {
    const current = toStaleDiagnostics(Text.of(["a", "b"]), [
      { severity: "warning", line: 1, column: 1, message: "current warning" }
    ]).map((diagnostic) => ({ ...diagnostic, origin: "current" as const }));
    const stale = toStaleDiagnostics(Text.of(["a", "b"]), [
      { severity: "error", line: 2, column: 1, message: "stale error" }
    ]);
    const merged = mergeDiagnosticLayers(current, stale);
    expect(merged).toHaveLength(2);
  });

  it("drops a stale diagnostic that overlaps a current error", () => {
    const doc = Text.of(["point A = (0, 0)"]);
    const current = toStaleDiagnostics(doc, [
      { severity: "error", line: 1, column: 1, message: "current error" }
    ]).map((diagnostic) => ({ ...diagnostic, origin: "current" as const }));
    const stale = toStaleDiagnostics(doc, [
      { severity: "warning", line: 1, column: 1, message: "stale warning" }
    ]);
    const merged = mergeDiagnosticLayers(current, stale);
    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe("current error");
  });
});
