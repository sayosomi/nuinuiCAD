import { describe, expect, it } from "vitest";
import { defaultDocumentPalette } from "../palette/palette";
import { createDefaultPrintLayout } from "../print/printLayout";
import type { CadElement } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import {
  compileDslDocument,
  layoutElementTree,
  parseDslDocument,
  serializeDocumentToDsl,
  type DslDocumentData
} from "./dslDocument";
import {
  PROPERTY_BINDING_TYPE_MISMATCH_CODE,
  PROPERTY_BINDING_UNRESOLVED_CODE,
  propertyBindingOccurrenceKey
} from "../scalars/propertyBindingCompiler";
import { TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE } from "../scalars/textTemplate";
import {
  CONST_ASSIGNMENT_CODE,
  INVALID_SET_TARGET_CODE,
  MISSING_SET_STATEMENT_IDENTITY_CODE
} from "../scalars/setStatementCompiler";
import {
  emptyDocument,
  expectSemanticallyEqualDocuments,
  roundTrip
} from "./dslDocumentTestUtils";
import { documentDslRefs } from "./dslSerializer";
import sampleFixture from "./__fixtures__/sample.nui?raw";

describe("dslDocument round-trip matrix", () => {
  it("round-trips freePoint via coordinate literal", () => {
    const { document, parsed } = roundTrip("point A = coordinate(x: 12.5,y: -30)");
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetPoint via name reference and expression", () => {
    const { document, parsed } = roundTrip(["point A = coordinate(x: 0,y: 0)", "point B = offset(from: @A, dx: 12, dy: -(12 * 2))"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips polarOffsetPoint", () => {
    const { document, parsed } = roundTrip(["point A = coordinate(x: 0,y: 0)", "point B = polar(from: @A,angle: 45,distance: 10)"].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips divisionPoint by ratio and by distance", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 100,y: 0)", "point M1 = between(start: @A,end: @B,ratio: 0.5)", "point M2 = between(start: @A,end: @B,distance: 30)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineDivisionPoint via derived endpoint anchor", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 100,y: 0)", "line AB = segment(start: @A,end: @B)", "point M = onLine(from: @AB.end,distance: 10)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips intersectionPoint by qualified line ids", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "point C = coordinate(x: 0,y: 100)",
        "point D = coordinate(x: 100,y: 100)",
        "line AB = segment(start: @A,end: @B)",
        "line CD = segment(start: @C,end: @D)",
        "point X = intersection(line1: @AB,line2: @CD,index: 0,extensions: true)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips lineTangentOffsetPoint", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0,y: 0)", "arc c = arc(center: @A,radius: 50,start: 0,end: 180)", "point H = tangentOffset(line: @c,base: @A,angle: 30,distance: 5)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("keeps multi-token numeric expressions intact across a round-trip", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point Polar = polar(from: @A, angle: 0, distance: 1)",
      "line Length = polar(start: @A, angle: 0, length: 1)",
      "arc Arc = arc(center: @A, radius: 1, start: 0, end: 90)",
      "point Tail = tangentOffset(line: @AB, base: @A, angle: 0, distance: 1)",
      "if (true) {",
      "  point ConditionalPoint = coordinate(x: 0, y: 0)",
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
        return { ...element, condition: expression(`${baseLine.id}.length > 0 &&  2 > 1`) };
      }
      return element;
    });
    const document = { ...initial, elements };
    const serialized = serializeDocumentToDsl(document, 4);
    const compiled = compileDslDocument(serialized);

    expect(serialized).toContain("angle: 1 + 2");
    expect(serialized).toContain("distance: sqrt(9) + 1");
    expect(serialized).toContain("length: - (2 * 3)");
    expect(serialized).toContain("radius: 10 / 2");
    expect(serialized).toContain("@AB.length > 0  and");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const compiledTail = compiled.document!.elements.find((element) => element.name === "Tail");
    const compiledCondition = compiled.document!.elements.find((element) => element.type === "conditionalGroup");
    expect(compiledTail).toMatchObject({
      distance: { kind: "expression", expression: expect.stringContaining(" / 5)") }
    });
    expect(compiledCondition).toMatchObject({
      condition: { kind: "expression", expression: expect.stringContaining(" and   2 > 1") }
    });
  });

  it("round-trips line via segment() and angleLengthLine via polar()", () => {
    const { document, parsed } = roundTrip(
      ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 100,y: 0)", "line AB = segment(start: @A,end: @B)", "line shoulder = polar(start: @A,angle: -12,length: 130)"].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips arcLine, threePointArcLine, cornerRadiusArcLine", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 50,y: 50)",
        "point C = coordinate(x: 100,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "line BC = segment(start: @B,end: @C)",
        "arc simple = arc(center: @A,radius: 30,start: 0,end: 90)",
        "arc three = through(point1: @A,point2: @B,point3: @C,start: 0,end: 180)",
        "arc corner = corner(end1: @AB.end, end2: @BC.start,radius: 10,index: 0)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips edge and extendTrim", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "point C = coordinate(x: 150,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "line BC = segment(start: @B,end: @C)",
        "edge(end1: @AB.end, end2: @BC.start, index: 0)",
        "extend(end: @AB.end, to: @C)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips bezierCurve with intermediate points", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "point C = coordinate(x: 50,y: 30)",
        "curve neckline = bezier(start: @A,end: @B,startAngle: -90,startLength: 35,endAngle: 180,endLength: 45,intermediates: [@C:45:20:25])"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips offsetLine, splitLine", () => {
    const { text, document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "point C = coordinate(x: 50,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "line seam = offset(sources: [@AB],distance: 10,side: left,closed: false,suppressTrimWarnings: true)",
        "line lower = split(source: @AB, at: @C)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(text).toContain("suppressTrimWarnings: true");
  });

  it("round-trips copyLine, symmetricCopyLine, move, symmetricMove", () => {
    const { document, parsed } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "line cp = copy(startPoint: @A,endPoint: @B,scale: 1,angleDeg: 0,mirrorX: false,baseLines: [@AB])",
        "line sym = mirrorCopy(axis1: @A,axis2: @B,baseLines: [@AB])",
        "move(targets: [@AB], from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: false)",
        "mirrorMove(targets: [@AB] ,axis1: @A ,axis2: @B)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips image", () => {
    const { document, parsed } = roundTrip(
      'image img = image(source: "assets/ref.png",origin: (0, 0),scale: 1,angleDeg: 0,mirrorX: false)'
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text with quoted body and derived anchor", () => {
    const { document, parsed } = roundTrip(["point A = coordinate(x: 0,y: 0)", 'text label = label(text: "前中心",anchor: @A,size: 4)'].join("\n"));
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips text containing a newline as an escaped single DSL line", () => {
    const { text, parsed } = roundTrip(["point A = coordinate(x: 0,y: 0)", 'text label = label(text: "一行目\\n二行目",anchor: @A,size: 4)'].join("\n"));
    expect(text).toContain('text: "一行目\\n二行目"');
    expect(parsed.elements.find((element) => element.name === "label")).toMatchObject({
      type: "text",
      text: "一行目\n二行目"
    });
  });

});

describe("dslDocument nesting", () => {
  it("round-trips nested groups", () => {
    const source = [
      "group 前身頃 {",
      "  point A = coordinate(x: 0,y: 0)",
      "  group 襟 {",
      "    point B = coordinate(x: 1,y: 1)",
      "  }",
      "  point C = coordinate(x: 2,y: 2)",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(parsed.elements.map((element) => element.type)).toEqual(["group", "freePoint", "group", "freePoint", "freePoint"]);
  });

  it("round-trips if/else branches", () => {
    const source = ["if (true) {", "  point A = coordinate(x: 0,y: 0)", "} else {", "  point B = coordinate(x: 1,y: 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips for blocks", () => {
    const source = ["for i in range(from: 0,count: 3,step: 1) {", "  point P = coordinate(x: i * 10,y: 0)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips deeply nested group/if/for combinations", () => {
    const source = [
      "group 外 {",
      "  if (true) {",
      "    for i in range(from: 0,count: 2,step: 1) {",
      "      point P = coordinate(x: i,y: 0)",
      "    }",
      "  } else {",
      "    point Q = coordinate(x: 0,y: 0)",
      "  }",
      "}"
    ].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });
});

describe("dslDocument unnamed elements", () => {
  it("round-trips unnamed elements at the root", () => {
    const source = ["point = coordinate(x: 0,y: 0)", "point = coordinate(x: 5,y: 5)"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(parsed.elements.map((element) => element.name)).toEqual(["", ""]);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips unnamed group blocks", () => {
    const source = ["group {", "  point A = coordinate(x: 0,y: 0)", "}"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.elements[0].name).toBe("");
    expect(parsed.elements[1].parentGroupId).toBe(parsed.elements[0].id);
  });
});

describe("dslDocument palette", () => {
  it("round-trips palette colors and defaultColorId", () => {
    const source = [
      "nui 4",
      "",
      'color main ("#112233", name: "本体")',
      'color accent ("#445566", name: "アクセント", default: true)'
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
    const reserialized = serializeDocumentToDsl(parsed.document!, 4);
    const reparsed = parseDslDocument(reserialized);
    expect(reparsed.document?.palette).toEqual(parsed.document?.palette);
  });

  it("falls back to the default palette when no color statements are present", () => {
    const parsed = parseDslDocument("nui 4\n\npoint A = coordinate(x: 0, y: 0)");
    expect(parsed.document?.palette).toEqual(defaultDocumentPalette());
  });
});

describe("dslDocument printLayout and activePrintLayout", () => {
  it("round-trips a full print layout block", () => {
    const source = [
      "nui 4",
      "",
      'role seam (name: "縫い代")',
      "view 印刷 (default: true, seam: true)",
      "",
      "group 前身頃 {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "",
      "printLayout A4 (",
      "  output: svg,",
      "  view: 印刷,",
      "  paper: a3,",
      "  orientation: landscape,",
      "  columns: 3,",
      "  rows: 4,",
      "  overlap: 15,",
      "  scale: 0.5,",
      "  canvas: (500, 700)",
      ") {",
      "  place @前身頃(at: (10, 20), angle: 90, mirrorX: true)",
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

    const reserialized = serializeDocumentToDsl(parsed.document!, 4);
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
    const text = serializeDocumentToDsl(document, 4);
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
    const text = serializeDocumentToDsl(document, 4);
    expect(text).toContain("activePrintLayout レイアウト1");
    expect(text).toContain("printLayout レイアウト1");

    const reparsed = parseDslDocument(text);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reparsed.document!.printLayouts[1].name).toBe("レイアウト1");
    expect(reparsed.document!.activePrintLayoutId).toBe(reparsed.document!.printLayouts[1].id);
  });
});

describe("printLayout is the canonical document-end sink", () => {
  it("accepts stop before the final printLayout section", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "group 前身頃 {",
      "}",
      "stop",
      "printLayout A4(",
      "  width: 210,",
      "  height: 297,",
      ") {",
      "  const margin: number = 10",
      "  place @前身頃(x: @margin, y: @margin, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"), {
      assignedStatementIds: new Map([[5, "test:print-layout-margin"]])
    });
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.document?.printLayouts[0].placements).toHaveLength(1);
  });

  it("adds a trailing comma to every argument in canonical multi-line calls", () => {
    const compiled = compileDslDocument("nui 4\npoint A = coordinate(\n  x: 0,\n  y: 0\n)");
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(compiled.document!, 4)).toContain(
      "point A = coordinate(\n  x: 0,\n  y: 0,\n)"
    );
  });

  it("serializes the printLayout section after the elements section", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "printLayout レイアウト1 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const text = serializeDocumentToDsl(compiled.document!, 4);
    const elementIndex = text.indexOf("point A");
    const printLayoutIndex = text.indexOf("printLayout");
    expect(elementIndex).toBeGreaterThanOrEqual(0);
    expect(printLayoutIndex).toBeGreaterThan(elementIndex);
  });

  const bodyStatementAfterPrintLayout = (trailingStatement: string) =>
    [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "printLayout レイアウト1 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}",
      trailingStatement
    ].join("\n");

  it("rejects a set statement placed after a printLayout block", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "let v: number = 1",
      "printLayout レイアウト1 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}",
      "set v = 2"
    ].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error" && item.message.includes("printLayout"))).toBe(true);
  });

  it("rejects a typed declaration placed after a printLayout block", () => {
    const compiled = compileDslDocument(bodyStatementAfterPrintLayout("let v: number = 2"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error" && item.message.includes("printLayout"))).toBe(true);
  });

  it("rejects an element placed after a printLayout block", () => {
    const compiled = compileDslDocument(bodyStatementAfterPrintLayout("point B = coordinate(x: 1, y: 1)"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error" && item.message.includes("printLayout"))).toBe(true);
  });

  it("rejects a group placed after a printLayout block", () => {
    const compiled = compileDslDocument(
      bodyStatementAfterPrintLayout(["group G {", "  point C = coordinate(x: 2, y: 2)", "}"].join("\n"))
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error" && item.message.includes("printLayout"))).toBe(true);
  });

  it("rejects a reverse statement placed after a printLayout block", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "line AB = segment(start: @A, end: @B)",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)",
      "printLayout レイアウト1 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}",
      "reverse(target: AB)"
    ].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some((item) => item.severity === "error" && item.message.includes("printLayout"))).toBe(true);
  });

  it("allows a further printLayout block (and its place statements) after the first one", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout 一枚目 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(at: (0, 0), angle: 0, mirrorX: false)",
      "}",
      "printLayout 二枚目 (output: pdf, paper: a4, orientation: portrait, columns: 1, rows: 1, overlap: 0, scale: 1, canvas: (410, 584)) {",
      "  place @G(at: (0, 0), angle: 0, mirrorX: false)",
      "}",
      "activePrintLayout 二枚目"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    expect(compiled.document!.printLayouts).toHaveLength(2);
  });
});

