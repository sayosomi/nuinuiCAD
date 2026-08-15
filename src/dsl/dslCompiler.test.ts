import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { compileDslToElements } from "./dslCompiler";
import { compileDslDocument } from "./dslDocument";
import { documentDslRefs, serializeElementsToDsl } from "./dslSerializer";
import { serializeElementStatementBlock, serializeElementStatementLogical } from "./dslSerializeElement";
import { UNCLOSED_CALL_CODE } from "./dslCallParser";

describe("DSL compiler", () => {
  it("serializes an omitted bezierExtremePoint segmentIndex as canonical zero", () => {
    const result = compileDslToElements([
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "curve ベジェ線 = bezier(start: @A, end: @B, startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "point 上端 = bezierExtremePoint(\n  source: @ベジェ線,\n  direction: 90,\n)"
    ].join("\n"), { elements: [] });

    expect(result.diagnostics).toEqual([]);
    const extreme = result.elements.at(-1)!;
    const statement = serializeElementStatementBlock(extreme, documentDslRefs(result.elements));
    expect(statement.args.map((arg) => arg.text)).toEqual([
      "source: @ベジェ線",
      "segmentIndex: 0",
      "direction: 90"
    ]);
    expect(serializeElementStatementLogical(extreme, documentDslRefs(result.elements))).toBe(
      "point 上端 = bezierExtremePoint(source: @ベジェ線, segmentIndex: 0, direction: 90)"
    );
  });

  it("serializes an omitted bezierBulgePoint segmentIndex as canonical zero", () => {
    const result = compileDslToElements([
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "curve ベジェ線 = bezier(start: @A, end: @B, startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "point 膨らみ点 = bezierBulgePoint(\n  source: @ベジェ線,\n)"
    ].join("\n"), { elements: [] });

    expect(result.diagnostics).toEqual([]);
    const bulge = result.elements.at(-1)!;
    expect(serializeElementStatementLogical(bulge, documentDslRefs(result.elements))).toBe(
      "point 膨らみ点 = bezierBulgePoint(source: @ベジェ線, segmentIndex: 0)"
    );
  });

  it("creates basic drafting elements from short DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = offset(from: @A, dx: 0, dy: -(210 / 4))",
        "line AB = segment(start: @A,end: @B)",
        "arc armhole = arc(center: @A,radius: 120,start: 0,end: -90)",
        "text label = label(text: \"前中心\", anchor: @A, size: 4)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.type)).toEqual([
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
    expect(result.elements[1]).toMatchObject({
      type: "offsetPoint",
      fromPoint: { mode: "reference", pointId: result.elements[0].id }
    });
    expect(result.elements[2]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: result.elements[0].id },
      endPoint: { mode: "reference", pointId: result.elements[1].id }
    });
  });

  it("keeps an unanchored text element unanchored when applying serialized DSL", () => {
    const initial = compileDslToElements('text label = label(text: "一行目\\n二行目",anchor: none,size: 3)', { elements: [] });

    expect(initial.diagnostics).toEqual([]);
    expect(initial.elements[0]).toMatchObject({
      type: "text",
      text: "一行目\n二行目",
      anchor: null
    });
  });

  it("updates existing elements by stable id", () => {
    const initial = compileDslToElements("point A = coordinate(x: 0,y: 0)", { elements: [] });
    const point = initial.elements[0];
    const result = compileDslToElements(`point A = coordinate(x: 10, y: 20, id: ${point.id})`, {
      elements: initial.elements
    });

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      id: point.id,
      type: "freePoint",
      x: 10,
      y: 20
    });
  });

  it("supports quoted names and references with spaces", () => {
    const result = compileDslToElements(
      [
        "point \"前 上\" = coordinate(x: 0, y: 0)",
        "point \"前 下\" = offset(from: @\"前 上\", dx: 0, dy: -(210 / 4))",
        "line \"前 中心線\" = segment(start: @\"前 上\", end: @\"前 下\")",
        "point \"線上 点\" = onLine(from: @\"前 中心線\".end, distance: 10)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.name)).toEqual([
      "前 上",
      "前 下",
      "前 中心線",
      "線上 点"
    ]);
    expect(result.elements[2]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: result.elements[0].id },
      endPoint: { mode: "reference", pointId: result.elements[1].id }
    });
    expect(result.elements[3]).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: result.elements[2].id, endpointKey: "end" }
    });
  });

  it("resolves duplicate element names by parent namespace and qualified path", () => {
    const result = compileDslToElements(
      [
        "group front {",
        "}",
        "group back {",
        "}",
        "point A = coordinate(x: 0,y: 0,parent: @front)",
        "point B = coordinate(x: 100,y: 0,parent: @front)",
        "point A = coordinate(x: 0,y: 10,parent: @back)",
        "point B = coordinate(x: 100,y: 10,parent: @back)",
        // Bare `back::A` right after a call-arg colon is ambiguous with the
        // scanner's `identifier:` key-boundary heuristic (both start with
        // `back:`); quoting the group segment disambiguates, same as other
        // qualified-reference tests do for names containing special tokens.
        // Both lines use fully-qualified references rather than relying on
        // implicit same-scope disambiguation from a flat `parent:` fallback,
        // since only the qualified-path form is reliably scope-resolved.
        "line side = segment(start: @\"front\"::A, end: @\"front\"::B, parent: @front)",
        "line backSide = segment(start: @\"back\"::A, end: @\"back\"::B, parent: @front)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    const frontA = result.elements.find((element) => element.name === "A" && element.parentGroupId === result.elements[0].id);
    const frontB = result.elements.find((element) => element.name === "B" && element.parentGroupId === result.elements[0].id);
    const backA = result.elements.find((element) => element.name === "A" && element.parentGroupId === result.elements[1].id);
    const backB = result.elements.find((element) => element.name === "B" && element.parentGroupId === result.elements[1].id);
    expect(result.elements.find((element) => element.name === "side")).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: frontA?.id },
      endPoint: { mode: "reference", pointId: frontB?.id }
    });
    expect(result.elements.find((element) => element.name === "backSide")).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: backA?.id },
      endPoint: { mode: "reference", pointId: backB?.id }
    });
  });

  // v1 had a generic `element type=... key=value` escape hatch for element
  // types without dedicated short syntax; v2 removed it entirely because
  // every construction (including offsetLine, used here) now has a direct
  // vertical call form, so the closest equivalent is exercising that
  // construction call directly.
  it("constructs an offsetLine element via its construction call (no generic escape hatch remains)", () => {
    const base = compileDslToElements(
      [
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 100, y: 0)",
        "line AB = segment(start: @A, end: @B)"
      ].join("\n"),
      { elements: [] }
    );
    const result = compileDslToElements(
      "line offset = offset(sources: [@AB], distance: 10, side: left, closed: false)",
      { elements: base.elements }
    );

    expect(result.diagnostics).toEqual([]);
    const lineId = base.elements.find((element) => element.name === "AB")?.id;
    expect(result.elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: [lineId],
      offset: 10,
      side: "left",
      closed: false
    });
  });

  it("rejects the retired locked attribute as an unknown argument", () => {
    const result = compileDslToElements("point A = coordinate(x: 0, y: 0, locked: true)", { elements: [] });

    expect(result.diagnostics.map((item) => item.message)).toContain(
      "construction「coordinate」に引数「locked」はありません。候補: x、y、state、color、steps、vars、varIds、id、roles、parent、branch。"
    );
    expect(result.elements).toHaveLength(0);
  });

  it("creates drafting point constructions from natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 100, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "line vertical = polar(start: @A, angle: 90, length: 100)",
        "point mid = between(start: @A, end: @B, ratio: 0.5)",
        "point onLine = onLine(from: @AB.start, distance: 25)",
        "point cross = intersection(line1: @AB, line2: @vertical, index: 0, extensions: true)",
        "point tangent = tangentOffset(line: @AB, base: @A, angle: 90, distance: 10)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.type)).toEqual([
      "freePoint",
      "freePoint",
      "line",
      "angleLengthLine",
      "divisionPoint",
      "lineDivisionPoint",
      "intersectionPoint",
      "lineTangentOffsetPoint"
    ]);
    expect(result.elements[4]).toMatchObject({ type: "divisionPoint", placement: { kind: "ratio", value: 0.5 } });
    expect(result.elements[5]).toMatchObject({ type: "lineDivisionPoint", placement: { kind: "distance", value: 25 } });
    expect(result.elements[6]).toMatchObject({ type: "intersectionPoint", intersectionIndex: 0, useExtensions: true });
    expect(result.elements[7]).toMatchObject({ type: "lineTangentOffsetPoint", tangentAngleDeg: 90, distance: 10 });
  });

  it("creates line and curve operations from natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 100, y: 0)",
        "point C = coordinate(x: 50, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "curve curveAB = bezier(start: @A, end: @B, startAngle: 0, startLength: 25, endAngle: 180, endLength: 25, intermediates: [@C:45:10:20:mid-1])",
        "line splitAB = split(source: @AB, at: @C)",
        "extend(end: @AB.end, to: @C)",
        "line offsetAB = offset(sources: [@AB, @curveAB], distance: 10, side: left, closed: false)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[4]).toMatchObject({
      type: "bezierCurve",
      startHandleAngleDeg: 0,
      startHandleLength: 25,
      endHandleAngleDeg: 180,
      endHandleLength: 25,
      intermediatePoints: [
        expect.objectContaining({
          id: "mid-1",
          handleAngleDeg: 45,
          incomingHandleLength: 10,
          outgoingHandleLength: 20
        })
      ]
    });
    expect(result.elements[5]).toMatchObject({ type: "splitLine", baseLineId: result.elements[3].id });
    expect(result.elements[6]).toMatchObject({ type: "extendTrim", endpoint: { lineId: result.elements[3].id, endpointKey: "end" } });
    expect(result.elements[7]).toMatchObject({
      type: "offsetLine",
      baseLineIds: [result.elements[3].id, result.elements[4].id],
      offset: 10,
      side: "left",
      closed: false
    });
  });

  it("creates advanced arc constructions from natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 50, y: 50)",
        "point C = coordinate(x: 100, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "line BC = segment(start: @B, end: @C)",
        "arc throughArc = through(point1: @A, point2: @B, point3: @C, start: 0, end: 180)",
        "arc cornerArc = corner(end1: @AB.end, end2: @BC.start, radius: 10, index: 0)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[5]).toMatchObject({ type: "threePointArcLine", startAngleDeg: 0, endAngleDeg: 180 });
    expect(result.elements[6]).toMatchObject({
      type: "cornerRadiusArcLine",
      endpoint1: { lineId: result.elements[3].id, endpointKey: "end" },
      endpoint2: { lineId: result.elements[4].id, endpointKey: "start" },
      radius: 10,
      intersectionIndex: 0
    });
  });

  it("can compile a standalone DSL document without existing elements", () => {
    const existing = compileDslToElements("point old = coordinate(x: 10, y: 10)", { elements: [] }).elements;
    const result = compileDslToElements("point A = coordinate(x: 0, y: 0)\npoint B = offset(from: @A, dx: 10, dy: 0)", {
      elements: existing,
      mode: "document"
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(2);
    expect(result.elements.map((element) => element.name)).toEqual(["A", "B"]);
  });

  it("serializes selected elements into editable DSL with ids", () => {
    const result = compileDslToElements("point A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 10, y: 0)\nline AB = segment(start: @A, end: @B)", {
      elements: []
    });
    const source = serializeElementsToDsl(result.elements);

    expect(source).toContain("point A = coordinate(");
    expect(source).toContain(`id: ${result.elements[0].id}`);
    expect(source).toContain("line AB = segment(");
    expect(source).toContain(`start: @${result.elements[0].id}`);
    expect(source).toContain(`end: @${result.elements[1].id}`);
  });

  it("quotes serialized element names that contain spaces", () => {
    const result = compileDslToElements(
      [
        "point \"前 上\" = coordinate(x: 0, y: 0)",
        "point \"前 下\" = coordinate(x: 0, y: -100)",
        "line \"前 中心線\" = segment(start: @\"前 上\", end: @\"前 下\")"
      ].join("\n"),
      { elements: [] }
    );
    const source = serializeElementsToDsl(result.elements);
    const roundTrip = compileDslToElements(source, { elements: result.elements });

    expect(source).toContain(`point "前 上" = coordinate(`);
    expect(source).toContain(`id: ${result.elements[0].id}`);
    expect(source).toContain(`line "前 中心線" = segment(`);
    expect(source).toContain(`start: @${result.elements[0].id}`);
    expect(roundTrip.diagnostics).toEqual([]);
    expect(roundTrip.elements.map((element) => element.name)).toEqual(["前 上", "前 下", "前 中心線"]);
  });

  it("serializes advanced GUI elements with natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 100, y: 0)",
        "point C = coordinate(x: 50, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "point mid = between(start: @A, end: @B, ratio: 0.5)",
        "line splitAB = split(source: AB, at: C)",
        "line offsetAB = offset(sources: [@AB], distance: 10, side: left, closed: false)",
        "curve curveAB = bezier(start: @A, end: @B, startAngle: 0, startLength: 25, endAngle: 180, endLength: 25, intermediates: [@C:45:10:20:mid-1])"
      ].join("\n"),
      { elements: [] }
    );
    const source = serializeElementsToDsl(result.elements);

    expect(source).toContain("point mid = between");
    expect(source).toContain("line splitAB = split");
    expect(source).toContain("line offsetAB = offset");
    expect(source).toContain("curve curveAB =");
    expect(source).toContain("intermediates: [");
  });

  it("compiles and serializes visibility roles and profiles", () => {
    const result = compileDslToElements(
      [
        'role seam (name: "縫い代")',
        'role notch (name: "ノッチ")',
        "view 通常 (default: false, seam: false, notch: false)",
        "view 印刷 (default: false, seam: true, notch: true)",
        "activeView 通常",
        "group 前身頃 {",
        "}",
        "group 前身頃縫い代 (parent: @前身頃, roles: [seam]) {",
        "}",
        "printLayout A4 (output: pdf, view: 印刷) {",
        "}"
      ].join("\n"),
      {
        elements: [],
        visibilityRoles: [],
        visibilityProfiles: [],
        activeVisibilityProfileId: "",
        printLayouts: [{ ...DEFAULT_PRINT_LAYOUT, id: "a4", name: "A4" }]
      }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.visibilityRoles).toEqual([
      { id: "seam", name: "縫い代" },
      { id: "notch", name: "ノッチ" }
    ]);
    expect(result.visibilityProfiles).toEqual([
      {
        id: "通常",
        name: "通常",
        defaultRoleVisible: false,
        roleVisibility: { seam: false, notch: false }
      },
      {
        id: "印刷",
        name: "印刷",
        defaultRoleVisible: false,
        roleVisibility: { seam: true, notch: true }
      }
    ]);
    expect(result.activeVisibilityProfileId).toBe("通常");
    expect(result.elements[1]).toMatchObject({
      type: "group",
      visibilityRoleIds: ["seam"]
    });
    expect(result.printLayouts?.[0]).toMatchObject({
      id: "a4",
      visibilityProfileId: "印刷"
    });

    expect(serializeElementsToDsl(result.elements, {
      visibilityRoles: result.visibilityRoles,
      visibilityProfiles: result.visibilityProfiles,
      activeVisibilityProfileId: result.activeVisibilityProfileId,
      printLayouts: result.printLayouts
    })).toContain("group 前身頃縫い代");
  });
});

