import { describe, expect, it } from "vitest";
import { compileDslDocument, type DslDocumentData } from "./dslDocument";
import { dslLinesForElements, dslTextForElements } from "./dslDocumentTestUtils";
import { dslReferenceCompletionOptions } from "./dslCompletionCandidates";
import { evaluateElements } from "../geometry/evaluate";

const identities = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  // 各statementはv2では複数物理行に跨り得るため、statement.line〜endLineの
  // 全物理行をそのstatementのelementIdへ対応付ける(単一行前提だとcursorLineが
  // ヘッダ行以外の物理行を指した際にidを引けなくなる)。
  const ids = new Map<number, string>();
  for (const [elementId, statement] of compiled.statementMap!.byElementId) {
    for (let line = statement.line; line <= statement.endLine; line += 1) ids.set(line, elementId);
  }
  return {
    elements: compiled.document!.elements,
    ids
  };
};

const lineOf = (source: string, needle: string): number => {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
};

describe("dslReferenceCompletionOptions", () => {
  it("uses the live scope and strictly excludes the cursor line and later statements", () => {
    const groupLines = dslLinesForElements([
      { id: "outer", name: "Outer", type: "group", activity: "visible" },
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "outer" },
      { id: "ab", name: "AB", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "a" }, parentGroupId: "outer" }
    ]);
    // カーソルが編集中の空行(未入力statement)にある状態を再現するため、
    // group閉じ括弧の直前に空行を1つ挿入する。
    groupLines.splice(groupLines.findIndex((line) => line.trim() === "}"), 0, "");
    const laterLines = dslLinesForElements([
      { id: "later", name: "Later", type: "freePoint", activity: "visible", x: 10, y: 0 }
    ]);
    const source = ["nui 1", ...groupLines, ...laterLines].join("\n");
    const { elements, ids } = identities(source);
    const blankLine = source.split("\n").findIndex((line) => line === "") + 1;
    const pointALine = lineOf(source, "point A");

    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: blankLine,
      kind: "reference",
      statementElementIds: ids,
      elements
    }).map((option) => option.label);
    expect(options).toContain("A");
    expect(options).toContain("AB.start");
    expect(options).not.toContain("Later");

    const currentLineOptions = dslReferenceCompletionOptions({
      source,
      cursorLine: pointALine,
      kind: "reference",
      statementElementIds: ids,
      elements
    }).map((option) => option.label);
    expect(currentLineOptions).not.toContain("A");
  });

  it("uses parameter kinds to keep line endpoints and line lists distinct", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "ab", name: "AB", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "a" } },
      { id: "target", name: "Target", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]);
    const { elements, ids } = identities(source);
    const cursorLine = lineOf(source, "point Target");
    const endpoints = dslReferenceCompletionOptions({ source, cursorLine, kind: "lineEndpointReference", statementElementIds: ids, elements });
    const lines = dslReferenceCompletionOptions({ source, cursorLine, kind: "lineReferenceList", statementElementIds: ids, elements });
    expect(endpoints.map((option) => option.label)).toEqual(expect.arrayContaining(["AB.start", "AB.end"]));
    expect(endpoints.map((option) => option.label)).not.toContain("AB");
    expect(lines.map((option) => option.label)).toContain("AB");
  });

  it("does not fall back to compiled scope when a live dirty group has no stable identity", () => {
    const committed = identities(dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ]));
    const aId = committed.ids.get(2)!;
    const liveLines = dslLinesForElements([
      { id: "new", name: "New", type: "group", activity: "visible" },
      { id: "a2", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "new" }
    ]);
    liveLines.splice(liveLines.findIndex((line) => line.trim() === "}"), 0, "");
    const liveSource = liveLines.join("\n");
    const pointALine = lineOf(liveSource, "point A");
    const cursorLine = liveSource.split("\n").findIndex((line) => line === "") + 1;
    const options = dslReferenceCompletionOptions({
      source: liveSource,
      cursorLine,
      kind: "reference",
      statementElementIds: new Map([[pointALine, aId]]),
      elements: committed.elements
    });
    expect(options).toEqual([]);
  });

  it("returns only the stable top eight for a 1000-element document", () => {
    const elements: DslDocumentData["elements"] = Array.from({ length: 1000 }, (_, index) => ({
      id: `p${index}`, name: `P${index}`, type: "freePoint", activity: "visible", x: index, y: 0
    }));
    const source = dslTextForElements(elements);
    const { elements: compiledElements, ids } = identities(source);
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: source.split("\n").length + 1,
      kind: "reference",
      query: "P",
      statementElementIds: ids,
      elements: compiledElements
    });
    expect(options).toHaveLength(8);
    expect(options.map((option) => option.label)).toEqual(
      Array.from({ length: 8 }, (_, index) => `P${index}`)
    );
  }, 20_000);

  it("uses evaluator-owned forGroup rows to aggregate runtime instances to one saved token", () => {
    const source = dslTextForElements([
      { id: "loop", name: "Loop", type: "forGroup", activity: "visible", variableName: "i", start: 0, count: 3, step: 1, showGenerated: true },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: { kind: "expression", expression: "@i * 10" }, y: 0, parentGroupId: "loop" },
      { id: "target", name: "Target", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "p" }, endPoint: { mode: "reference", pointId: "p" }, parentGroupId: "loop" }
    ]);
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: lineOf(source, "line Target"),
      kind: "reference",
      parameterKey: "startPoint",
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });
    expect(options.filter((option) => option.label === "P")).toHaveLength(1);
  });

  it("removes every runtime instance when another line-list token already selects its template", () => {
    const source = dslTextForElements([
      { id: "loop", name: "Loop", type: "forGroup", activity: "visible", variableName: "i", start: 0, count: 3, step: 1, showGenerated: true },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: { kind: "expression", expression: "@i * 10" }, y: 0, parentGroupId: "loop" },
      { id: "l", name: "L", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "p" }, endPoint: { mode: "coordinate", x: { kind: "expression", expression: "@i * 10" }, y: 10 }, parentGroupId: "loop" },
      { id: "m", name: "M", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "p" }, endPoint: { mode: "coordinate", x: { kind: "expression", expression: "@i * 10" }, y: 20 }, parentGroupId: "loop" },
      { id: "o", name: "O", type: "offsetLine", activity: "visible", baseLineIds: ["l", "l"], offset: 4, side: "left", closed: false, parentGroupId: "loop" }
    ]);
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    // v2の正準出力は縦型callのため、baseLineIdsのトークン列は`sources:`引数行に
    // あり、ヘッダ行(`line O = offset(`)には現れない。
    const sourcesLine = lineOf(source, "sources:");
    const lineText = source.split("\n")[sourcesLine - 1];
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: sourcesLine,
      kind: "lineReferenceList",
      parameterKey: "baseLineIds",
      replacementFrom: lineText.lastIndexOf("L"),
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });

    // `L` is represented by three runtime instances, but one persisted token.
    // It must not be offered for confirmation, so the second slot cannot gain
    // a duplicate `L` token.
    expect(options.map((option) => option.label)).toEqual(["M"]);
  });

  it("keeps the currently edited line-list token replaceable while excluding other selections", () => {
    const source = dslTextForElements([
      { id: "loop", name: "Loop", type: "forGroup", activity: "visible", variableName: "i", start: 0, count: 2, step: 1, showGenerated: true },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: { kind: "expression", expression: "@i * 10" }, y: 0, parentGroupId: "loop" },
      { id: "l", name: "L", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "p" }, endPoint: { mode: "coordinate", x: { kind: "expression", expression: "@i * 10" }, y: 10 }, parentGroupId: "loop" },
      { id: "m", name: "M", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "p" }, endPoint: { mode: "coordinate", x: { kind: "expression", expression: "@i * 10" }, y: 20 }, parentGroupId: "loop" },
      { id: "o", name: "O", type: "offsetLine", activity: "visible", baseLineIds: ["l", "m"], offset: 4, side: "left", closed: false, parentGroupId: "loop" }
    ]);
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    const sourcesLine = lineOf(source, "sources:");
    const lineText = source.split("\n")[sourcesLine - 1];
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: sourcesLine,
      kind: "lineReferenceList",
      parameterKey: "baseLineIds",
      replacementFrom: lineText.indexOf("L"),
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });

    expect(options.map((option) => option.label)).toContain("L");
    expect(options.map((option) => option.label)).not.toContain("M");
  });
});