describe("dslDocument stop / evaluationLimitIndex", () => {
  it("round-trips a mid-document stop", () => {
    const source = ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 1,y: 1)", "stop", "point C = coordinate(x: 2,y: 2)"].join("\n");
    const { document, parsed, text } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text).toContain("stop");
  });

  it("omits stop entirely when the whole document evaluates", () => {
    const source = ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 1,y: 1)"].join("\n");
    const { text, parsed } = roundTrip(source);
    expect(text).not.toContain("stop");
    expect(parsed.evaluationLimitIndex).toBeUndefined();
  });

  it("round-trips an explicit terminal stop without conflating it with no marker", () => {
    const source = ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 1,y: 1)", "stop"].join("\n");
    const { document, parsed, text } = roundTrip(source);

    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
    expect(text.split("\n").filter((line) => line === "stop")).toHaveLength(1);
    expect(text.trimEnd().endsWith("stop")).toBe(true);
  });

  it("places stop before the first element when evaluationLimitIndex is 0", () => {
    const source = ["stop", "point A = coordinate(x: 0,y: 0)"].join("\n");
    const { parsed } = roundTrip(source);
    expect(parsed.evaluationLimitIndex).toBe(0);
  });

  it("keeps stop working when nested inside a group", () => {
    const source = ["group G {", "  point A = coordinate(x: 0,y: 0)", "  stop", "  point B = coordinate(x: 1,y: 1)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expect(document.evaluationLimitIndex).toBe(2);
    expect(parsed.evaluationLimitIndex).toBe(2);
  });
});

