// v2の単一行呼び出し構文上でのspan境界検出そのものが検証対象。
import { describe, expect, it } from "vitest";
import {
  adjacentDslValueSpan,
  dslLineLabeledValueSpans,
  dslLinePrintLayoutStatement,
  dslLinePrintLayoutValueSpans,
  dslLineValueSpans,
  findDslValueSpanAt
} from "./dslValueSpans";
import { parseDsl } from "./dslParser";

const textOf = (source: string, span: { start: number; end: number }) => source.slice(span.start, span.end);

describe("dslLineValueSpans", () => {
  it("keeps the legacy projection while exposing payload and attribute labels", () => {
    const source = "point A = coordinate(x: 0,y: 10,state: hidden)";
    const labeled = dslLineLabeledValueSpans(source);
    const xStart = source.indexOf("x: 0") + "x: ".length;
    const yStart = source.indexOf("y: 10") + "y: ".length;
    const stateStart = source.indexOf("state: hidden") + "state: ".length;
    expect(labeled).toEqual([
      { start: xStart, end: xStart + 1, source: "attr", key: "x" },
      { start: yStart, end: yStart + 2, source: "attr", key: "y" },
      { start: stateStart, end: stateStart + 6, source: "attr", key: "state" }
    ]);
    expect(labeled.map(({ start, end }) => ({ start, end }))).toEqual(dslLineValueSpans(source));
  });
  it("selects point X and Y coordinates independently", () => {
    const source = "point A = coordinate(x: 0,y: 10)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10"]);
  });

  it("includes the sign on a negative decimal coordinate", () => {
    const source = "point A = coordinate(x: -10.5,y: 20)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["-10.5", "20"]);
  });

  it("selects line start and end references independently", () => {
    const source = "line AB = segment(start: A,end: B)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B"]);
  });

  it("selects a derived-point reference as a whole span", () => {
    const source = "line CD = segment(start: AB.start,end: AB.end)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["AB.start", "AB.end"]);
  });

  it("selects a numeric attribute value", () => {
    const source = "arc C = arc(center: A,radius: 10,start: 0,end: 120)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "10", "0", "120"]);
  });

  it("selects a boolean attribute value", () => {
    const source = "line L = offset(sources: [AB],distance: 10,side: right,closed: true)";
    const spans = dslLineValueSpans(source);
    expect(spans.at(-1)).toBeDefined();
    expect(textOf(source, spans.at(-1)!)).toBe("true");
  });

  it("selects a string attribute value including its quotes", () => {
    const source = 'text Label = label(anchor: A,size: 4,text: "hello world")';
    const spans = dslLineValueSpans(source);
    expect(textOf(source, spans.at(-1)!)).toBe('"hello world"');
  });

  it("selects a parenthesized expression attribute value as a whole", () => {
    const source = "point B = offset(from: A, dx: 0, dy: (base + 10))";
    const spans = dslLineValueSpans(source);
    expect(textOf(source, spans.at(-1)!)).toBe("(base + 10)");
  });

  it("does not duplicate a span shared by payloadSpans and attrs (arc center)", () => {
    const source = "arc C = arc(center: P,radius: 10)";
    const spans = dslLineValueSpans(source);
    const texts = spans.map((span) => textOf(source, span));
    expect(texts.filter((text) => text === "P")).toHaveLength(1);
  });

  it("does not surface extra spans beyond the construction's own reference arguments", () => {
    const source = "point P = between(start: A,end: B)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B"]);
  });

  it("still selects attribute values on a block-opening statement (for/if/group)", () => {
    const forSource = "for i in range(from: 0,count: 5) {";
    expect(dslLineValueSpans(forSource).map((span) => textOf(forSource, span))).toEqual(["i", "0", "5"]);

    const ifSource = "if (x > 5) {";
    const ifSpans = dslLineValueSpans(ifSource);
    expect(ifSpans).toHaveLength(1);
    expect(textOf(ifSource, ifSpans[0])).toBe("x > 5");
  });

  it("returns no spans for a blank line, comment-only line, or block line", () => {
    expect(dslLineValueSpans("")).toEqual([]);
    expect(dslLineValueSpans("   # just a comment")).toEqual([]);
    expect(dslLineValueSpans("}")).toEqual([]);
    expect(dslLineValueSpans("group G {")).toEqual([]);
  });

  it("returns no spans for a line whose parse produced an error diagnostic", () => {
    // "point" with an unsupported form: no construction identifier followed by "(".
    expect(dslLineValueSpans("point A = notAValidForm")).toEqual([]);
  });

  it("still surfaces already-typed argument spans for a mid-edit unclosed call (UNCLOSED_CALL_CODE carve-out)", () => {
    // Task 51 fix: an unclosed call (e.g. a string/template hole not yet
    // closed while typing) used to be rejected outright, with no statement
    // && no spans at all, which meant completion could never resolve the
    // argument being edited. This is still a hard compile error for a real
    // document (see dslCompiler.test.ts's "unterminated call statement
    // safety" suite, && dslValueSpans.test.ts's own "yields a statement AND
    // an error diagnostic" case above for the general rule) - only this
    // single-line probe tolerates it, the same way it already tolerates
    // MISSING_ATTRIBUTE_VALUE_CODE.
    const source = "point A = coordinate(x: 0,y: 10";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10"]);
  });

  it("returns no spans for a line that yields a statement AND an error diagnostic", () => {
    // A freePoint statement is returned (real x/y payload spans exist), but the
    // trailing "{" is invalid for this statement kind (point can't open a block),
    // so parseDsl also emits an error attached to this same line. The diagnostics
    // check must win over the fact that a statement was parsed.
    const source = "point A = coordinate(x: 0, y: 10) {";
    const { statements, diagnostics } = parseDsl(source);
    expect(statements).toHaveLength(1);
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(dslLineValueSpans(source)).toEqual([]);
  });

  it("still returns other attributes' spans when the only error is a missing-value diagnostic", () => {
    // Contrast with "returns no spans for a line whose parse produced an
    // error diagnostic" above: a genuinely empty (mid-edit) attribute value
    // is structurally sound, unlike those genuine syntax errors, so it must
    // not blank out the whole line's spans - otherwise completion could
    // never resolve the very attribute being edited (Task 51 manual E2E
    // rerun regression).
    const source = "line Off = offset(sources: [AB], distance: 3, side: , closed: false)";
    const { diagnostics } = parseDsl(source);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(1);
    expect(diagnostics[0].message).toContain("値がありません");

    const labeled = dslLineLabeledValueSpans(source);
    expect(labeled.map((span) => span.key)).toEqual(
      expect.arrayContaining(["sources", "distance", "side", "closed"])
    );
    const sideSpan = labeled.find((span) => span.key === "side");
    expect(sideSpan?.start).toBe(sideSpan?.end);
    expect(sideSpan?.rawValueSpan).toBeDefined();
    expect(textOf(source, sideSpan!.rawValueSpan!)).toBe(" ");
  });

  it("does not select comment text following a value", () => {
    const source = "point A = coordinate(x: 0, y: 10) # trailing comment";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10"]);
  });

  it("excludes non-element (palette/view/print/directive) statements even with real values", () => {
    expect(dslLineValueSpans("nui 2")).toEqual([]);
    expect(dslLineValueSpans('role R (name: "縫い代")')).toEqual([]);
    expect(dslLineValueSpans("view V (default: true)")).toEqual([]);
    expect(dslLineValueSpans('color X ("#336699", name: "基本線")')).toEqual([]);
    expect(dslLineValueSpans("printLayout P (scale: 2) {")).toEqual([]);
  });
});

