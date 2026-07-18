import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { documentDslRefs, serializeElementsToDsl } from "./dslSerializer";
import { serializeElementStatementLogical } from "./dslSerializeElement";

// 決定論的なIDを明示して要素を組み立て、フラット出力のバイト列を固定する。
// serializer共通化リファクタで既存出力(DslPanelの書き出し形式)が
// 1バイトも変わらないことを保証する回帰テスト。
const buildElements = () => {
  const result = compileDslToElements(
    [
      "group 前身頃 (id: g1) {",
      "}",
      "var bust = expression(value: 840 id: v1)",
      "point A = coordinate(x: 0 y: 0 id: p1)",
      "point inGroup = coordinate(x: 1 y: 1 id: p9 parent: g1)",
      "point B = offset(from: A dx: 10 dy: -(bust / 4) id: p2)",
      "point C = polar(from: A angle: -45 distance: 80 id: p3)",
      "line AB = segment(start: A end: B id: l1)",
      "line shoulder = polar(start: A angle: -12 length: 130 id: l2)",
      "arc armhole = arc(center: A radius: 120 start: 0 end: -90 id: a1)",
      "point D = between(start: A end: B ratio: 0.5 id: p4)",
      "point E = onLine(from: AB.end distance: 20 id: p5)",
      "point X = intersection(line1: AB line2: shoulder index: 0 extensions: false id: p6)",
      "point H = tangentOffset(line: armhole base: A angle: 90 distance: 12 id: p7)",
      "arc r = corner(end1: AB.end end2: shoulder.start radius: 10 index: 0 id: a2)",
      "line lower = split(source: armhole at: D id: l3)",
      "line adjusted = extend(end: shoulder.end to: E id: l4)",
      "line seam = offset(sources: [AB, shoulder] distance: 10 side: left closed: false id: l5)",
      "curve neckline = bezier(start: A end: B startAngle: -90 startLength: 35 endAngle: 180 endLength: 45 intermediates: [C:45:20:25:i1] id: c1)",
      "arc three = through(point1: A point2: B point3: C start: 180 end: 270 id: a3)",
      'text label = label(text: "前中心" anchor: A size: 4 id: t1)',
      "line edge1 = edge(end1: AB.start end2: shoulder.end index: 0 id: e1)",
      "line cp = copy(startPoint: A endPoint: B scale: 1 angleDeg: 0 mirrorX: false baseLines: [AB] id: e2)",
      "line sym = mirrorCopy(axis1: A axis2: B baseLines: [AB] id: e3)",
      "line mv = move(startPoint: A endPoint: B scale: 1 angleDeg: 0 mirrorX: false baseLines: [AB] id: e4)",
      "line smv = mirrorMove(axis1: A axis2: B baseLines: [AB] id: e5)",
      "if cond (1 id: e6) {",
      "}",
      "for rep (i from: 0 count: 5 step: 1 showGenerated: false id: e7) {",
      "}",
      'image img = image(source: "assets/ref.png" origin: A scale: 1 angleDeg: 0 mirrorX: false id: e8)',
      "point hidden = coordinate(x: 5 y: 5 id: p8 visible: false enabled: false color: main)"
    ].join("\n"),
    { elements: [] }
  );
  expect(
    result.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => `${item.line}: ${item.message}`)
  ).toEqual([]);
  return result.elements;
};