describe("dslDocument layoutElementTree ElementTreeRow shape", () => {
  it("bakes a container's `{` onto its own header row and emits multi-line vertical-call rows for regular elements", () => {
    const source = ["nui 4", "group G {", "  point A = coordinate(x: 0, y: 0)", "  stop", "  point B = coordinate(x: 1, y: 1)", "}"].join("\n");
    const compiled = compileDslDocument(source);
    const document = compiled.document!;
    const refs = documentDslRefs(document.elements);
    const rows = layoutElementTree(document.elements, refs, document.evaluationLimitIndex);

    // There is no separate "blockStart" row: a container's own header
    // row carries its `{` on its last physical line.
    expect(rows.map((row) => row.role)).toEqual(["statement", "statement", "atStop", "statement", "blockEnd"]);

    const groupRow = rows[0];
    expect(groupRow.lines).toEqual(["group G {"]);
    expect(groupRow.argKeys).toEqual([null]);

    // Regular (non-container) elements now serialize as vertical calls:
    // header line, one arg per line, closing `)` line.
    const pointARow = rows[1];
    expect(pointARow.lines).toEqual(["  point A = coordinate(", "    x: 0,", "    y: 0,", "  )"]);
    expect(pointARow.argKeys).toEqual([null, "x", "y", null]);

    expect(rows.find((row) => row.role === "atStop")!.lines).toEqual(["  stop"]);
    expect(rows.find((row) => row.role === "blockEnd")!.lines).toEqual(["}"]);
  });
});

