import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements } from "../geometry/evaluate";
import { resolveGroupPrintEnabledBindingId, type GroupPrintEnabledLookup } from "../geometry/groupPrintEnabledRuntime";
import type { CadElement, PrintLayout } from "../types/geometry";
import { printableGroups, printableItemsForLayout, printablePathsForLayout } from "./printGeometry";

const elements: CadElement[] = [
  {
    id: "print-group",
    name: "前身頃",
    type: "group",
    activity: "visible",
    printEnabled: true,
    printAnchor: { mode: "reference", pointId: "origin" }
  },
  {
    id: "origin",
    name: "基準",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "print-group",
    x: 10,
    y: 0
  },
  {
    id: "end",
    name: "端",
    type: "freePoint",
    activity: "visible",
    parentGroupId: "print-group",
    x: 20,
    y: 0
  },
  {
    id: "printed-line",
    name: "印刷線",
    type: "line",
    activity: "visible",
    parentGroupId: "print-group",
    startPoint: { mode: "reference", pointId: "origin" },
    endPoint: { mode: "reference", pointId: "end" }
  },
  {
    id: "printed-text",
    name: "注記",
    type: "text",
    activity: "visible",
    parentGroupId: "print-group",
    text: "前中心",
    anchor: { mode: "reference", pointId: "origin" },
    fontSize: 3
  },
  {
    id: "root-start",
    name: "root start",
    type: "freePoint",
    activity: "visible",
    x: 0,
    y: 0
  },
  {
    id: "root-end",
    name: "root end",
    type: "freePoint",
    activity: "visible",
    x: 100,
    y: 0
  },
  {
    id: "root-line",
    name: "root line",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "root-start" },
    endPoint: { mode: "reference", pointId: "root-end" }
  },
  {
    id: "skip-group",
    name: "印刷しない",
    type: "group",
    activity: "visible",
    printEnabled: false,
    printAnchor: { mode: "coordinate", x: 0, y: 0 }
  }
];

const layout = (patch: Partial<PrintLayout> = {}): PrintLayout => {
  const {
    svgCanvasWidthMm = 210,
    svgCanvasHeightMm = 297,
    placements: patchedPlacements,
    ...rest
  } = patch;
  const placements = patchedPlacements ?? [
    {
      id: "placement-1",
      groupId: "print-group",
      x: 50,
      y: 40,
      angleDeg: 0,
      mirrorX: false
    }
  ];
  return {
    id: "print-layout-1",
    name: "",
    outputKind: "pdf",
    paperSizeId: "a4",
    orientation: "portrait",
    columns: 1,
    rows: 1,
    overlapMm: 10,
    scale: 1,
    ...rest,
    svgCanvasWidthMm,
    svgCanvasHeightMm,
    placements
  };
};

