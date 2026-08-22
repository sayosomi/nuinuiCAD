import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { documentDslRefs, serializeElementsToDsl } from "./dslSerializer";
import { serializeElementStatementLogical } from "./dslSerializeElement";

// 決定論的なIDを明示して要素を組み立て、フラット出力のバイト列を固定する。
// serializer共通化後も、正規化された nui4 の `@` 参照を安定して出力する
// 回帰テスト。
const buildElements = () => {
  const result = compileDslToElements(
    [
      "group 前身頃 (id: g1) {",
      "}",
      "point A = coordinate(x: 0,y: 0, id: p1)",
      "point inGroup = coordinate(x: 1,y: 1, id: p9,parent: @g1)",
      "point B = offset(from: @A, dx: 10, dy: -(210 / 4), id: p2)",
      "point C = polar(from: @A,angle: -45,distance: 80, id: p3)",
      "line AB = segment(start: @A,end: @B, id: l1)",
      "line shoulder = polar(start: @A,angle: -12,length: 130, id: l2)",
      "arc armhole = arc(center: @A,radius: 120,start: 0,end: -90, id: a1)",
      "point D = between(start: @A,end: @B,ratio: 0.5, id: p4)",
      "point E = onLine(from: @AB.end,distance: 20, id: p5)",
      "point X = intersection(line1: @AB,line2: @shoulder,index: 0,extensions: false, id: p6)",
      "point H = tangentOffset(line: @armhole,base: @A,angle: 90,distance: 12, id: p7)",
      "arc r = corner(end1: @AB.end, end2: @shoulder.start,radius: 10,index: 0, id: a2)",
      "line lower = split(source: @armhole, at: @D, id: l3)",
      "extend(end: @shoulder.end, to: @E, id: l4)",
      "line seam = offset(sources: [@AB, @shoulder],distance: 10,side: left,closed: false, id: l5)",
      "curve neckline = bezier(start: @A,end: @B,startAngle: -90,startLength: 35,endAngle: 180,endLength: 45,intermediates: [@C:45:20:25:i1], id: c1)",
      "arc three = through(point1: @A,point2: @B,point3: @C,start: 180,end: 270, id: a3)",
      'text label = label(text: "前中心",anchor: @A,size: 4, id: t1)',
      "edge(end1: @AB.start, end2: @shoulder.end, index: 0, id: e1)",
      "line cp = transformCopy(startPoint: @A,endPoint: @B,scale: 1,angleDeg: 0,mirrorX: false,baseLines: [@AB], id: e2)",
      "line sym = mirrorCopy(axis1: @A,axis2: @B,baseLines: [@AB], id: e3)",
      "move(targets: [@AB], from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: false, id: e4)",
      "mirrorMove(targets: [@AB], axis1: @A, axis2: @B, id: e5)",
      "if (1) {",
      "}",
      "for i in range(from: 0,count: 5,step: 1,showGenerated: false, id: e7) {",
      "}",
      'image img = image(source: "assets/ref.png",origin: @A,scale: 1,angleDeg: 0,mirrorX: false, id: e8)',
      "point hidden = coordinate(x: 5,y: 5, id: p8,state: disabled)"
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
  it("keeps the flat id-based output canonical", () => {
    const elements = buildElements();
    const serialized = serializeElementsToDsl(elements);
    expect(serialized).toContain("transformCopy(");
    expect(serialized).not.toContain("copy(");
    expect(serialized).toMatchInlineSnapshot(`
      "group 前身頃 (id: g1)
      point A = coordinate(
        x: 0,
        y: 0,
        id: p1,
      )
      point inGroup = coordinate(
        x: 1,
        y: 1,
        id: p9,
        parent: @g1,
      )
      point B = offset(
        from: @p1,
        dx: 10,
        dy: -(210 / 4),
        id: p2,
      )
      point C = polar(
        from: @p1,
        angle: -45,
        distance: 80,
        id: p3,
      )
      line AB = segment(
        start: @p1,
        end: @p2,
        id: l1,
      )
      line shoulder = polar(
        start: @p1,
        angle: -12,
        length: 130,
        id: l2,
      )
      arc armhole = arc(
        center: @p1,
        radius: 120,
        start: 0,
        end: -90,
        id: a1,
      )
      point D = between(
        start: @p1,
        end: @p2,
        ratio: 0.5,
        steps: [ratio: 0.01],
        id: p4,
      )
      point E = onLine(
        from: @l1.end,
        distance: 20,
        steps: [ratio: 0.01],
        id: p5,
      )
      point X = intersection(
        line1: @l1,
        line2: @l2,
        index: 0,
        extensions: false,
        id: p6,
      )
      point H = tangentOffset(
        line: @a1,
        base: @p1,
        angle: 90,
        distance: 12,
        id: p7,
      )
      arc r = corner(
        end1: @l1.end,
        end2: @l2.start,
        radius: 10,
        index: 0,
        id: a2,
      )
      line lower = split(
        source: @a1,
        at: @p4,
        id: l3,
      )
      extend(
        end: @l2.end,
        to: @p5,
        id: l4,
      )
      line seam = offset(
        sources: [@l1, @l2],
        distance: 10,
        side: left,
        closed: false,
        suppressTrimWarnings: false,
        id: l5,
      )
      curve neckline = bezier(
        start: @p1,
        end: @p2,
        startAngle: -90,
        startLength: 35,
        endAngle: 180,
        endLength: 45,
        intermediates: [@p3:45:20:25:i1],
        id: c1,
      )
      arc three = through(
        point1: @p1,
        point2: @p2,
        point3: @p3,
        start: 180,
        end: 270,
        id: a3,
      )
      text label = label(
        text: "前中心",
        anchor: @p1,
        size: 4,
        id: t1,
      )
      edge(
        end1: @l1.start,
        end2: @l2.end,
        index: 0,
        id: e1,
      )
      line cp = transformCopy(
        startPoint: @p1,
        endPoint: @p2,
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLines: [@l1],
        id: e2,
      )
      line sym = mirrorCopy(
        axis1: @p1,
        axis2: @p2,
        baseLines: [@l1],
        id: e3,
      )
      move(
        targets: [@l1],
        from: @p1,
        to: @p2,
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        id: e4,
      )
      mirrorMove(
        targets: [@l1],
        axis1: @p1,
        axis2: @p2,
        id: e5,
      )
      if (1)
      for i in range(from: 0, count: 5, step: 1)
      image img = image(
        source: "assets/ref.png",
        origin: @p1,
        naturalWidthPx: 1,
        naturalHeightPx: 1,
        sourceDpi: 300,
        targetPixelsPerMm: 11.811023622047244,
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        steps: [scale: 0.01],
        id: e8,
      )
      point hidden = coordinate(
        x: 5,
        y: 5,
        state: disabled,
        id: p8,
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
      view 完成 (default: true, 外周: true)
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
    expect(statementByName("AB")).toBe("line AB = segment(start: @A, end: @B)");
    expect(statementByName("B")).toBe("point B = offset(from: @A, dx: 10, dy: -(210 / 4))");
    expect(statementByName("inGroup")).toBe("point inGroup = coordinate(x: 1, y: 1)");
    expect(statementByName("X")).toBe("point X = intersection(line1: @AB, line2: @shoulder, index: 0, extensions: false)");
    expect(statementByName("seam")).toBe("line seam = offset(sources: [@AB, @shoulder], distance: 10, side: left, closed: false, suppressTrimWarnings: false)");
  });

  it("drops persistent record ids from bezier intermediates", () => {
    expect(statementByName("neckline")).toBe(
      "curve neckline = bezier(start: @A, end: @B, startAngle: -90, startLength: 35, endAngle: 180, endLength: 45, intermediates: [@C:45:20:25])"
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
    expect(serializeElementStatementLogical(dangling as never, refs)).toBe("line AB = segment(start: @freePoint-gone, end: @B)");
  });
});