describe("dslDocument idempotence", () => {
  it("is a fixed point for a rich hand-written document", () => {
    const first = parseDslDocument(sampleFixture);
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const canonical = serializeDocumentToDsl(first.document!, 4);
    const second = parseDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const reserialized = serializeDocumentToDsl(second.document!, 4);
    expect(reserialized).toBe(canonical);
  });

  it("is a fixed point for an empty document", () => {
    const canonical = serializeDocumentToDsl(emptyDocument(), 4);
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 4)).toBe(canonical);
  });

  it("is a fixed point for a document with non-contiguous group children (parent= fallback)", () => {
    const g1 = compileDslToElements("group G (id: g1) {\n}", { elements: [] }).elements[0];
    let elements: CadElement[] = [g1];
    elements = compileDslToElements("point A = coordinate(x: 0, y: 0, id: pa, parent: @g1)", { elements }).elements;
    elements = compileDslToElements("point R = coordinate(x: 1, y: 1, id: pr)", { elements }).elements;
    elements = compileDslToElements("point B = coordinate(x: 2, y: 2, id: pb, parent: @g1)", { elements }).elements;

    const document: DslDocumentData = { ...emptyDocument(), elements, evaluationLimitIndex: elements.length };
    const canonical = serializeDocumentToDsl(document, 4);
    expect(canonical).toContain("parent: @G");
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 4)).toBe(canonical);

    const b = parsed.document!.elements.find((element) => element.name === "B");
    const g = parsed.document!.elements.find((element) => element.name === "G");
    expect(b?.parentGroupId).toBe(g?.id);
  });
});