describe("serializeElementsToDsl flat output", () => {
  it("keeps the flat id-based output byte-stable", () => {
    const elements = buildElements();
    expect(serializeElementsToDsl(elements)).toMatchInlineSnapshot(`
      "group 前身頃 (id: g1)
      var bust = expression(
        value: 840
        scope: global
        id: v1
      )
      point A = coordinate(
        x: 0
        y: 0
        id: p1
      )
      point inGroup = coordinate(
        x: 1
        y: 1
        id: p9
        parent: g1
      )
      point B = offset(
        from: p1
        dx: 10
        dy: -(bust / 4)
        id: p2
      )
      point C = polar(
        from: p1
        angle: -45
        distance: 80
        id: p3
      )
      line AB = segment(
        start: p1
        end: p2
        id: l1
      )
      line shoulder = polar(
        start: p1
        angle: -12
        length: 130
        id: l2
      )
      arc armhole = arc(
        center: p1
        radius: 120
        start: 0
        end: -90
        id: a1
      )
      point D = between(
        start: p1
        end: p2
        ratio: 0.5
        steps: [ratio: 0.01]
        id: p4
      )
      point E = onLine(
        from: l1.end
        distance: 20
        steps: [ratio: 0.01]
        id: p5
      )
      point X = intersection(
        line1: l1
        line2: l2
        index: 0
        extensions: false
        id: p6
      )
      point H = tangentOffset(
        line: a1
        base: p1
        angle: 90
        distance: 12
        id: p7
      )
      arc r = corner(
        end1: l1.end
        end2: l2.start
        radius: 10
        index: 0
        id: a2
      )
      line lower = split(
        source: a1
        at: p4
        id: l3
      )
      line adjusted = extend(
        end: l2.end
        to: p5
        id: l4
      )
      line seam = offset(
        sources: [l1, l2]
        distance: 10
        side: left
        closed: false
        suppressTrimWarnings: false
        id: l5
      )
      curve neckline = bezier(
        start: p1
        end: p2
        startAngle: -90
        startLength: 35
        endAngle: 180
        endLength: 45
        intermediates: [p3:45:20:25:i1]
        id: c1
      )
      arc three = through(
        point1: p1
        point2: p2
        point3: p3
        start: 180
        end: 270
        id: a3
      )
      text label = label(
        text: "前中心"
        anchor: p1
        size: 4
        id: t1
      )
      line edge1 = edge(
        end1: l1.start
        end2: l2.end
        index: 0
        id: e1
      )
      line cp = copy(
        startPoint: p1
        endPoint: p2
        scale: 1
        angleDeg: 0
        mirrorX: false
        baseLines: [l1]
        id: e2
      )
      line sym = mirrorCopy(
        axis1: p1
        axis2: p2
        baseLines: [l1]
        id: e3
      )
      line mv = move(
        startPoint: p1
        endPoint: p2
        scale: 1
        angleDeg: 0
        mirrorX: false
        baseLines: [l1]
        id: e4
      )
      line smv = mirrorMove(
        axis1: p1
        axis2: p2
        baseLines: [l1]
        id: e5
      )
      if cond (1 id: e6)
      for rep (i from: 0 count: 5 step: 1 showGenerated: false id: e7)
      image img = image(
        source: "assets/ref.png"
        origin: p1
        naturalWidthPx: 1
        naturalHeightPx: 1
        sourceDpi: 300
        targetPixelsPerMm: 11.811023622047244
        scale: 1
        angleDeg: 0
        mirrorX: false
        steps: [scale: 0.01]
        id: e8
      )
      point hidden = coordinate(
        x: 5
        y: 5
        visible: false
        enabled: false
        color: main
        id: p8
      )"
    `);
  });

  it("keeps visibility settings output byte-stable", () => {
    const elements = buildElements();
    const output = serializeElementsToDsl(elements.slice(0, 1), {
      visibilityRoles: [{ id: "外周", name: "外周" }],
      visibilityProfiles: [
        { id: "完成", name: "完成", defaultRoleVisible: true, roleVisibility: { 外周: true } }
      ],
      activeVisibilityProfileId: "完成"
    });
    expect(output).toMatchInlineSnapshot(`
      "role 外周 (name: "外周")
      view 完成 (default: true 外周: true)
      activeView 完成

      group 前身頃 (id: g1)"
    `);
  });

});

