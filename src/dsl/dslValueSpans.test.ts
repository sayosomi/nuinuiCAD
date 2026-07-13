import { describe, expect, it } from "vitest";
import { adjacentDslValueSpan, dslLineLabeledValueSpans, dslLineValueSpans, findDslValueSpanAt } from "./dslValueSpans";
import { parseDsl } from "./dslParser";

const textOf = (source: string, span: { start: number; end: number }) => source.slice(span.start, span.end);

describe("dslLineValueSpans", () => {
  it("keeps the legacy projection while exposing payload and attribute labels", () => {
    const source = "point A = (0, 10) visible=false";
    const labeled = dslLineLabeledValueSpans(source);
    expect(labeled).toEqual([
      { start: 11, end: 12, source: "payload", key: "x" },
      { start: 14, end: 16, source: "payload", key: "y" },
      { start: 26, end: 31, source: "attr", key: "visible" }
    ]);
    expect(labeled.map(({ start, end }) => ({ start, end }))).toEqual(dslLineValueSpans(source));
  });
  it("selects point X and Y coordinates independently", () => {
    const source = "point A = (0, 10)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10"]);
  });

  it("includes the sign on a negative decimal coordinate", () => {
    const source = "point A = (-10.5, 20)";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["-10.5", "20"]);
  });

  it("selects line start and end references independently", () => {
    const source = "line AB = A -> B";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B"]);
  });

  it("selects a qualified reference as a whole span", () => {
    const source = "line AB = Group::A -> Group::B";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["Group::A", "Group::B"]);
  });

  it("selects a numeric attribute value", () => {
    const source = "point A = (0, 10) length=120";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10", "120"]);
  });

  it("selects a boolean attribute value", () => {
    const source = "point A = (0, 10) visible=true";
    const spans = dslLineValueSpans(source);
    expect(spans.at(-1)).toBeDefined();
    expect(textOf(source, spans.at(-1)!)).toBe("true");
  });

  it("selects a string attribute value including its quotes", () => {
    const source = "point A = (0, 10) label=\"hello world\"";
    const spans = dslLineValueSpans(source);
    expect(textOf(source, spans.at(-1)!)).toBe("\"hello world\"");
  });

  it("selects a parenthesized expression attribute value as a whole", () => {
    const source = "point A = (0, 10) length=(base + 10)";
    const spans = dslLineValueSpans(source);
    expect(textOf(source, spans.at(-1)!)).toBe("(base + 10)");
  });

  it("does not duplicate a span shared by payloadSpans and attrs (arc center)", () => {
    const source = "arc C center=P r=10";
    const spans = dslLineValueSpans(source);
    const texts = spans.map((span) => textOf(source, span));
    expect(texts.filter((text) => text === "P")).toHaveLength(1);
  });

  it("excludes the synthetic type attribute injected for generic element statements", () => {
    const source = "point P = between A B";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B"]);
  });

  it("still selects attribute values on a block-opening statement (for/if/group)", () => {
    const forSource = "for i count=5 {";
    expect(dslLineValueSpans(forSource).map((span) => textOf(forSource, span))).toEqual(["i", "5"]);

    const ifSource = "if condition=(x > 5) {";
    const ifSpans = dslLineValueSpans(ifSource);
    expect(ifSpans).toHaveLength(1);
    expect(textOf(ifSource, ifSpans[0])).toBe("(x > 5)");
  });

  it("returns no spans for a blank line, comment-only line, or block line", () => {
    expect(dslLineValueSpans("")).toEqual([]);
    expect(dslLineValueSpans("   # just a comment")).toEqual([]);
    expect(dslLineValueSpans("}")).toEqual([]);
    expect(dslLineValueSpans("group G {")).toEqual([]);
  });

  it("returns no spans for a line whose parse produced an error diagnostic", () => {
    // "point" with an unsupported form: no coordinate/offset/polar/between/on/intersection/tangentOffset.
    expect(dslLineValueSpans("point A = notAValidForm")).toEqual([]);
    // line with unbalanced braces mid-statement is rejected outright.
    expect(dslLineValueSpans("point A = (0, 10) { oops")).toEqual([]);
  });

  it("returns no spans for a line that yields a statement AND an error diagnostic", () => {
    // A freePoint statement is returned (real x/y payload spans exist), but the
    // trailing "{" is invalid for this statement kind, so parseDsl also emits
    // "この文はブロックを開けません。" attached to this same line. The diagnostics
    // check must win over the fact that a statement was parsed.
    const source = "point A = (0, 10) {";
    const { statements, diagnostics } = parseDsl(source);
    expect(statements).toHaveLength(1);
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(dslLineValueSpans(source)).toEqual([]);
  });

  it("does not select comment text following a value", () => {
    const source = "point A = (0, 10) length=120 # trailing comment";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["0", "10", "120"]);
  });

  it("excludes non-element (palette/view/print/directive) statements even with real values", () => {
    expect(dslLineValueSpans("nui 1")).toEqual([]);
    expect(dslLineValueSpans("role R enabled=true")).toEqual([]);
    expect(dslLineValueSpans("view V zoom=2")).toEqual([]);
    expect(dslLineValueSpans("color X \"#336699\"")).toEqual([]);
    expect(dslLineValueSpans("printLayout P scale=2")).toEqual([]);
  });
});