describe("printGeometry", () => {
  it("returns only groups explicitly enabled for printing", () => {
    expect(printableGroups(elements).map((group) => group.id)).toEqual(["print-group"]);
  });

  it("prints line geometry from placed groups and excludes root geometry", () => {
    const paths = printablePathsForLayout({
      elements,
      evaluation: evaluateElements(elements),
      layout: layout()
    });

    expect(paths).toEqual([
      expect.objectContaining({
        kind: "line",
        elementId: "printed-line",
        start: { x: 50, y: 40 },
        end: { x: 60, y: 40 }
      })
    ]);
  });

  it("uses activity predicates when an evaluation payload has no display masks", () => {
    const hiddenElements = elements.map((element) =>
      element.id === "printed-line" ? { ...element, activity: "hidden" as const } : element
    );
    const evaluation = evaluateElements(hiddenElements);
    const paths = printablePathsForLayout({
      elements: hiddenElements,
      evaluation: {
        ...evaluation,
        effectiveVisibleElementIds: undefined,
        effectiveEnabledElementIds: undefined
      },
      layout: layout()
    });

    expect(evaluation.computedGeometry.has("printed-line")).toBe(true);
    expect(paths).toEqual([]);
  });

  it("applies linear scale and mirroring around the group print anchor", () => {
    const paths = printablePathsForLayout({
      elements,
      evaluation: evaluateElements(elements),
      layout: layout({
        scale: 0.5,
        placements: [
          {
            id: "placement-1",
            groupId: "print-group",
            x: 50,
            y: 40,
            angleDeg: 0,
            mirrorX: true
          }
        ]
      })
    });

    expect(paths[0]).toMatchObject({
      kind: "line",
      start: { x: 50, y: 40 },
      end: { x: 45, y: 40 }
    });
  });

  it("prints anchored text and excludes anchorless comments", () => {
    const evaluation = evaluateElements([
      ...elements,
      {
        id: "comment",
        name: "コメント",
        type: "text",
        activity: "visible",
        parentGroupId: "print-group",
        text: "構成リスト用",
        anchor: null,
        fontSize: 3
      }
    ]);
    const items = printableItemsForLayout({
      elements: [
        ...elements,
        {
          id: "comment",
          name: "コメント",
          type: "text",
          activity: "visible",
          parentGroupId: "print-group",
          text: "構成リスト用",
          anchor: null,
          fontSize: 3
        }
      ],
      evaluation,
      layout: layout({ scale: 2 })
    });

    expect(items.texts).toEqual([
      expect.objectContaining({
        elementId: "printed-text",
        text: "前中心",
        anchor: { x: 50, y: 40 },
        fontSize: 6
      })
    ]);
  });

  it("filters printable geometry with the layout visibility profile", () => {
    const roleElements: CadElement[] = [
      ...elements,
      {
        id: "allowance-group",
        name: "縫い代",
        type: "group",
        activity: "visible",
        parentGroupId: "print-group",
        visibilityRoleIds: ["seam"]
      },
      {
        id: "allowance-end",
        name: "縫い代端",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "allowance-group",
        x: 20,
        y: 10
      },
      {
        id: "allowance-line",
        name: "縫い代線",
        type: "line",
        activity: "visible",
        parentGroupId: "allowance-group",
        startPoint: { mode: "reference", pointId: "origin" },
        endPoint: { mode: "reference", pointId: "allowance-end" }
      }
    ];
    const visibilityProfiles = [
      {
        id: "draft",
        name: "通常",
        defaultRoleVisible: false,
        roleVisibility: { seam: false }
      },
      {
        id: "print",
        name: "印刷",
        defaultRoleVisible: false,
        roleVisibility: { seam: true }
      }
    ];

    expect(printablePathsForLayout({
      elements: roleElements,
      evaluation: evaluateElements(roleElements),
      layout: layout({ visibilityProfileId: "draft" }),
      visibilityProfiles
    }).map((path) => path.elementId)).toEqual(["printed-line"]);

    expect(printablePathsForLayout({
      elements: roleElements,
      evaluation: evaluateElements(roleElements),
      layout: layout({ visibilityProfileId: "print" }),
      visibilityProfiles
    }).map((path) => path.elementId)).toEqual(["printed-line", "allowance-line"]);
  });
});

