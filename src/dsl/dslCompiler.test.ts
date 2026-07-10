import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { compileDslToElements } from "./dslCompiler";
import { serializeElementsToDsl } from "./dslSerializer";

describe("DSL compiler", () => {
  it("creates basic drafting elements from short DSL syntax", () => {
    const result = compileDslToElements(
      [
        "var bust = 840",
        "point A = (0, 0)",
        "point B = offset A dx=0 dy=-(bust / 4)",
        "line AB = A -> B",
        "arc armhole center=A radius=120 start=0 end=-90",
        "text label = \"前中心\" at=A size=4"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.type)).toEqual([
      "variable",
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
    expect(result.elements[2]).toMatchObject({
      type: "offsetPoint",
      fromPoint: { mode: "reference", pointId: result.elements[1].id }
    });
    expect(result.elements[3]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: result.elements[1].id },
      endPoint: { mode: "reference", pointId: result.elements[2].id }
    });
  });

  it("keeps an unanchored text element unanchored when applying serialized DSL", () => {
    const initial = compileDslToElements('text label = "一行目\\n二行目" at=none size=3', { elements: [] });

    expect(initial.diagnostics).toEqual([]);
    expect(initial.elements[0]).toMatchObject({
      type: "text",
      text: "一行目\n二行目",
      anchor: null
    });
  });

  it("updates existing elements by stable id", () => {
    const initial = compileDslToElements("point A = (0, 0)", { elements: [] });
    const point = initial.elements[0];
    const result = compileDslToElements(`point A = (10, 20) id=${point.id}`, {
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
        "var 'バスト 寸法' = 840",
        "point \"前 上\" = (0, 0)",
        "point \"前 下\" = offset \"前 上\" dx=0 dy=-('バスト 寸法' / 4)",
        "line \"前 中心線\" = \"前 上\" -> \"前 下\"",
        "point \"線上 点\" = on \"前 中心線\".end distance=10"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.name)).toEqual([
      "バスト 寸法",
      "前 上",
      "前 下",
      "前 中心線",
      "線上 点"
    ]);
    expect(result.elements[3]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: result.elements[1].id },
      endPoint: { mode: "reference", pointId: result.elements[2].id }
    });
    expect(result.elements[4]).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: result.elements[3].id, endpointKey: "end" }
    });
  });

  it("resolves duplicate element names by parent namespace and qualified path", () => {
    const result = compileDslToElements(
      [
        "group front",
        "group back",
        "point A = (0, 0) parent=front",
        "point B = (100, 0) parent=front",
        "point A = (0, 10) parent=back",
        "point B = (100, 10) parent=back",
        "line side = A -> B parent=front",
        "line backSide = back::A -> back::B parent=front"
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

  it("supports generic element syntax for element types without short syntax", () => {
    const base = compileDslToElements(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "line AB = A -> B"
      ].join("\n"),
      { elements: [] }
    );
    const lineId = base.elements.find((element) => element.name === "AB")?.id;
    const result = compileDslToElements(
      `element offset type=offsetLine baseLineIds=[${lineId}] offset=10 side=left closed=false`,
      { elements: base.elements }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: [lineId],
      offset: 10,
      side: "left",
      closed: false
    });
  });

  it("round-trips locked common attributes", () => {
    const result = compileDslToElements("point A = (0, 0) locked=true", { elements: [] });

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]).toMatchObject({ locked: true });
    expect(serializeElementsToDsl(result.elements)).toContain("locked=true");
  });

  it("creates drafting point constructions from natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "line AB = A -> B",
        "line vertical = from A angle=90 length=100",
        "point mid = between A B ratio=0.5",
        "point onLine = on AB.start distance=25",
        "point cross = intersection AB vertical index=0 extensions=true",
        "point tangent = tangentOffset AB base=A angle=90 distance=10"
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
    expect(result.elements[4]).toMatchObject({ type: "divisionPoint", placementMode: "ratio", ratio: 0.5 });
    expect(result.elements[5]).toMatchObject({ type: "lineDivisionPoint", placementMode: "distance", distance: 25 });
    expect(result.elements[6]).toMatchObject({ type: "intersectionPoint", intersectionIndex: 0, useExtensions: true });
    expect(result.elements[7]).toMatchObject({ type: "lineTangentOffsetPoint", tangentAngleDeg: 90, distance: 10 });
  });

  it("creates line and curve operations from natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 0)",
        "line AB = A -> B",
        "curve curveAB = A -> B startAngle=0 startLength=25 endAngle=180 endLength=25 intermediates=[C:45:10:20:mid-1]",
        "line splitAB = split AB at=C",
        "line extended = extend AB.end to=C",
        "line offsetAB = offset [AB,curveAB] distance=10 side=left closed=false"
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
        "point A = (0, 0)",
        "point B = (50, 50)",
        "point C = (100, 0)",
        "line AB = A -> B",
        "line BC = B -> C",
        "arc throughArc = through A B C start=0 end=180",
        "arc cornerArc = corner AB.end BC.start radius=10 index=0"
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
    const existing = compileDslToElements("point old = (10, 10)", { elements: [] }).elements;
    const result = compileDslToElements("point A = (0, 0)\npoint B = offset A dx=10 dy=0", {
      elements: existing,
      mode: "document"
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(2);
    expect(result.elements.map((element) => element.name)).toEqual(["A", "B"]);
  });

  it("serializes selected elements into editable DSL with ids", () => {
    const result = compileDslToElements("point A = (0, 0)\npoint B = (10, 0)\nline AB = A -> B", {
      elements: []
    });
    const source = serializeElementsToDsl(result.elements);

    expect(source).toContain(`point A = (0, 0) id=${result.elements[0].id}`);
    expect(source).toContain(`line AB = ${result.elements[0].id} -> ${result.elements[1].id}`);
  });

  it("quotes serialized element names that contain spaces", () => {
    const result = compileDslToElements(
      [
        "point \"前 上\" = (0, 0)",
        "point \"前 下\" = (0, -100)",
        "line \"前 中心線\" = \"前 上\" -> \"前 下\""
      ].join("\n"),
      { elements: [] }
    );
    const source = serializeElementsToDsl(result.elements);
    const roundTrip = compileDslToElements(source, { elements: result.elements });

    expect(source).toContain(`point "前 上" = (0, 0) id=${result.elements[0].id}`);
    expect(source).toContain(`line "前 中心線" = ${result.elements[0].id} -> ${result.elements[1].id}`);
    expect(roundTrip.diagnostics).toEqual([]);
    expect(roundTrip.elements.map((element) => element.name)).toEqual(["前 上", "前 下", "前 中心線"]);
  });

  it("serializes advanced GUI elements with natural DSL syntax", () => {
    const result = compileDslToElements(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "point C = (50, 0)",
        "line AB = A -> B",
        "point mid = between A B ratio=0.5",
        "line splitAB = split AB at=C",
        "line offsetAB = offset [AB] distance=10 side=left closed=false",
        "curve curveAB = A -> B startAngle=0 startLength=25 endAngle=180 endLength=25 intermediates=[C:45:10:20:mid-1]"
      ].join("\n"),
      { elements: [] }
    );
    const source = serializeElementsToDsl(result.elements);

    expect(source).toContain("point mid = between");
    expect(source).toContain("line splitAB = split");
    expect(source).toContain("line offsetAB = offset");
    expect(source).toContain("curve curveAB =");
    expect(source).toContain("intermediates=[");
  });

  it("compiles and serializes visibility roles and profiles", () => {
    const result = compileDslToElements(
      [
        "role seam name=\"縫い代\"",
        "role notch name=\"ノッチ\"",
        "view 通常 default=false seam=false notch=false",
        "view 印刷 default=false seam=true notch=true",
        "activeView 通常",
        "group 前身頃",
        "group 前身頃縫い代 parent=前身頃 roles=[seam]",
        "printLayout A4 output=pdf visibilityView=印刷"
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
describe("DSL compiler blocks", () => {
  it("assigns parentGroupId from group blocks", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = (0, 0)",
        "  group 襟 {",
        "    point B = (1, 1)",
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
        "if 分岐 condition=1 {",
        "  point A = (0, 0)",
        "} else {",
        "  point B = (1, 1)",
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
        "for 繰返し i start=0 count=3 step=1 {",
        "  point P = (i * 10, 0)",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    const [forGroup, point] = result.elements;
    expect(forGroup).toMatchObject({ type: "forGroup", variableName: "i", start: 0, count: 3, step: 1 });
    expect(point.parentGroupId).toBe(forGroup.id);
  });

  it("prefers block structure over parent= attributes with a warning", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = (0, 0) parent=どこか",
        "}"
      ].join("\n"),
      { elements: [] }
    );

    const warnings = result.diagnostics.filter((item) => item.severity === "warning");
    expect(warnings.some((item) => item.message.includes("parent="))).toBe(true);
    expect(result.elements[1].parentGroupId).toBe(result.elements[0].id);
  });

  it("keeps unnamed elements unnamed and always inserts them", () => {
    const initial = compileDslToElements("point = (0, 0)", { elements: [] });
    expect(initial.elements).toHaveLength(1);
    expect(initial.elements[0].name).toBe("");

    const second = compileDslToElements("point = (5, 5)", { elements: initial.elements });
    expect(second.elements).toHaveLength(2);
  });
});