describe("adjacentDslValueSpan", () => {
  it("cycles point X/Y forward && backward, matching the spec's worked example", () => {
    const source = "point A = coordinate(x: 0, y: 10)";
    const spans = dslLineValueSpans(source);
    const [x, y] = spans;

    expect(adjacentDslValueSpan(spans, x.start, "next")).toEqual(y);
    expect(adjacentDslValueSpan(spans, y.start, "next")).toEqual(x);
    expect(adjacentDslValueSpan(spans, y.start, "previous")).toEqual(x);
    expect(adjacentDslValueSpan(spans, x.start, "previous")).toEqual(y);
  });

  it("walks a mixed payload/attribute line in source order", () => {
    const source = "line AB = segment(start: A, end: B, color: red, state: hidden)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B", "red", "hidden"]);

    let current = spans[0].start;
    const order: string[] = [];
    for (let step = 0; step < spans.length + 1; step += 1) {
      const next = adjacentDslValueSpan(spans, current, "next")!;
      order.push(textOf(source, next));
      current = next.start;
    }
    expect(order).toEqual(["B", "red", "hidden", "A", "B"]);
  });

  it("resolves from a caret inside a value, an exact-match selection, and a caret outside every value", () => {
    const source = "arc C = arc(center: A, radius: 10, start: 0, end: 120)";
    const spans = dslLineValueSpans(source);
    const [center, radius, start, end] = spans;

    // Caret inside "10" (not at its start).
    expect(adjacentDslValueSpan(spans, radius.start + 1, "next")).toEqual(start);
    // Selection exactly matching "10" (selection.from === span.start).
    expect(adjacentDslValueSpan(spans, radius.start, "next")).toEqual(start);
    // Caret before any value (start of line).
    expect(adjacentDslValueSpan(spans, 0, "next")).toEqual(center);
    expect(adjacentDslValueSpan(spans, 0, "previous")).toEqual(end);
    // Caret between two values (right after "10", before the next key).
    const between = radius.end;
    expect(adjacentDslValueSpan(spans, between, "next")).toEqual(start);
    expect(adjacentDslValueSpan(spans, between, "previous")).toEqual(radius);
    // Caret after the last value (end of line).
    expect(adjacentDslValueSpan(spans, source.length, "next")).toEqual(center);
    expect(adjacentDslValueSpan(spans, source.length, "previous")).toEqual(end);
  });

  it("cycles to itself when there is only one editable value", () => {
    const spans = dslLineValueSpans("group G (printAnchor: A) {");
    expect(spans).toHaveLength(1);
    expect(adjacentDslValueSpan(spans, spans[0].start, "next")).toEqual(spans[0]);
    expect(adjacentDslValueSpan(spans, spans[0].start, "previous")).toEqual(spans[0]);
  });

  it("returns null for an empty span list", () => {
    expect(adjacentDslValueSpan([], 0, "next")).toBeNull();
    expect(adjacentDslValueSpan([], 0, "previous")).toBeNull();
  });
});