describe("dslDocument version handling", () => {
  it("rejects a missing nui header", () => {
    const parsed = parseDslDocument("point A = coordinate(x: 0, y: 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("nui"))).toBe(true);
  });

  it("rejects an empty document", () => {
    const parsed = parseDslDocument("");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("accepts nui 4 as the only supported major version", () => {
    const v4 = compileDslDocument("nui 4\npoint A = coordinate(x: 0, y: 0)");
    expect(v4.document).not.toBeNull();
    expect(v4.majorVersion).toBe(4);
  });

  it("rejects an unsupported major version and lists the supported set", () => {
    const parsed = parseDslDocument("nui 3\npoint A = coordinate(x: 0, y: 0)");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("未対応のDSLバージョンです: 3(対応: 4)"))).toBe(
      true
    );
  });

  it("rejects a non-numeric version", () => {
    const parsed = parseDslDocument("nui abc");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("不正なDSLバージョン"))).toBe(true);
  });

  it("rejects a duplicate nui statement and leaves majorVersion unresolved", () => {
    const compiled = compileDslDocument(["nui 4", "nui 4", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBeNull();
    expect(compiled.diagnostics.some((item) => item.message.includes("先頭に1つだけ"))).toBe(true);
  });

  it("accepts a valid nui 4 header with a leading comment", () => {
    const parsed = parseDslDocument(["// comment before header is not allowed to precede nui", "nui 4", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    // comments do not produce statements, so nui 4 is still the first statement
    expect(parsed.document).not.toBeNull();
  });

  it("keeps majorVersion resolved even when an unrelated body statement is fatal", () => {
    // A valid nui 4 header, but the body has a known-fatal DivisionPlacement
    // conflict (both distance and ratio given) unrelated to the header itself.
    const compiled = compileDslDocument(
      [
        "nui 4",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "point Both = between(start: @A, end: @B, distance: 4, ratio: 0.25)"
      ].join("\n")
    );
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBe(4);
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
    const compiled = compileDslDocument("point A = coordinate(x: 0, y: 0)");
    expect(compiled.document).toBeNull();
    expect(compiled.statementMap).toBeNull();
    expect(compiled.statements.length).toBeGreaterThan(0);
    expect(compiled.sourceLines).toEqual(["point A = coordinate(x: 0, y: 0)"]);
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

    expect(infoOf("前身頃")).toMatchObject({ line: 12, range: { startLine: 12, endLine: 45 }, indentDepth: 0 });
    const conditional = document.elements.find((item) => item.type === "conditionalGroup");
    expect(conditional).toBeDefined();
    expect(map.byElementId.get(conditional!.id)).toMatchObject({
      line: 27,
      range: { startLine: 27, endLine: 37 },
      elseLine: 32,
      indentDepth: 1
    });
    expect(infoOf("C")).toMatchObject({ line: 28, endLine: 31, indentDepth: 2 });
    expect(infoOf("D")).toMatchObject({ line: 33, endLine: 36, indentDepth: 2 });
    const loop = document.elements.find((item) => item.type === "forGroup");
    expect(loop).toBeDefined();
    expect(map.byElementId.get(loop!.id)).toMatchObject({ range: { startLine: 39, endLine: 44 }, indentDepth: 1 });
    expect(infoOf("after")).toMatchObject({ line: 54, endLine: 57, range: { startLine: 54, endLine: 54 }, indentDepth: 0 });

    // 全要素がstatementMapに載る(無名要素含む)。
    expect(map.byElementId.size).toBe(document.elements.length);
    const unnamed = document.elements.find((item) => item.name === "" && item.type === "freePoint");
    expect(map.byElementId.get(unnamed!.id)).toMatchObject({ line: 47 });
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
    expect(map.byKey.get("printLayout:A4")).toMatchObject({ range: { startLine: 59, endLine: 71 } });
    expect(map.byKey.get("atStop")).toMatchObject({ line: 52 });

    expect(map.sectionEnds).toEqual({ version: 1, palette: 5, visibility: 10, elements: 57, printLayouts: 71 });
  });

  it("counts a trailing stop (with no printLayout yet) as the end of the elements section, not the statement before it", () => {
    const source = ["nui 4", "point A = coordinate(x: 0, y: 0)", "stop"].join("\n");
    const compiled = compileDslDocument(source);
    const map = compiled.statementMap!;
    // Line 2 is "point A = ..."; line 3 is "stop" - sectionEnds.elements must
    // point at stop's own line (the true end of the section) so a
    // newly-inserted printLayout is anchored after it, not before it.
    expect(map.byKey.get("atStop")).toMatchObject({ line: 3 });
    expect(map.sectionEnds.elements).toBe(3);
  });

  it("injects assignedElementIds while letting explicit id= win", () => {
    const source = ["nui 4", "", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1, id: pinned-b)"].join("\n");
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

describe("nui 4 state syntax wiring", () => {
  it("accepts state: visible/hidden/disabled and lowers to ElementActivity", () => {
    const parsed = parseDslDocument([
      "nui 4",
      "point A = coordinate(x: 0, y: 0, state: hidden)",
      "point B = coordinate(x: 1, y: 0, state: disabled)",
      "point C = coordinate(x: 2, y: 0)"
    ].join("\n"));
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document!.elements).toMatchObject([
      { name: "A", activity: "hidden" },
      { name: "B", activity: "disabled" },
      { name: "C", activity: "visible" }
    ]);
  });

  it("regenerates canonical output as state: only", () => {
    const compiled = compileDslDocument("nui 4\npoint A = coordinate(x: 0, y: 0, state: hidden)");
    expect(compiled.majorVersion).toBe(4);
    const regenerated = serializeDocumentToDsl(compiled.document!, compiled.majorVersion!);
    expect(regenerated).toContain("state: hidden");
    expect(regenerated).not.toContain("visible:");
    expect(regenerated).not.toContain("enabled:");
    expect(regenerated.startsWith("nui 4")).toBe(true);
  });
});

describe("nui 4 typed declaration wiring", () => {
  it("accepts const/let with no diagnostics, staying out of document.elements", () => {
    // 型付き宣言のidentityはstatement reconcilerが供給する。直接compilerを
    // 呼ぶこの単体テストでも、その契約を明示して渡す。
    const compiled = compileDslDocument(
      ["nui 4", "const x: number = 1", "let 表示する: boolean = true", "point A = coordinate(x: 0, y: 0)"].join("\n"),
      {
        assignedStatementIds: new Map([
          [1, "test:typed:x"],
          [2, "test:typed:visible"]
        ])
      }
    );
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.majorVersion).toBe(4);
    expect(compiled.document!.elements).toMatchObject([{ name: "A" }]);
    const declarations = compiled.statements.filter((item) => item.kind === "typedDeclaration");
    expect(declarations).toHaveLength(2);
  });
});

describe("Task 22 property binding wiring", () => {
  it("stores a resolved binding source on compiled.propertyBindings, alongside a clean diagnostics list", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let 印刷: boolean = true", "group G (printEnabled: @印刷) {", "}"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:printEnabled"]]) }
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const entry = compiled.propertyBindings?.get(propertyBindingOccurrenceKey(2, "printEnabled"));
    expect(entry).toMatchObject({ kind: "binding", type: { kind: "boolean" }, name: "印刷" });
  });

  it("accepts schema-typed property bindings without a property-name allowlist", () => {
    const compiled = compileDslDocument(
      [
        "nui 4",
        'const パス: string = "x.png"',
        'image IMG = image(source: @パス, origin: (0, 0), naturalWidthPx: 1, naturalHeightPx: 1, sourceDpi: 300, targetPixelsPerMm: 11.811023622047244, scale: 1, angleDeg: 0, mirrorX: false)'
      ].join("\n"),
      { assignedStatementIds: new Map([[1, "test:path"]]) }
    );
    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.propertyBindings?.get(propertyBindingOccurrenceKey(2, "sourcePath"))).toMatchObject({
      kind: "binding", type: { kind: "string" }, name: "パス"
    });
  });

  it("keeps the last-good document (null) and surfaces property-binding-unresolved for an undefined name", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let 印刷: boolean = true", "group G (printEnabled: @Missing) {", "}"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:printEnabled"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: PROPERTY_BINDING_UNRESOLVED_CODE })])
    );
  });

  it("keeps the last-good document (null) and surfaces property-binding-type-mismatch for invalid typed property expressions", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let 印刷: boolean = true", "group G (printEnabled: @印刷 + 1) {", "}"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:printEnabled"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: PROPERTY_BINDING_TYPE_MISMATCH_CODE })])
    );
  });

  it("keeps the last-good document (null) and surfaces property-binding-type-mismatch for a wrongly-typed binding", () => {
    const compiled = compileDslDocument(
      ["nui 4", "const n: number = 1", "group G (printEnabled: @n) {", "}"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:n"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: PROPERTY_BINDING_TYPE_MISMATCH_CODE })])
    );
  });

  it("leaves propertyBindings undefined for a document with no typed declarations at all", () => {
    const compiled = compileDslDocument(["nui 4", "group G (printEnabled: false) {", "}"].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    expect(compiled.propertyBindings).toBeUndefined();
  });
});