describe("DSL compiler document settings", () => {
  it("builds a palette from color statements", () => {
    const result = compileDslToElements(
      [
        "color main \"#112233\" name=\"本体\"",
        "color accent \"#445566\" default",
        "point A = (0, 0)"
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
      ["color a \"#112233\" default", "color b \"#445566\" default"].join("\n"),
      { elements: [], mode: "document" }
    );
    expect(result.diagnostics.some((item) => item.message.includes("default"))).toBe(true);
  });

  it("builds full print layouts from blocks", () => {
    const result = compileDslToElements(
      [
        "group 前身頃 {",
        "  point A = (0, 0)",
        "}",
        "printLayout 型紙A output=svg paper=a3 orientation=landscape columns=3 rows=4 overlap=15 scale=0.5 canvas=(500, 700) {",
        "  layoutVar 余白 = 20",
        "  place 前身頃 at=(10, @余白) angle=90 mirrorX=true",
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
    expect(layout.numericVariables).toHaveLength(1);
    expect(layout.numericVariables![0]).toMatchObject({ name: "余白", value: 20 });
    expect(layout.placements).toHaveLength(1);
    const placement = layout.placements[0];
    expect(placement.groupId).toBe(result.elements[0].id);
    expect(placement.x).toBe(10);
    expect(placement.y).toEqual({ kind: "expression", expression: "@print-variable-1" });
    expect(placement.mirrorX).toBe(true);
    expect(placement.angleDeg).toBe(90);
  });

  it("reports unresolved place references", () => {
    const result = compileDslToElements(
      ["printLayout 型紙A {", "  place 存在しない at=(0, 0)", "}"].join("\n"),
      { elements: [], mode: "document" }
    );
    expect(result.diagnostics.some((item) => item.message.includes("参照先が見つかりません"))).toBe(true);
  });

  it("resolves activePrintLayout by name", () => {
    const result = compileDslToElements(
      [
        "printLayout 型紙A output=pdf {",
        "}",
        "printLayout 型紙B output=pdf {",
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

  it("computes evaluationLimitIndex from @stop in document mode", () => {
    const result = compileDslToElements(
      ["point A = (0, 0)", "point B = (1, 1)", "@stop", "point C = (2, 2)"].join("\n"),
      { elements: [], mode: "document" }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.evaluationLimitIndex).toBe(2);
    expect(result.elements).toHaveLength(3);
  });

  it("warns and ignores @stop in edit mode", () => {
    const result = compileDslToElements(
      ["point A = (0, 0)", "@stop"].join("\n"),
      { elements: [] }
    );
    expect(result.evaluationLimitIndex).toBeUndefined();
    expect(result.diagnostics.some((item) => item.severity === "warning" && item.message.includes("@stop"))).toBe(true);
  });

  it("ignores the nui version statement during compilation", () => {
    const result = compileDslToElements(
      ["nui 1", "point A = (0, 0)"].join("\n"),
      { elements: [] }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(1);
  });

  it("accepts parent= attributes in document and edit modes", () => {
    const source = [
      "group 前身頃 id=g1",
      "point A = (0, 0) parent=g1"
    ].join("\n");

    const editResult = compileDslToElements(source, { elements: [] });
    expect(editResult.diagnostics).toEqual([]);

    const documentResult = compileDslToElements(source, { elements: [], mode: "document" });
    expect(documentResult.diagnostics).toEqual([]);
    expect(documentResult.elements[1].parentGroupId).toBe(documentResult.elements[0].id);
  });
});