describe("serializeElementStatementLogical with documentDslRefs", () => {
  const statementByName = (name: string) => {
    const elements = buildElements();
    const refs = documentDslRefs(elements);
    const element = elements.find((item) => item.name === name);
    expect(element).toBeDefined();
    return serializeElementStatementLogical(element!, refs);
  };

  it("writes name-based references without id/parent attributes", () => {
    expect(statementByName("AB")).toBe("line AB = segment(start: A end: B)");
    expect(statementByName("B")).toBe("point B = offset(from: A dx: 10 dy: -(bust / 4))");
    expect(statementByName("inGroup")).toBe("point inGroup = coordinate(x: 1 y: 1)");
    expect(statementByName("X")).toBe("point X = intersection(line1: AB line2: shoulder index: 0 extensions: false)");
    expect(statementByName("seam")).toBe("line seam = offset(sources: [AB, shoulder] distance: 10 side: left closed: false suppressTrimWarnings: false)");
  });

  it("drops persistent record ids from bezier intermediates", () => {
    expect(statementByName("neckline")).toBe(
      "curve neckline = bezier(start: A end: B startAngle: -90 startLength: 35 endAngle: 180 endLength: 45 intermediates: [C:45:20:25])"
    );
  });

  it("keeps dangling references as raw id tokens without throwing", () => {
    const elements = buildElements();
    const refs = documentDslRefs(elements);
    const line = elements.find((item) => item.name === "AB");
    expect(line).toBeDefined();
    const dangling = {
      ...line!,
      startPoint: { mode: "reference", pointId: "freePoint-gone" }
    } as typeof line & object;
    expect(serializeElementStatementLogical(dangling as never, refs)).toBe("line AB = segment(start: freePoint-gone end: B)");
  });
});

describe("extended lossless attributes", () => {
  it("round-trips element local variables through vars:", () => {
    const first = compileDslToElements(
      "point P = coordinate(x: 0 y: 0 id: p1 vars: [高さ: 10; 幅: @高さ * 2])",
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const element = first.elements[0];
    expect(element.numericVariables).toHaveLength(2);
    expect(element.numericVariables![0]).toMatchObject({ name: "高さ", value: 10 });
    expect(element.numericVariables![1].name).toBe("幅");

    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized).toBe(
      [
        "point P = coordinate(",
        "  x: 0",
        "  y: 0",
        "  vars: [高さ: 10; 幅: @local-variable-1 * 2]",
        "  varIds: [local-variable-1, local-variable-2]",
        "  id: p1",
        ")"
      ].join("\n")
    );

    const second = compileDslToElements(serialized, { elements: [] });
    expect(second.diagnostics).toEqual([]);
    expect(second.elements[0].numericVariables).toEqual(element.numericVariables);
  });

  it("round-trips group printEnabled and printAnchor", () => {
    const first = compileDslToElements(
      "group G (id: g1 printEnabled: true printAnchor: (10, 20)) {\n}",
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized).toBe("group G (printEnabled: true printAnchor: (10, 20) id: g1)");
  });

  // v1では未知の`key=value`属性が(将来互換のため)診断なしで要素に吸収され、
  // かつ再出力はされなかった(この挙動自体を検証するテストがここにあった)。
  // v2はregistry駆動のconstruction引数検証(dslCallParser.ts の validateArgs)
  // が全ての呼び出しで未知引数を診断エラーにするため、この「未知属性の
  // サイレント吸収」という機能自体が仕様として廃止されている
  // (plan.mdの不変条件: 汎用`element type=`エスケープハッチの全廃)。
  // よってこのテストケースは対応する検証対象を持たないため削除した。

  it("round-trips non-expression variable modes (measurement constructions have no scope arg)", () => {
    const first = compileDslToElements(
      [
        "point A = coordinate(x: 0 y: 0 id: p1)",
        "point B = coordinate(x: 10 y: 0 id: p2)",
        "var 距離 = pointDistance(point1: A point2: B id: v1)"
      ].join("\n"),
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const variable = first.elements[2];
    expect(variable).toMatchObject({
      type: "variable",
      valueMode: "pointDistance",
      point1: { mode: "reference", pointId: "p1" },
      point2: { mode: "reference", pointId: "p2" }
    });

    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized).toContain(
      ["var 距離 = pointDistance(", "  point1: p1", "  point2: p2", "  id: v1", ")"].join("\n")
    );

    const second = compileDslToElements(serialized, { elements: [] });
    expect(second.diagnostics).toEqual([]);
    expect(second.elements[2]).toMatchObject({
      valueMode: "pointDistance"
    });
  });
});