describe("Task 26 text template wiring", () => {
  it("stores a compiled template on compiled.textTemplates for a typed string hole", () => {
    const compiled = compileDslDocument(
      ["nui 4", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
      { assignedStatementIds: new Map([[1, "test:label"]]) }
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const template = compiled.textTemplates?.get(propertyBindingOccurrenceKey(2, "text"));
    expect(template).toBeDefined();
    expect(template?.segments.some((segment) => segment.kind === "hole" && segment.holeKind === "string")).toBe(true);
  });

  it("still compiles textTemplates for a document with no typed declaration at all, unlike propertyBindings/bindingAnalysis", () => {
    const compiled = compileDslDocument(
      ["nui 4", 'text T = label(text: "cost \\{5\\} yen", anchor: none, size: 3)'].join("\n")
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    expect(compiled.bindingAnalysis).toBeUndefined();
    expect(compiled.propertyBindings).toBeUndefined();
    const template = compiled.textTemplates?.get(propertyBindingOccurrenceKey(1, "text"));
    expect(template).toBeDefined();
    expect(template?.segments).toEqual([
      expect.objectContaining({ kind: "literal", cooked: "cost {5} yen" })
    ]);
  });

  it("keeps the last-good document (null) and surfaces interpolation-type-mismatch for a boolean hole", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let 表示する: boolean = true", 'text T = label(text: "flag ${@表示する}", anchor: none, size: 3)'].join("\n"),
      { assignedStatementIds: new Map([[1, "test:flag"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE })])
    );
  });

  it("keeps the last-good document (null) and surfaces unterminated-interpolation for an unclosed hole", () => {
    const compiled = compileDslDocument(
      ["nui 4", 'text T = label(text: "prefix ${oops", anchor: none, size: 3)'].join("\n")
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: "unterminated-interpolation" })])
    );
  });

});

