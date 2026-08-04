import { describe, expect, it } from "vitest";
import {
  createElementNameContext,
  createdElementName,
  elementNameTokensForContext,
  elementQualifiedName,
  fallbackElementName,
  formatReferenceOptionLabel,
  makeUniqueElementName,
  resolveElementName
} from "./elementNames";
import type { CadElement } from "../types/geometry";

const elements: CadElement[] = [
  {
    id: "point-a",
    name: "点A",
    type: "freePoint",
    activity: "visible",
    x: 0,
    y: 0
  },
  {
    id: "point-b",
    name: "点A 2",
    type: "offsetPoint",
    activity: "visible",
    fromPointId: "point-a",
    dx: 10,
    dy: 0
  },
  {
    id: "line-a",
    name: "直線A",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "point-a" },
    endPoint: { mode: "reference", pointId: "point-b" }
  }
];

describe("elementNames", () => {
  it("keeps a name that is already unique", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "点C",
        fallbackBaseName: "点"
      })
    ).toBe("点C");
  });

  it("adds a suffix when the requested name is already used", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "点A",
        fallbackBaseName: "点"
      })
    ).toBe("点A 3");
  });

  it("allows the same name in a different parent group namespace", () => {
    const groupedElements: CadElement[] = [
      {
        id: "group-a",
        name: "前身頃",
        type: "group",
        activity: "visible",
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        ...elements[0],
        parentGroupId: "group-a"
      }
    ];

    expect(
      makeUniqueElementName({
        elements: groupedElements,
        requestedName: "点A",
        fallbackBaseName: "点"
      })
    ).toBe("点A");
    expect(
      makeUniqueElementName({
        elements: groupedElements,
        requestedName: "点A",
        fallbackBaseName: "点",
        parentGroupId: "group-a"
      })
    ).toBe("点A 2");
  });

  it("does not treat the current element name as a duplicate", () => {
    expect(
      makeUniqueElementName({
        elements,
        elementId: "point-a",
        requestedName: "点A",
        fallbackBaseName: "点"
      })
    ).toBe("点A");
  });

  it("uses a fallback name for blank input", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "   ",
        fallbackBaseName: "点"
      })
    ).toBe("点");
  });

  it("includes element type in reference option labels", () => {
    expect(formatReferenceOptionLabel(elements[1])).toBe("点A 2 - offset point");
  });

  it("has a fallback name for intersection points", () => {
    expect(fallbackElementName("intersectionPoint")).toBe("交点");
  });

  it("creates alphabetic point names from existing point count", () => {
    expect(
      createdElementName({
        elements,
        element: {
          id: "point-c",
          name: "",
          type: "freePoint",
          activity: "visible",
          x: 0,
          y: 0
        }
      })
    ).toBe("点C");
  });

  it("continues point names past Z", () => {
    const manyPoints = Array.from({ length: 26 }, (_, index): CadElement => ({
      id: `point-${index}`,
      name: `点${index + 1}`,
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    }));

    expect(
      createdElementName({
        elements: manyPoints,
        element: {
          id: "point-aa",
          name: "",
          type: "freePoint",
          activity: "visible",
          x: 0,
          y: 0
        }
      })
    ).toBe("点AA");
  });

  it("creates line names from point references", () => {
    expect(
      createdElementName({
        elements,
        element: {
          id: "line-b",
          name: "",
          type: "line",
          activity: "visible",
          startPoint: { mode: "reference", pointId: "point-a" },
          endPoint: { mode: "reference", pointId: "point-b" }
        }
      })
    ).toBe("直線AA2");
  });

  it("creates intersection names from line references", () => {
    expect(
      createdElementName({
        elements: [
          ...elements,
          {
            id: "line-b",
            name: "直線B",
            type: "line",
            activity: "visible",
            startPoint: { mode: "reference", pointId: "point-b" },
            endPoint: { mode: "reference", pointId: "point-a" }
          }
        ],
        element: {
          id: "cross",
          name: "",
          type: "intersectionPoint",
          activity: "visible",
          numericVariables: [],
          line1Id: "line-a",
          line2Id: "line-b",
          intersectionIndex: 0,
          useExtensions: false
        }
      })
    ).toBe("交点A_B");
  });

  it("keeps name resolution context equivalent to the compatibility path", () => {
    const nestedElements: CadElement[] = [
      {
        id: "child",
        name: "袖線",
        type: "line",
        activity: "visible",
        parentGroupId: "parent",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "parent",
        x: 0,
        y: 0
      },
      {
        id: "parent",
        name: "前身頃",
        type: "group",
        activity: "visible",
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "parent",
        x: 10,
        y: 0
      }
    ];
    const context = createElementNameContext(nestedElements);
    const child = nestedElements[0];

    expect(elementQualifiedName(child, nestedElements, context)).toBe(
      elementQualifiedName(child, nestedElements)
    );
    expect(elementQualifiedName(child, nestedElements, context)).toBe("前身頃::袖線");

    for (const token of ["袖線", "前身頃::袖線", "child", "::前身頃::袖線"]) {
      const slow = resolveElementName({ token, elements: nestedElements, currentElement: child });
      const fast = resolveElementName({ token, elements: nestedElements, currentElement: child, context });
      expect({ ...fast, element: fast.status === "resolved" ? fast.element.id : undefined }).toEqual({
        ...slow,
        element: slow.status === "resolved" ? slow.element.id : undefined
      });
    }

    const tokenSummary = (items: ReturnType<typeof elementNameTokensForContext>) =>
      items.map(({ token, element }) => [token, element.id]);
    expect(
      tokenSummary(elementNameTokensForContext({ elements: nestedElements, currentElement: child, context }))
    ).toEqual(tokenSummary(elementNameTokensForContext({ elements: nestedElements, currentElement: child })));
  });

  it("resolves misses during namespace-chain walking identically with and without context", () => {
    // 深いグループネストと、各段の名前空間でミスが起きる(=祖先まで
    // 遡らないと解決できない/どこにも無い)トークンを混在させる。
    // resolveNameSegmentInNamespaceのcontext有無フォールバック差分が
    // ここで露呈する(高速経路がミス時に線形スキャンへ落ちなくなった)。
    const nestedElements: CadElement[] = [
      {
        id: "outer",
        name: "外側",
        type: "group",
        activity: "visible",
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "outer-point",
        name: "外側点",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "outer",
        x: 0,
        y: 0
      },
      {
        id: "inner",
        name: "内側",
        type: "group",
        activity: "visible",
        parentGroupId: "outer",
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "inner-point-dup-a",
        name: "重複点",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "inner",
        x: 0,
        y: 0
      },
      {
        id: "inner-point-dup-b",
        name: "重複点",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "inner",
        x: 1,
        y: 0
      },
      {
        id: "leaf",
        name: "葉",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "inner",
        x: 2,
        y: 0
      }
    ];
    const context = createElementNameContext(nestedElements);
    const leaf = nestedElements.find((element) => element.id === "leaf")!;

    const tokens = [
      "外側点", // innerでミス→outerで解決
      "重複点", // innerで曖昧
      "存在しない名前", // どの名前空間にも無い(全段ミス)
      "内側", // innerの親自身の名前(outerでのみ解決)
      "外側::内側::葉"
    ];

    for (const token of tokens) {
      const withContext = resolveElementName({ token, elements: nestedElements, currentElement: leaf, context });
      const withoutContext = resolveElementName({ token, elements: nestedElements, currentElement: leaf });
      const normalize = (result: typeof withContext) => ({
        ...result,
        element: result.status === "resolved" ? result.element.id : undefined,
        elements: result.status === "ambiguous" ? result.elements.map((element) => element.id).sort() : undefined
      });
      expect(normalize(withContext)).toEqual(normalize(withoutContext));
    }
  });
});