describe("adjacentDslValueSpan", () => {
  it("cycles point X/Y forward and backward, matching the spec's worked example", () => {
    const source = "point A = (0, 10)";
    const spans = dslLineValueSpans(source);
    const [x, y] = spans;

    expect(adjacentDslValueSpan(spans, x.start, "next")).toEqual(y);
    expect(adjacentDslValueSpan(spans, y.start, "next")).toEqual(x);
    expect(adjacentDslValueSpan(spans, y.start, "previous")).toEqual(x);
    expect(adjacentDslValueSpan(spans, x.start, "previous")).toEqual(y);
  });

  it("walks a mixed payload/attribute line in source order", () => {
    const source = "line AB = A -> B color=red locked=false";
    const spans = dslLineValueSpans(source);
    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B", "red", "false"]);

    let current = spans[0].start;
    const order: string[] = [];
    for (let step = 0; step < spans.length + 1; step += 1) {
      const next = adjacentDslValueSpan(spans, current, "next")!;
      order.push(textOf(source, next));
      current = next.start;
    }
    expect(order).toEqual(["B", "red", "false", "A", "B"]);
  });

  it("resolves from a caret inside a value, an exact-match selection, and a caret outside every value", () => {
    const source = "point A = (0, 10) length=120";
    const spans = dslLineValueSpans(source);
    const [x, y, length] = spans;

    // Caret inside "10" (not at its start).
    expect(adjacentDslValueSpan(spans, y.start + 1, "next")).toEqual(length);
    // Selection exactly matching "10" (selection.from === span.start).
    expect(adjacentDslValueSpan(spans, y.start, "next")).toEqual(length);
    // Caret before any value (start of line).
    expect(adjacentDslValueSpan(spans, 0, "next")).toEqual(x);
    expect(adjacentDslValueSpan(spans, 0, "previous")).toEqual(length);
    // Caret between two values (right after "0", before the comma).
    const between = x.end;
    expect(adjacentDslValueSpan(spans, between, "next")).toEqual(y);
    expect(adjacentDslValueSpan(spans, between, "previous")).toEqual(x);
    // Caret after the last value (end of line).
    expect(adjacentDslValueSpan(spans, source.length, "next")).toEqual(x);
    expect(adjacentDslValueSpan(spans, source.length, "previous")).toEqual(length);
  });

  it("cycles to itself when there is only one editable value", () => {
    const spans = dslLineValueSpans("group G scale=2");
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
  const source = "point A = (0, 10) length=120";
  const spans = dslLineValueSpans(source);

  it("finds the value at a position inside it", () => {
    const lengthSpan = spans.at(-1)!;
    const middle = lengthSpan.start + 1;
    expect(findDslValueSpanAt(spans, middle)).toEqual(lengthSpan);
  });

  it("treats the span as half-open: the start offset is inside, the end offset is not", () => {
    const lengthSpan = spans.at(-1)!;
    expect(findDslValueSpanAt(spans, lengthSpan.start)).toEqual(lengthSpan);
    expect(findDslValueSpanAt(spans, lengthSpan.end)).toBeNull();
  });

  it("returns null for a position on a keyword, name, operator, or whitespace", () => {
    expect(findDslValueSpanAt(spans, 0)).toBeNull(); // "point"
    expect(findDslValueSpanAt(spans, 6)).toBeNull(); // "A"
    expect(findDslValueSpanAt(spans, 8)).toBeNull(); // "="
    expect(findDslValueSpanAt(spans, source.length - 1)).not.toBeNull();
    expect(findDslValueSpanAt(spans, source.length)).toBeNull(); // past end of line
  });

  it("returns null for an empty span list", () => {
    expect(findDslValueSpanAt([], 3)).toBeNull();
  });
});
