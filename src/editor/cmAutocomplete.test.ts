import { completionStatus, currentCompletions, selectedCompletionIndex, startCompletion } from "@codemirror/autocomplete";
import { ChangeSet, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDslCompletionSource, dslAutocompleteExtension } from "./cmAutocomplete";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { dslLinesForElements, dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { parseDsl } from "../dsl/dslParser";
import {
  createPrintLayoutRangeIndex,
  createScopeBodyRangeIndex,
  createStatementRangeIndex,
  createTypedDeclarationRangeIndex,
  mapScopeBodyRangeIndex,
  mapTypedDeclarationRangeIndex,
  type ScopeBodyRangeIndex,
  type TypedDeclarationRangeIndex
} from "./statementRangeIndex";

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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
      evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
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
        evaluationErrors: () => [],
        bindingAnalysis: () => undefined,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => undefined,
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
        evaluationErrors: () => [],
        bindingAnalysis: () => undefined,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => undefined,
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
        evaluationErrors: () => [],
        bindingAnalysis: () => undefined,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => undefined,
      });
      expect(await Promise.resolve(completionSource({ state, pos, explicit: true } as never))).toBeNull();
    });

    it("shows a real, visible completion tooltip from natural (non-explicit) typing through a live EditorView, and keeps narrowing it", async () => {
      // Regression coverage for a real Tauri report: typing `.` after an
      // element name must surface ElementName.property candidates through
      // the actual dslAutocompleteExtension/EditorView wiring - not just
      // through a direct createDslCompletionSource({ explicit: true }) call,
      // which every other test in this describe block uses and which can't
      // tell an implicit-typing gate bug apart from a working completion
      // source (see the `64f473c` `@`-marker gate that only ever applies to
      // typedInitializer/propertyScalarValue/templateHole contexts, never to
      // this elementParameter one - characterized here by actually typing).
      const source = buildSource("");
      const { elements, statementRanges, printLayouts, printLayoutRanges } = identities(source);
      const pos = source.indexOf("直線AB.") + "直線AB.".length;
      const parent = document.createElement("div");
      document.body.append(parent);
      const abId = elements.find((element) => element.type === "line")!.id;
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
      const view = new EditorView({
        state: EditorState.create({
          doc: source,
          selection: EditorSelection.cursor(pos),
          extensions: [
            dslAutocompleteExtension({
              elements: () => elements,
              statementRanges: () => statementRanges,
              printLayouts: () => printLayouts,
              printLayoutRanges: () => printLayoutRanges,
              isComposing: () => false,
              computedVariables: () => undefined,
              computedGeometry: () => computedGeometry,
              effectiveEnabledElementIds: () => new Set([abId]),
              evaluationErrors: () => [],
              bindingAnalysis: () => undefined,
              typedDeclarationRanges: () => new Map(),
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => undefined
            })
          ]
        }),
        parent
      });

      expect(completionStatus(view.state)).toBeNull();
      // A real typed keystroke: a docChanged transaction tagged exactly the
      // way CodeMirror's own DOM input handling tags it, at the live cursor
      // position - not an explicit startCompletion() call.
      view.dispatch({
        changes: { from: pos, insert: "l" },
        selection: { anchor: pos + 1 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => view.state.doc.toString().slice(pos, pos + 1), { timeout: 1000, interval: 20 }).toBe("l");
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("length");
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();

      view.dispatch({
        changes: { from: pos + 1, insert: "e" },
        selection: { anchor: pos + 2 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => view.state.doc.toString().slice(pos, pos + 2), { timeout: 1000, interval: 20 }).toBe("le");
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("length");
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();

      view.destroy();
      parent.remove();
    });

    it("Task 51 checklist: @ offers the typed binding, @Element. offers the property, both narrow and apply correctly in one live session", async () => {
      // The exact acceptance scenario from the Task 51 migration: a plain
      // numeric attribute must offer BOTH a typed const/let binding (@length)
      // and an element-property reference (@AB.length) - through the real
      // dslAutocompleteExtension wiring, in one EditorView session, with the
      // same name ("length") shared by the binding and the property so a
      // regression that conflates the two would be caught here.
      const source = [
        "nui 3",
        "const length: number = 12.3456",
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "line AB = segment(start: A end: B)",
        "point C = coordinate(x: 0 y: 0)"
      ].join("\n");
      const compiled = compileDslDocument(source, { assignedStatementIds: new Map([[1, "test:length"]]) });
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(compiled.document).not.toBeNull();
      const doc = EditorState.create({ doc: source }).doc;
      const elements = compiled.document!.elements;
      const statementRanges = createStatementRangeIndex(doc, compiled.statementMap!);
      const abId = elements.find((element) => element.type === "line")!.id;
      const computedGeometry = new Map([[abId, {
        kind: "line" as const,
        elementId: abId,
        name: "AB",
        startPointId: null,
        endPointId: null,
        start: { kind: "point" as const, elementId: "a", name: "A", x: 0, y: 0 },
        end: { kind: "point" as const, elementId: "b", name: "B", x: 10, y: 0 },
        length: 10,
        startAngleDeg: 0,
        endAngleDeg: 0,
        startTangentAngleDeg: 0,
        endTangentAngleDeg: 0
      }]]);
      const parent = document.createElement("div");
      document.body.append(parent);

      const view = new EditorView({
        state: EditorState.create({
          doc: source,
          extensions: [
            dslAutocompleteExtension({
              elements: () => elements,
              statementRanges: () => statementRanges,
              printLayouts: () => [],
              printLayoutRanges: () => new Map(),
              isComposing: () => false,
              computedVariables: () => undefined,
              computedGeometry: () => computedGeometry,
              effectiveEnabledElementIds: () => new Set([abId]),
              evaluationErrors: () => [],
              bindingAnalysis: () => compiled.bindingAnalysis,
              typedDeclarationRanges: () => createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
              scopeBodyRanges: () => createScopeBodyRangeIndex(doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex),
              statementInfoByElementId: () => compiled.statementMap!.byElementId,
              majorVersion: () => 3
            })
          ]
        }),
        parent
      });

      // Step 1-3: "@" on point C's x: field offers the typed binding
      // "length", "@l" narrows to it, applying inserts "@length".
      const xInsertPos = source.indexOf("point C") + "point C = coordinate(x: ".length;
      view.dispatch({
        changes: { from: xInsertPos, insert: "@" },
        selection: { anchor: xInsertPos + 1 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("@length");

      view.dispatch({
        changes: { from: xInsertPos + 1, insert: "l" },
        selection: { anchor: xInsertPos + 2 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      const narrowedBindingLabels = currentCompletions(view.state).map((option) => option.label);
      expect(narrowedBindingLabels).toContain("@length");
      expect(narrowedBindingLabels.every((label) => label.toLowerCase().includes("l"))).toBe(true);

      startCompletion(view);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      const bindingOption = currentCompletions(view.state).find((option) => option.label === "@length")!;
      view.dispatch({
        changes: { from: xInsertPos, to: xInsertPos + 2, insert: typeof bindingOption.apply === "string" ? bindingOption.apply : "@length" }
      });
      expect(view.state.doc.toString().slice(xInsertPos, xInsertPos + "@length".length)).toBe("@length");

      // Step 4-6: "@AB." on point C's y: field offers the element property
      // "length", "@AB.l" narrows to it, applying inserts "@AB.length".
      const yInsertPos = view.state.doc.toString().indexOf("y: ", xInsertPos) + "y: ".length;
      view.dispatch({
        changes: { from: yInsertPos, insert: "@AB." },
        selection: { anchor: yInsertPos + 4 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("length");

      view.dispatch({
        changes: { from: yInsertPos + 4, insert: "l" },
        selection: { anchor: yInsertPos + 5 },
        annotations: Transaction.userEvent.of("input.type")
      });
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("length");

      startCompletion(view);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      const propertyOption = currentCompletions(view.state).find((option) => option.label === "length")!;
      view.dispatch({
        changes: { from: yInsertPos + 4, to: yInsertPos + 5, insert: typeof propertyOption.apply === "string" ? propertyOption.apply : "length" }
      });
      expect(view.state.doc.toString().slice(yInsertPos, yInsertPos + "@AB.length".length)).toBe("@AB.length");

      view.destroy();
      parent.remove();
    });

    it("Task 51 checklist item 7: bare Element. offers no candidates in a nui 3 document", async () => {
      const source = [
        "nui 3",
        "point A = coordinate(x: 0 y: 0)",
        "point B = coordinate(x: 10 y: 0)",
        "line AB = segment(start: A end: B)",
        "point C = coordinate(x: 0 y: 0)"
      ].join("\n");
      const compiled = compileDslDocument(source);
      expect(compiled.document).not.toBeNull();
      const doc = EditorState.create({ doc: source }).doc;
      const elements = compiled.document!.elements;
      const statementRanges = createStatementRangeIndex(doc, compiled.statementMap!);
      const abId = elements.find((element) => element.type === "line")!.id;
      const parent = document.createElement("div");
      document.body.append(parent);
      const xInsertPos = source.indexOf("point C") + "point C = coordinate(x: ".length;
      const view = new EditorView({
        state: EditorState.create({
          doc: source,
          extensions: [
            dslAutocompleteExtension({
              elements: () => elements,
              statementRanges: () => statementRanges,
              printLayouts: () => [],
              printLayoutRanges: () => new Map(),
              isComposing: () => false,
              computedVariables: () => undefined,
              computedGeometry: () => new Map(),
              effectiveEnabledElementIds: () => new Set([abId]),
              evaluationErrors: () => [],
              bindingAnalysis: () => undefined,
              typedDeclarationRanges: () => new Map(),
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => compiled.statementMap!.byElementId,
              majorVersion: () => 3
            })
          ]
        }),
        parent
      });

      for (const char of "AB.") {
        const pos = view.state.selection.main.head === 0 ? xInsertPos : view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: char },
          selection: { anchor: pos + 1 },
          annotations: Transaction.userEvent.of("input.type")
        });
      }
      // Confirm the completion pipeline settles to no result - unlike the
      // majorVersion-omitted/2 case, which opens (see the elementParameter
      // describe block above). completionStatus briefly reports "pending"
      // while the async completion source resolves, so poll rather than
      // sampling once.
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBeNull();

      view.destroy();
      parent.remove();
    });
  });
});

describe("typed value completion (Task 39)", () => {
  /** Typed declarations/set statements need reconciler-issued statement
   * identity to appear in bindingAnalysis at all - assigns a fresh stable id
   * per statement index, mirroring the fixture convention used across the
   * scalars test suite (e.g. propertyBindingCompiler.test.ts's `compileFor`). */
  const compiledTyped = (source: string) => {
    const statements = parseDsl(source).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(source, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    return compiled;
  };

  const baseOptions = () => ({
    elements: () => [] as never[],
    statementRanges: () => new Map(),
    printLayouts: () => [] as never[],
    printLayoutRanges: () => new Map(),
    isComposing: () => false,
    computedVariables: () => undefined,
    computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined,
    evaluationErrors: () => undefined
  });

  const insertThroughContentDom = (
    view: EditorView,
    data: string,
    inputType: "insertText" | "insertCompositionText" = "insertText",
    isComposing = false
  ) => {
    const line = view.contentDOM.querySelector(".cm-line:last-child")!;
    const textNode = line.firstChild!;
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    view.contentDOM.focus();
    fireEvent(view.contentDOM, new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data,
      inputType,
      isComposing
    }));
    textNode.textContent += data;
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(view.contentDOM, new InputEvent("input", {
      bubbles: true,
      data,
      inputType,
      isComposing
    }));
  };

  describe("typed declaration initializer", () => {
    it("offers boolean literal and unary ! candidates at a clean operand start", async () => {
      // Committed/compiled from a complete, valid initializer; the actual
      // completion query happens against a separate dirty state with nothing
      // yet typed after "=" (an empty initializer would itself be a parse
      // error, so it can never be what compiledTyped compiles).
      const committedSource = ["nui 3", "const flag: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
      const dirtySource = committedSource.replace(" true", " ");
      const changes = ChangeSet.of({ from: committedSource.indexOf(" true"), to: committedSource.indexOf(" true") + " true".length, insert: " " }, committedSource.length);
      const dirtyRanges = mapTypedDeclarationRangeIndex(committedRanges, changes);
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => dirtyRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toEqual(expect.arrayContaining(["true", "false"]));
      expect(result!.options.every((option) => option.type === "enum" || option.type === "keyword")).toBe(true);
      expect(await Promise.resolve(completionSource({ state, pos, explicit: false } as never))).toBeNull();
    });

    it("offers @name reference candidates filtered to the declared type", async () => {
      // Committed/compiled from a fully-resolved reference ("@f" alone would
      // be an unresolved-reference compile error); the in-progress "@f"
      // partial only exists in a separate dirty live state.
      const committedSource = ["nui 3", "const flagA: boolean = true", "const numA: number = 1", "const target: boolean = @flagA"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
      const dirtySource = committedSource.replace("@flagA", "@f");
      const changes = ChangeSet.of({ from: committedSource.indexOf("@flagA") + 2, to: committedSource.length, insert: "" }, committedSource.length);
      const dirtyRanges = mapTypedDeclarationRangeIndex(committedRanges, changes);
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => dirtyRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const options = result!.options;
      expect(options.some((option) => option.label === "flagA" && option.apply === "@flagA")).toBe(true);
      expect(options.some((option) => option.label === "numA")).toBe(false);
      expect(options.every((option) => option.type === "variable")).toBe(true);
    });

    it("automatically opens completion after a Shift+2 DOM input inserts @ in a brand-new number declaration", async () => {
      const committedSource = [
        "nui 3",
        "const length: number = 12.3456",
        "const label: string = \"front\"",
        "const printed: boolean = true",
        "const side: choice(right, left) = left"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
      const insertion = "\nconst x: number =";
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        committedRanges,
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const parent = document.createElement("div");
      document.body.append(parent);
      Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
      let activeTransitions = 0;
      let acceptedTextInputTransactions = 0;
      const view = new EditorView({
        state: EditorState.create({
          doc: dirtySource,
          selection: EditorSelection.cursor(dirtySource.length),
          extensions: [
            dslAutocompleteExtension({
              ...baseOptions(),
              bindingAnalysis: () => compiled.bindingAnalysis,
              typedDeclarationRanges: () => ranges,
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => compiled.statementMap!.byElementId
            }),
            EditorView.updateListener.of((update) => {
              if (completionStatus(update.startState) !== "active" && completionStatus(update.state) === "active") {
                activeTransitions += 1;
              }
              for (const transaction of update.transactions) {
                if (transaction.isUserEvent("input.type") && transaction.docChanged) acceptedTextInputTransactions += 1;
              }
            })
          ]
        }),
        parent
      });

      expect(completionStatus(view.state)).toBeNull();
      expect(view.state.doc.toString()).toBe(dirtySource);
      insertThroughContentDom(view, " ");
      await expect.poll(() => view.state.doc.toString().endsWith("= "), { timeout: 1000, interval: 20 }).toBe(true);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBeNull();
      expect(parent.querySelector(".cm-tooltip-autocomplete")).toBeNull();
      fireEvent.keyDown(view.contentDOM, { key: "@", code: "Digit2", shiftKey: true });
      insertThroughContentDom(view, "@");
      await expect.poll(() => view.state.doc.toString().endsWith("@"), { timeout: 1000, interval: 20 }).toBe(true);
      expect(acceptedTextInputTransactions).toBe(2);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");

      const labels = currentCompletions(view.state).map((option) => option.label);
      expect(labels).toContain("length");
      expect(labels).not.toContain("label");
      expect(labels).not.toContain("printed");
      expect(labels).not.toContain("side");
      expect(labels.filter((label) => label === "length")).toHaveLength(1);
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
      expect(activeTransitions).toBe(1);
      insertThroughContentDom(view, "l");
      await expect.poll(() => view.state.doc.toString().endsWith("@l"), { timeout: 1000, interval: 20 }).toBe(true);
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["length"]);
      expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
      insertThroughContentDom(view, "e");
      await expect.poll(() => view.state.doc.toString().endsWith("@le"), { timeout: 1000, interval: 20 }).toBe(true);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["length"]);
      expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
      view.destroy();
      parent.remove();
    });

    it("waits for a composed @ to finalize, then performs one non-explicit retry", async () => {
      const committedSource = [
        "nui 3",
        "const length: number = 12.3456",
        "const label: string = \"front\"",
        "const printed: boolean = true",
        "const side: choice(right, left) = left"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = "\nconst x: number =";
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const parent = document.createElement("div");
      document.body.append(parent);
      Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
      let activeTransitions = 0;
      let automaticRetryTransactions = 0;
      const view = new EditorView({
        state: EditorState.create({
          doc: dirtySource,
          selection: EditorSelection.cursor(dirtySource.length),
          extensions: [
            dslAutocompleteExtension({
              ...baseOptions(),
              bindingAnalysis: () => compiled.bindingAnalysis,
              typedDeclarationRanges: () => ranges,
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => compiled.statementMap!.byElementId
            }),
            EditorView.updateListener.of((update) => {
              if (completionStatus(update.startState) !== "active" && completionStatus(update.state) === "active") {
                activeTransitions += 1;
              }
              for (const transaction of update.transactions) {
                if (transaction.annotation(Transaction.userEvent) === "input.type" && !transaction.docChanged) {
                  automaticRetryTransactions += 1;
                }
              }
            })
          ]
        }),
        parent
      });
      insertThroughContentDom(view, " ");
      await expect.poll(() => view.state.doc.toString().endsWith("= "), { timeout: 1000, interval: 20 }).toBe(true);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBeNull();
      expect(parent.querySelector(".cm-tooltip-autocomplete")).toBeNull();

      fireEvent.keyDown(view.contentDOM, { key: "@", code: "Digit2", shiftKey: true, isComposing: true });
      fireEvent.compositionStart(view.contentDOM);
      insertThroughContentDom(view, "@", "insertCompositionText", true);
      await expect.poll(() => view.state.doc.toString().endsWith("@"), { timeout: 1000, interval: 20 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(completionStatus(view.state)).toBeNull();
      expect(parent.querySelector(".cm-tooltip-autocomplete")).toBeNull();

      fireEvent.compositionEnd(view.contentDOM, { data: "@" });
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["length"]);
      expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
      expect(activeTransitions).toBe(1);
      expect(automaticRetryTransactions).toBe(1);
      insertThroughContentDom(view, "l");
      await expect.poll(() => view.state.doc.toString().endsWith("@l"), { timeout: 1000, interval: 20 }).toBe(true);
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["length"]);
      expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
      insertThroughContentDom(view, "e");
      await expect.poll(() => view.state.doc.toString().endsWith("@le"), { timeout: 1000, interval: 20 }).toBe(true);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["length"]);
      expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
      view.destroy();
      parent.remove();
    });

    it("does not retry a finalized composition when stale metadata has no typed binding candidates", async () => {
      const committedSource = ["nui 3", "const length: number = 12.3456"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = "\nconst x: number = ";
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const parent = document.createElement("div");
      document.body.append(parent);
      Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
      let automaticRetryTransactions = 0;
      const view = new EditorView({
        state: EditorState.create({
          doc: dirtySource,
          selection: EditorSelection.cursor(dirtySource.length),
          extensions: [
            dslAutocompleteExtension({
              ...baseOptions(),
              // The range is live, but the catalog cannot resolve its binding
              // id. This is the fail-closed stale-metadata shape.
              bindingAnalysis: () => compiledTyped([
                "nui 3",
                "point A = coordinate(x: 0 y: 0)",
                "const unrelated: number = 1"
              ].join("\n")).bindingAnalysis,
              typedDeclarationRanges: () => ranges,
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => undefined
            }),
            EditorView.updateListener.of((update) => {
              for (const transaction of update.transactions) {
                if (transaction.annotation(Transaction.userEvent) === "input.type" && !transaction.docChanged) {
                  automaticRetryTransactions += 1;
                }
              }
            })
          ]
        }),
        parent
      });
      const line = view.contentDOM.querySelector(".cm-line:last-child")!;
      const textNode = line.firstChild!;
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      view.contentDOM.focus();

      fireEvent.compositionStart(view.contentDOM);
      fireEvent(view.contentDOM, new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "@",
        inputType: "insertCompositionText",
        isComposing: true
      }));
      textNode.textContent += "@";
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent(view.contentDOM, new InputEvent("input", {
        bubbles: true,
        data: "@",
        inputType: "insertCompositionText",
        isComposing: true
      }));
      await expect.poll(() => view.state.doc.toString().endsWith("@"), { timeout: 1000, interval: 20 }).toBe(true);
      fireEvent.compositionEnd(view.contentDOM, { data: "@" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(completionStatus(view.state)).toBeNull();
      expect(parent.querySelector(".cm-tooltip-autocomplete")).toBeNull();
      expect(automaticRetryTransactions).toBe(0);
      view.destroy();
      parent.remove();
    });

    it("deduplicates a shadowed name for a new declaration using mapped live offsets", async () => {
      const committedSource = [
        "nui 3",
        "const length: number = 1",
        "if Scope (true) {",
        "const length: number = 2",
        "}"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertionPos = committedDoc.line(5).from;
      const insertion = "const x: number = @\n";
      const dirtySource = committedSource.slice(0, insertionPos) + insertion + committedSource.slice(insertionPos);
      const changes = ChangeSet.of({ from: insertionPos, insert: insertion }, committedSource.length);
      const ranges = mapTypedDeclarationRangeIndex(createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!), changes);
      const scopeBodyRanges = mapScopeBodyRangeIndex(
        createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex),
        changes
      );
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => ranges,
        scopeBodyRanges: () => scopeBodyRanges,
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = insertionPos + "const x: number = @".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options.map((option) => option.label).filter((label) => label === "length")).toHaveLength(1);
    });

    it("offers boolean operators right after a completed reference operand", async () => {
      const source = ["nui 3", "const flagA: boolean = true", "const target: boolean = @flagA "].join("\n");
      const compiled = compiledTyped(source);
      const doc = EditorState.create({ doc: source }).doc;
      const typedDeclarationRanges = createTypedDeclarationRangeIndex(doc, compiled.statementMap!);
      const state = EditorState.create({ doc: source });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => typedDeclarationRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = source.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      expect(result!.options.map((option) => option.label)).toEqual(["&&", "||", "==", "!="]);
      expect(result!.options.every((option) => option.type === "keyword")).toBe(true);
    });

    it("keeps completing through a dirty edit made after the last compile, before any recompile settles", async () => {
      // Committed/compiled state: a valid document.
      const committedSource = ["nui 3", "const flagA: boolean = true", "const target: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);

      // Dirty live buffer: several more characters typed into target's
      // initializer since that last compile - no recompile has run yet.
      const insertion = " && @fla";
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const dirtySource = committedSource + insertion;
      const dirtyRanges = mapTypedDeclarationRangeIndex(committedRanges, changes);
      const state = EditorState.create({ doc: dirtySource });

      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => dirtyRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      expect(result!.options.some((option) => option.label === "flagA")).toBe(true);
    });

    it("fails closed (no candidates) once the live statement is no longer a typed declaration", async () => {
      const committedSource = ["nui 3", "const target: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
      // The declaration keyword itself is edited away (no longer "const"),
      // so a fresh reparse of the live line no longer sees a typed
      // declaration at all - a structural edit fail-closed guard, not a
      // range-index invalidation.
      const dirtySource = ["nui 3", "notconst target: boolean = true"].join("\n");
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => committedRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });

    it("fails closed when the tracked bindingId no longer resolves in the (stale) precomputed catalog", async () => {
      const source = ["nui 3", "const target: boolean = true"].join("\n");
      const compiled = compiledTyped(source);
      const doc = EditorState.create({ doc: source }).doc;
      const staleRanges = createTypedDeclarationRangeIndex(doc, compiled.statementMap!);
      const state = EditorState.create({ doc: source });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        // A stale catalog from an entirely different (unrelated) document -
        // the tracked bindingId (derived from *this* document's own
        // statement-index-based stable id) can never resolve in it. The
        // unrelated declaration is deliberately placed at a different
        // statement index (via the leading extra statement) so its own
        // stable id never coincidentally collides with "target"'s.
        bindingAnalysis: () => compiledTyped(["nui 3", "point A = coordinate(x: 0 y: 0)", "const other: number = 1"].join("\n")).bindingAnalysis,
        typedDeclarationRanges: () => staleRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = source.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });

    it("fails closed for a brand-new declaration when no mapped live binding matches stale metadata", async () => {
      const committedSource = ["nui 3", "const length: number = 1"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = "\nconst x: number = @";
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiledTyped(["nui 3", "const unrelated: number = 1"].join("\n")).bindingAnalysis,
        typedDeclarationRanges: () => ranges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => undefined
      });
      const result = await Promise.resolve(completionSource({ state, pos: dirtySource.length, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });
  });

  describe("property scalar value", () => {
    it("offers @name reference candidates for an opt-in text property", async () => {
      // Committed/compiled from a fully-resolved reference (an unresolved
      // "@gr" would itself be a compile error); the in-progress "@gr" only
      // exists in a separate dirty live state.
      const committedSource = ["nui 3", "const greeting: string = \"hi\"", "text T = label(text: @greeting anchor: none size: 3)"].join("\n");
      const compiled = compiledTyped(committedSource);
      const dirtySource = committedSource.replace("@greeting", "@gr");
      const state = EditorState.create({ doc: dirtySource });
      const statementRanges = createStatementRangeIndex(state.doc, compiled.statementMap!);
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        elements: () => compiled.document!.elements,
        statementRanges: () => statementRanges,
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.indexOf("@gr") + "@gr".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const options = result!.options;
      expect(options.some((option) => option.label === "greeting" && option.apply === "@greeting")).toBe(true);
      expect(options.every((option) => option.type === "variable")).toBe(true);
    });

    it("offers true/false literal candidates for an opt-in boolean property with no @ prefix", async () => {
      // Committed/compiled from a complete, valid document; a bare "t" typed
      // toward "true" only exists in a separate dirty live state (an empty
      // required boolean value has no locatable value span at all, let alone
      // being a compile error, so this exercises the realistic in-progress
      // shape instead).
      const committedSource = ["nui 3", "group G (printEnabled: true) {", "}"].join("\n");
      const compiled = compiledTyped(committedSource);
      const dirtySource = committedSource.replace("printEnabled: true", "printEnabled: t");
      const state = EditorState.create({ doc: dirtySource });
      const statementRanges = createStatementRangeIndex(state.doc, compiled.statementMap!);
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        elements: () => compiled.document!.elements,
        statementRanges: () => statementRanges,
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.indexOf("printEnabled: t") + "printEnabled: t".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      expect(result!.options.map((option) => option.label)).toEqual(expect.arrayContaining(["true", "false"]));
      expect(result!.options.every((option) => option.type === "enum")).toBe(true);
    });
  });

  describe("template hole", () => {
    it("offers string/number @name candidates inside an in-progress hole, excludes boolean/choice", async () => {
      // The compiled/committed document must be a *complete, valid* nui 3
      // document - so the in-progress hole only ever exists in a separate,
      // dirty live EditorState, never in the text `compiledTyped` itself
      // compiles. The dirty string's outer quotes stay properly closed
      // (`"{@"`, cursor placed right after "@", before the closing quote) so
      // the surrounding statement/attribute parse stays intact - Task 26's
      // scanTextTemplateLiteral is what actually detects the hole as open,
      // by being bounded at the cursor rather than at the real closing quote
      // (see dslTemplateHoleCompletionContext.ts) - a genuinely unterminated
      // string would instead break the whole statement's parse, which is not
      // what this test is exercising.
      const committedSource = [
        "nui 3",
        "const greeting: string = \"hi\"",
        "const count: number = 1",
        "const flag: boolean = true",
        'text T = label(text: "placeholder" anchor: none size: 3)'
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const dirtySource = committedSource.replace('"placeholder"', '"{@"');
      const state = EditorState.create({ doc: dirtySource });
      // statementMap's line *numbers* are content-length-independent, so
      // projecting them through the dirty doc directly (rather than the
      // committed one) mirrors what statementRanges' own incremental
      // ChangeDesc mapping achieves in the real controller for this single,
      // same-line edit.
      const statementRanges = createStatementRangeIndex(state.doc, compiled.statementMap!);
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        elements: () => compiled.document!.elements,
        statementRanges: () => statementRanges,
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.indexOf("{@") + "{@".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toContain("greeting");
      expect(labels).toContain("count");
      expect(labels).not.toContain("flag");
    });

    it("offers typed candidates in a template hole on a brand-new element", async () => {
      const committedSource = [
        "nui 3",
        "const greeting: string = \"hi\"",
        "const count: number = 1",
        "const flag: boolean = true",
        "const side: choice(right, left) = left"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = '\ntext T = label(text: "{@" anchor: none size: 3)';
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const state = EditorState.create({ doc: dirtySource });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        elements: () => compiled.document!.elements,
        statementRanges: () => createStatementRangeIndex(state.doc, compiled.statementMap!),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => ranges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = dirtySource.indexOf("{@") + 2;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      const labels = result?.options.map((option) => option.label) ?? [];
      expect(labels).toEqual(expect.arrayContaining(["greeting", "count"]));
      expect(labels).not.toContain("flag");
      expect(labels).not.toContain("side");
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
          evaluationErrors: () => undefined,
          bindingAnalysis: () => undefined,
          typedDeclarationRanges: () => new Map(),
          scopeBodyRanges: () => [],
          statementInfoByElementId: () => undefined,
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
          evaluationErrors: () => undefined,
          bindingAnalysis: () => undefined,
          typedDeclarationRanges: () => new Map(),
          scopeBodyRanges: () => [],
          statementInfoByElementId: () => undefined,
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

describe("set target/rhs completion (Task 40)", () => {
  const compiledTyped = (source: string) => {
    const statements = parseDsl(source).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(source, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    return compiled;
  };

  const baseOptions = () => ({
    elements: () => [] as never[],
    statementRanges: () => new Map(),
    printLayouts: () => [] as never[],
    printLayoutRanges: () => new Map(),
    isComposing: () => false,
    computedVariables: () => undefined,
    computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined,
    evaluationErrors: () => undefined,
    statementInfoByElementId: () => undefined
  });

  type Compiled = ReturnType<typeof compiledTyped>;
  type Ranges = { typedDeclarationRanges: TypedDeclarationRangeIndex; scopeBodyRanges: ScopeBodyRangeIndex };

  /** Builds the committed Tier B ranges directly from a compiled document's own text. */
  const rangesFor = (compiled: Compiled, docText: string): Ranges => {
    const doc = EditorState.create({ doc: docText }).doc;
    return {
      typedDeclarationRanges: createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
      scopeBodyRanges: compiled.bindingAnalysis
        ? createScopeBodyRangeIndex(doc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
        : []
    };
  };

  /** Maps committed ranges through a single ChangeSet describing a dirty,
   * uncommitted live buffer - bindingAnalysis/scopeIndex themselves stay
   * frozen at the last successful compile the same way typedDeclarationRanges
   * already does for Task 39, so a brand-new statement inserted by the
   * change never needs its own compiled identity for site resolution. */
  const dirtyRanges = (committed: Ranges, changes: ReturnType<typeof ChangeSet.of>): Ranges => ({
    typedDeclarationRanges: mapTypedDeclarationRangeIndex(committed.typedDeclarationRanges, changes),
    scopeBodyRanges: mapScopeBodyRangeIndex(committed.scopeBodyRanges, changes)
  });

  const completionSourceFor = (compiled: Compiled, ranges: Ranges) =>
    createDslCompletionSource({
      ...baseOptions(),
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => ranges.typedDeclarationRanges,
      scopeBodyRanges: () => ranges.scopeBodyRanges
    });

  describe("target completion", () => {
    it("offers every visible let, excluding const/legacy, for a brand-new uncommitted \"set \" line in a clean document", async () => {
      const committedSource = ["nui 3", "let a: number = 1", "const c: number = 2", "var legacy = 3"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset ";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toContain("a");
      expect(labels).not.toContain("c");
      expect(labels).not.toContain("legacy");
      // A set target is a bare identifier, never "@"-prefixed.
      expect(result!.options.every((option) => option.apply === option.label)).toBe(true);
    });

    it("keeps target candidates available even while the currently-typed target name is itself unresolved", async () => {
      const committedSource = ["nui 3", "let a: number = 1"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset bogus = 1 +";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      // Cursor inside the (unresolved) target name "bogus".
      const pos = dirtySource.indexOf("bogus") + 3;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      expect(result!.options.map((option) => option.label)).toContain("a");
    });

    it("resolves scope-appropriate candidates for a brand-new set typed inside a nested forGroup, excluding a let declared afterward", async () => {
      const committedSource = [
        "nui 3",
        "let outer: number = 1",
        "if C (true) {",
        "  for Loop (i from: 0 count: 2) {",
        "  }",
        "}",
        "let after: number = 2"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const doc = EditorState.create({ doc: committedSource }).doc;
      const insertPos = doc.line(5).from; // right before the forGroup's own closing "  }"
      // No leading indentation: dslSetParser.ts's own leading keyword match
      // (mirroring dslDeclarationParser.ts's own convention) requires "set"
      // at the statement text's own position 0, independent of column -
      // same as every other completion-context fixture in this file.
      const insertedLine = "set ";
      const insertion = `${insertedLine}\n`;
      const dirtySource = committedSource.slice(0, insertPos) + insertion + committedSource.slice(insertPos);
      const changes = ChangeSet.of({ from: insertPos, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = insertPos + insertedLine.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toContain("outer");
      expect(labels).not.toContain("after");
    });
  });

  describe("RHS completion", () => {
    it("switches from target to RHS candidates within the same uncommitted burst once \"set name = \" is typed", async () => {
      const committedSource = ["nui 3", "let flag: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset flag = ";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      expect(result!.options.map((option) => option.label)).toEqual(expect.arrayContaining(["true", "false"]));
    });

    it("keeps RHS candidates available for a valid target even while its own RHS is currently incomplete", async () => {
      const committedSource = ["nui 3", "let a: number = 1", "let target: number = 2"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset target = 1 +";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const options = result!.options;
      expect(options.some((option) => option.label === "a" && option.apply === "@a")).toBe(true);
    });

    it("filters reference candidates to the target's own declared type", async () => {
      const committedSource = ["nui 3", "let flagA: boolean = true", "let numA: number = 1", "let target: boolean = false"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset target = @f";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const options = result!.options;
      expect(options.some((option) => option.label === "flagA")).toBe(true);
      expect(options.some((option) => option.label === "numA")).toBe(false);
    });
  });

  describe("fail-closed behavior", () => {
    it("returns no candidates when there is no BindingAnalysis to resolve against", async () => {
      const source = "set foo = 1";
      const state = EditorState.create({ doc: source });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => undefined,
        typedDeclarationRanges: () => new Map(),
        scopeBodyRanges: () => []
      });
      const pos = source.indexOf("foo") + 2;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });

    it("returns no RHS candidates when the currently-typed target name does not resolve to any visible let", async () => {
      const committedSource = ["nui 3", "let a: number = 1"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committed = rangesFor(compiled, committedSource);
      const insertion = "\nset bogus = ";
      const dirtySource = committedSource + insertion;
      const changes = ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length);
      const ranges = dirtyRanges(committed, changes);
      const state = EditorState.create({ doc: dirtySource });
      const pos = dirtySource.length;
      const result = await Promise.resolve(completionSourceFor(compiled, ranges)({ state, pos, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });
  });
});
