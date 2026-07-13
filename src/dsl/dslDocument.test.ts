import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { createDefaultPrintLayout } from "../print/printLayout";
import type { CadElement } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import {
  compileDslDocument,
  parseDslDocument,
  serializeDocumentToDsl,
  type DslDocumentData
} from "./dslDocument";
import {
  emptyDocument,
  expectSemanticallyEqualDocuments,
  roundTrip
} from "./dslDocumentTestUtils";
import sampleFixture from "./__fixtures__/sample.nui?raw";

describe("dslDocument round-trip matrix", () => {
  it("round-trips freePoint via coordinate literal", () => {
    const { document, parsed } = roundTrip("point A = (12.5, -30)");
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetPoint via name reference and expression", () => {
    const { document, parsed } = roundTrip(["var d = 12", "point A = (0, 0)", "point B = offset A dx=d dy=-(d * 2)"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips polarOffsetPoint", () => {
    const { document, parsed } = roundTrip(["point A = (0, 0)", "point B = polar A angle=45 distance=10"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips divisionPoint by ratio and by distance", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "point M1 = between A B ratio=0.5", "point M2 = between A B distance=30"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineDivisionPoint via derived endpoint anchor", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "line AB = A -> B", "point M = on AB.end distance=10"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips intersectionPoint by qualified line ids", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (0, 100)",
        "point D = (100, 100)",
        "line AB = A -> B",
        "line CD = C -> D",
        "point X = intersection AB CD index=0 extensions=true"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineTangentOffsetPoint", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "arc c center=A radius=50 start=0 end=180", "point H = tangentOffset c base=A angle=30 distance=5"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("quotes multi-token numeric attributes while keeping expression values intact", () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "line AB = A -> B",
      "point Polar = polar A angle=0 distance=1",
      "line Length = from A angle=0 length=1",
      "arc Arc center=A radius=1 start=0 end=90",
      "point Tail = tangentOffset AB base=A angle=0 distance=1",
      "if 条件 condition=1 {",
      "  point ConditionalPoint = (0, 0)",
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
    const serialized = serializeDocumentToDsl(document);
    const compiled = compileDslDocument(serialized);

    expect(serialized).toContain('angle="1 + 2"');
    expect(serialized).toContain('distance="sqrt(9) + 1"');
    expect(serialized).toContain('length="- (2 * 3)"');
    expect(serialized).toContain('radius="10 / 2"');
    expect(serialized).toContain('condition="AB.length > 0 && 2 > 1"');
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

  it("round-trips line via -> and angleLengthLine via from/angle/length", () => {
    const { document, parsed } = roundTrip(
      ["point A = (0, 0)", "point B = (100, 0)", "line AB = A -> B", "line shoulder = from A angle=-12 length=130"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips arcLine, threePointArcLine, cornerRadiusArcLine", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (50, 50)",
        "point C = (100, 0)",
        "line AB = A -> B",
        "line BC = B -> C",
        "arc simple center=A radius=30 start=0 end=90",
        "arc three = through A B C start=0 end=180",
        "arc corner = corner AB.end BC.start radius=10 index=0"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips edge and extendTrim", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (150, 0)",
        "line AB = A -> B",
        "line BC = B -> C",
        "element e1 type=edge endpoint1=AB.end endpoint2=BC.start intersectionIndex=0",
        "line extended = extend AB.end to=C"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips bezierCurve with intermediate points", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 30)",
        "curve neckline = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[C:45:20:25]"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetLine, splitLine", () => {
    const { text, document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 0)",
        "line AB = A -> B",
        "line seam = offset [AB] distance=10 side=left closed=false suppressTrimWarnings=true",
        "line lower = split AB at=C"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(text).toContain("suppressTrimWarnings=true");
  });

  it("round-trips copyLine, symmetricCopyLine, move, symmetricMove via generic element syntax", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "line AB = A -> B",
        "element cp type=copyLine startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB]",
        "element sym type=symmetricCopyLine axisPoint1=A axisPoint2=B baseLineIds=[AB]",
        "element mv type=move startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB]",
        "element smv type=symmetricMove axisPoint1=A axisPoint2=B baseLineIds=[AB]"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips image via generic element syntax", () => {
    const { document, parsed } = roundTrip(
      "element img type=image sourcePath=\"assets/ref.png\" originPoint=(0,0) scale=1 angleDeg=0 mirrorX=false"
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text with quoted body and derived anchor", () => {
    const { document, parsed } = roundTrip(["point A = (0, 0)", "text label = \"前中心\" at=A size=4"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text containing a newline as an escaped single DSL line", () => {
    const { text, parsed } = roundTrip(["point A = (0, 0)", "text label = \"一行目\\n二行目\" at=A size=4"].join("\n"));
    expect(text).toContain('text label = "一行目\\n二行目" at=A size=4');
    expect(parsed.elements.find((element) => element.name === "label")).toMatchObject({
      type: "text",
      text: "一行目\n二行目"
    });
  });

  it("round-trips variable with expression mode and with pointDistance mode", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = (0, 0)",
        "point B = (10, 0)",
        "var bust = 840",
        "var d = 0 mode=pointDistance point1=A point2=B scope=group"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument nesting", () => {
  it("round-trips nested groups", () => {
    const source = [
      "group 前身頃 {",
      "  point A = (0, 0)",
      "  group 襟 {",
      "    point B = (1, 1)",
      "  }",
      "  point C = (2, 2)",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(parsed.elements.map((element) => element.type)).toEqual(["group", "freePoint", "group", "freePoint", "freePoint"]);
  });

  it("round-trips if/else branches", () => {
    const source = ["if 分岐 condition=1 {", "  point A = (0, 0)", "} else {", "  point B = (1, 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips for blocks", () => {
    const source = ["for 繰返し i start=0 count=3 step=1 {", "  point P = (i * 10, 0)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips deeply nested group/if/for combinations", () => {
    const source = [
      "group 外 {",
      "  if 内分岐 condition=1 {",
      "    for 内繰返し i start=0 count=2 step=1 {",
      "      point P = (i, 0)",
      "    }",
      "  } else {",
      "    point Q = (0, 0)",
      "  }",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument unnamed elements", () => {
  it("round-trips unnamed elements at the root", () => {
    const source = ["point = (0, 0)", "point = (5, 5)"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(parsed.elements.map((element) => element.name)).toEqual(["", ""]);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips unnamed group blocks", () => {
    const source = ["group {", "  point A = (0, 0)", "}"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.elements[0].name).toBe("");
    expect(parsed.elements[1].parentGroupId).toBe(parsed.elements[0].id);
  });
});

describe("dslDocument palette", () => {
  it("round-trips palette colors and defaultColorId", () => {
    const source = [
      "nui 1",
      "",
      "color main \"#112233\" name=\"本体\"",
      "color accent \"#445566\" name=\"アクセント\" default"
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
    const reserialized = serializeDocumentToDsl(parsed.document!);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.document?.palette).toEqual(parsed.document?.palette);
  });

  it("falls back to the default palette when no color statements are present", () => {
    const parsed = parseDslDocument("nui 1\n\npoint A = (0, 0)");
    expect(parsed.document?.palette).toEqual(defaultDocumentPalette());
  });
});

describe("dslDocument printLayout and activePrintLayout", () => {
  it("round-trips a full print layout block", () => {
    const source = [
      "nui 1",
      "",
      "role seam name=\"縫い代\"",
      "view 印刷 default=true seam=true",
      "",
      "printLayout A4 output=svg view=印刷 paper=a3 orientation=landscape columns=3 rows=4 overlap=15 scale=0.5 canvas=(500, 700) {",
      "  layoutVar margin = 20",
      "  place 前身頃 at=(10, margin) angle=90 mirrorX=true",
      "}",
      "",
      "group 前身頃 {",
      "  point A = (0, 0)",
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

    const reserialized = serializeDocumentToDsl(parsed.document!);
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
    const text = serializeDocumentToDsl(document);
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
    const text = serializeDocumentToDsl(document);
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
    const source = ["point A = (0, 0)", "point B = (1, 1)", "@stop", "point C = (2, 2)"].join("\n");
    const { document, parsed, text } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text).toContain("@stop");
  });

  it("omits @stop entirely when the whole document evaluates", () => {
    const source = ["point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const { text, parsed } = roundTrip(source);
    expect(text).not.toContain("@stop");
    expect(parsed.evaluationLimitIndex).toBe(2);
  });

  it("places @stop before the first element when evaluationLimitIndex is 0", () => {
    const source = ["@stop", "point A = (0, 0)"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.evaluationLimitIndex).toBe(0);
  });

  it("keeps @stop working when nested inside a group", () => {
    const source = ["group G {", "  point A = (0, 0)", "  @stop", "  point B = (1, 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
  });
});

describe("dslDocument idempotence", () => {
  it("is a fixed point for a rich hand-written document", () => {
    const first = parseDslDocument(sampleFixture);
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const canonical = serializeDocumentToDsl(first.document!);
    const second = parseDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const reserialized = serializeDocumentToDsl(second.document!);
    expect(reserialized).toBe(canonical);
  });

  it("is a fixed point for an empty document", () => {
    const canonical = serializeDocumentToDsl(emptyDocument());
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!)).toBe(canonical);
  });

  it("is a fixed point for a document with non-contiguous group children (parent= fallback)", () => {
    const g1 = compileDslToElements("group G id=g1", { elements: [] }).elements[0];
    let elements: CadElement[] = [g1];
    elements = compileDslToElements("point A = (0, 0) id=pa parent=g1", { elements }).elements;
    elements = compileDslToElements("point R = (1, 1) id=pr", { elements }).elements;
    elements = compileDslToElements("point B = (2, 2) id=pb parent=g1", { elements }).elements;

    const document: DslDocumentData = { ...emptyDocument(), elements, evaluationLimitIndex: elements.length };
    const canonical = serializeDocumentToDsl(document);
    expect(canonical).toContain("parent=G");
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!)).toBe(canonical);

    const b = parsed.document!.elements.find((element) => element.name === "B");
    const g = parsed.document!.elements.find((element) => element.name === "G");
    expect(b?.parentGroupId).toBe(g?.id);
  });
});

describe("dslDocument version handling", () => {
  it("rejects a missing nui header", () => {
    const parsed = parseDslDocument("point A = (0, 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("nui"))).toBe(true);
  });

  it("rejects an empty document", () => {
    const parsed = parseDslDocument("");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("rejects an unknown major version", () => {
    const parsed = parseDslDocument("nui 2\npoint A = (0, 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("未対応のDSLバージョン"))).toBe(true);
  });

  it("rejects a non-numeric version", () => {
    const parsed = parseDslDocument("nui abc");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("不正なDSLバージョン"))).toBe(true);
  });

  it("rejects a duplicate nui statement", () => {
    const parsed = parseDslDocument(["nui 1", "nui 1", "point A = (0, 0)"].join("\n"));
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("先頭に1つだけ"))).toBe(true);
  });

  it("accepts a valid nui 1 header with a leading comment", () => {
    const parsed = parseDslDocument(["# comment before header is not allowed to precede nui", "nui 1", "point A = (0, 0)"].join("\n"));
    // comments do not produce statements, so nui 1 is still the first statement
    expect(parsed.document).not.toBeNull();
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
    const compiled = compileDslDocument("point A = (0, 0)");
    expect(compiled.document).toBeNull();
    expect(compiled.statementMap).toBeNull();
    expect(compiled.statements.length).toBeGreaterThan(0);
    expect(compiled.sourceLines).toEqual(["point A = (0, 0)"]);
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

    expect(infoOf("前身頃")).toMatchObject({ line: 18, range: { startLine: 18, endLine: 32 }, indentDepth: 0 });
    expect(infoOf("見返し")).toMatchObject({
      line: 23,
      range: { startLine: 23, endLine: 27 },
      elseLine: 25,
      indentDepth: 1
    });
    expect(infoOf("C")).toMatchObject({ line: 24, indentDepth: 2 });
    expect(infoOf("D")).toMatchObject({ line: 26, indentDepth: 2 });
    expect(infoOf("繰返し")).toMatchObject({ range: { startLine: 29, endLine: 31 }, indentDepth: 1 });
    expect(infoOf("after")).toMatchObject({ line: 38, range: { startLine: 38, endLine: 38 }, indentDepth: 0 });

    // 全要素がstatementMapに載る(無名要素含む)。
    expect(map.byElementId.size).toBe(document.elements.length);
    const unnamed = document.elements.find((item) => item.name === "" && item.type === "freePoint");
    expect(map.byElementId.get(unnamed!.id)).toMatchObject({ line: 34 });
  });

  it("keys non-element statements and records section ends for the sample fixture", () => {
    const compiled = compileDslDocument(sampleFixture);
    const map = compiled.statementMap!;

    expect(map.byKey.get("version")).toMatchObject({ line: 1 });
    expect(map.byKey.get("color:pattern-black")).toMatchObject({ line: 3 });
    expect(map.byKey.get("color:cut-red")).toMatchObject({ line: 4 });
    expect(map.byKey.get("role:seam")).toMatchObject({ line: 6 });
    expect(map.byKey.get("view:通常")).toMatchObject({ line: 7 });
    expect(map.byKey.get("view:印刷")).toMatchObject({ line: 8 });
    expect(map.byKey.get("activeView")).toMatchObject({ line: 9 });
    expect(map.byKey.get("printLayout:A4")).toMatchObject({ range: { startLine: 11, endLine: 14 } });
    expect(map.byKey.get("atStop")).toMatchObject({ line: 36 });

    expect(map.sectionEnds).toEqual({ version: 1, palette: 4, visibility: 9, printLayouts: 14 });
  });

  it("injects assignedElementIds while letting explicit id= win", () => {
    const source = ["nui 1", "", "point A = (0, 0)", "point B = (1, 1) id=pinned-b"].join("\n");
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
