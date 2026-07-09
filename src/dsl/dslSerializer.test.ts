import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { documentDslRefs, serializeElementStatement, serializeElementsToDsl } from "./dslSerializer";

// 決定論的なIDを明示して要素を組み立て、フラット出力のバイト列を固定する。
// serializer共通化リファクタで既存出力(DslPanelの書き出し形式)が
// 1バイトも変わらないことを保証する回帰テスト。
const buildElements = () => {
  const result = compileDslToElements(
    [
      "group 前身頃 id=g1 expanded=true",
      "var bust = 840 id=v1",
      "point A = (0, 0) id=p1",
      "point inGroup = (1, 1) id=p9 parent=g1",
      "point B = offset A dx=10 dy=-(bust / 4) id=p2",
      "point C = polar A angle=-45 distance=80 id=p3",
      "line AB = A -> B id=l1",
      "line shoulder = from A angle=-12 length=130 id=l2",
      "arc armhole center=A radius=120 start=0 end=-90 id=a1",
      "point D = between A B ratio=0.5 id=p4",
      "point E = on AB.end distance=20 id=p5",
      "point X = intersection AB shoulder index=0 extensions=false id=p6",
      "point H = tangentOffset armhole base=A angle=90 distance=12 id=p7",
      "arc r = corner AB.end shoulder.start radius=10 index=0 id=a2",
      "line lower = split armhole at=D id=l3",
      "line adjusted = extend shoulder.end to=E id=l4",
      "line seam = offset [AB,shoulder] distance=10 side=left closed=false id=l5",
      "curve neckline = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[C:45:20:25:i1] id=c1",
      "arc three = through A B C start=180 end=270 id=a3",
      "text label = \"前中心\" at=A size=4 id=t1",
      "element edge1 type=edge endpoint1=AB.start endpoint2=shoulder.end intersectionIndex=0 id=e1",
      "element cp type=copyLine startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB] id=e2",
      "element sym type=symmetricCopyLine axisPoint1=A axisPoint2=B baseLineIds=[AB] id=e3",
      "element mv type=move startPoint=A endPoint=B scale=1 angleDeg=0 mirrorX=false baseLineIds=[AB] id=e4",
      "element smv type=symmetricMove axisPoint1=A axisPoint2=B baseLineIds=[AB] id=e5",
      "element cond type=conditionalGroup condition=1 expanded=true elseExpanded=false id=e6",
      "element rep type=forGroup variableName=i start=0 count=5 step=1 expanded=true showGenerated=false id=e7",
      "element img type=image sourcePath=\"assets/ref.png\" originPoint=A scale=1 angleDeg=0 mirrorX=false id=e8",
      "point hidden = (5, 5) id=p8 visible=false enabled=false color=main"
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
      "group 前身頃 id=g1 expanded=true
      var bust = 840 id=v1
      point A = (0, 0) id=p1
      point inGroup = (1, 1) id=p9 parent=g1
      point B = offset p1 dx=10 dy=-(bust / 4) id=p2
      point C = polar p1 angle=-45 distance=80 id=p3
      line AB = p1 -> p2 id=l1
      line shoulder = from p1 angle=-12 length=130 id=l2
      arc armhole center=p1 radius=120 start=0 end=-90 id=a1
      point D = between p1 p2 ratio=0.5 id=p4
      point E = on l1.end distance=20 id=p5
      point X = intersection l1 l2 index=0 extensions=false id=p6
      point H = tangentOffset a1 base=p1 angle=90 distance=12 id=p7
      arc r = corner l1.end l2.start radius=10 index=0 id=a2
      line lower = split a1 at=p4 id=l3
      line adjusted = extend l2.end to=p5 id=l4
      line seam = offset [l1,l2] distance=10 side=left closed=false id=l5
      curve neckline = p1 -> p2 startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[p3:45:20:25:i1] id=c1
      arc three = through p1 p2 p3 start=180 end=270 id=a3
      text label = "前中心" at=p1 size=4 id=t1
      element edge1 type=edge id=e1 endpoint1=l1.start endpoint2=l2.end intersectionIndex=0
      element cp type=copyLine id=e2 startPoint=p1 endPoint=p2 scale=1 angleDeg=0 mirrorX=false baseLineIds=[l1]
      element sym type=symmetricCopyLine id=e3 axisPoint1=p1 axisPoint2=p2 baseLineIds=[l1]
      element mv type=move id=e4 startPoint=p1 endPoint=p2 scale=1 angleDeg=0 mirrorX=false baseLineIds=[l1]
      element smv type=symmetricMove id=e5 axisPoint1=p1 axisPoint2=p2 baseLineIds=[l1]
      element cond type=conditionalGroup id=e6 condition=1 expanded=true elseExpanded=false
      element rep type=forGroup id=e7 variableName=i start=0 count=5 step=1 expanded=true showGenerated=false
      element img type=image id=e8 sourcePath="assets/ref.png" originPoint=p1 scale=1 angleDeg=0 mirrorX=false
      point hidden = (5, 5) id=p8 visible=false enabled=false color=main"
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
      "role 外周 name="外周"
      view 完成 default=true 外周=true
      activeView 完成

      group 前身頃 id=g1 expanded=true"
    `);
  });

  it("serializes without ids when includeIds is false", () => {
    const elements = buildElements();
    expect(serializeElementsToDsl(elements.slice(0, 6), { includeIds: false })).toMatchInlineSnapshot(`
      "group 前身頃 expanded=true
      var bust = 840
      point A = (0, 0)
      point inGroup = (1, 1) parent=g1
      point B = offset p1 dx=10 dy=-(bust / 4)
      point C = polar p1 angle=-45 distance=80"
    `);
  });
});

describe("serializeElementStatement with documentDslRefs", () => {
  const statementByName = (name: string) => {
    const elements = buildElements();
    const refs = documentDslRefs(elements);
    const element = elements.find((item) => item.name === name);
    expect(element).toBeDefined();
    return serializeElementStatement(element!, refs);
  };

  it("writes name-based references without id/parent attributes", () => {
    expect(statementByName("AB")).toBe("line AB = A -> B");
    expect(statementByName("B")).toBe("point B = offset A dx=10 dy=-(bust / 4)");
    expect(statementByName("inGroup")).toBe("point inGroup = (1, 1)");
    expect(statementByName("X")).toBe("point X = intersection AB shoulder index=0 extensions=false");
    expect(statementByName("seam")).toBe("line seam = offset [AB,shoulder] distance=10 side=left closed=false");
  });

  it("drops persistent record ids from bezier intermediates", () => {
    expect(statementByName("neckline")).toBe(
      "curve neckline = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[C:45:20:25]"
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
    expect(serializeElementStatement(dangling as never, refs)).toBe("line AB = freePoint-gone -> B");
  });
});

describe("extended lossless attributes", () => {
  it("round-trips element local variables through vars=", () => {
    const first = compileDslToElements(
      "point P = (0, 0) id=p1 vars=[高さ:10;幅:@高さ * 2]",
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const element = first.elements[0];
    expect(element.numericVariables).toHaveLength(2);
    expect(element.numericVariables![0]).toMatchObject({ name: "高さ", value: 10 });
    expect(element.numericVariables![1].name).toBe("幅");

    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized).toBe("point P = (0, 0) id=p1 vars=[高さ:10;幅:@local-variable-1 * 2]");

    const second = compileDslToElements(serialized, { elements: [] });
    expect(second.diagnostics).toEqual([]);
    expect(second.elements[0].numericVariables).toEqual(element.numericVariables);
  });

  it("round-trips group printEnabled and printAnchor", () => {
    const first = compileDslToElements(
      "group G id=g1 expanded=true printEnabled=true printAnchor=(10, 20)",
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized).toBe("group G id=g1 expanded=true printEnabled=true printAnchor=(10, 20)");
  });

  it("round-trips variable scope and non-expression modes", () => {
    const first = compileDslToElements(
      [
        "point A = (0, 0) id=p1",
        "point B = (10, 0) id=p2",
        "var 距離 = 0 mode=pointDistance point1=A point2=B scope=group id=v1"
      ].join("\n"),
      { elements: [] }
    );
    expect(first.diagnostics).toEqual([]);
    const variable = first.elements[2];
    expect(variable).toMatchObject({
      type: "variable",
      valueMode: "pointDistance",
      scope: "group",
      point1: { mode: "reference", pointId: "p1" },
      point2: { mode: "reference", pointId: "p2" }
    });

    const serialized = serializeElementsToDsl(first.elements);
    expect(serialized.split("\n")[2]).toBe(
      "var 距離 = 0 mode=pointDistance point1=p1 point2=p2 scope=group id=v1"
    );

    const second = compileDslToElements(serialized, { elements: [] });
    expect(second.diagnostics).toEqual([]);
    expect(second.elements[2]).toMatchObject({
      valueMode: "pointDistance",
      scope: "group"
    });
  });
});