// Task 24: group.printEnabled resolved through a real DSL-compiled scalar
// binding, exercised end-to-end (compile -> evaluate -> print traversal),
// not just the isGroupPrintEnabled unit (see groupPrintEnabledRuntime.test.ts).
describe("printGeometry: group.printEnabled binding", () => {
  const compileCanonical = (statements: string[]): LastGoodDslDocument => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
    const result = compileCanonicalText(baseline, ["nui 4", ...statements].join("\n"));
    expect(result.status).not.toBe("fatal");
    return result.doc;
  };

  const lookupFor = (doc: LastGoodDslDocument): GroupPrintEnabledLookup => ({
    propertyBindings: doc.propertyBindings,
    byElementId: doc.statementMap.byElementId
  });

  const groupNamed = (doc: LastGoodDslDocument, name: string) => {
    const group = doc.document.elements.find(
      (element): element is Extract<CadElement, { type: "group" }> =>
        element.type === "group" && element.name === name
    );
    if (!group) throw new Error(`group "${name}" not found`);
    return group;
  };

  const boundGroupSource = (groupArgs: string) => [
    "let 印刷: boolean = true",
    `group G (${groupArgs}) {`,
    "  point A = coordinate(x: 0, y: 0)",
    "  point B = coordinate(x: 10, y: 0)",
    "  line AB = segment(start: @A, end: @B)",
    "}"
  ];

  const layoutFor = (groupId: string): PrintLayout => ({
    id: "print-layout-1",
    name: "",
    outputKind: "pdf",
    paperSizeId: "a4",
    orientation: "portrait",
    columns: 1,
    rows: 1,
    overlapMm: 10,
    scale: 1,
    svgCanvasWidthMm: 210,
    svgCanvasHeightMm: 297,
    placements: [{ id: "placement-1", groupId, x: 0, y: 0, angleDeg: 0, mirrorX: false }]
  });

  it("includes the group's geometry when the bound printEnabled evaluates true", () => {
    const doc = compileCanonical(boundGroupSource("printEnabled: @印刷"));
    const group = groupNamed(doc, "G");
    const evaluation = evaluateElements(doc.document.elements, { scalarProgram: doc.scalarProgram });

    expect(printableGroups(doc.document.elements, lookupFor(doc), evaluation.computedScalarBindings).map((item) => item.id)).toEqual([group.id]);
    const paths = printablePathsForLayout({
      elements: doc.document.elements,
      evaluation,
      layout: layoutFor(group.id),
      groupPrintEnabledLookup: lookupFor(doc)
    });
    expect(paths).toHaveLength(1);
  });

  it("excludes the group's geometry when the bound printEnabled evaluates false", () => {
    const doc = compileCanonical([
      "let 印刷: boolean = false",
      "group G (printEnabled: @印刷) {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "}"
    ]);
    const group = groupNamed(doc, "G");
    const evaluation = evaluateElements(doc.document.elements, { scalarProgram: doc.scalarProgram });

    expect(printableGroups(doc.document.elements, lookupFor(doc), evaluation.computedScalarBindings)).toEqual([]);
    const paths = printablePathsForLayout({
      elements: doc.document.elements,
      evaluation,
      layout: layoutFor(group.id),
      groupPrintEnabledLookup: lookupFor(doc)
    });
    expect(paths).toEqual([]);
  });

  it("excludes the group without crashing or affecting normal evaluation when the bound printEnabled is poisoned", () => {
    const doc = compileCanonical([
      "point Z1 = coordinate(x: 0, y: 0)",
      "point Z2 = coordinate(x: 3, y: 4)",
    "line D = segment(start: @Z1, end: @Z2, state: disabled)",
      "const dist: number = @D.length",
      "const 印刷: boolean = @dist > 0",
      "group G (printEnabled: @印刷) {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "}"
    ]);
    const group = groupNamed(doc, "G");
    const evaluation = evaluateElements(doc.document.elements, { scalarProgram: doc.scalarProgram });
    const printedBindingId = resolveGroupPrintEnabledBindingId(group.id, lookupFor(doc));

    expect(printedBindingId).toBeDefined();
    expect(evaluation.computedScalarBindings?.get(printedBindingId!)).toMatchObject({ status: "error" });
    expect(printableGroups(doc.document.elements, lookupFor(doc), evaluation.computedScalarBindings)).toEqual([]);
    const paths = printablePathsForLayout({
      elements: doc.document.elements,
      evaluation,
      layout: layoutFor(group.id),
      groupPrintEnabledLookup: lookupFor(doc)
    });
    expect(paths).toEqual([]);
    // The poison is intrinsic to the `印刷` binding's own evaluation, not
    // something print resolution introduces - normal evaluation errors are
    // unaffected by whether/how a group's printEnabled resolves.
    expect(evaluation.errors).toEqual([]);
  });

  it("keeps printEnabled independent of a hidden group's activity - hidden descendants stay excluded from print regardless", () => {
    const doc = compileCanonical(boundGroupSource("state: hidden, printEnabled: @印刷"));
    const group = groupNamed(doc, "G");
    const evaluation = evaluateElements(doc.document.elements, { scalarProgram: doc.scalarProgram });

    expect(printableGroups(doc.document.elements, lookupFor(doc), evaluation.computedScalarBindings).map((item) => item.id)).toEqual([group.id]);
    const paths = printablePathsForLayout({
      elements: doc.document.elements,
      evaluation,
      layout: layoutFor(group.id),
      groupPrintEnabledLookup: lookupFor(doc)
    });
    expect(paths).toEqual([]);
  });

  it("keeps printEnabled independent of a disabled group's activity - disabled descendants never evaluate, so print stays empty", () => {
    const doc = compileCanonical(boundGroupSource("state: disabled, printEnabled: @印刷"));
    const group = groupNamed(doc, "G");
    const evaluation = evaluateElements(doc.document.elements, { scalarProgram: doc.scalarProgram });

    expect(printableGroups(doc.document.elements, lookupFor(doc), evaluation.computedScalarBindings).map((item) => item.id)).toEqual([group.id]);
    const paths = printablePathsForLayout({
      elements: doc.document.elements,
      evaluation,
      layout: layoutFor(group.id),
      groupPrintEnabledLookup: lookupFor(doc)
    });
    expect(paths).toEqual([]);
  });
});
