import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { createDefaultPrintLayout } from "../print/printLayout";
import type { CadElement } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import {
  compileDslDocument,
  layoutElementTree,
  parseDslDocument,
  requireDslMajorVersionForFeature,
  serializeDocumentToDsl,
  TYPED_SYNTAX_REQUIRES_NUI3_CODE,
  type DslDocumentData
} from "./dslDocument";
import {
  emptyDocument,
  expectSemanticallyEqualDocuments,
  roundTrip
} from "./dslDocumentTestUtils";
import { documentDslRefs } from "./dslSerializer";
import sampleFixture from "./__fixtures__/sample.nui?raw";

describe("dslDocument round-trip matrix", () => {
  it("round-trips freePoint via coordinate literal", () => {
    const { document, parsed } = roundTrip("point A = coordinate(x: 12.5 y: -30)");
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetPoint via name reference and expression", () => {
    const { document, parsed } = roundTrip(["var d = 12", "point A = coordinate(x: 0 y: 0)", "point B = offset(from: A dx: d dy: -(d * 2))"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips polarOffsetPoint", () => {
    const { document, parsed } = roundTrip(["point A = coordinate(x: 0 y: 0)", "point B = polar(from: A angle: 45 distance: 10)"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips divisionPoint by ratio and by distance", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 100 y: 0)", "point M1 = between(start: A end: B ratio: 0.5)", "point M2 = between(start: A end: B distance: 30)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineDivisionPoint via derived endpoint anchor", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 100 y: 0)", "line AB = segment(start: A end: B)", "point M = onLine(from: AB.end distance: 10)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips intersectionPoint by qualified line ids", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 100 y: 0)",
        "point C = coordinate(x: 0 y: 100)",
        "point D = coordinate(x: 100 y: 100)",
        "line AB = segment(start: A end: B)",
        "line CD = segment(start: C end: D)",
        "point X = intersection(line1: AB line2: CD index: 0 extensions: true)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineTangentOffsetPoint", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0 y: 0)", "arc c = arc(center: A radius: 50 start: 0 end: 180)", "point H = tangentOffset(line: c base: A angle: 30 distance: 5)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("keeps multi-token numeric expressions intact across a round-trip (v2 needs no quoting: key: takes the rest of the line)", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)",
      "line AB = segment(start: A end: B)",
      "point Polar = polar(from: A angle: 0 distance: 1)",
      "line Length = polar(start: A angle: 0 length: 1)",
      "arc Arc = arc(center: A radius: 1 start: 0 end: 90)",
      "point Tail = tangentOffset(line: AB base: A angle: 0 distance: 1)",
      "if 条件 (1) {",
      "  point ConditionalPoint = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const initialResult = compileDslDocument(source);
    expect(initialResult.diagnostics).toEqual([]);
    expect(initialResult.document).not.toBeNull();
    const initial = initialResult.document!;
    const baseLine = initial.elements.find((element) => element.name === "AB" && element.type === "line")!;
    const expression = (value: string) => ({ kind: "expression" as const, expression: value });
    const elements = initial.elements.map((element) => {
      if (element.name === "Polar" && element.type === "polarOffsetPoint") {
        return { ...element, angleDeg: expression("1 + 2"), distance: expression("sqrt(9) + 1") };
      }
      if (element.name === "Length" && element.type === "angleLengthLine") {
        return { ...element, length: expression("- (2 * 3)") };
      }
      if (element.name === "Arc" && element.type === "arcLine") {
        return { ...element, radius: expression("10 / 2"), endAngleDeg: expression("45 + 45") };
      }
      if (element.name === "Tail" && element.type === "lineTangentOffsetPoint") {
        return { ...element, distance: expression(`- (${baseLine.id}.length / 5)`) };
      }
      if (element.type === "conditionalGroup") {
        return { ...element, condition: expression(`${baseLine.id}.length > 0 && 2 > 1`) };
      }
      return element;
    });
    const document = { ...initial, elements };
    const serialized = serializeDocumentToDsl(document, 2);
    const compiled = compileDslDocument(serialized);

    expect(serialized).toContain("angle: 1 + 2");
    expect(serialized).toContain("distance: sqrt(9) + 1");
    expect(serialized).toContain("length: - (2 * 3)");
    expect(serialized).toContain("radius: 10 / 2");
    expect(serialized).toContain("AB.length > 0 && 2 > 1");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const compiledTail = compiled.document!.elements.find((element) => element.name === "Tail");
    const compiledCondition = compiled.document!.elements.find((element) => element.type === "conditionalGroup");
    expect(compiledTail).toMatchObject({
      distance: { kind: "expression", expression: expect.stringContaining(" / 5)") }
    });
    expect(compiledCondition).toMatchObject({
      condition: { kind: "expression", expression: expect.stringContaining("&& 2 > 1") }
    });
  });

  it("round-trips line via segment() and angleLengthLine via polar()", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 100 y: 0)", "line AB = segment(start: A end: B)", "line shoulder = polar(start: A angle: -12 length: 130)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips arcLine, threePointArcLine, cornerRadiusArcLine", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 50 y: 50)",
        "point C = coordinate(x: 100 y: 0)",
        "line AB = segment(start: A end: B)",
        "line BC = segment(start: B end: C)",
        "arc simple = arc(center: A radius: 30 start: 0 end: 90)",
        "arc three = through(point1: A point2: B point3: C start: 0 end: 180)",
        "arc corner = corner(end1: AB.end end2: BC.start radius: 10 index: 0)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips edge and extendTrim", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 100 y: 0)",
        "point C = coordinate(x: 150 y: 0)",
        "line AB = segment(start: A end: B)",
        "line BC = segment(start: B end: C)",
        "line e1 = edge(end1: AB.end end2: BC.start index: 0)",
        "line extended = extend(end: AB.end to: C)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips bezierCurve with intermediate points", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 100 y: 0)",
        "point C = coordinate(x: 50 y: 30)",
        "curve neckline = bezier(start: A end: B startAngle: -90 startLength: 35 endAngle: 180 endLength: 45 intermediates: [C:45:20:25])"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetLine, splitLine", () => {
    const { text, document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 100 y: 0)",
        "point C = coordinate(x: 50 y: 0)",
        "line AB = segment(start: A end: B)",
        "line seam = offset(sources: [AB] distance: 10 side: left closed: false suppressTrimWarnings: true)",
        "line lower = split(source: AB at: C)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(text).toContain("suppressTrimWarnings: true");
  });

  it("round-trips copyLine, symmetricCopyLine, move, symmetricMove", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 100 y: 0)",
        "line AB = segment(start: A end: B)",
        "line cp = copy(startPoint: A endPoint: B scale: 1 angleDeg: 0 mirrorX: false baseLines: [AB])",
        "line sym = mirrorCopy(axis1: A axis2: B baseLines: [AB])",
        "line mv = move(startPoint: A endPoint: B scale: 1 angleDeg: 0 mirrorX: false baseLines: [AB])",
        "line smv = mirrorMove(axis1: A axis2: B baseLines: [AB])"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips image", () => {
    const { document, parsed } = roundTrip(
      'image img = image(source: "assets/ref.png" origin: (0, 0) scale: 1 angleDeg: 0 mirrorX: false)'
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text with quoted body and derived anchor", () => {
    const { document, parsed } = roundTrip(["point A = coordinate(x: 0 y: 0)", 'text label = label(text: "前中心" anchor: A size: 4)'].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text containing a newline as an escaped single DSL line", () => {
    const { text, parsed } = roundTrip(["point A = coordinate(x: 0 y: 0)", 'text label = label(text: "一行目\\n二行目" anchor: A size: 4)'].join("\n"));
    expect(text).toContain('text: "一行目\\n二行目"');
    expect(parsed.elements.find((element) => element.name === "label")).toMatchObject({
      type: "text",
      text: "一行目\n二行目"
    });
  });

  it("round-trips variable with expression mode and with pointDistance mode", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "var bust = 840",
        "var d = pointDistance(point1: A point2: B)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument nesting", () => {
  it("round-trips nested groups", () => {
    const source = [
      "group 前身頃 {",
      "  point A = coordinate(x: 0 y: 0)",
      "  group 襟 {",
      "    point B = coordinate(x: 1 y: 1)",
      "  }",
      "  point C = coordinate(x: 2 y: 2)",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(parsed.elements.map((element) => element.type)).toEqual(["group", "freePoint", "group", "freePoint", "freePoint"]);
  });

  it("round-trips if/else branches", () => {
    const source = ["if 分岐 (1) {", "  point A = coordinate(x: 0 y: 0)", "} else {", "  point B = coordinate(x: 1 y: 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips for blocks", () => {
    const source = ["for 繰返し (i from: 0 count: 3 step: 1) {", "  point P = coordinate(x: i * 10 y: 0)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips deeply nested group/if/for combinations", () => {
    const source = [
      "group 外 {",
      "  if 内分岐 (1) {",
      "    for 内繰返し (i from: 0 count: 2 step: 1) {",
      "      point P = coordinate(x: i y: 0)",
      "    }",
      "  } else {",
      "    point Q = coordinate(x: 0 y: 0)",
      "  }",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument unnamed elements", () => {
  it("round-trips unnamed elements at the root", () => {
    const source = ["point = coordinate(x: 0 y: 0)", "point = coordinate(x: 5 y: 5)"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(parsed.elements.map((element) => element.name)).toEqual(["", ""]);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips unnamed group blocks", () => {
    const source = ["group {", "  point A = coordinate(x: 0 y: 0)", "}"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.elements[0].name).toBe("");
    expect(parsed.elements[1].parentGroupId).toBe(parsed.elements[0].id);
  });
});

describe("dslDocument palette", () => {
  it("round-trips palette colors and defaultColorId", () => {
    const source = [
      "nui 2",
      "",
      'color main ("#112233" name: "本体")',
      'color accent ("#445566" name: "アクセント" default: true)'
    ].join("\n");
    const parsed = parseDslDocument(source);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document?.palette).toEqual({
      colors: [
        { id: "main", name: "本体", hex: "#112233" },
        { id: "accent", name: "アクセント", hex: "#445566" }
      ],
      defaultColorId: "accent"
    });
    const reserialized = serializeDocumentToDsl(parsed.document!, 2);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.document?.palette).toEqual(parsed.document?.palette);
  });

  it("falls back to the default palette when no color statements are present", () => {
    const parsed = parseDslDocument("nui 2\n\npoint A = coordinate(x: 0 y: 0)");
    expect(parsed.document?.palette).toEqual(defaultDocumentPalette());
  });
});

describe("dslDocument printLayout and activePrintLayout", () => {
  it("round-trips a full print layout block", () => {
    const source = [
      "nui 2",
      "",
      'role seam (name: "縫い代")',
      "view 印刷 (default: true seam: true)",
      "",
      "printLayout A4 (",
      "  output: svg",
      "  view: 印刷",
      "  paper: a3",
      "  orientation: landscape",
      "  columns: 3",
      "  rows: 4",
      "  overlap: 15",
      "  scale: 0.5",
      "  canvas: (500, 700)",
      ") {",
      "  layoutVar margin = 20",
      "  place 前身頃 (at: (10, margin) angle: 90 mirrorX: true)",
      "}",
      "",
      "group 前身頃 {",
      "  point A = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const parsed = parseDslDocument(source);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const layout = parsed.document!.printLayouts[0];
    expect(layout).toMatchObject({
      name: "A4",
      outputKind: "svg",
      paperSizeId: "a3",
      orientation: "landscape",
      columns: 3,
      rows: 4,
      overlapMm: 15,
      scale: 0.5,
      svgCanvasWidthMm: 500,
      svgCanvasHeightMm: 700
    });
    expect(layout.placements).toHaveLength(1);
    expect(layout.numericVariables).toHaveLength(1);

    const reserialized = serializeDocumentToDsl(parsed.document!, 2);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reparsed.document!.printLayouts[0]).toMatchObject({
      name: "A4",
      outputKind: "svg",
      paperSizeId: "a3",
      orientation: "landscape"
    });
  });

  it("omits the activePrintLayout statement when the active layout is first", () => {
    const document: DslDocumentData = {
      ...emptyDocument(),
      printLayouts: [createDefaultPrintLayout([]), createDefaultPrintLayout([{ id: "print-layout-1" }])].map((layout, index) => ({
        ...layout,
        name: `layout-${index}`
      })),
      activePrintLayoutId: undefined as unknown as string
    };
    document.activePrintLayoutId = document.printLayouts[0].id;
    const text = serializeDocumentToDsl(document, 2);
    expect(text).not.toContain("activePrintLayout");
  });

  it("promotes a deterministic name for an unnamed non-first active print layout", () => {
    const first = { ...createDefaultPrintLayout([]), id: "layout-1", name: "先頭" };
    const second = { ...createDefaultPrintLayout([first]), id: "layout-2", name: "" };
    const document: DslDocumentData = {
      ...emptyDocument(),
      printLayouts: [first, second],
      activePrintLayoutId: second.id
    };
    const text = serializeDocumentToDsl(document, 2);
    expect(text).toContain("activePrintLayout レイアウト1");
    expect(text).toContain("printLayout レイアウト1");

    const reparsed = parseDslDocument(text);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reparsed.document!.printLayouts[1].name).toBe("レイアウト1");
    expect(reparsed.document!.activePrintLayoutId).toBe(reparsed.document!.printLayouts[1].id);
  });
});

describe("dslDocument @stop / evaluationLimitIndex", () => {
  it("round-trips a mid-document @stop", () => {
    const source = ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 1 y: 1)", "@stop", "point C = coordinate(x: 2 y: 2)"].join("\n");
    const { document, parsed, text } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text).toContain("@stop");
  });

  it("omits @stop entirely when the whole document evaluates", () => {
    const source = ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 1 y: 1)"].join("\n");
    const { text, parsed } = roundTrip(source);
    expect(text).not.toContain("@stop");
    expect(parsed.evaluationLimitIndex).toBeUndefined();
  });

  it("round-trips an explicit terminal @stop without conflating it with no marker", () => {
    const source = ["point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 1 y: 1)", "@stop"].join("\n");
    const { document, parsed, text } = roundTrip(source);

    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text.split("\n").filter((line) => line === "@stop")).toHaveLength(1);
    expect(text.trimEnd().endsWith("@stop")).toBe(true);
  });

  it("places @stop before the first element when evaluationLimitIndex is 0", () => {
    const source = ["@stop", "point A = coordinate(x: 0 y: 0)"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.evaluationLimitIndex).toBe(0);
  });

  it("keeps @stop working when nested inside a group", () => {
    const source = ["group G {", "  point A = coordinate(x: 0 y: 0)", "  @stop", "  point B = coordinate(x: 1 y: 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
  });
});

describe("dslDocument layoutElementTree ElementTreeRow shape", () => {
  it("bakes a container's `{` onto its own header row and emits multi-line vertical-call rows for regular elements", () => {
    const source = ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "  @stop", "  point B = coordinate(x: 1 y: 1)", "}"].join("\n");
    const compiled = compileDslDocument(source);
    const document = compiled.document!;
    const refs = documentDslRefs(document.elements);
    const rows = layoutElementTree(document.elements, refs, document.evaluationLimitIndex);

    // v2 no longer has a separate "blockStart" row: a container's own header
    // row carries its `{` on its last physical line.
    expect(rows.map((row) => row.role)).toEqual(["statement", "statement", "atStop", "statement", "blockEnd"]);

    const groupRow = rows[0];
    expect(groupRow.lines).toEqual(["group G {"]);
    expect(groupRow.argKeys).toEqual([null]);

    // Regular (non-container) elements now serialize as vertical calls:
    // header line, one arg per line, closing `)` line.
    const pointARow = rows[1];
    expect(pointARow.lines).toEqual(["  point A = coordinate(", "    x: 0", "    y: 0", "  )"]);
    expect(pointARow.argKeys).toEqual([null, "x", "y", null]);

    expect(rows.find((row) => row.role === "atStop")!.lines).toEqual(["  @stop"]);
    expect(rows.find((row) => row.role === "blockEnd")!.lines).toEqual(["}"]);
  });
});

describe("dslDocument idempotence", () => {
  it("is a fixed point for a rich hand-written document", () => {
    const first = parseDslDocument(sampleFixture);
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const canonical = serializeDocumentToDsl(first.document!, 2);
    const second = parseDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const reserialized = serializeDocumentToDsl(second.document!, 2);
    expect(reserialized).toBe(canonical);
  });

  it("is a fixed point for an empty document", () => {
    const canonical = serializeDocumentToDsl(emptyDocument(), 2);
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 2)).toBe(canonical);
  });

  it("is a fixed point for a document with non-contiguous group children (parent= fallback)", () => {
    const g1 = compileDslToElements("group G (id: g1) {\n}", { elements: [] }).elements[0];
    let elements: CadElement[] = [g1];
    elements = compileDslToElements("point A = coordinate(x: 0 y: 0 id: pa parent: g1)", { elements }).elements;
    elements = compileDslToElements("point R = coordinate(x: 1 y: 1 id: pr)", { elements }).elements;
    elements = compileDslToElements("point B = coordinate(x: 2 y: 2 id: pb parent: g1)", { elements }).elements;

    const document: DslDocumentData = { ...emptyDocument(), elements, evaluationLimitIndex: elements.length };
    const canonical = serializeDocumentToDsl(document, 2);
    expect(canonical).toContain("parent: G");
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 2)).toBe(canonical);

    const b = parsed.document!.elements.find((element) => element.name === "B");
    const g = parsed.document!.elements.find((element) => element.name === "G");
    expect(b?.parentGroupId).toBe(g?.id);
  });
});