describe("findDslValueSpanAt", () => {
  const source = "arc C = arc(center: A, radius: 10, start: 0, end: 120)";
  const spans = dslLineValueSpans(source);

  it("finds the value at a position inside it", () => {
    const lastSpan = spans.at(-1)!;
    const middle = lastSpan.start + 1;
    expect(findDslValueSpanAt(spans, middle)).toEqual(lastSpan);
  });

  it("treats the span as half-open: the start offset is inside, the end offset is not", () => {
    const lastSpan = spans.at(-1)!;
    expect(findDslValueSpanAt(spans, lastSpan.start)).toEqual(lastSpan);
    expect(findDslValueSpanAt(spans, lastSpan.end)).toBeNull();
  });

  it("returns null for a position on a keyword, name, operator, or whitespace", () => {
    expect(findDslValueSpanAt(spans, 0)).toBeNull(); // "arc"
    expect(findDslValueSpanAt(spans, 4)).toBeNull(); // "C"
    expect(findDslValueSpanAt(spans, 6)).toBeNull(); // "="
    expect(findDslValueSpanAt(spans, source.length - 2)).not.toBeNull(); // last digit of "120", before the closing ")"
    expect(findDslValueSpanAt(spans, source.length)).toBeNull(); // past end of line
  });

  it("returns null for an empty span list", () => {
    expect(findDslValueSpanAt([], 3)).toBeNull();
  });
});

describe("dslLinePrintLayoutStatement / dslLinePrintLayoutValueSpans", () => {
  it("recognizes a printLayout block-opening line and rejects an element-statement line", () => {
    const line = "printLayout Layout1 (columns: 2, canvas: (210, 297)) {";
    expect(dslLinePrintLayoutStatement(line)?.kind).toBe("printLayout");
    expect(dslLinePrintLayoutStatement("point A = coordinate(x: 0, y: 0)")).toBeNull();
  });

  it("recognizes a place member line only via the synthetic enclosing block", () => {
    const line = "place @Group1(at: (10, 20), angle: 15)";
    expect(dslLinePrintLayoutStatement(line)?.kind).toBe("place");
  });

  it("rejects a place line with a genuine parse error (missing group reference)", () => {
    expect(dslLinePrintLayoutStatement("place (at: (1, 2))")).toBeNull();
  });

  it("keeps returned span offsets relative to the original lineText, not the synthetic wrapper — place", () => {
    // The synthetic wrapper prepends a full extra line ("printLayout {\n") before
    // this text when reparsing a place line. If span offsets ever leaked
    // through unadjusted from that wrapped coordinate space, they would be off by
    // "printLayout {\n".length (14) || by an unrelated line-1 offset entirely —
    // this test fails loudly in either case instead of silently mis-selecting text.
    const line = "place @Group1(at: (10, 20), angle: 15)";
    const spans = dslLinePrintLayoutValueSpans(line);
    const at = spans.find((span) => span.key === "at")!;
    const angle = spans.find((span) => span.key === "angle")!;
    expect(line.slice(at.start, at.end)).toBe("(10, 20)");
    expect(at.start).toBe(line.indexOf("(10, 20)"));
    expect(at.end).toBe(line.indexOf("(10, 20)") + "(10, 20)".length);
    expect(line.slice(angle.start, angle.end)).toBe("15");
    expect(angle.start).toBe(line.indexOf("angle: 15") + "angle: ".length);
  });

  it("keeps returned span offsets relative to the original lineText — printLayout", () => {
    // printLayout uses the same synthetic-closing-`}` strategy as
    // dslLineElementStatement (append, not prepend), so this is the same
    // no-shift guarantee already relied on elsewhere, re-asserted explicitly here.
    const line = "printLayout Layout1 (columns: 2, canvas: (210, 297)) {";
    const spans = dslLinePrintLayoutValueSpans(line);
    const columns = spans.find((span) => span.key === "columns")!;
    const canvas = spans.find((span) => span.key === "canvas")!;
    expect(line.slice(columns.start, columns.end)).toBe("2");
    expect(columns.start).toBe(line.indexOf("columns: 2") + "columns: ".length);
    expect(line.slice(canvas.start, canvas.end)).toBe("(210, 297)");
    expect(canvas.start).toBe(line.indexOf("(210, 297)"));
  });
});
