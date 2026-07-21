import { completionStatus, currentCompletions, selectedCompletionIndex, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDslCompletionSource, dslAutocompleteExtension } from "./cmAutocomplete";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { dslLinesForElements, dslTextForElements } from "../dsl/dslDocumentTestUtils";
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

  it("offers registry construction candidates in an incomplete element header", async () => {
    const source = "point P = co";
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(), printLayouts: () => [], printLayoutRanges: () => new Map(),
      isComposing: () => false, computedVariables: () => undefined, computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined
    });
    const result = await Promise.resolve(completionSource({ state, pos: source.length, explicit: true } as never));
    expect(result?.from).toBe(source.indexOf("co"));
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "coordinate", apply: "coordinate", type: "function" })
    ]));
  });

  it("projects a vertical call's partial named argument back to its physical row", async () => {
    const source = ["point P = offset(", "  from: A", "  d", ")"].join("\n");
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(), printLayouts: () => [], printLayoutRanges: () => new Map(),
      isComposing: () => false, computedVariables: () => undefined, computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined
    });
    const pos = source.indexOf("\n  d") + "\n  d".length;
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.from).toBe(pos - 1);
    expect(result?.to).toBe(pos);
    expect(result?.options.map((option) => option.label)).toEqual([
      "dx", "dy", "visible", "enabled", "state", "color", "steps", "vars"
    ]);
    expect(result?.options.every((option) => typeof option.apply === "string" && option.apply.endsWith(": "))).toBe(true);
  });

  it("keeps short-variable @value completion after declining ambiguous var construction completion", async () => {
    const source = ["nui 2", "var GlobalWidth = 100", "var Copy = @Gl"].join("\n");
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => elements, statementRanges: () => statementRanges, printLayouts: () => printLayouts, printLayoutRanges: () => printLayoutRanges,
      isComposing: () => false, computedVariables: () => undefined, computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined
    });
    const pos = source.length;
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "@GlobalWidth", apply: "@GlobalWidth" })
    ]));
  });

  it("passes only the shared ranked top eight to CodeMirror without re-filtering", async () => {
    const pointElements: DslDocumentData["elements"] = Array.from({ length: 10 }, (_, index) => ({
      id: `p${index}`, name: `P${index}`, type: "freePoint", visible: true, enabled: true, x: index, y: 0
    }));
    // 末尾のLは意図的にダングリング参照"P"(P0..P9とは別)から始まる — ユーザーが
    // "P"まで入力し、続く候補一覧をトリガーした状態を再現する。
    const source = dslTextForElements([
      ...pointElements,
      { id: "l", name: "L", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "P" }, endPoint: { mode: "reference", pointId: "p0" } }
    ]);
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.indexOf("start: P") + "start: P".length;
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
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      { id: "first", name: "First", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "second", name: "Second", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      // "Sec"は入力途中のダングリングトークン(Secondの先頭一致)。
      { id: "o", name: "O", type: "offsetLine", visible: true, enabled: true, baseLineIds: ["first", "Sec"], offset: 4, side: "left", closed: false }
    ]);
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
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      { id: "first", name: "First", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "second", name: "Second", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      // "Fir"は入力途中のダングリングトークン(Firstの先頭一致)。
      { id: "o", name: "O", type: "offsetLine", visible: true, enabled: true, baseLineIds: ["first", "Fir"], offset: 4, side: "left", closed: false }
    ]);
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
    const source = dslTextForElements([
      {
        id: "width", name: "Width", type: "variable", visible: true, enabled: true, scope: "global", valueMode: "expression",
        expression: 10, point1: { mode: "coordinate", x: 0, y: 0 }, point2: { mode: "coordinate", x: 0, y: 0 }, point: { mode: "coordinate", x: 0, y: 0 }, lineId: ""
      },
      // fromPointは未定義"A"へのダングリング参照(この文の意味自体はテスト対象外)。
      { id: "p", name: "P", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "A" }, dx: { kind: "expression", expression: "10+@Wi" }, dy: 0 }
    ]);
    const { elements, ids } = identities(source);
    const state = EditorState.create({ doc: source });
    const ranges = new Map([...ids].map(([line, elementId]) => [
      elementId,
      { elementId, from: state.doc.line(line).from, to: state.doc.line(line).to, statement: {} as never, foldTargets: [] }
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

  it("resolves attribute + @variable completion on a multi-line vertical-call continuation via the statement's logical projection", async () => {
    const source = ["nui 2", "var Width = 10", "point P = offset(", "  from: A", "  dx: 10+@Wi", "  dy: 0", ")"].join("\n");
    const { elements, ids } = identities(source);
    const state = EditorState.create({ doc: source });
    const ranges = new Map([...ids].map(([line, elementId]) => [
      elementId,
      { elementId, from: state.doc.line(line).from, to: state.doc.line(line).to, statement: {} as never, foldTargets: [] }
    ]));
    const pos = source.indexOf("@Wi") + "@Wi".length;
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
    // from/to must be projected back onto the physical continuation line: applying
    // the replacement at [from, to) should reproduce exactly "@Wi" -> "@Width",
    // never a shifted or logical-space offset.
    const applied = source.slice(0, result!.from) + "@Width" + source.slice(result!.to);
    expect(applied).toBe(source.replace("@Wi", "@Width"));
  });

  it("falls back to the physical line as a whole unit when the cursor has no enclosing logical statement (blank line)", async () => {
    const pointLines = dslLinesForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 }
    ]);
    const source = ["nui 1", "", ...pointLines].join("\n");
    const state = EditorState.create({ doc: source });
    const pos = state.doc.line(2).from;
    const completionSource = createDslCompletionSource({
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
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.map((option) => option.label)).toContain("point");
    expect(result?.from).toBe(pos);
    expect(result?.to).toBe(pos);
  });

  it("honors a documentInput override", async () => {
    const source = dslTextForElements([
      {
        id: "width", name: "Width", type: "variable", visible: true, enabled: true, scope: "global", valueMode: "expression",
        expression: 10, point1: { mode: "coordinate", x: 0, y: 0 }, point2: { mode: "coordinate", x: 0, y: 0 }, point: { mode: "coordinate", x: 0, y: 0 }, lineId: ""
      },
      { id: "p", name: "P", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "A" }, dx: { kind: "expression", expression: "10+@Wi" }, dy: 0 }
    ]);
    const { elements, ids } = identities(source);
    const mainState = EditorState.create({ doc: source });
    const ranges = new Map([...ids].map(([line, elementId]) => [
      elementId,
      { elementId, from: mainState.doc.line(line).from, to: mainState.doc.line(line).to, statement: {} as never, foldTargets: [] }
    ]));
    // The lens mirrors the whole statement's logical (row-joined) projection at
    // its own buffer offset 0 — a different EditorState than the main document,
    // proving the documentInput override, not the CompletionContext's own
    // state, drives candidate lookup. P's construction call always spans
    // multiple physical rows in v2's canonical vertical layout, so the lens
    // text is the joined logical statement rather than a single physical row.
    const lensLineText = "point P = offset( from: A dx: 10+@Wi dy: 0 )";
    const lensPos = lensLineText.indexOf("@Wi") + "@Wi".length;
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
        localPos: lensPos,
        doc: mainState.doc
      })
    });
    const result = await Promise.resolve(completionSource({ state: lensState, pos: lensPos, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.some((option) => option.label === "@Width")).toBe(true);
  });

  // printLayoutセクションは常に要素ツリーより前にシリアライズされるため(dslDocument.ts
  // のserializeDocumentToDsl)、「printLayoutブロックより前の行にトップレベルvarがある」
  // という行順序関係は生成経由では再現できない(dslVariableCompletionOptionsの
  // cursorLine=block.line カットオフがこの行順序に依存する)。手書きリテラルのまま残す。
  it("merges block-local layoutVar and global-only top-level candidates for a place/printLayout attribute", async () => {
    const source = [
      "nui 2",
      "var GlobalW = 100",
      "group G {",
      "  point A = coordinate(x: 0 y: 0)",
      "  var GroupW = expression(value: 50 scope: group)",
      "}",
      "printLayout Layout1 (columns: 2) {",
      "  layoutVar Margin = 20",
      "  place G (at: (0, 0) angle: 0+@Ma)",
      "}"
    ].join("\n");
    const { elements: compiledElements, printLayouts, statementRanges, printLayoutRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.indexOf("@Ma") + "@Ma".length;
    const completionSource = createDslCompletionSource({
      elements: () => compiledElements,
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
    const source = dslTextForElements([
      {
        id: "globallen", name: "GlobalLen", type: "variable", visible: true, enabled: true, scope: "global", valueMode: "expression",
        expression: 15, point1: { mode: "coordinate", x: 0, y: 0 }, point2: { mode: "coordinate", x: 0, y: 0 }, point: { mode: "coordinate", x: 0, y: 0 }, lineId: ""
      },
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 10 },
      {
        id: "c", name: "C", type: "bezierCurve", visible: true, enabled: true,
        startPoint: { mode: "reference", pointId: "a" }, startHandleAngleDeg: 0, startHandleLength: 0,
        endPoint: { mode: "reference", pointId: "b" }, endHandleAngleDeg: 0, endHandleLength: 0,
        intermediatePoints: [{
          id: "pt1",
          point: { mode: "reference", pointId: "a" },
          handleAngleDeg: { kind: "expression", expression: "0+@Gl" },
          incomingHandleLength: 5,
          outgoingHandleLength: 5
        }],
        numericVariables: [{ id: "local", name: "Local", value: 5 }]
      }
    ]);
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
    const buildSource = (dotSuffix: string) => dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      { id: "ab", name: "直線AB", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "p", name: "P", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: { kind: "expression", expression: `直線AB.${dotSuffix}` }, dy: 0 }
    ]);

    const setup = () => {
      const source = buildSource("");
      const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = elements.find((element) => element.type === "line")!.id;
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
      const source = buildSource("le");
      const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = elements.find((element) => element.type === "line")!.id;
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
      const source = buildSource("");
      const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const abId = elements.find((element) => element.type === "line")!.id;
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

describe("dslAutocompleteExtension candidate navigation", () => {
  const createView = (isComposing: () => boolean) => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "p",
        extensions: dslAutocompleteExtension({
          elements: () => [],
          statementRanges: () => new Map(),
          printLayouts: () => [],
          printLayoutRanges: () => new Map(),
          isComposing,
          computedVariables: () => undefined,
          computedGeometry: () => undefined,
          effectiveEnabledElementIds: () => undefined,
          evaluationErrors: () => undefined
        })
      }),
      parent
    });
    return { parent, view };
  };

  const openCompletion = async (view: EditorView) => {
    expect(startCompletion(view)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(completionStatus(view.state)).toBe("active");
    // The completion result can become active late in the initial wait under a
    // full-suite load. Wait from that observed state as well so CM's own
    // interactionDelay has definitely elapsed before asserting key handling.
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(selectedCompletionIndex(view.state)).toBe(0);
  };

  it("uses arrows to move completion and Tab to accept", async () => {
    const { parent, view } = createView(() => false);
    await openCompletion(view);
    expect(currentCompletions(view.state).length).toBeGreaterThan(1);

    expect(fireEvent.keyDown(view.contentDOM, { key: "ArrowDown" })).toBe(false);
    expect(selectedCompletionIndex(view.state)).toBe(1);
    expect(fireEvent.keyDown(view.contentDOM, { key: "Tab" })).toBe(false);
    expect(view.state.doc.toString()).not.toBe("p");
    view.destroy();
    parent.remove();
  });

  it("falls through without an open candidate list and does not consume completion keys during composition", async () => {
    let composing = false;
    const { parent, view } = createView(() => composing);
    expect(fireEvent.keyDown(view.contentDOM, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(view.contentDOM, { key: " ", code: "Space" })).toBe(true);

    await openCompletion(view);
    composing = true;
    for (const event of [
      { key: "Tab" },
      { key: " ", code: "Space" },
      { key: "Enter" }
    ]) {
      expect(fireEvent.keyDown(view.contentDOM, event)).toBe(true);
    }
    expect(view.state.doc.toString()).toBe("p");
    expect(selectedCompletionIndex(view.state)).toBe(0);
    view.destroy();
    parent.remove();
  });

  it("leaves Space to numeric expression input even when its completion list is open", async () => {
    const source = ["nui 2", "var GlobalWidth = 100", "var Copy = @Gl"].join("\n");
    const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: EditorSelection.cursor(source.length),
        extensions: dslAutocompleteExtension({
          elements: () => elements,
          statementRanges: () => statementRanges,
          printLayouts: () => printLayouts,
          printLayoutRanges: () => printLayoutRanges,
          isComposing: () => false,
          computedVariables: () => undefined,
          computedGeometry: () => undefined,
          effectiveEnabledElementIds: () => undefined,
          evaluationErrors: () => undefined
        })
      }),
      parent
    });
    await openCompletion(view);

    expect(fireEvent.keyDown(view.contentDOM, { key: " ", code: "Space" })).toBe(true);
    expect(completionStatus(view.state)).toBeNull();
    // The command returned false, so CodeMirror/the platform—not completion—
    // owns inserting the one ordinary whitespace character.
    view.destroy();
    parent.remove();
  });
});