// A mid-edit, genuinely unterminated call (no closing quote, no closing paren)
// must never be silently evaluated as geometry, even though dslCallParser now
// returns a non-null "degraded" statement for this shape so single-line probe
// parses (completion) can still resolve already-typed argument spans. This
// pins the severity-based compile gate itself, not just the parser's own
// diagnostic - see dslCallParser.ts's UNCLOSED_CALL_CODE and
// dslValueSpans.ts's dslLineElementStatement carve-out.
describe("DSL compiler: unterminated call statement safety", () => {
  const source = 'text T = label(text: "${@';

  it("compileDslToElements reports UNCLOSED_CALL_CODE and produces no elements", () => {
    const result = compileDslToElements(source, { elements: [] });

    expect(result.elements).toEqual([]);
    expect(result.changedCount).toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: UNCLOSED_CALL_CODE })
    );
  });

  it("compileDslToElements does not overwrite existing elements with garbage from the degraded statement", () => {
    const existing = compileDslToElements("point A = coordinate(x: 0,y: 0)", { elements: [] }).elements;
    const result = compileDslToElements(source, { elements: existing });

    expect(result.elements).toBe(existing);
    expect(result.changedCount).toBe(0);
  });

  it("compileDslDocument keeps document null for the same unterminated call", () => {
    const compiled = compileDslDocument(source);

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: UNCLOSED_CALL_CODE })
    );
  });
});

