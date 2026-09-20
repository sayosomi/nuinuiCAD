import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { compileDslToElements } from "@nuinuicad/nui-language";
import {
  compileDslDocument,
  layoutElementTree,
  parseDslDocument,
  serializeDocumentToDsl,
  type DslDocumentData
} from "@nuinuicad/nui-language";
import {
  propertyBindingOccurrenceKey
} from "@nuinuicad/nui-language";
import { TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE } from "@nuinuicad/nui-language";
import {
  emptyDocument,
  expectSemanticallyEqualDocuments,
  roundTrip
} from "@nuinuicad/nui-language";
import { documentDslRefs } from "@nuinuicad/nui-language";
import { resolveTypedDependencyGraphRuntime } from "@nuinuicad/nui-language";
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
      "nui 1",
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
    const serialized = serializeDocumentToDsl(document, 1);
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
        "edge [AB.end, BC.start] as joined (index: 0)",
        "extend AB.end as extended (to: @C)"
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
    const { document, parsed, text } = roundTrip(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 100,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "line cp = transformCopy(startPoint: @A,endPoint: @B,scale: 1,angleDeg: 0,mirrorX: false,baseLines: [@AB])",
        "line sym = mirrorCopy(axis1: @A,axis2: @B,baseLines: [@AB])",
        "move AB as moved (from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: false)",
        "mirrorMove AB as mirrored (axis1: @A, axis2: @B)"
      ].join("\n")
    );
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
    expect(text).toContain("transformCopy(");
    expect(text).not.toContain("copy(");
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
    const source = ["for i in range(min: 0, max: 2, step: 1) {", "  point P = coordinate(x: @i * 10,y: 0)", "}"].join("\n");
    const { document, parsed } = roundTrip(source);
    expectSemanticallyEqualDocuments(document, { ...document, elements: parsed.elements });
  });

  it("round-trips deeply nested group/if/for combinations", () => {
    const source = [
      "group 外 {",
      "  if (true) {",
      "    for i in range(min: 0, max: 1, step: 1) {",
      "      point P = coordinate(x: @i,y: 0)",
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

describe("dslDocument legacy palette syntax", () => {
  it("rejects top-level color statements", () => {
    const parsed = parseDslDocument(["nui 1", 'color main ("#112233", name: "本体")'].join(String.fromCharCode(10)));
    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(parsed.document).toBeNull();
  });
});

describe("dslDocument canonical blocks", () => {
  it("adds a trailing comma to every argument in canonical multi-line calls", () => {
    const compiled = compileDslDocument("nui 1\npoint A = coordinate(\n  x: 0,\n  y: 0\n)");
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(compiled.document!, 1)).toContain(
      "point A = coordinate(\n  x: 0,\n  y: 0,\n)"
    );
  });

});

describe("dslDocument layoutElementTree ElementTreeRow shape", () => {
  it("bakes a container's `{` onto its own header row and emits multi-line vertical-call rows for regular elements", () => {
    const source = ["nui 1", "group G {", "  point A = coordinate(x: 0, y: 0)", "  point B = coordinate(x: 1, y: 1)", "}"].join("\n");
    const compiled = compileDslDocument(source);
    const document = compiled.document!;
    const refs = documentDslRefs(document.elements);
    const rows = layoutElementTree(document.elements, refs, document.evaluationLimitIndex);

    // There is no separate "blockStart" row: a container's own header
    // row carries its `{` on its last physical line.
    expect(rows.map((row) => row.role)).toEqual(["statement", "statement", "statement", "blockEnd"]);

    const groupRow = rows[0];
    expect(groupRow.lines).toEqual(["group G {"]);
    expect(groupRow.argKeys).toEqual([null]);

    // Regular (non-container) elements now serialize as vertical calls:
    // header line, one arg per line, closing `)` line.
    const pointARow = rows[1];
    expect(pointARow.lines).toEqual(["  point A = coordinate(", "    x: 0,", "    y: 0,", "  )"]);
    expect(pointARow.argKeys).toEqual([null, "x", "y", null]);

    expect(rows[2].lines).toEqual(["  point B = coordinate(", "    x: 1,", "    y: 1,", "  )"]);
    expect(rows.find((row) => row.role === "blockEnd")!.lines).toEqual(["}"]);
  });
});

describe("dslDocument idempotence", () => {
  it("is a fixed point for a rich hand-written document", () => {
    const first = parseDslDocument(sampleFixture);
    expect(first.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const canonical = serializeDocumentToDsl(first.document!, 1);
    const second = parseDslDocument(canonical);
    expect(second.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const reserialized = serializeDocumentToDsl(second.document!, 1);
    expect(reserialized).toBe(canonical);
  });

  it("is a fixed point for an empty document", () => {
    const canonical = serializeDocumentToDsl(emptyDocument(), 1);
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 1)).toBe(canonical);
  });

  it("is a fixed point for a document with non-contiguous group children (parent= fallback)", () => {
    const g1 = compileDslToElements("group G (id: g1) {\n}", { elements: [] }).elements[0];
    let elements: CadElement[] = [g1];
    elements = compileDslToElements("point A = coordinate(x: 0, y: 0, id: pa, parent: @g1)", { elements }).elements;
    elements = compileDslToElements("point R = coordinate(x: 1, y: 1, id: pr)", { elements }).elements;
    elements = compileDslToElements("point B = coordinate(x: 2, y: 2, id: pb, parent: @g1)", { elements }).elements;

    const document: DslDocumentData = { ...emptyDocument(), elements, evaluationLimitIndex: elements.length };
    const canonical = serializeDocumentToDsl(document, 1);
    expect(canonical).toContain("parent: @G");
    const parsed = parseDslDocument(canonical);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(serializeDocumentToDsl(parsed.document!, 1)).toBe(canonical);

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

  it("accepts nui 1 as the only supported major version", () => {
    const v1 = compileDslDocument("nui 1\npoint A = coordinate(x: 0, y: 0)");
    expect(v1.document).not.toBeNull();
    expect(v1.majorVersion).toBe(1);
  });

  it.each([2, 3, 4, 5])("rejects unsupported major version %s and lists supported major 1", (major) => {
    const parsed = parseDslDocument(`nui ${major}\npoint A = coordinate(x: 0, y: 0)`);
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes(`未対応のDSLバージョンです: ${major}(対応: 1)`))).toBe(true);
  });

  it("rejects a non-numeric version", () => {
    const parsed = parseDslDocument("nui abc");
    expect(parsed.document).toBeNull();
    expect(parsed.diagnostics.some((item) => item.message.includes("不正なDSLバージョン"))).toBe(true);
  });

  it("rejects a duplicate nui statement and leaves majorVersion unresolved", () => {
    const compiled = compileDslDocument(["nui 1", "nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBeNull();
    expect(compiled.diagnostics.some((item) => item.message.includes("先頭に1つだけ"))).toBe(true);
  });

  it("accepts a valid nui 1 header with a leading comment", () => {
    const parsed = parseDslDocument(["// comment before header is not allowed to precede nui", "nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    // comments do not produce statements, so nui 1 is still the first statement
    expect(parsed.document).not.toBeNull();
  });

  it("keeps majorVersion resolved even when an unrelated body statement is fatal", () => {
    // A valid nui 1 header, but the body has a known-fatal DivisionPlacement
    // conflict (both distance and ratio given) unrelated to the header itself.
    const compiled = compileDslDocument(
      [
        "nui 1",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "point Both = between(start: @A, end: @B, distance: 4, ratio: 0.25)"
      ].join("\n")
    );
    expect(compiled.document).toBeNull();
    expect(compiled.majorVersion).toBe(1);
    expect(compiled.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("serializes the current major without regenerating the removed nui 4 header", () => {
    const serialized = serializeDocumentToDsl(emptyDocument(), 1);
    expect(serialized.startsWith("nui 1")).toBe(true);
    expect(serialized).not.toContain("nui 4");
  });
});

describe("compileDslDocument facade", () => {
  it("matches parseDslDocument output (wrapper equivalence, IDs are per-parse)", () => {
    const compiled = compileDslDocument(sampleFixture);
    const parsed = parseDslDocument(sampleFixture);
    expectSemanticallyEqualDocuments(parsed.document!, compiled.document!);
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
    expect(map.byKey.get("role:seam")).toMatchObject({ line: 7 });
    expect(map.byKey.get("view:通常")).toMatchObject({ line: 8 });
    expect(map.byKey.get("view:印刷")).toMatchObject({ line: 9 });
    expect(map.byKey.get("activeView")).toMatchObject({ line: 10 });
    expect(map.byKey.has("atStop")).toBe(false);

    expect(map.sectionEnds).toEqual({ version: 1, visibility: 10, elements: 57 });
  });

  it("rejects a trailing stop instead of adding a statement-map boundary", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)", "stop"].join("\n");
    const compiled = compileDslDocument(source);
    expect(compiled.document).toBeNull();
    expect(compiled.statementMap).toBeNull();
    expect(compiled.diagnostics.some((item) => item.message.includes("有効な構文ではありません"))).toBe(true);
  });

  it("injects assignedElementIds while letting explicit id= win", () => {
    const source = ["nui 1", "", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1, id: pinned-b)"].join("\n");
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
    expect(document.visibilityRoles).toEqual([{ id: "seam", name: "縫い代" }]);
    expect(document.elements.some((element) => element.name === "前身頃" && element.type === "group")).toBe(true);
    expect(document.evaluationLimitIndex).toBeUndefined();
  });
});

describe("nui 1 enabled/visible syntax wiring", () => {
  it("accepts direct gates and derives the status projection", () => {
    const parsed = parseDslDocument([
      "nui 1",
      "point A = coordinate(x: 0, y: 0, visible: false)",
      "point B = coordinate(x: 1, y: 0, enabled: false)",
      "point C = coordinate(x: 2, y: 0)"
    ].join("\n"));
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.document!.elements).toMatchObject([
      { name: "A", visible: false, enabled: true },
      { name: "B", enabled: false },
      { name: "C", activity: "visible" }
    ]);
  });

  it("regenerates canonical output with direct gates", () => {
    const compiled = compileDslDocument("nui 1\npoint A = coordinate(x: 0, y: 0, visible: false)");
    expect(compiled.majorVersion).toBe(1);
    const regenerated = serializeDocumentToDsl(compiled.document!, compiled.majorVersion!);
    expect(regenerated).toContain("visible: false");
    expect(regenerated).not.toContain("state:");
    expect(regenerated.startsWith("nui 1")).toBe(true);
  });
});

describe("nui 1 typed declaration wiring", () => {
  it("accepts const declarations with no diagnostics, staying out of document.elements", () => {
    // 型付き宣言のidentityはstatement reconcilerが供給する。直接compilerを
    // 呼ぶこの単体テストでも、その契約を明示して渡す。
    const compiled = compileDslDocument(
      ["nui 1", "const x: number = 1", "const 表示する: boolean = true", "point A = coordinate(x: 0, y: 0)"].join("\n"),
      {
        assignedStatementIds: new Map([
          [1, "test:typed:x"],
          [2, "test:typed:visible"]
        ])
      }
    );
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.majorVersion).toBe(1);
    expect(compiled.document!.elements).toMatchObject([{ name: "A" }]);
    const declarations = compiled.statements.filter((item) => item.kind === "typedDeclaration");
    expect(declarations).toHaveLength(2);
  });
});

describe("Task 22 property binding wiring", () => {
  it("accepts schema-typed property bindings without a property-name allowlist", () => {
    const compiled = compileDslDocument(
      [
        "nui 1",
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

});

describe("Task 26 text template wiring", () => {
  it("stores a compiled template on compiled.textTemplates for a typed string hole", () => {
    const compiled = compileDslDocument(
      ["nui 1", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
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
      ["nui 1", 'text T = label(text: "cost \\{5\\} yen", anchor: none, size: 3)'].join("\n")
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

  it("accepts a boolean hole and stores the compiled boolean template", () => {
    const compiled = compileDslDocument(
      ["nui 1", "const 表示する: boolean = true", 'text T = label(text: "flag ${@表示する}", anchor: none, size: 3)'].join("\n"),
      { assignedStatementIds: new Map([[1, "test:flag"]]) }
    );
    expect(compiled.document).not.toBeNull();
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === TEXT_TEMPLATE_HOLE_TYPE_MISMATCH_CODE)).toBe(false);
    const template = compiled.textTemplates?.get(propertyBindingOccurrenceKey(2, "text"));
    expect(template).toBeDefined();
    expect(template?.segments.some((segment) => segment.kind === "hole" && segment.holeKind === "boolean")).toBe(true);
  });

  it("keeps the last-good document (null) and surfaces unterminated-interpolation for an unclosed hole", () => {
    const compiled = compileDslDocument(
      ["nui 1", 'text T = label(text: "prefix ${oops", anchor: none, size: 3)'].join("\n")
    );
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", code: "unterminated-interpolation" })])
    );
  });

});

describe("Task 36 typed dependency graph wiring", () => {
  it("keeps static missing and resolved forward initializer navigation on the compiled document", () => {
    const compiled = compileDslDocument(
      ["nui 1", "const missing: number = @unknown", "const late: number = @later", "const later: number = 1"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:missing"], [2, "test:late"], [3, "test:later"]]) }
    );

    expect(compiled.document).not.toBeNull();
    expect(compiled.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "initializer", reason: "missing", span: expect.any(Object) }),
      expect.objectContaining({ kind: "initializer", reason: undefined, span: expect.any(Object) })
    ]));
  });

  it("deduplicates repeated initializer targets while retaining an invalid target reason", () => {
    const compiled = compileDslDocument(
      ["nui 1", "const bad: number = @missing", "const use: number = @bad + @bad"].join("\n"),
      { assignedStatementIds: new Map([[1, "test:bad"], [2, "test:use"]]) }
    );
    const edges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "initializer" && edge.from.kind === "binding" && edge.from.id === "binding:test:use"
    );

    expect(edges).toHaveLength(1);
    expect(edges?.[0]).toMatchObject({ to: { id: "binding:test:bad" }, reason: "invalid" });
  });

  it("activates selected lazy geometry edges for cycles without requiring unselected branches", () => {
    const compile = (condition: "true" | "false") => compileDslDocument(
      [
        "nui 1",
        `const gate: boolean = if (${condition}) { @A.length > 0 } else { true }`,
        "line A = segment(start: (0, 0), end: (10, 0), enabled: @gate)"
      ].join("\n"),
      { assignedStatementIds: new Map([[1, "test:gate"], [2, "test:a"]]) }
    );

    const selected = compile("true");
    expect(selected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("dependency-cycle");
    expect(selected.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "geometry-property",
        requiredness: "conditional",
        activation: expect.objectContaining({
          guards: expect.arrayContaining([
            expect.objectContaining({ branch: "then", staticSelection: "selected" })
          ])
        })
      })
    ]));

    const unselected = compile("false");
    expect(unselected.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("dependency-cycle");
    expect(unselected.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "geometry-property",
        requiredness: "conditional",
        activation: expect.objectContaining({
          guards: expect.arrayContaining([
            expect.objectContaining({ branch: "then", staticSelection: "unselected" })
          ])
        })
      })
    ]));
    const runtimeProjection = unselected.typedDependencyGraph
      ? resolveTypedDependencyGraphRuntime(unselected.typedDependencyGraph, new Map())
      : undefined;
    expect(runtimeProjection?.cycles).toEqual([]);
  });

  it("scopes lazy controller ids by their dependency source endpoint", () => {
    const compiled = compileDslDocument([
      "nui 1",
      "const flagA: boolean = false",
      "const flagB: boolean = true",
      "const valueA: number = if (@flagA) { @LaterA.length } else { 0 }",
      "const valueB: number = if (@flagB) { @LaterB.length } else { 0 }",
      "line ConsumerA = segment(start: (0, 0), end: (@valueA, 1))",
      "line ConsumerB = segment(start: (0, 0), end: (@valueB, 1))",
      "line LaterA = segment(start: (0, 0), end: (20, 0))",
      "line LaterB = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"), {
      assignedStatementIds: new Map([
        [1, "test:flag-a"],
        [2, "test:flag-b"],
        [3, "test:value-a"],
        [4, "test:value-b"],
        [5, "test:consumer-a"],
        [6, "test:consumer-b"],
        [7, "test:later-a"],
        [8, "test:later-b"]
      ])
    });
    const graph = compiled.typedDependencyGraph;
    expect(graph).toBeDefined();
    const guardedEdges = graph?.edges.filter((edge) =>
      edge.from.kind === "binding" &&
      (edge.from.name === "valueA" || edge.from.name === "valueB") &&
      edge.activation?.guards.some((guard) => guard.controllerExpression)
    ) ?? [];
    expect(guardedEdges).toHaveLength(2);

    const localStarts = guardedEdges.map((edge) => edge.activation!.guards[0]!.controllerExpression!.span.start);
    expect(localStarts[0]).toBe(localStarts[1]);

    const controllerIdsBySource = new Map<string, Set<string>>();
    for (const edge of guardedEdges) {
      const ids = controllerIdsBySource.get(edge.from.id) ?? new Set<string>();
      for (const guard of edge.activation!.guards) ids.add(guard.controllerId);
      controllerIdsBySource.set(edge.from.id, ids);
    }
    expect(controllerIdsBySource.size).toBe(2);
    expect([...controllerIdsBySource.values()].every((ids) => ids.size === 1)).toBe(true);
    expect(new Set([...controllerIdsBySource.values()].map((ids) => [...ids][0]))).toHaveLength(2);
  });

  it("scopes same-element numeric controller ids by parameter occurrence", () => {
    const compiled = compileDslDocument([
      "nui 1",
      "const flagX: boolean = false",
      "const flagY: boolean = true",
      "point P = coordinate(x: if (@flagX) { @LaterX.length } else { 0 }, y: if (@flagY) { @LaterY.length } else { 0 })",
      "line LaterX = segment(start: (0, 0), end: (20, 0))",
      "line LaterY = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"), {
      assignedStatementIds: new Map([
        [1, "test:flag-x"],
        [2, "test:flag-y"],
        [3, "test:p"],
        [4, "test:later-x"],
        [5, "test:later-y"]
      ])
    });
    const point = compiled.document?.elements.find((element) => element.name === "P");
    const numericKeys = [...(compiled.numericBindings ?? [])]
      .map(([key]) => key)
      .filter((key) => key.endsWith(":x") || key.endsWith(":y"));
    const xKey = numericKeys.find((key) => key.endsWith(":x"));
    const yKey = numericKeys.find((key) => key.endsWith(":y"));
    expect(point).toBeDefined();
    expect(xKey).toBeDefined();
    expect(yKey).toBeDefined();
    expect(xKey).not.toBe(yKey);

    const guardedEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "geometry-property" &&
      edge.from.kind === "element" &&
      edge.from.id === point?.id &&
      edge.to.kind === "geometry-stage" &&
      edge.activation?.guards.some((guard) => guard.controllerExpression)
    ) ?? [];
    const xEdges = guardedEdges.filter((edge) => edge.to.kind === "geometry-stage" && edge.to.name.startsWith("LaterX."));
    const yEdges = guardedEdges.filter((edge) => edge.to.kind === "geometry-stage" && edge.to.name.startsWith("LaterY."));
    expect(xEdges).toHaveLength(1);
    expect(yEdges).toHaveLength(1);
    expect(xEdges[0]!.from.id).toBe(yEdges[0]!.from.id);
    expect(xEdges[0]!.activation!.guards[0]!.controllerExpression!.span.start)
      .toBe(yEdges[0]!.activation!.guards[0]!.controllerExpression!.span.start);
    expect(new Set(xEdges.map((edge) => edge.activation!.guards[0]!.controllerId))).toHaveLength(1);
    expect(new Set(yEdges.map((edge) => edge.activation!.guards[0]!.controllerId))).toHaveLength(1);
    expect(xEdges[0]!.activation!.guards[0]!.controllerId)
      .not.toBe(yEdges[0]!.activation!.guards[0]!.controllerId);
  });

  it("keeps conditionalGroup lazy geometry dependencies free of legacy duplicates", () => {
    const compiled = compileDslDocument([
      "nui 1",
      "const chooseLater: boolean = false",
      "if (if (@chooseLater) { @Later.length > 0 } else { false }) {",
      "  point Inside = coordinate(x: 1, y: 1)",
      "}",
      "line Later = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"), {
      assignedStatementIds: new Map([
        [1, "test:choose-later"],
        [2, "test:conditional-group"],
        [3, "test:inside"],
        [5, "test:later"]
      ])
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const conditional = compiled.document?.elements.find((element) => element.type === "conditionalGroup");
    const later = compiled.document?.elements.find((element) => element.name === "Later");
    expect(conditional).toBeDefined();
    expect(later).toBeDefined();
    const dependencyEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.from.kind === "element" &&
      edge.from.id === conditional?.id &&
      edge.to.kind === "geometry-stage" &&
      edge.to.ownerId === later?.id
    ) ?? [];
    expect(dependencyEdges).toHaveLength(1);
    expect(dependencyEdges[0]).toMatchObject({ kind: "geometry-property", requiredness: "conditional" });
    expect(dependencyEdges[0]!.activation?.guards).toHaveLength(1);
    expect(dependencyEdges[0]!.activation?.guards[0]?.branch).toBe("then");
    expect(compiled.typedDependencyGraph?.edges.some((edge) =>
      edge.from.kind === "element" &&
      edge.from.id === conditional?.id &&
      edge.to.kind === "geometry-stage" &&
      edge.to.ownerId === later?.id &&
      edge.kind === "geometry" &&
      edge.requiredness === "required"
    )).toBe(false);
  });

  it("classifies numeric coalescing fallback geometry as a lazy dependency", () => {
    for (const maybeValue of ["5", "none"]) {
      const compiled = compileDslDocument([
        "nui 1",
        `const maybe: number? = ${maybeValue}`,
        "point P = coordinate(x: @maybe ?? @Later.length, y: 0)",
        "line Later = segment(start: (0, 0), end: (10, 0))"
      ].join("\n"), {
        assignedStatementIds: new Map([
          [1, `test:maybe-${maybeValue}`],
          [2, `test:p-${maybeValue}`],
          [3, `test:later-${maybeValue}`]
        ])
      });
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      const point = compiled.document?.elements.find((element) => element.name === "P");
      const later = compiled.document?.elements.find((element) => element.name === "Later");
      const fallbackEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
        edge.from.kind === "element" &&
        edge.from.id === point?.id &&
        edge.to.kind === "geometry-stage" &&
        edge.to.ownerId === later?.id &&
        edge.kind === "geometry-property"
      ) ?? [];
      expect(fallbackEdges).toHaveLength(1);
      expect(fallbackEdges[0]).toMatchObject({ requiredness: "conditional" });
      expect(fallbackEdges[0]!.activation?.guards[0]).toMatchObject({ branch: "right" });
      expect(fallbackEdges[0]!.activation?.guards[0]?.controllerExpression).toBeDefined();
    }
  });
});
