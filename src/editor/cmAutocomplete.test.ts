import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createDslCompletionSource } from "./cmAutocomplete";
import { compileDslDocument } from "../dsl/dslDocument";
import { createPrintLayoutRangeIndex, createStatementRangeIndex } from "./statementRangeIndex";

const identities = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  const doc = EditorState.create({ doc: source }).doc;
  return {
    elements: compiled.document!.elements,
    printLayouts: compiled.document!.printLayouts,
    ids: new Map([...compiled.statementMap!.byElementId].map(([elementId, statement]) => [statement.line, elementId])),
    statementRanges: createStatementRangeIndex(doc, compiled.statementMap!),
    printLayoutRanges: createPrintLayoutRangeIndex(doc, compiled.statementMap!)
  };
};

describe("createDslCompletionSource", () => {
  it("suppresses completion while the existing editor composition guard is active", () => {
    const state = EditorState.create({ doc: "poi" });
    const source = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      printLayouts: () => [],
      printLayoutRanges: () => new Map(),
      isComposing: () => true,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });
    expect(source({ state, pos: 3, explicit: true } as never)).toBeNull();
  });

  it("returns parser keyword completions after composition has ended", async () => {
    const state = EditorState.create({ doc: "poi" });
    const source = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      printLayouts: () => [],
      printLayoutRanges: () => new Map(),
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });
    const result = await Promise.resolve(source({ state, pos: 3, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.map((option) => option.label)).toContain("point");
  });

  it("passes only the shared ranked top eight to CodeMirror without re-filtering", async () => {
    const source = [
      "nui 1",
      ...Array.from({ length: 10 }, (_, index) => `point P${index} = (${index}, 0)`),
      "line L = P -> P0"
    ].join("\n");
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.lastIndexOf("P ->") + 1;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      printLayouts: () => printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });

    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.filter).toBe(false);
    expect(result?.options.map((option) => option.label)).toEqual(
      Array.from({ length: 8 }, (_, index) => `P${index}`)
    );
  });

  it("replaces only the current line-list item and preserves shared candidate order", async () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line First = A -> B",
      "line Second = A -> B",
      "line O = offset [First,Sec] distance=4 side=left"
    ].join("\n");
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const tokenStart = source.lastIndexOf("Sec");
    const pos = tokenStart + 3;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      printLayouts: () => printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });

    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.from).toBe(tokenStart);
    expect(result?.to).toBe(pos);
    expect(result?.options.map((option) => option.label)).toEqual(["Second"]);
  });

  it("does not offer a line already selected in another line-list item", async () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line First = A -> B",
      "line Second = A -> B",
      "line O = offset [First,Fir] distance=4 side=left"
    ].join("\n");
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const tokenStart = source.lastIndexOf("Fir");
    const pos = tokenStart + 3;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      printLayouts: () => printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });

    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.options ?? []).toEqual([]);
  });

  it("offers @name variable completions for a number-kind field with a live @ prefix", async () => {
    const source = ["nui 1", "var Width = 10", "point P = offset A dx=10+@Wi"].join("\n");
    const { elements, ids } = identities(source);
    const state = EditorState.create({ doc: source });
    const ranges = new Map([...ids].map(([line, elementId]) => [
      elementId,
      { elementId, from: state.doc.line(line).from, to: state.doc.line(line).to, statement: {} as never }
    ]));
    const pos = source.indexOf("@Wi") + 3;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => ranges,
      printLayouts: () => [],
      printLayoutRanges: () => new Map(),
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    const options = result!.options;
    expect(options.some((option) => option.label === "@Width")).toBe(true);
    expect(options.every((option) => option.type === "variable")).toBe(true);
    expect(options.find((option) => option.label === "@Width")?.apply).toBe("@Width");
  });

  it("honors a documentInput override, proving the Line Lens indirection point works", async () => {
    const source = ["nui 1", "var Width = 10", "point P = offset A dx=10+@Wi"].join("\n");
    const { elements, ids } = identities(source);
    const mainState = EditorState.create({ doc: source });
    const ranges = new Map([...ids].map(([line, elementId]) => [
      elementId,
      { elementId, from: mainState.doc.line(line).from, to: mainState.doc.line(line).to, statement: {} as never }
    ]));
    // The lens mirrors the whole selected line at its own buffer offset 0 — a
    // different EditorState than the main document, proving the documentInput
    // override, not the CompletionContext's own state, drives candidate lookup.
    const lensLineText = "point P = offset A dx=10+@Wi";
    const lensState = EditorState.create({ doc: lensLineText });
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => ranges,
      printLayouts: () => [],
      printLayoutRanges: () => new Map(),
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      documentInput: () => ({
        source,
        cursorLineNumber: 3,
        lineText: lensLineText,
        localPos: lensLineText.length,
        doc: mainState.doc
      })
    });
    const result = await Promise.resolve(completionSource({ state: lensState, pos: lensLineText.length, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.some((option) => option.label === "@Width")).toBe(true);
  });

  it("merges block-local layoutVar and global-only top-level candidates for a place/printLayout attribute", async () => {
    const source = [
      "nui 1",
      "var GlobalW = 100",
      "group G {",
      "  point A = (0, 0)",
      "  var GroupW = 50 scope=group",
      "}",
      "printLayout Layout1 columns=2 {",
      "  layoutVar Margin = 20",
      "  place G at=(0, 0) angle=0+@Ma",
      "}"
    ].join("\n");
    const { elements, printLayouts, statementRanges, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.indexOf("@Ma") + "@Ma".length;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      printLayouts: () => printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    const labels = result!.options.map((option) => option.label);
    expect(labels).toContain("@Margin");
    expect(labels).toContain("@GlobalW");
    expect(labels).not.toContain("@GroupW");
  });

  it("routes intermediates= to plain top-level candidates only, never the current element's own vars=", async () => {
    const source = [
      "nui 1",
      "var GlobalLen = 15",
      "point A = (0, 0)",
      "point B = (10, 10)",
      "curve C = A -> B vars=[Local:5] intermediates=[A:0+@Gl:5:5:pt1]"
    ].join("\n");
    const { elements, printLayouts, statementRanges, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.indexOf("@Gl") + "@Gl".length;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      printLayouts: () => printLayouts,
      printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false,
      computedVariables: () => undefined,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined
    });
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    const labels = result!.options.map((option) => option.label);
    expect(labels).toContain("@GlobalLen");
    expect(labels).not.toContain("@Local");
  });

  describe("elementParameter (ElementName.parameterKey) completion", () => {
    const setup = () => {
      const source = ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B", "point P = offset A dx=直線AB."].join("\n");
      const { elements, ids, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = ids.get(4)!;
      const state = EditorState.create({ doc: source });
      const computedGeometry = new Map([[abId, {
        kind: "line" as const,
        elementId: abId,
        name: "直線AB",
        startPointId: null,
        endPointId: null,
        start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
        end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
        length: 10,
        startAngleDeg: 0,
        endAngleDeg: 0,
        startTangentAngleDeg: 0,
        endTangentAngleDeg: 0
      }]]);
      const pos = source.indexOf("直線AB.") + "直線AB.".length;
      const completionSource = createDslCompletionSource({
        elements: () => elements,
        statementRanges: () => statementRanges,
        printLayouts: () => printLayouts,
        printLayoutRanges: () => printLayoutRanges,
        isComposing: () => false,
        computedVariables: () => undefined,
        computedGeometry: () => computedGeometry,
        effectiveEnabledElementIds: () => new Set([abId]),
        evaluationErrors: () => []
      });
      return { completionSource, state, pos, source };
    };

    it("lists AB's referenceable parameters right after the dot", async () => {
      const { completionSource, state, pos } = setup();
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toContain("length");
      expect(labels).toContain("startTangentAngleDeg");
      expect(result!.options.every((option) => option.type === "variable")).toBe(true);
    });

    it("spans only the member token (from/to exclude the ElementName. prefix)", async () => {
      const source = ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B", "point P = offset A dx=直線AB.le"].join("\n");
      const { elements, ids, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = ids.get(4)!;
      const state = EditorState.create({ doc: source });
      const computedGeometry = new Map([[abId, {
        kind: "line" as const,
        elementId: abId,
        name: "直線AB",
        startPointId: null,
        endPointId: null,
        start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
        end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
        length: 10,
        startAngleDeg: 0,
        endAngleDeg: 0,
        startTangentAngleDeg: 0,
        endTangentAngleDeg: 0
      }]]);
      const pos = source.indexOf("直線AB.le") + "直線AB.le".length;
      const completionSource = createDslCompletionSource({
        elements: () => elements,
        statementRanges: () => statementRanges,
        printLayouts: () => printLayouts,
        printLayoutRanges: () => printLayoutRanges,
        isComposing: () => false,
        computedVariables: () => undefined,
        computedGeometry: () => computedGeometry,
        effectiveEnabledElementIds: () => new Set([abId]),
        evaluationErrors: () => []
      });
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      // The dot immediately precedes `result!.from` - the "直線AB." prefix is
      // entirely outside [from, to), so picking a completion can never touch it.
      expect(source[result!.from - 1]).toBe(".");
      expect(source.slice(result!.from, result!.to)).toBe("le");
      const lengthOption = result!.options.find((option) => option.label === "length");
      expect(lengthOption?.apply).toBe("length");
    });

    it("is suppressed during IME composition, same as the shared top-level guard", async () => {
      const source = ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B", "point P = offset A dx=直線AB."].join("\n");
      const { elements, ids, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = ids.get(4)!;
      const state = EditorState.create({ doc: source });
      const pos = source.indexOf("直線AB.") + "直線AB.".length;
      const completionSource = createDslCompletionSource({
        elements: () => elements,
        statementRanges: () => statementRanges,
        printLayouts: () => printLayouts,
        printLayoutRanges: () => printLayoutRanges,
        isComposing: () => true,
        computedVariables: () => undefined,
        computedGeometry: () => new Map(),
        effectiveEnabledElementIds: () => new Set([abId]),
        evaluationErrors: () => []
      });
      expect(await Promise.resolve(completionSource({ state, pos, explicit: true } as never))).toBeNull();
    });
  });
});
