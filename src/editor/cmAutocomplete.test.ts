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
    ids: new Map([...compiled.statementMap!.byElementId].map(([elementId, statement]) => [statement.line, elementId])),
    statementRanges: createStatementRangeIndex(doc, compiled.statementMap!),
  };
};

describe("createDslCompletionSource", () => {
  it("suppresses completion while the existing editor composition guard is active", () => {
    const state = EditorState.create({ doc: "poi" });
    const source = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      isComposing: () => true,
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
      isComposing: () => false,
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

  it("offers unused number type settings with key-and-colon insertion", async () => {
    const source = "let width: number(step: 5, m";
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(),
      isComposing: () => false, computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined, typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
    });

    const result = await Promise.resolve(completionSource({ state, pos: source.length, explicit: true } as never));
    expect(result).toMatchObject({ from: source.length - 1, to: source.length });
    expect(result?.options).toEqual([
      expect.objectContaining({ label: "min", apply: "min: ", type: "property" }),
      expect.objectContaining({ label: "max", apply: "max: ", type: "property" })
    ]);
  });

  it("offers declaration type names for an incomplete type annotation and inserts choice()", async () => {
    const source = "const x: cho";
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(),
      isComposing: () => false, computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
      bindingAnalysis: () => undefined, typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [],
      statementInfoByElementId: () => undefined,
    });

    const result = await Promise.resolve(completionSource({ state, pos: source.length, explicit: false } as never));
    expect(result).toMatchObject({ from: source.indexOf("cho"), to: source.length });
    expect(result?.options.map((option) => option.label)).toEqual(["number", "string", "boolean", "choice"]);
    if (!result || result.from === undefined || result.to === undefined) {
      throw new Error("declaration type completion must include a replacement range");
    }

    const choice = result?.options.find((option) => option.label === "choice");
    expect(typeof choice?.apply).toBe("function");
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: source.length } }) });
    if (typeof choice?.apply !== "function") throw new Error("choice completion must have a custom apply");
    choice.apply(view, choice, result.from, result.to);
    expect(view.state.doc.toString()).toBe("const x: choice()");
    expect(view.state.selection.main.head).toBe("const x: choice(".length);
    view.destroy();
  });

  it("offers registry construction candidates in an incomplete element header", async () => {
    const source = "point P = co";
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(),
      isComposing: () => false, computedGeometry: () => undefined,
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
    const source = ["point P = offset(", "  from: @A", "  d", ")"].join("\n");
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      elements: () => [], statementRanges: () => new Map(),
      isComposing: () => false, computedGeometry: () => undefined,
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
      "dx", "dy", "state", "color", "steps"
    ]);
    expect(result?.options.every((option) => typeof option.apply === "string" && option.apply.endsWith(": "))).toBe(true);
  });

  it("passes only the shared ranked top eight to CodeMirror without re-filtering", async () => {
    const pointElements: DslDocumentData["elements"] = Array.from({ length: 10 }, (_, index) => ({
      id: `p${index}`, name: `P${index}`, type: "freePoint", activity: "visible", x: index, y: 0
    }));
    // 末尾のLは意図的にダングリング参照"P"(P0..P9とは別)から始まる — ユーザーが
    // "P"まで入力し、続く候補一覧をトリガーした状態を再現する。
    const source = dslTextForElements([
      ...pointElements,
      { id: "l", name: "L", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "P" }, endPoint: { mode: "reference", pointId: "p0" } }
    ]);
    const { elements, statementRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const pos = source.indexOf("start: @P") + "start: @P".length;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      isComposing: () => false,
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
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
      { id: "first", name: "First", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "second", name: "Second", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      // "Sec"は入力途中のダングリングトークン(Secondの先頭一致)。
      { id: "o", name: "O", type: "offsetLine", activity: "visible", baseLineIds: ["first", "Sec"], offset: 4, side: "left", closed: false }
    ]);
    const { elements, statementRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const tokenStart = source.lastIndexOf("@Sec");
    const pos = tokenStart + 4;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      isComposing: () => false,
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
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
      { id: "first", name: "First", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "second", name: "Second", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      // "Fir"は入力途中のダングリングトークン(Firstの先頭一致)。
      { id: "o", name: "O", type: "offsetLine", activity: "visible", baseLineIds: ["first", "Fir"], offset: 4, side: "left", closed: false }
    ]);
    const { elements, statementRanges } = identities(source);
    const state = EditorState.create({ doc: source });
    const tokenStart = source.lastIndexOf("Fir");
    const pos = tokenStart + 3;
    const completionSource = createDslCompletionSource({
      elements: () => elements,
      statementRanges: () => statementRanges,
      isComposing: () => false,
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

  it("offers @name typed-binding completions for a number-kind field with a live @ prefix", async () => {
    // fromは未定義"A"へのダングリング参照(この文の意味自体はテスト対象外)。
    const source = ["nui 4", "const Width: number = 10", "point P = offset(from: @A, dx: 10+@Wi, dy: 0)"].join("\n");
    // "@Wi" is a deliberately partial (still-being-typed) reference - compile a
    // same-shape baseline with it removed so compileDslDocument doesn't treat
    // this mid-keystroke text as a genuinely unresolved, document-fatal typed
    // binding reference. Only `state`/`pos` below use the real dirty text,
    // mirroring how production completion resolves against the store's
    // last-good bindingAnalysis while the live buffer is still dirty.
    const compileSource = ["nui 4", "const Width: number = 10", "point P = offset(from: @A, dx: 10, dy: 0)"].join("\n");
    const statements = parseDsl(compileSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(compileSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const state = EditorState.create({ doc: source });
    const ranges = createStatementRangeIndex(state.doc, compiled.statementMap!);
    const typedRanges = createTypedDeclarationRangeIndex(state.doc, compiled.statementMap!);
    const scopeRanges = createScopeBodyRangeIndex(state.doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex);
    const pos = source.indexOf("@Wi") + 3;
    const completionSource = createDslCompletionSource({
      elements: () => compiled.document!.elements,
      statementRanges: () => ranges,
      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => typedRanges,
      scopeBodyRanges: () => scopeRanges,
      statementInfoByElementId: () => compiled.statementMap!.byElementId,
    });
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    const options = result!.options;
    expect(options.some((option) => option.label === "@Width")).toBe(true);
    expect(options.find((option) => option.label === "@Width")?.apply).toBe("@Width");
  });

  it("resolves attribute + @variable completion on a multi-line vertical-call continuation via the statement's logical projection", async () => {
    const source = ["nui 4", "const Width: number = 10", "point P = offset(", "  from: @A,", "  dx: 10+@Wi,", "  dy: 0", ")"].join("\n");
    // See the previous test's comment: "@Wi" is deliberately partial, so
    // compile a same-shape (same line count) baseline with it removed.
    const compileSource = ["nui 4", "const Width: number = 10", "point P = offset(", "  from: @A,", "  dx: 10,", "  dy: 0", ")"].join("\n");
    const statements = parseDsl(compileSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(compileSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const state = EditorState.create({ doc: source });
    const ranges = createStatementRangeIndex(state.doc, compiled.statementMap!);
    const typedRanges = createTypedDeclarationRangeIndex(state.doc, compiled.statementMap!);
    const scopeRanges = createScopeBodyRangeIndex(state.doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex);
    const pos = source.indexOf("@Wi") + "@Wi".length;
    const completionSource = createDslCompletionSource({
      elements: () => compiled.document!.elements,
      statementRanges: () => ranges,
      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => typedRanges,
      scopeBodyRanges: () => scopeRanges,
      statementInfoByElementId: () => compiled.statementMap!.byElementId,
    });
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result).not.toBeNull();
    const options = result!.options;
    expect(options.some((option) => option.label === "@Width")).toBe(true);
    expect(options.find((option) => option.label === "@Width")?.apply).toBe("@Width");
    // from/to must be projected back onto the physical continuation line: applying
    // the replacement at [from, to) should reproduce exactly "@Wi" -> "@Width",
    // never a shifted or logical-space offset.
    const applied = source.slice(0, result!.from) + "@Width" + source.slice(result!.to);
    expect(applied).toBe(source.replace("@Wi", "@Width"));
  });

  it("falls back to the physical line as a whole unit when the cursor has no enclosing logical statement (blank line)", async () => {
    const pointLines = dslLinesForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ]);
    const source = ["nui 1", "", ...pointLines].join("\n");
    const state = EditorState.create({ doc: source });
    const pos = state.doc.line(2).from;
    const completionSource = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      isComposing: () => false,
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
    // P's construction call always spans multiple physical rows in the
    // canonical vertical layout, so the lens text below is the joined
    // logical statement rather than a single physical row.
    const bodySource = ["point P = offset(", "  from: @A,", "  dx: 10+@Wi,", "  dy: 0", ")"].join("\n");
    const source = ["nui 4", "const Width: number = 10", bodySource].join("\n");
    // "@Wi" is deliberately partial (still-being-typed) - compile a same-shape
    // baseline with it removed so compileDslDocument doesn't treat this
    // mid-keystroke text as a genuinely unresolved, document-fatal reference.
    // `mainState`/the lens below still carry the real dirty "@Wi" text.
    const compileBodySource = ["point P = offset(", "  from: @A,", "  dx: 10,", "  dy: 0", ")"].join("\n");
    const compileSource = ["nui 4", "const Width: number = 10", compileBodySource].join("\n");
    const statements = parseDsl(compileSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(compileSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const mainState = EditorState.create({ doc: source });
    const ranges = createStatementRangeIndex(mainState.doc, compiled.statementMap!);
    const typedRanges = createTypedDeclarationRangeIndex(mainState.doc, compiled.statementMap!);
    const scopeRanges = createScopeBodyRangeIndex(mainState.doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex);
    // The lens mirrors the whole statement's logical (row-joined) projection at
    // its own buffer offset 0 — a different EditorState than the main document,
    // proving the documentInput override, not the CompletionContext's own
    // state, drives candidate lookup.
    const lensLineText = "point P = offset( from: @A, dx: 10+@Wi, dy: 0 )";
    const lensPos = lensLineText.indexOf("@Wi") + "@Wi".length;
    const lensState = EditorState.create({ doc: lensLineText });
    const completionSource = createDslCompletionSource({
      elements: () => compiled.document!.elements,
      statementRanges: () => ranges,
      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => undefined,
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => typedRanges,
      scopeBodyRanges: () => scopeRanges,
      statementInfoByElementId: () => compiled.statementMap!.byElementId,
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

  describe("elementParameter (ElementName.parameterKey) completion", () => {
    const buildSource = (dotSuffix: string) => dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
      { id: "ab", name: "直線AB", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "p", name: "P", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "a" }, dx: { kind: "expression", expression: `@直線AB.${dotSuffix}` }, dy: 0 }
    ]);

    const setup = () => {
      const source = buildSource("");
      const { elements, statementRanges } = identities(source);
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

        isComposing: () => false,
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
      expect(result!.options.every((option) => option.type === "constant")).toBe(true);
    });

    it("spans only the member token (from/to exclude the ElementName. prefix)", async () => {
      const source = buildSource("le");
      const { elements, statementRanges } = identities(source);

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

        isComposing: () => false,
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
      const { elements, statementRanges } = identities(source);

      const abId = elements.find((element) => element.type === "line")!.id;
      const state = EditorState.create({ doc: source });
      const pos = source.indexOf("直線AB.") + "直線AB.".length;
      const completionSource = createDslCompletionSource({
        elements: () => elements,
        statementRanges: () => statementRanges,
        isComposing: () => true,
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

    it("shows a real, visible completion tooltip from natural (non-explicit) typing through a live EditorView, && keeps narrowing it", async () => {
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
      const { elements, statementRanges } = identities(source);

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

              isComposing: () => false,
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

    it("Task 51 checklist: @ offers the typed binding, @Element. offers the property, both narrow && apply correctly in one live session", async () => {
      // The exact acceptance scenario from the Task 51 migration: a plain
      // numeric attribute must offer BOTH a typed const/let binding (@length)
      // and an element-property reference (@AB.length) - through the real
      // dslAutocompleteExtension wiring, in one EditorView session, with the
      // same name ("length") shared by the binding and the property so a
      // regression that conflates the two would be caught here.
      const source = [
        "nui 4",
        "const length: number = 12.3456",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "point C = coordinate(x: 0, y: 0)"
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
              isComposing: () => false,
              computedGeometry: () => computedGeometry,
              effectiveEnabledElementIds: () => new Set([abId]),
              evaluationErrors: () => [],
              bindingAnalysis: () => compiled.bindingAnalysis,
              typedDeclarationRanges: () => createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
              scopeBodyRanges: () => createScopeBodyRangeIndex(doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex),
              statementInfoByElementId: () => compiled.statementMap!.byElementId,
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

    it("Task 51 checklist item 7: bare Element. offers no candidates in a nui 4 document", async () => {
      const source = [
        "nui 4",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "point C = coordinate(x: 0, y: 0)"
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

              isComposing: () => false,
              computedGeometry: () => new Map(),
              effectiveEnabledElementIds: () => new Set([abId]),
              evaluationErrors: () => [],
              bindingAnalysis: () => undefined,
              typedDeclarationRanges: () => new Map(),
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => compiled.statementMap!.byElementId,
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

describe("choice value completion at a zero-length value (Task 51 manual E2E rerun)", () => {
  it("offers only the choice's own candidates, in declared order, right after a real delete lands the cursor mid-gap, and narrows/applies correctly", async () => {
    // Real repro: an `offset` line's `side: right` value is selected &&
    // deleted (not typed character-by-character down to empty), which is
    // exactly the shape that exposed the bug - the resulting value gap before
    // the required comma is wider than one separating space, &&
    // a real EditorView delete transaction leaves the cursor right where the
    // deleted text used to start: inside that gap, not at its far edge
    // (where dslArgScanner's trimSpan collapses the empty valueSpan to).
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
        "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 3, side: right, closed: false)"
    ].join("\n");
    const { elements, statementRanges } = identities(source);
    const abId = elements.find((element) => element.type === "line" && element.name === "AB")!.id;
    const parent = document.createElement("div");
    document.body.append(parent);

    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          dslAutocompleteExtension({
            elements: () => elements,
            statementRanges: () => statementRanges,

            isComposing: () => false,
            computedGeometry: () => new Map(),
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

    const rightStart = source.indexOf("right");
    const rightEnd = rightStart + "right".length;
    view.dispatch({
      changes: { from: rightStart, to: rightEnd },
      selection: { anchor: rightStart },
      annotations: Transaction.userEvent.of("delete.selection")
    });
    // The delete transaction itself lands the cursor exactly where "right"
    // used to start - inside the two-space gap left behind, one character
    // past the gap's own start (right after the colon). This is the cursor
    // position the real regression depends on.
    expect(view.state.doc.toString().slice(rightStart - 6, rightStart + 9)).toBe("side: , closed:");
    expect(view.state.selection.main.head).toBe(rightStart);

    startCompletion(view);
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    const emptyLabels = currentCompletions(view.state).map((option) => option.label);
    expect(emptyLabels).toEqual(["right", "left"]);
    for (const generic of ["color", "enable", "state", "steps", "visible"]) {
      expect(emptyLabels).not.toContain(generic);
    }

    // Typing "r" narrows to "right" only.
    view.dispatch({
      changes: { from: rightStart, insert: "r" },
      selection: { anchor: rightStart + 1 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["right"]);

    // Clear back to empty, then typing "l" narrows to "left" only.
    view.dispatch({
      changes: { from: rightStart, to: rightStart + 1 },
      selection: { anchor: rightStart },
      annotations: Transaction.userEvent.of("delete.selection")
    });
    startCompletion(view);
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    view.dispatch({
      changes: { from: rightStart, insert: "l" },
      selection: { anchor: rightStart + 1 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["left"]);

    const leftOption = currentCompletions(view.state).find((option) => option.label === "left")!;
    view.dispatch({
      changes: { from: rightStart, to: rightStart + 1, insert: typeof leftOption.apply === "string" ? leftOption.apply : "left" }
    });
    const applied = view.state.doc.toString();
    expect(applied).toBe(
      "nui 4\n" +
      "point A = coordinate(x: 0, y: 0)\n" +
      "point B = coordinate(x: 10, y: 0)\n" +
      "line AB = segment(start: @A, end: @B)\n" +
      "line Off = offset(sources: [@AB], distance: 3, side: left, closed: false)"
    );
    expect(parseDsl(applied).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    view.destroy();
    parent.remove();
  });

  it("does not regress @length / @AB.length numeric-attribute completion (kept alongside the choice fix as a boundary check)", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point C = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { elements, statementRanges } = identities(source);

    const abId = elements.find((element) => element.type === "line" && element.name === "AB")!.id;
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
    const xInsertPos = source.indexOf("point C") + "point C = coordinate(x: ".length;

    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: EditorSelection.cursor(xInsertPos),
        extensions: [
          dslAutocompleteExtension({
            elements: () => elements,
            statementRanges: () => statementRanges,
            isComposing: () => false,
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

    view.dispatch({
      changes: { from: xInsertPos, insert: "@AB." },
      selection: { anchor: xInsertPos + 4 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toContain("length");

    view.destroy();
    parent.remove();
  });
});

describe("typed value completion (Task 39)", () => {
  it("offers builtin functions inside a typed if condition", async () => {
    const source = ["nui 4", "if (isClose(1, 1, 0)) {", "}"].join("\n");
    const compiled = compiledTyped(source);
    const state = EditorState.create({ doc: source });
    const completionSource = createDslCompletionSource({
      ...baseOptions(),
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => new Map(),
      scopeBodyRanges: () => [],
      statementInfoByElementId: () => compiled.statementMap!.byElementId
    });
    const pos = source.indexOf("isClose") + 2;
    const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "isClose",
        apply: "isClose(",
        detail: "isClose(number, number, number) -> boolean",
        type: "function"
      })
    ]));
  });

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

    isComposing: () => false,
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
    it("shows all builtin overload signatures in the completion detail", async () => {
      const source = ["nui 4", "const value: number = round(1)"].join("\n");
      const compiled = compiledTyped(source);
      const doc = EditorState.create({ doc: source }).doc;
      const state = EditorState.create({ doc: source });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = source.indexOf("round") + 2;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: "round",
          detail: "round(number) -> number | round(number, number) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "sin",
          apply: "sin(",
          detail: "sin(number) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "atan2",
          apply: "atan2(",
          detail: "atan2(number, number) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "spreadAngle",
          apply: "spreadAngle(",
          detail: "spreadAngle(length: number, spread: number) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "distance",
          apply: "distance(",
          detail: "distance(point, point) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "angle",
          apply: "angle(",
          detail: "angle(point, point) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "lineDistance",
          apply: "lineDistance(",
          detail: "lineDistance(point, line) -> number",
          type: "function"
        }),
        expect.objectContaining({
          label: "lineAngle",
          apply: "lineAngle(",
          detail: "lineAngle(line, line) -> number",
          type: "function"
        })
      ]));
    });

    it("offers production spreadAngle named arguments through the generic completion mapping", async () => {
      const source = [
        "nui 4",
        "const value: number = spreadAngle(",
        "  length: 100,",
        "  spread: 20",
        ")"
      ].join("\n");
      const compiled = compiledTyped(source);
      const doc = EditorState.create({ doc: source }).doc;
      const state = EditorState.create({ doc: source });
      const completionSource = createDslCompletionSource({
        ...baseOptions(),
        bindingAnalysis: () => compiled.bindingAnalysis,
        typedDeclarationRanges: () => createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = source.indexOf("length") + "length".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: "length", apply: "length: " }),
        expect.objectContaining({ label: "spread", apply: "spread: " })
      ]));
    });

    it("offers boolean literal and unary ! candidates at a clean operand start", async () => {
      // Committed/compiled from a complete, valid initializer; the actual
      // completion query happens against a separate dirty state with nothing
      // yet typed after "=" (an empty initializer would itself be a parse
      // error, so it can never be what compiledTyped compiles).
      const committedSource = ["nui 4", "const flag: boolean = true"].join("\n");
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
      expect(labels).toContain("isClose");
      expect(result!.options.some((option) => option.label === "isClose" && option.type === "function" && option.apply === "isClose(")).toBe(true);
      expect(await Promise.resolve(completionSource({ state, pos, explicit: false } as never))).toBeNull();
    });

    it("offers @name reference candidates filtered to the declared type", async () => {
      // Committed/compiled from a fully-resolved reference ("@f" alone would
      // be an unresolved-reference compile error); the in-progress "@f"
      // partial only exists in a separate dirty live state.
      const committedSource = ["nui 4", "const flagA: boolean = true", "const numA: number = 1", "const target: boolean = @flagA"].join("\n");
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
      expect(options.every((option) => option.type === "constant")).toBe(true);
    });

    it("automatically opens completion after a Shift+2 DOM input inserts @ in a brand-new number declaration", async () => {
      const committedSource = [
        "nui 4",
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
        "nui 4",
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
      const committedSource = ["nui 4", "const length: number = 12.3456"].join("\n");
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
                "nui 4",
                "point A = coordinate(x: 0, y: 0)",
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
        "nui 4",
        "const length: number = 1",
        "if (true) {",
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
      const source = ["nui 4", "const flagA: boolean = true", "const target: boolean = @flagA "].join("\n");
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
      expect(result!.options.map((option) => option.label)).toEqual([" and ", " or ", "==", "!="]);
      expect(result!.options.every((option) => option.type === "keyword")).toBe(true);
    });

    it("keeps completing through a dirty edit made after the last compile, before any recompile settles", async () => {
      // Committed/compiled state: a valid document.
      const committedSource = ["nui 4", "const flagA: boolean = true", "const target: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);

      // Dirty live ,buffer: several more characters typed into target's
      // initializer since that last compile - no recompile has run yet.
      const insertion = "  and  @fla";
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
      const committedSource = ["nui 4", "const target: boolean = true"].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const committedRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
      // The declaration keyword itself is edited away (no longer "const"),
      // so a fresh reparse of the live line no longer sees a typed
      // declaration at all - a structural edit fail-closed guard, not a
      // range-index invalidation.
      const dirtySource = ["nui 4", "notconst target: boolean = true"].join("\n");
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
      const source = ["nui 4", "const target: boolean = true"].join("\n");
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
        bindingAnalysis: () => compiledTyped(["nui 4", "point A = coordinate(x: 0, y: 0)", "const other: number = 1"].join("\n")).bindingAnalysis,
        typedDeclarationRanges: () => staleRanges,
        scopeBodyRanges: () => [],
        statementInfoByElementId: () => compiled.statementMap!.byElementId
      });
      const pos = source.length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result?.options ?? []).toEqual([]);
    });

    it("fails closed for a brand-new declaration when no mapped live binding matches stale metadata", async () => {
      const committedSource = ["nui 4", "const length: number = 1"].join("\n");
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
        bindingAnalysis: () => compiledTyped(["nui 4", "const unrelated: number = 1"].join("\n")).bindingAnalysis,
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
      const committedSource = ["nui 4", "const greeting: string = \"hi\"", "text T = label(text: @greeting, anchor: none, size: 3)"].join("\n");
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
      expect(options.every((option) => option.type === "constant")).toBe(true);
    });

  });

  describe("template hole", () => {
    it("offers string/number @name candidates inside an in-progress hole, excludes boolean/choice", async () => {
      // The compiled/committed document must be a *complete, valid* nui 4
      // document - so the in-progress hole only ever exists in a separate,
      // dirty live EditorState, never in the text `compiledTyped` itself
      // compiles. The dirty string's outer quotes stay properly closed
      // (`"${@"`, cursor placed right after "@", before the closing quote) so
      // the surrounding statement/attribute parse stays intact - Task 26's
      // scanTextTemplateLiteral is what actually detects the hole as open,
      // by being bounded at the cursor rather than at the real closing quote
      // (see dslTemplateHoleCompletionContext.ts) - a genuinely unterminated
      // string would instead break the whole statement's parse, which is not
      // what this test is exercising.
      const committedSource = [
        "nui 4",
        "const greeting: string = \"hi\"",
        "const count: number = 1",
        "const flag: boolean = true",
        'text T = label(text: "placeholder", anchor: none, size: 3)'
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const dirtySource = committedSource.replace('"placeholder"', '"${@"');
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
      const pos = dirtySource.indexOf("${@") + "${@".length;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      expect(result).not.toBeNull();
      const labels = result!.options.map((option) => option.label);
      expect(labels).toContain("greeting");
      expect(labels).toContain("count");
      expect(labels).not.toContain("flag");
    });

    it("offers typed candidates in a template hole on a brand-new element", async () => {
      const committedSource = [
        "nui 4",
        "const greeting: string = \"hi\"",
        "const count: number = 1",
        "const flag: boolean = true",
        "const side: choice(right, left) = left"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = '\ntext T = label(text: "${@", anchor: none, size: 3)';
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
      const pos = dirtySource.indexOf("${@") + 2;
      const result = await Promise.resolve(completionSource({ state, pos, explicit: true } as never));
      const labels = result?.options.map((option) => option.label) ?? [];
      expect(labels).toEqual(expect.arrayContaining(["greeting", "count"]));
      expect(labels).not.toContain("flag");
      expect(labels).not.toContain("side");
    });

    it("Task 51 manual-E2E rerun: natural '{' then '@' through a live EditorView with no closing quote/paren still opens the popup with only string/number candidates", async () => {
      // Regression for the actual Tauri repro (51-manual-e2e-checklist.md
      // Scenario 4 step 4): every other template-hole test above keeps the
      // *outer string quote* closed (`"${@"`) so only the hole itself is
      // in-progress. Here neither the string nor the call `(...)` is ever
      // closed - exactly what natural typing at the end of the buffer looks
      // like before dslCallParser.ts's UNCLOSED_CALL_CODE fix,
      // parseDslCallStatement discarded the whole statement
      // (`statement: null`) once its closing `)` search failed, so
      // dslCompletionContextAt never reached the templateHole branch at all
      // && no popup opened - through the real dslAutocompleteExtension/
      // EditorView wiring, not a direct completionSource call.
      const committedSource = [
        "nui 4",
        "const label: string = \"hi\"",
        "const length: number = 1",
        "const printed: boolean = true",
        "const side: choice(right, left) = left"
      ].join("\n");
      const compiled = compiledTyped(committedSource);
      const committedDoc = EditorState.create({ doc: committedSource }).doc;
      const insertion = '\ntext T = label(text: "';
      const dirtySource = committedSource + insertion;
      const ranges = mapTypedDeclarationRangeIndex(
        createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
        ChangeSet.of({ from: committedSource.length, insert: insertion }, committedSource.length)
      );
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        state: EditorState.create({
          doc: dirtySource,
          selection: EditorSelection.cursor(dirtySource.length),
          extensions: [
            dslAutocompleteExtension({
              ...baseOptions(),
              elements: () => compiled.document!.elements,
              statementRanges: () => createStatementRangeIndex(EditorState.create({ doc: dirtySource }).doc, compiled.statementMap!),
              bindingAnalysis: () => compiled.bindingAnalysis,
              typedDeclarationRanges: () => ranges,
              scopeBodyRanges: () => [],
              statementInfoByElementId: () => compiled.statementMap!.byElementId
            })
          ]
        }),
        parent
      });

      expect(completionStatus(view.state)).toBeNull();

      // Two real typed keystrokes, "${" then "@" - never a closing quote ||
      // paren, matching the exact end-of-buffer natural-input repro.
      const openBrace = dirtySource.length;
      view.dispatch({
        changes: { from: openBrace, insert: "${" },
        selection: { anchor: openBrace + 2 },
        annotations: Transaction.userEvent.of("input.type")
      });
      view.dispatch({
        changes: { from: openBrace + 2, insert: "@" },
        selection: { anchor: openBrace + 3 },
        annotations: Transaction.userEvent.of("input.type")
      });

      await expect.poll(() => view.state.doc.toString().slice(openBrace, openBrace + 3), { timeout: 1000, interval: 20 }).toBe("${@");
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      expect(parent.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
      const labels = currentCompletions(view.state).map((option) => option.label);
      expect(labels).toContain("label");
      expect(labels).toContain("length");
      expect(labels).not.toContain("printed");
      expect(labels).not.toContain("side");

      startCompletion(view);
      await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
      const option = currentCompletions(view.state).find((candidate) => candidate.label === "length")!;
      // apply ("@length") already carries the "@" the user typed, replacing
      // the whole "@" token rather than being appended after it.
      view.dispatch({
        changes: { from: openBrace + 2, to: openBrace + 3, insert: typeof option.apply === "string" ? option.apply : "@length" }
      });
      expect(view.state.doc.toString().slice(openBrace, openBrace + "${@length".length)).toBe("${@length");

      view.destroy();
      parent.remove();
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

          isComposing,
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

  it("opens explicitly with Mod+Shift+Space", async () => {
    const { parent, view } = createView(() => false);

    // In the Vitest browser harness Mod maps to Ctrl; CodeMirror maps the same
    // binding to Command on macOS, where the desktop app is supported.
    expect(fireEvent.keyDown(view.contentDOM, {
      key: " ",
      code: "Space",
      ctrlKey: true,
      shiftKey: true
    })).toBe(false);
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");

    view.destroy();
    parent.remove();
  });

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
      { key: " ", code: "Space", ctrlKey: true, shiftKey: true },
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
    const source = ["nui 4", "const GlobalWidth: number = 100", "let Copy: number = @Gl"].join("\n");
    const statements = parseDsl(source).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(source, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const parent = document.createElement("div");
    document.body.append(parent);
    const docState = EditorState.create({ doc: source });
    const statementRanges = createStatementRangeIndex(docState.doc, compiled.statementMap!);
    const typedRanges = createTypedDeclarationRangeIndex(docState.doc, compiled.statementMap!);
    const scopeRanges = createScopeBodyRangeIndex(docState.doc, compiled.statementMap!, compiled.bindingAnalysis!.catalog.scopeIndex);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: EditorSelection.cursor(source.length),
        extensions: dslAutocompleteExtension({
          elements: () => compiled.document!.elements,
          statementRanges: () => statementRanges,

          isComposing: () => false,
          computedGeometry: () => undefined,
          effectiveEnabledElementIds: () => undefined,
          evaluationErrors: () => undefined,
          bindingAnalysis: () => compiled.bindingAnalysis,
          typedDeclarationRanges: () => typedRanges,
          scopeBodyRanges: () => scopeRanges,
          statementInfoByElementId: () => compiled.statementMap!.byElementId,
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

    isComposing: () => false,
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
    it("offers every visible let, excluding const, for a brand-new uncommitted \"set \" line in a clean document", async () => {
      const committedSource = ["nui 4", "let a: number = 1", "const c: number = 2"].join("\n");
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
      // A set target is a bare identifier, never "@"-prefixed.
      expect(result!.options.every((option) => option.apply === option.label)).toBe(true);
    });

    it("keeps target candidates available even while the currently-typed target name is itself unresolved", async () => {
      const committedSource = ["nui 4", "let a: number = 1"].join("\n");
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
        "nui 4",
        "let outer: number = 1",
        "if (true) {",
        "  for i in range(from: 0, count: 2) {",
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
      const committedSource = ["nui 4", "let flag: boolean = true"].join("\n");
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
      const committedSource = ["nui 4", "let a: number = 1", "let target: number = 2"].join("\n");
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
      const committedSource = ["nui 4", "let flagA: boolean = true", "let numA: number = 1", "let target: boolean = false"].join("\n");
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
      const committedSource = ["nui 4", "let a: number = 1"].join("\n");
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

describe("set target completion via natural typing (Task 51 manual E2E rerun)", () => {
  it("opens from a real Space keystroke that first closes the keyword popup via the Space keymap, then re-triggers from the actual space insertion", async () => {
    // Regression coverage for a real manual E2E report: typing "set " (0
    // characters typed after the space) inside a nested if/else scope never
    // opened the target-name popup. Every existing "set target/rhs
    // completion (Task 40)" test above calls createDslCompletionSource
    // directly with explicit: true, which can't distinguish an
    // implicit-typing gate bug from a working completion source (same class
    // of gap as the `64f473c` elementParameter regression documented above
    // at "shows a real, visible completion tooltip..."). Space adds one more
    // wrinkle beyond that precedent: it is the one character here
    // intercepted by dslAutocompleteExtension's own Prec.highest "Space"
    // keymap (dismissCompletionForSpace) before any character is inserted,
    // so a test that skips straight to dispatching the post-insertion
    // transaction would never actually exercise that keymap path. This test
    // drives the real two-step sequence instead: a genuine DOM keydown for
    // Space (running the actual keymap command, which closes the open
    // keyword popup && returns false), then the separate input.type
    // transaction that stands in for the browser's own character insertion.
    const committedSource = [
      "nui 4",
      "let flag: boolean = true",
      "let total: number = 0",
      "let show: boolean = false",
      "const limit: number = 10",
      "if (@flag) {",
      "} else {",
      "",
      "}"
    ].join("\n");
    const statements = parseDsl(committedSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(committedSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const committedDoc = EditorState.create({ doc: committedSource }).doc;
    let liveTypedDeclarationRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
    let liveScopeBodyRanges = compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [];

    const insertPos = committedDoc.line(8).from; // the blank line inside the else block
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: committedSource,
        selection: EditorSelection.cursor(insertPos),
        extensions: [
          dslAutocompleteExtension({
            elements: () => [],
            statementRanges: () => new Map(),

            isComposing: () => false,
            computedGeometry: () => undefined,
            effectiveEnabledElementIds: () => undefined,
            evaluationErrors: () => undefined,
            bindingAnalysis: () => compiled.bindingAnalysis,
            typedDeclarationRanges: () => liveTypedDeclarationRanges,
            scopeBodyRanges: () => liveScopeBodyRanges,
            statementInfoByElementId: () => undefined
          }),
          // Mirrors sourceEditorController.ts's own handleViewUpdate: every
          // doc-changing transaction incrementally maps the live Tier B
          // indices forward, never rebuilding them from a fresh compile.
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            liveTypedDeclarationRanges = mapTypedDeclarationRangeIndex(liveTypedDeclarationRanges, update.changes);
            liveScopeBodyRanges = mapScopeBodyRangeIndex(liveScopeBodyRanges, update.changes);
          })
        ]
      }),
      parent
    });

    // Natural typing: "set" first - no custom keymap intercepts ordinary
    // letters, so a direct input.type dispatch is faithful here (matching
    // the existing elementParameter regression test's own convention).
    view.dispatch({
      changes: { from: insertPos, insert: "set" },
      selection: { anchor: insertPos + 3 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toContain("set");

    // The real Space keystroke: a genuine DOM KeyboardEvent, so
    // dslAutocompleteExtension's own Prec.highest "Space" keymap command
    // (dismissCompletionForSpace) actually runs && closes the keyword
    // popup - not a hand-built transaction that bypasses the keymap layer.
    const notPrevented = fireEvent.keyDown(view.contentDOM, { key: " ", code: "Space" });
    expect(notPrevented).toBe(true); // the command returned false: it never consumes Space itself.
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBeNull();

    // The keymap command deliberately left Space unconsumed so "CodeMirror/
    // the browser" can insert it - jsdom has no native contentEditable
    // insertion pipeline to fall through to here, so the actual space
    // character is dispatched next as its own separate input.type
    // transaction, exactly mirroring what CodeMirror's real DOM
    // input-observer would produce once a real browser inserts it.
    view.dispatch({
      changes: { from: insertPos + 3, insert: " " },
      selection: { anchor: insertPos + 4 },
      annotations: Transaction.userEvent.of("input.type")
    });

    // No further input: the setTarget popup must reopen on its own.
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(1);
    const labels = currentCompletions(view.state).map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining(["flag", "total", "show"]));
    expect(labels).not.toContain("limit");
    expect(currentCompletions(view.state).every((option) => option.apply === option.label)).toBe(true);

    // Narrows correctly as more of the target name is typed.
    const afterSpacePos = insertPos + 4;
    view.dispatch({
      changes: { from: afterSpacePos, insert: "t" },
      selection: { anchor: afterSpacePos + 1 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(
      () => (completionStatus(view.state) === "active" ? currentCompletions(view.state).map((option) => option.label).join(",") : null),
      { timeout: 1000, interval: 20 }
    ).toBe("total");

    view.destroy();
    parent.remove();
  });
});

describe("set target completion after a real delete transaction (Task 51 manual E2E rerun)", () => {
  // The actual manual repro was never character-by-character typing into a
  // blank line: an existing "set total = 99" line was duplicated, then the
  // duplicate's "total = 99" was selected && deleted, landing the cursor at
  // "set |" via a delete transaction - never an input.type one. CodeMirror's
  // own autocomplete update-type classification (getUpdateType,
  // node_modules/@codemirror/autocomplete/dist/index.js) only ever sets its
  // Activate bit for an "input.type"-tagged transaction (or, when a result is
  // already open, narrows/survives a "delete.backward" one) - a plain delete
  // landing on a previously-inactive completion state never schedules a new
  // query on its own. This file already encodes that exact limitation for a
  // different context: the "choice value completion at a zero-length value"
  // test above deletes "right" down to empty and then has to call
  // startCompletion(view) explicitly - CM does not reopen it by itself.
  const buildDeleteRepro = () => {
    const committedSource = [
      "nui 4",
      "let flag: boolean = true",
      "let total: number = 0",
      "let show: boolean = false",
      "const limit: number = 10",
      "if (@flag) {",
      "} else {",
      "  set total = 99",
      "  set total = 99",
      "}"
    ].join("\n");
    const statements = parseDsl(committedSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(committedSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const committedDoc = EditorState.create({ doc: committedSource }).doc;
    let liveTypedDeclarationRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
    let liveScopeBodyRanges = compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [];

    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: committedSource,
        extensions: [
          dslAutocompleteExtension({
            elements: () => [],
            statementRanges: () => new Map(),
            isComposing: () => false,
            computedGeometry: () => undefined,
            effectiveEnabledElementIds: () => undefined,
            evaluationErrors: () => undefined,
            bindingAnalysis: () => compiled.bindingAnalysis,
            typedDeclarationRanges: () => liveTypedDeclarationRanges,
            scopeBodyRanges: () => liveScopeBodyRanges,
            statementInfoByElementId: () => undefined
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            liveTypedDeclarationRanges = mapTypedDeclarationRangeIndex(liveTypedDeclarationRanges, update.changes);
            liveScopeBodyRanges = mapScopeBodyRangeIndex(liveScopeBodyRanges, update.changes);
          })
        ]
      }),
      parent
    });

    // The second "set total = 99" is the stand-in for the duplicated line;
    // deleting its own "total = 99" leaves "  set " with the cursor right
    // after the trailing space, matching the real repro's "set |" state.
    const secondSetLine = committedSource.lastIndexOf("set total = 99");
    const deleteFrom = secondSetLine + "set ".length;
    const deleteTo = secondSetLine + "set total = 99".length;
    view.dispatch({
      changes: { from: deleteFrom, to: deleteTo },
      selection: { anchor: deleteFrom },
      annotations: Transaction.userEvent.of("delete.selection")
    });
    expect(view.state.doc.toString().slice(secondSetLine, secondSetLine + 4)).toBe("set ");
    expect(view.state.selection.main.head).toBe(deleteFrom);

    return { view, parent };
  };

  it("opens automatically after the delete, with no further input and no explicit invocation", async () => {
    const { view, parent } = buildDeleteRepro();

    // No startCompletion(view) call here on purpose: the real repro never
    // pressed Ctrl-Space, && the popup must appear on its own.
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    const labels = currentCompletions(view.state).map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining(["flag", "total", "show"]));
    expect(labels).not.toContain("limit");

    view.destroy();
    parent.remove();
  });

  it("sanity check: explicit startCompletion still resolves the correct candidates right after the same delete", async () => {
    // Isolates which layer is actually broken: if this passes while the test
    // above fails, the candidate/context computation is fine && only the
    // automatic (non-explicit) trigger needs a fix - mirrors how the
    // existing zero-length choice-value delete test above already relies on
    // an explicit startCompletion(view) call after its own delete.
    const { view, parent } = buildDeleteRepro();

    startCompletion(view);
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    const labels = currentCompletions(view.state).map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining(["flag", "total", "show"]));
    expect(labels).not.toContain("limit");

    view.destroy();
    parent.remove();
  });
});

describe("set target recovery from the current dirty source (Task 51)", () => {
  const normalCommittedSource = [
    "nui 4",
    "let flag: boolean = true",
    "let total: number = 0",
    "let show: boolean = false"
  ].join("\n");

  const completionOptions = (committedSource: string, dirtySource: string) => {
    const compiled = compileDslDocument(committedSource, {
      assignedStatementIds: new Map(parseDsl(committedSource).statements.map((_, index) => [index, `stable-${index}`]))
    });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const committedDoc = EditorState.create({ doc: committedSource }).doc;
    const dirtyDoc = EditorState.create({ doc: dirtySource }).doc;
    const changes = ChangeSet.of({ from: committedSource.length, insert: dirtySource.slice(committedSource.length) }, committedSource.length);
    const typedDeclarationRanges = mapTypedDeclarationRangeIndex(
      createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
      changes
    );
    const scopeBodyRanges = compiled.bindingAnalysis
      ? mapScopeBodyRangeIndex(
        createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex),
        changes
      )
      : [];
    const source = createDslCompletionSource({
      elements: () => compiled.document!.elements,
      statementRanges: () => new Map(),

      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => [],
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => typedDeclarationRanges,
      scopeBodyRanges: () => scopeBodyRanges,
      statementInfoByElementId: () => compiled.statementMap!.byElementId
    });
    return { source, state: EditorState.create({ doc: dirtyDoc }), compiled };
  };

  const rhsCompletionOptions = (committedType: "number" | "string", liveType: "number" | "string") => {
    const committedSource = [
      "nui 4",
      `let total: ${committedType} = ${committedType === "string" ? '"old"' : "0"}`,
      "let num: number = 1",
      "let text: string = \"text\""
    ].join("\n");
    const dirtyPrefix = committedSource.replace(`let total: ${committedType}`, `let total: ${liveType}`);
    const dirtySource = `${dirtyPrefix}\nset total = @`;
    const compiled = compileDslDocument(committedSource, {
      assignedStatementIds: new Map(parseDsl(committedSource).statements.map((_, index) => [index, `stable-${index}`]))
    });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const committedDoc = EditorState.create({ doc: committedSource }).doc;
    const typeStart = committedSource.indexOf(`let total: ${committedType}`) + "let total: ".length;
    const changes = ChangeSet.of([
      { from: typeStart, to: typeStart + committedType.length, insert: liveType },
      { from: committedSource.length, insert: "\nset total = @" }
    ], committedSource.length);
    const typedDeclarationRanges = mapTypedDeclarationRangeIndex(
      createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!),
      changes
    );
    const scopeBodyRanges = compiled.bindingAnalysis
      ? mapScopeBodyRangeIndex(
        createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex),
        changes
      )
      : [];
    const source = createDslCompletionSource({
      elements: () => compiled.document!.elements,
      statementRanges: () => new Map(),
      isComposing: () => false,
      computedGeometry: () => undefined,
      effectiveEnabledElementIds: () => undefined,
      evaluationErrors: () => [],
      bindingAnalysis: () => compiled.bindingAnalysis,
      typedDeclarationRanges: () => typedDeclarationRanges,
      scopeBodyRanges: () => scopeBodyRanges,
      statementInfoByElementId: () => compiled.statementMap!.byElementId
    });
    return { source, state: EditorState.create({ doc: dirtySource }), pos: dirtySource.length };
  };

  it("keeps Task 40 recovery for an already-committed poisoned let and normal valid lets", async () => {
    const committedSource = ["nui 4", "let broken: number = @broken"].join("\n");
    const dirtySource = `${committedSource}\nset b`;
    const { source, state } = completionOptions(committedSource, dirtySource);
    const result = await Promise.resolve(source({ state, pos: dirtySource.length, explicit: true } as never));
    expect(result?.options.map((option) => option.label)).toContain("broken");

    const normalDirtySource = `${normalCommittedSource}\nset b`;
    const normal = completionOptions(normalCommittedSource, normalDirtySource);
    const normalResult = await Promise.resolve(normal.source({ state: normal.state, pos: normalDirtySource.length, explicit: true } as never));
    expect(normalResult?.options.map((option) => option.label)).toEqual(expect.arrayContaining(["flag", "total", "show"]));
  });

  it.each([
    ["number", "string", "text", "num"],
    ["string", "number", "num", "text"]
  ] as const)("uses the reconciled live %s target type for %s RHS completion", async (committedType, liveType, expected, excluded) => {
    const { source, state, pos } = rhsCompletionOptions(committedType, liveType);
    const result = await Promise.resolve(source({ state, pos, explicit: true } as never));
    expect(result?.options.map((option) => option.label)).toContain(expected);
    expect(result?.options.map((option) => option.label)).not.toContain(excluded);
  });

  it("recovers a newly typed poisoned let during a real input.type burst and keeps it target-only", async () => {
    const dirtySource = `${normalCommittedSource}\nlet broken: number = @broken\nset b`;
    const compiled = compileDslDocument(normalCommittedSource, {
      assignedStatementIds: new Map(parseDsl(normalCommittedSource).statements.map((_, index) => [index, `stable-${index}`]))
    });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const committedDoc = EditorState.create({ doc: normalCommittedSource }).doc;
    let typedDeclarationRanges: TypedDeclarationRangeIndex = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
    let scopeBodyRanges: ScopeBodyRangeIndex = compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [];
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: normalCommittedSource,
        selection: { anchor: normalCommittedSource.length },
        extensions: [
          dslAutocompleteExtension({
            elements: () => compiled.document!.elements,
            statementRanges: () => new Map(),

            isComposing: () => false,
            computedGeometry: () => undefined,
            effectiveEnabledElementIds: () => undefined,
            evaluationErrors: () => [],
            bindingAnalysis: () => compiled.bindingAnalysis,
            typedDeclarationRanges: () => typedDeclarationRanges,
            scopeBodyRanges: () => scopeBodyRanges,
            statementInfoByElementId: () => compiled.statementMap!.byElementId
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            typedDeclarationRanges = mapTypedDeclarationRangeIndex(typedDeclarationRanges, update.changes);
            scopeBodyRanges = mapScopeBodyRangeIndex(scopeBodyRanges, update.changes);
          })
        ]
      }),
      parent
    });

    view.dispatch({
      changes: { from: normalCommittedSource.length, insert: dirtySource.slice(normalCommittedSource.length) },
      selection: { anchor: dirtySource.length },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete")).toHaveLength(1);
    const broken = currentCompletions(view.state).find((option) => option.label === "broken");
    expect(broken?.apply).toBe("broken");
    const normalTargetSource = `${normalCommittedSource}\nset `;
    const normalTarget = completionOptions(normalCommittedSource, normalTargetSource);
    const normalTargetResult = await Promise.resolve(normalTarget.source({
      state: normalTarget.state,
      pos: normalTargetSource.length,
      explicit: true
    } as never));
    expect(normalTargetResult?.options.map((option) => option.label)).toEqual(expect.arrayContaining(["flag", "total", "show"]));

    const targetStart = dirtySource.lastIndexOf("set b") + "set ".length;
    view.dispatch({
      changes: { from: targetStart, to: targetStart + 1, insert: typeof broken?.apply === "string" ? broken.apply : "broken" },
      selection: { anchor: targetStart + "broken".length }
    });
    expect(view.state.doc.toString()).toContain("set broken");

    const rhsSource = `${normalCommittedSource}\nlet broken: number = @broken\nset total = @br`;
    const rhs = completionOptions(normalCommittedSource, rhsSource);
    const rhsResult = await Promise.resolve(rhs.source({ state: rhs.state, pos: rhsSource.length, explicit: true } as never));
    expect(rhsResult?.options.map((option) => option.label)).not.toContain("broken");

    view.destroy();
    parent.remove();
  });

  it("uses a newly typed lexical scope in a real EditorView and drops it outside that scope", async () => {
    const dirtySource = [
      normalCommittedSource,
      "if (@flag) {",
      "  let broken: number = @broken",
      "  set b",
      "}",
      "set t"
    ].join("\n");
    const compiled = compileDslDocument(normalCommittedSource, {
      assignedStatementIds: new Map(parseDsl(normalCommittedSource).statements.map((_, index) => [index, `stable-${index}`]))
    });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    const committedDoc = EditorState.create({ doc: normalCommittedSource }).doc;
    let typedDeclarationRanges: TypedDeclarationRangeIndex = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
    let scopeBodyRanges: ScopeBodyRangeIndex = compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [];
    const parent = document.createElement("div");
    document.body.append(parent);
    const insideSet = dirtySource.indexOf("  set b") + "  set b".length;
    const view = new EditorView({
      state: EditorState.create({
        doc: normalCommittedSource,
        selection: { anchor: normalCommittedSource.length },
        extensions: [
          dslAutocompleteExtension({
            elements: () => compiled.document!.elements,
            statementRanges: () => new Map(),
            isComposing: () => false,
            computedGeometry: () => undefined,
            effectiveEnabledElementIds: () => undefined,
            evaluationErrors: () => [],
            bindingAnalysis: () => compiled.bindingAnalysis,
            typedDeclarationRanges: () => typedDeclarationRanges,
            scopeBodyRanges: () => scopeBodyRanges,
            statementInfoByElementId: () => compiled.statementMap!.byElementId
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            typedDeclarationRanges = mapTypedDeclarationRangeIndex(typedDeclarationRanges, update.changes);
            scopeBodyRanges = mapScopeBodyRangeIndex(scopeBodyRanges, update.changes);
          })
        ]
      }),
      parent
    });
    view.dispatch({
      changes: { from: normalCommittedSource.length, insert: dirtySource.slice(normalCommittedSource.length) },
      selection: { anchor: insideSet },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toContain("broken");

    view.dispatch({ selection: { anchor: dirtySource.length } });
    startCompletion(view);
    await expect.poll(() => completionStatus(view.state), { timeout: 1000, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).not.toContain("broken");

    view.destroy();
    parent.remove();
  });
});