// 04: DivisionPlacement characterization。union移行(Task 05)前に、v2フル文書compileの
// distance/ratio境界を固定する。compileDslToElementsは`elements`をそのまま返すが、
// severity:errorが1件でもあれば`elements`は変化せず(次に述べるcompileDslDocument経由で
// documentがnullになる)、applyArgsへは到達しない。
describe("DSL compiler: DivisionPlacement characterization", () => {
  it("compiles distance-only and ratio-only division points normally", () => {
    const result = compileDslToElements(
      [
        "point A = coordinate(x: 0,y: 0)",
        "point B = coordinate(x: 10,y: 0)",
        "line AB = segment(start: @A,end: @B)",
        "point ByDistance = between(start: @A,end: @B,distance: 4)",
        "point ByRatio = between(start: @A,end: @B,ratio: 0.25)",
        "point OnLineByDistance = onLine(from: @AB.start,distance: 4)",
        "point OnLineByRatio = onLine(from: @AB.start,ratio: 0.25)"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[3]).toMatchObject({ type: "divisionPoint", placement: { kind: "distance", value: 4 } });
    expect(result.elements[4]).toMatchObject({ type: "divisionPoint", placement: { kind: "ratio", value: 0.25 } });
    expect(result.elements[5]).toMatchObject({ type: "lineDivisionPoint", placement: { kind: "distance", value: 4 } });
    expect(result.elements[6]).toMatchObject({ type: "lineDivisionPoint", placement: { kind: "ratio", value: 0.25 } });
  });

  it("fails the whole v2 document compile when both distance and ratio are given (no element is produced)", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0,y: 0)",
      "point B = coordinate(x: 10,y: 0)",
      "point Both = between(start: @A,end: @B,distance: 4,ratio: 0.25)"
    ].join("\n");

    const compiled = compileDslDocument(source);

    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: "引数「distance」と「ratio」は同時に指定できません。"
      })
    );

    const lineSource = [
      "nui 2",
      "point A = coordinate(x: 0,y: 0)",
      "point B = coordinate(x: 10,y: 0)",
      "line AB = segment(start: A,end: B)",
      "point Both = onLine(from: AB.start,distance: 4,ratio: 0.25)"
    ].join("\n");

    expect(compileDslDocument(lineSource).document).toBeNull();
  });

  it("falls back to the factory default (ratio 0.5) when neither distance nor ratio is given", () => {
    const source = [
      "point A = coordinate(x: 0,y: 0)",
      "point B = coordinate(x: 10,y: 0)",
      "line AB = segment(start: @A,end: @B)",
      "point Neither = between(start: @A,end: @B)",
      "point OnLineNeither = onLine(from: @AB.start)"
    ].join("\n");

    const result = compileDslToElements(source, { elements: [] });

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[3]).toMatchObject({
      type: "divisionPoint", placement: { kind: "ratio", value: 0.5 }
    });
    expect(result.elements[4]).toMatchObject({
      type: "lineDivisionPoint", placement: { kind: "ratio", value: 0.5 }
    });
  });
});

