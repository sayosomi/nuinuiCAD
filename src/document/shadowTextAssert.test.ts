import { afterEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { CadElement } from "../types/geometry";
import { assertReconcileSane, assertShadowEquivalent } from "./shadowTextAssert";

afterEach(() => {
  vi.restoreAllMocks();
});

const compileOrThrow = (source: string): DslDocumentData => {
  const compiled = compileDslDocument(source);
  expect(compiled.document, `must compile:\n${source}`).not.toBeNull();
  return compiled.document!;
};

describe("assertShadowEquivalent", () => {
  it("正準シリアライズが一致すればtrueを返しconsole.errorを呼ばない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const afterDoc = compileOrThrow(["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    expect(assertShadowEquivalent(afterDoc, afterDoc, 3)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("シリアライズが食い違えばfalseを返しconsole.errorで警告する", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const afterDoc = compileOrThrow(["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const shadowDoc = compileOrThrow(["nui 3", "point A = coordinate(x: 99, y: 99)"].join("\n"));
    expect(assertShadowEquivalent(afterDoc, shadowDoc, 3)).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("shadowDocumentがnullならfalseを返しconsole.errorで警告する", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const afterDoc = compileOrThrow(["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    expect(assertShadowEquivalent(afterDoc, null, 3)).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("assertReconcileSane", () => {
  const baseSource = ["nui 3", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)", "point C = coordinate(x: 2, y: 2)"].join("\n");

  it("リネームのみ(移動なし)はID継承必須: 正常な場合は警告しない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevCompiled = compileDslDocument(baseSource);
    const prevDoc = prevCompiled.document!;
    const afterDoc: DslDocumentData = {
      ...prevDoc,
      elements: prevDoc.elements.map((element) =>
        element.name === "B" ? ({ ...element, name: "B2" } as CadElement) : element
      )
    };
    const nextShadowText = serializeDocumentToDsl(afterDoc, 3);
    assertReconcileSane(prevCompiled, nextShadowText, afterDoc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("移動のみ(リネームなし)はID継承必須: 正常な場合は警告しない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevCompiled = compileDslDocument(baseSource);
    const prevDoc = prevCompiled.document!;
    const [a, b, c] = prevDoc.elements;
    const afterDoc: DslDocumentData = { ...prevDoc, elements: [a, c, b] };
    const nextShadowText = serializeDocumentToDsl(afterDoc, 3);
    assertReconcileSane(prevCompiled, nextShadowText, afterDoc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("リネーム+移動の同時実行は許容される対応不能ケース: 警告しない(偽陽性を出さない)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevCompiled = compileDslDocument(baseSource);
    const prevDoc = prevCompiled.document!;
    const [a, b, c] = prevDoc.elements;
    // B を移動しつつ同時にリネームする(移動のみのCと対比)。
    const afterDoc: DslDocumentData = {
      ...prevDoc,
      elements: [a, { ...c }, { ...b, name: "B2" } as CadElement]
    };
    const nextShadowText = serializeDocumentToDsl(afterDoc, 3);
    assertReconcileSane(prevCompiled, nextShadowText, afterDoc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("実際の挿入・削除は正常なら警告しない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevCompiled = compileDslDocument(baseSource);
    const prevDoc = prevCompiled.document!;
    const inserted = compileOrThrow("nui 3\npoint D = coordinate(x: 3, y: 3)").elements[0];
    const afterDoc: DslDocumentData = {
      ...prevDoc,
      elements: [...prevDoc.elements.filter((element) => element.name !== "C"), inserted]
    };
    const nextShadowText = serializeDocumentToDsl(afterDoc, 3);
    assertReconcileSane(prevCompiled, nextShadowText, afterDoc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prevCompiled.documentがnullなら比較対象がないので何もしない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const emptyParsed = parseDslSnapshot({ normalizedSource: "", sourceRevision: 0 });
    const brokenCompiled: CompiledDslDocument = {
      document: null,
      majorVersion: null,
      statements: [],
      statementMap: null,
      sourceLines: [],
      diagnostics: [],
      spans: { sourceMap: emptyParsed.sourceMap, logicalStatementByRangeFrom: emptyParsed.logicalStatementByRangeFrom }
    };
    const afterDoc = compileOrThrow(["nui 3", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    assertReconcileSane(brokenCompiled, serializeDocumentToDsl(afterDoc, 3), afterDoc);
    expect(spy).not.toHaveBeenCalled();
  });

  it("継承が仕様上必須なのに実際に継承できていない場合は警告する(実戦バグ検出)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevCompiled = compileDslDocument(baseSource);
    const prevDoc = prevCompiled.document!;
    // 影の照合器へ渡す旧ID情報を意図的に欠落させ、継承不能な状態を再現する。
    const corruptedPrev: CompiledDslDocument = {
      ...prevCompiled,
      statementMap: {
        ...prevCompiled.statementMap!,
        elementIdByStatementIndex: new Map(),
        statementIdByStatementIndex: new Map()
      }
    };
    const afterDoc: DslDocumentData = {
      ...prevDoc,
      elements: prevDoc.elements.map((element) =>
        element.name === "B" ? ({ ...element, name: "B2" } as CadElement) : element
      )
    };
    const nextShadowText = serializeDocumentToDsl(afterDoc, 3);
    assertReconcileSane(corruptedPrev, nextShadowText, afterDoc);
    expect(spy).toHaveBeenCalled();
    const [, detail] = spy.mock.calls[0];
    expect((detail as { missingInheritance: string[] }).missingInheritance.length).toBeGreaterThan(0);
  });
});