describe("Task 29 set statement wiring", () => {
  it("stores a resolved target/typed RHS on compiled.setStatements, alongside a clean diagnostics list", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let x: number = 1", "set x = 2"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:x"], [2, "test:set-x"]]) }
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const entry = compiled.setStatements?.get(2);
    expect(entry).toMatchObject({ targetName: "x", statementId: "test:set-x", sourceOrder: 2 });
  });

  it("keeps the last-good document (null) and surfaces const-assignment for a const target", () => {
    const compiled = compileDslDocument(
      ["nui 4", "const x: number = 1", "set x = 2"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:x"], [2, "test:set-x"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: CONST_ASSIGNMENT_CODE })])
    );
  });

  it("keeps the last-good document (null) and surfaces invalid-set-target for an undefined name", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let unrelated: number = 1", "set missing = 2"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:unrelated"], [2, "test:set-missing"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: INVALID_SET_TARGET_CODE })])
    );
  });

  it("keeps the last-good document (null) and surfaces invalid-set-target for a set with no typed declarations at all", () => {
    const compiled = compileDslDocument(
      ["nui 4", "set missing = 2"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:set-missing"]]) }
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: INVALID_SET_TARGET_CODE })])
    );
  });

  it("fails closed with missing-stable-statement-identity when no reconciled identity is supplied for a set statement", () => {
    const compiled = compileDslDocument(["nui 4", "let x: number = 1", "set x = 2"].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: MISSING_SET_STATEMENT_IDENTITY_CODE })])
    );
  });

  it("leaves setStatements undefined for a document with no set statements at all", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let x: number = 1"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:x"]]) }
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    expect(compiled.setStatements).toBeUndefined();
  });

});