describe("DSL compiler blocks", () => {
  it("assigns parentGroupId from group blocks", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = coordinate(x: 0,y: 0)",
        "  group 襟 {",
        "    point B = coordinate(x: 1,y: 1)",
        "  }",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    const [outer, pointA, inner, pointB] = result.elements;
    expect(result.elements.map((element) => element.type)).toEqual([
      "group",
      "freePoint",
      "group",
      "freePoint"
    ]);
    expect(pointA.parentGroupId).toBe(outer.id);
    expect(inner.parentGroupId).toBe(outer.id);
    expect(pointB.parentGroupId).toBe(inner.id);
  });

  it("assigns conditionalBranch from if/else blocks", () => {
    const result = compileDslToElements(
      [
        "if (1) {",
        "  point A = coordinate(x: 0,y: 0)",
        "} else {",
        "  point B = coordinate(x: 1,y: 1)",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    const [conditional, pointA, pointB] = result.elements;
    expect(conditional.type).toBe("conditionalGroup");
    expect(pointA).toMatchObject({ parentGroupId: conditional.id, conditionalBranch: "then" });
    expect(pointB).toMatchObject({ parentGroupId: conditional.id, conditionalBranch: "else" });
  });

  it("compiles for blocks to forGroup with children", () => {
    const result = compileDslToElements(
      [
        "for i in range(from: 0,count: 3,step: 1) {",
        "  point P = coordinate(x: i * 10,y: 0)",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    const [forGroup, point] = result.elements;
    expect(forGroup).toMatchObject({ type: "forGroup", variableName: "i", start: 0, count: 3, step: 1 });
    expect(point.parentGroupId).toBe(forGroup.id);
  });

  it("prefers block structure over parent: attributes with a warning", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = coordinate(x: 0,y: 0,parent: @どこか)",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    const warnings = result.diagnostics.filter((item) => item.severity === "warning");
    expect(warnings.some((item) => item.message.includes("parent"))).toBe(true);
    expect(result.elements[1].parentGroupId).toBe(result.elements[0].id);
  });

  it("keeps unnamed elements unnamed and always inserts them", () => {
    const initial = compileDslToElements("point = coordinate(x: 0,y: 0)", { elements: [] });
    expect(initial.elements).toHaveLength(1);
    expect(initial.elements[0].name).toBe("");

    const second = compileDslToElements("point = coordinate(x: 5,y: 5)", { elements: initial.elements });
    expect(second.elements).toHaveLength(2);
  });
});

describe("DSL compiler document settings", () => {
  it("builds a palette from color statements", () => {
    const result = compileDslToElements(
      [
        'color main ("#112233", name: "本体")',
        'color accent ("#445566", default: true)',
        "point A = coordinate(x: 0,y: 0)"
      ].join("\n"),
      { elements: [], mode: "document" }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.palette).toEqual({
      colors: [
        { id: "main", name: "本体", hex: "#112233" },
        { id: "accent", name: "accent", hex: "#445566" }
      ],
      defaultColorId: "accent"
    });
  });

  it("rejects multiple default colors", () => {
    const result = compileDslToElements(
      ['color a ("#112233", default: true)', 'color b ("#445566", default: true)'].join("\n"),
      { elements: [], mode: "document" }
    );
    expect(result.diagnostics.some((item) => item.message.includes("default"))).toBe(true);
  });

  it("builds full print layouts from blocks", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = coordinate(x: 0,y: 0)",
        "}",
        "printLayout 型紙A (output: svg,paper: a3,orientation: landscape,columns: 3,rows: 4,overlap: 15,scale: 0.5,canvas: (500, 700)) {",
        "  place @前身頃(at: (10, 20),angle: 90,mirrorX: true)",
        "}"
      ].join("\n"),
      { elements: [], mode: "document" }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.printLayouts).toHaveLength(1);
    const layout = result.printLayouts![0];
    expect(layout).toMatchObject({
      name: "型紙A",
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
    const placement = layout.placements[0];
    expect(placement.groupId).toBe(result.elements[0].id);
    expect(placement.x).toBe(10);
    expect(placement.y).toBe(20);
    expect(placement.mirrorX).toBe(true);
    expect(placement.angleDeg).toBe(90);
  });

  it("reports unresolved place references", () => {
    const result = compileDslToElements(
      ["printLayout 型紙A () {", "  place @存在しない(at: (0, 0))", "}"].join("\n"),
      { elements: [], mode: "document" }
    );
    expect(result.diagnostics.some((item) => item.message.includes("参照先が見つかりません"))).toBe(true);
  });

  it("requires strict @ references for place targets and rejects properties", () => {
    const qualified = compileDslToElements(
      [
        "group Outer {",
        "  group Inner {",
        "  }",
        "}",
        "printLayout 型紙A () {",
        "  place @Outer::Inner(at: (0, 0))",
        "}"
      ].join("\n"),
      { elements: [], mode: "document" }
    );
    expect(qualified.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(qualified.printLayouts?.[0].placements[0].groupId).toBe(
      qualified.elements.find((element) => element.name === "Inner")?.id
    );

    const compilePlace = (target: string) => compileDslToElements(
      [
        "group G {",
        "}",
        "printLayout 型紙A () {",
        `  place ${target}(at: (0, 0))`,
        "}"
      ].join("\n"),
      { elements: [], mode: "document" }
    );

    const bare = compilePlace("G");
    expect(bare.diagnostics.some((item) => item.severity === "error" && item.code === "invalid-source-reference")).toBe(true);

    const malformed = compilePlace("@G::");
    expect(malformed.diagnostics.some((item) => item.severity === "error" && item.code === "invalid-source-reference")).toBe(true);

    const property = compilePlace("@G.name");
    expect(property.diagnostics.some((item) => item.severity === "error" && item.code === "invalid-source-reference")).toBe(true);
    expect(property.diagnostics.some((item) => item.message.includes("property"))).toBe(true);
  });

  it("resolves activePrintLayout by name", () => {
    const result = compileDslToElements(
      [
        "printLayout 型紙A (output: pdf) {",
        "}",
        "printLayout 型紙B (output: pdf) {",
        "}",
        "activePrintLayout 型紙B"
      ].join("\n"),
      { elements: [], mode: "document" }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.printLayouts).toHaveLength(2);
    expect(result.activePrintLayoutId).toBe(result.printLayouts![1].id);
  });

  it("reports unknown activePrintLayout names", () => {
    const result = compileDslToElements("activePrintLayout 未定義", { elements: [], mode: "document" });
    expect(result.diagnostics.some((item) => item.message.includes("未定義の印刷レイアウト"))).toBe(true);
  });

  it("computes evaluationLimitIndex from stop in document mode", () => {
    const result = compileDslToElements(
      ["point A = coordinate(x: 0,y: 0)", "point B = coordinate(x: 1,y: 1)", "stop", "point C = coordinate(x: 2,y: 2)"].join("\n"),
      { elements: [], mode: "document" }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.evaluationLimitIndex).toBe(2);
    expect(result.elements).toHaveLength(3);
  });

  it("warns and ignores stop in edit mode", () => {
    const result = compileDslToElements(
      ["point A = coordinate(x: 0,y: 0)", "stop"].join("\n"),
      { elements: [] }
    );
    expect(result.evaluationLimitIndex).toBeUndefined();
    expect(result.diagnostics.some((item) => item.severity === "warning" && item.message.includes("stop"))).toBe(true);
  });

  it("ignores the nui version statement during compilation", () => {
    const result = compileDslToElements(
      ["nui 1", "point A = coordinate(x: 0,y: 0)"].join("\n"),
      { elements: [] }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(1);
  });

  it("accepts parent: attributes in document and edit modes", () => {
    const source = [
      "group 前身頃 (id: g1) {",
      "}",
      "point A = coordinate(x: 0,y: 0,parent: @g1)"
    ].join("\n");

    const editResult = compileDslToElements(source, { elements: [] });
    expect(editResult.diagnostics).toEqual([]);

    const documentResult = compileDslToElements(source, { elements: [], mode: "document" });
    expect(documentResult.diagnostics).toEqual([]);
    expect(documentResult.elements[1].parentGroupId).toBe(documentResult.elements[0].id);
  });
});

describe("DSL compiler: typed declarations", () => {
  it("accepts const/let with no diagnostics, and does not lift them into elements", () => {
    const result = compileDslToElements(
      ["const x: number = 1", "let y: boolean = true", 'const label: string = "front"', "const dir: choice(a, b) = a"].join(
        "\n"
      ),
      { elements: [], majorVersion: 4 }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(0);
  });

  it("does not perturb duplicate-name or element compilation for surrounding elements", () => {
    const result = compileDslToElements(
      ["const x: number = 1", "point A = coordinate(x: 0,y: 0)", "const x: number = 2"].join("\n"),
      { elements: [], majorVersion: 4 }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(1);
  });
});

describe("DSL compiler: set statements", () => {
  it("accepts set with no diagnostics, and does not lift it into elements", () => {
    const result = compileDslToElements(["set x = 1", "set y = 2"].join("\n"), { elements: [], majorVersion: 4 });
    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(0);
  });
});