describe("dslDocument version handling", () => {
  it("rejects a missing nui header", () => {
    const parsed = parseDslDocument("point A = coordinate(x: 0 y: 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("nui"))).toBe(true);
  });

  it("rejects an empty document", () => {
    const parsed = parseDslDocument("");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("accepts nui 2 and nui 3 as supported major versions", () => {
    const v2 = compileDslDocument("nui 2\npoint A = coordinate(x: 0 y: 0)");
    expect(v2.document).not.toBeNull();
    expect(v2.majorVersion).toBe(2);

    const v3 = compileDslDocument("nui 3\npoint A = coordinate(x: 0 y: 0)");
    expect(v3.document).not.toBeNull();
    expect(v3.majorVersion).toBe(3);
  });

  it("rejects an unsupported major version and lists the supported set", () => {
    const parsed = parseDslDocument("nui 4\npoint A = coordinate(x: 0 y: 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("未対応のDSLバージョンです: 4(対応: 2, 3)"))).toBe(
      true
    );
  });

  it("rejects a non-numeric version", () => {
    const parsed = parseDslDocument("nui abc");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("不正なDSLバージョン"))).toBe(true);
  });

  it("rejects a duplicate nui statement and leaves majorVersion unresolved", () => {
    const compiled = compileDslDocument(["nui 2", "nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBeNull();
    expect(compiled.diagnostics.some((item) => item.message.includes("先頭に1つだけ"))).toBe(true);
  });

  it("accepts a valid nui 2 header with a leading comment", () => {
    const parsed = parseDslDocument(["# comment before header is not allowed to precede nui", "nui 2", "point A = coordinate(x: 0 y: 0)"].join("\n"));
    // comments do not produce statements, so nui 2 is still the first statement
    expect(parsed.document).not.toBeNull();
  });

  it("keeps majorVersion resolved even when an unrelated body statement is fatal", () => {
    // A valid nui 2 header, but the body has a known-fatal DivisionPlacement
    // conflict (both distance and ratio given) unrelated to the header itself.
    const compiled = compileDslDocument(
      [
        "nui 2",
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "point Both = between(start: A end: B distance: 4 ratio: 0.25)"
      ].join("\n")
    );
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBe(2);
    expect(compiled.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });
});

describe("compileDslDocument facade", () => {
  it("matches parseDslDocument output (wrapper equivalence, IDs are per-parse)", () => {
    const compiled = compileDslDocument(sampleFixture);
    const parsed = parseDslDocument(sampleFixture);
    expectSemanticallyEqualDocuments(parsed.document!, compiled.document!);
    expect(parsed.document!.printLayouts.map((layout) => layout.name)).toEqual(
      compiled.document!.printLayouts.map((layout) => layout.name)
    );
    expect(parsed.diagnostics).toEqual(compiled.diagnostics);
  });

  it("returns a null statementMap alongside error diagnostics", () => {
    const compiled = compileDslDocument("point A = coordinate(x: 0 y: 0)");
    expect(compiled.document).toBeNull();
    expect(compiled.statementMap).toBeNull();
    expect(compiled.statements.length).toBeGreaterThan(0);
    expect(compiled.sourceLines).toEqual(["point A = coordinate(x: 0 y: 0)"]);
  });

  it("builds statement line ranges, else lines, and indent depths for the sample fixture", () => {
    const compiled = compileDslDocument(sampleFixture);
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const map = compiled.statementMap!;
    const document = compiled.document!;

    const infoOf = (name: string) => {
      const element = document.elements.find((item) => item.name === name);
      expect(element, name).toBeDefined();
      const info = map.byElementId.get(element!.id);
      expect(info, name).toBeDefined();
      return info!;
    };

    expect(infoOf("前身頃")).toMatchObject({ line: 29, range: { startLine: 29, endLine: 62 }, indentDepth: 0 });
    expect(infoOf("見返し")).toMatchObject({
      line: 44,
      range: { startLine: 44, endLine: 54 },
      elseLine: 49,
      indentDepth: 1
    });
    expect(infoOf("C")).toMatchObject({ line: 45, endLine: 48, indentDepth: 2 });
    expect(infoOf("D")).toMatchObject({ line: 50, endLine: 53, indentDepth: 2 });
    expect(infoOf("繰返し")).toMatchObject({ range: { startLine: 56, endLine: 61 }, indentDepth: 1 });
    expect(infoOf("after")).toMatchObject({ line: 71, endLine: 74, range: { startLine: 71, endLine: 71 }, indentDepth: 0 });

    // 全要素がstatementMapに載る(無名要素含む)。
    expect(map.byElementId.size).toBe(document.elements.length);
    const unnamed = document.elements.find((item) => item.name === "" && item.type === "freePoint");
    expect(map.byElementId.get(unnamed!.id)).toMatchObject({ line: 64 });
  });

  it("keys non-element statements and records section ends for the sample fixture", () => {
    const compiled = compileDslDocument(sampleFixture);
    const map = compiled.statementMap!;

    expect(map.byKey.get("version")).toMatchObject({ line: 1 });
    expect(map.byKey.get("color:pattern-black")).toMatchObject({ line: 4 });
    expect(map.byKey.get("color:cut-red")).toMatchObject({ line: 5 });
    expect(map.byKey.get("role:seam")).toMatchObject({ line: 7 });
    expect(map.byKey.get("view:通常")).toMatchObject({ line: 8 });
    expect(map.byKey.get("view:印刷")).toMatchObject({ line: 9 });
    expect(map.byKey.get("activeView")).toMatchObject({ line: 10 });
    expect(map.byKey.get("printLayout:A4")).toMatchObject({ range: { startLine: 12, endLine: 25 } });
    expect(map.byKey.get("atStop")).toMatchObject({ line: 69 });

    expect(map.sectionEnds).toEqual({ version: 1, palette: 5, visibility: 10, printLayouts: 25 });
  });

  it("injects assignedElementIds while letting explicit id= win", () => {
    const source = ["nui 2", "", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 1 y: 1 id: pinned-b)"].join("\n");
    const baseline = compileDslDocument(source);
    expect(baseline.document!.elements.map((item) => item.name)).toEqual(["A", "B"]);

    // 文index: 0=version, 1=A, 2=B
    const compiled = compileDslDocument(source, {
      assignedElementIds: new Map([
        [1, "assigned-a"],
        [2, "assigned-b-ignored"]
      ])
    });
    expect(compiled.document!.elements.map((item) => item.id)).toEqual(["assigned-a", "pinned-b"]);
    expect(compiled.statementMap!.elementIdByStatementIndex.get(1)).toBe("assigned-a");
    expect(compiled.statementMap!.elementIdByStatementIndex.get(2)).toBe("pinned-b");
  });
});

describe("dslDocument golden fixture", () => {
  it("parses the sample fixture without diagnostics and preserves key structure", () => {
    const parsed = parseDslDocument(sampleFixture);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const document = parsed.document!;
    expect(document.palette.colors.map((color) => color.id)).toEqual(["pattern-black", "cut-red"]);
    expect(document.palette.defaultColorId).toBe("pattern-black");
    expect(document.visibilityRoles).toEqual([{ id: "seam", name: "縫い代" }]);
    expect(document.printLayouts).toHaveLength(1);
    expect(document.printLayouts[0].placements).toHaveLength(1);
    expect(document.elements.some((element) => element.name === "前身頃" && element.type === "group")).toBe(true);
    expect(document.evaluationLimitIndex).toBeLessThan(document.elements.length);
  });
});

describe("requireDslMajorVersionForFeature", () => {
  it("returns null once the document major meets the requirement", () => {
    expect(requireDslMajorVersionForFeature(3, 3, 5, "state: 構文")).toBeNull();
    expect(requireDslMajorVersionForFeature(3, 2, 5, "state: 構文")).toBeNull();
  });

  it("returns a coded diagnostic when the document major is too low", () => {
    const diagnostic = requireDslMajorVersionForFeature(2, 3, 5, "state: 構文");
    expect(diagnostic).toMatchObject({
      severity: "error",
      line: 5,
      column: 1,
      code: TYPED_SYNTAX_REQUIRES_NUI3_CODE,
      message: "state: 構文 は nui 3 以降でのみ使用できます(現在: nui 2)。"
    });
  });
});

describe("nui 2/3 state syntax wiring", () => {
  it("rejects state: under a nui 2 document with the version-gate diagnostic", () => {
    const parsed = parseDslDocument("nui 2\npoint A = coordinate(x: 0 y: 0 state: hidden)");
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: TYPED_SYNTAX_REQUIRES_NUI3_CODE })])
    );
    expect(parsed.document).toBeNull();
  });

  it("accepts state: visible/hidden/disabled under a nui 3 document and lowers to ElementActivity", () => {
    const parsed = parseDslDocument([
      "nui 3",
      "point A = coordinate(x: 0 y: 0 state: hidden)",
      "point B = coordinate(x: 1 y: 0 state: disabled)",
      "point C = coordinate(x: 2 y: 0)"
    ].join("\n"));
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document!.elements).toMatchObject([
      { name: "A", visible: false, enabled: true },
      { name: "B", visible: true, enabled: false },
      { name: "C", visible: true, enabled: true }
    ]);
  });

  it("v3 still accepts legacy visible/enabled flags alone (compatibility input)", () => {
    const parsed = parseDslDocument("nui 3\npoint A = coordinate(x: 0 y: 0 visible: false)");
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document!.elements).toMatchObject([{ name: "A", visible: false, enabled: true }]);
  });

  it("regenerates canonical v3 output as state: while keeping the document major unchanged", () => {
    const compiled = compileDslDocument("nui 3\npoint A = coordinate(x: 0 y: 0 state: hidden)");
    expect(compiled.majorVersion).toBe(3);
    const regenerated = serializeDocumentToDsl(compiled.document!, compiled.majorVersion!);
    expect(regenerated).toContain("state: hidden");
    expect(regenerated).not.toContain("visible:");
    expect(regenerated).not.toContain("enabled:");
    expect(regenerated.startsWith("nui 3")).toBe(true);
  });
});

describe("nui 2/3 typed declaration wiring", () => {
  it("rejects const/let under a nui 2 document with the version-gate diagnostic", () => {
    const parsed = parseDslDocument("nui 2\nconst x: number = 1");
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: TYPED_SYNTAX_REQUIRES_NUI3_CODE })])
    );
    expect(parsed.document).toBeNull();
  });

  it("accepts const/let under a nui 3 document with no diagnostics, staying out of document.elements", () => {
    // 型付き宣言のidentityはstatement reconcilerが供給する。直接compilerを
    // 呼ぶこの単体テストでも、その契約を明示して渡す。
    const compiled = compileDslDocument(
      ["nui 3", "const x: number = 1", "let 表示する: boolean = true", "point A = coordinate(x: 0 y: 0)"].join("\n"),
      {
        assignedStatementIds: new Map([
          [1, "test:typed:x"],
          [2, "test:typed:visible"]
        ])
      }
    );
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.majorVersion).toBe(3);
    expect(compiled.document!.elements).toMatchObject([{ name: "A" }]);
    const declarations = compiled.statements.filter((item) => item.kind === "typedDeclaration");
    expect(declarations).toHaveLength(2);
  });
});