describe("Task 36 typed dependency graph wiring", () => {
  it("keeps static missing and late initializer navigation on a fatal compile", () => {
    const compiled = compileDslDocument(
      ["nui 4", "const missing: number = @unknown", "const late: number = @later", "const later: number = 1", "group G (printEnabled: @unknown) {", "}"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:missing"], [2, "test:late"], [3, "test:later"]]) }
    );

    expect(compiled.document).toBeNull();
    expect(compiled.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "initializer", reason: "missing", span: expect.any(Object) }),
      expect.objectContaining({ kind: "initializer", reason: "late", span: expect.any(Object) })
    ]));
  });

  it("connects a set RHS to the version current before its statement", () => {
    const compiled = compileDslDocument(
      ["nui 4", "let x: number = 1", "let y: number = 2", "set x = @y", "set y = 3"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:x"], [2, "test:y"], [3, "test:set-x"], [4, "test:set-y"]]) }
    );
    const edge = compiled.typedDependencyGraph?.edges.find((candidate) => candidate.kind === "set-rhs");

    expect(edge).toMatchObject({
      from: { kind: "version", id: "test:set-x" },
      to: { kind: "version", id: "test:y" }
    });
  });

  it("deduplicates repeated initializer targets while retaining an invalid target reason", () => {
    const compiled = compileDslDocument(
      ["nui 4", "const bad: number = @missing", "const use: number = @bad + @bad"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:bad"], [2, "test:use"]]) }
    );
    const edges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "initializer" && edge.from.kind === "binding" && edge.from.id === "binding:test:use"
    );

    expect(edges).toHaveLength(1);
    expect(edges?.[0]).toMatchObject({ to: { id: "binding:test:bad" }, reason: "invalid" });
  });
});
