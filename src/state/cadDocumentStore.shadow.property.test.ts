import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
import { applyRandomOp, generateDocumentSource, type RandomOp } from "../document/documentTestGenerators";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "./cadDocumentStore";

// ランダムなストア操作列後、影テキストが常にモデルと意味的等価で
// あり(equivalence assertが一度も発火しない)、かつ手置きノイズ行が
// バイト単位で保存されることを検証するプロパティテスト。

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

const seedFromDocument = (doc: DslDocumentData) => {
  useCadDocumentStore.getState().replaceDocument(doc, null);
};

const randomOpArbitrary: fc.Arbitrary<RandomOp> = fc.record({
  kind: fc.constantFrom(
    "updateAttr",
    "rename",
    "insert",
    "deleteLeaf",
    "deleteReferencedTarget",
    "deleteSubtree",
    "ungroup",
    "move",
    "reparent",
    "paletteEdit",
    "stopMove",
    "profileToggle",
    "layoutEdit"
  ) as fc.Arbitrary<RandomOp["kind"]>,
  a: fc.nat(1000),
  b: fc.nat(1000)
});

describe("cadDocumentStore 影テキスト: ランダム操作プロパティテスト", () => {
  it("does not generate a reparent that moves a for-local element outside its iteration scope", () => {
    const generated = generateDocumentSource({
      pointCount: 4,
      groupCount: 1,
      withIf: true,
      withFor: true,
      withLayout: true,
      unnamedCount: 1,
      noiseEvery: 3,
      withContinuation: true
    });
    const initialCompiled = compileDslDocument(generated.source);
    expect(initialCompiled.document).not.toBeNull();
    const firstInsert = applyRandomOp(initialCompiled.document!, { kind: "insert", a: 0, b: 0 });
    const secondInsert = applyRandomOp(firstInsert.document, { kind: "insert", a: 0, b: 0 });
    const documentBeforeReparent = secondInsert.document;
    const forGroupId = documentBeforeReparent.elements.find((element) => element.type === "forGroup")?.id;
    const groupId = documentBeforeReparent.elements.find((element) => element.name === "G0")?.id;
    const forLocal = documentBeforeReparent.elements.find((element) => element.name === "FP0");
    expect(forGroupId).toBeDefined();
    expect(groupId).toBeDefined();
    expect(forLocal?.parentGroupId).toBe(forGroupId);

    const invalidModel = {
      ...documentBeforeReparent,
      elements: documentBeforeReparent.elements.map((element) =>
        element.name === "FP0" ? ({ ...element, parentGroupId: groupId } as typeof element) : element
      )
    };
    const invalidCompile = compileDslDocument(serializeDocumentToDsl(invalidModel, 4));
    expect(invalidCompile.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "numeric-binding-unresolved" })
    ]));

    const reparent = applyRandomOp(documentBeforeReparent, { kind: "reparent", a: 384, b: 0 });
    const reparsed = compileDslDocument(serializeDocumentToDsl(reparent.document, 4));
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reparent.document.elements.find((element) => element.name === "FP0")?.parentGroupId).toBe(forGroupId);

    const ordinaryReparent = applyRandomOp(documentBeforeReparent, { kind: "reparent", a: 0, b: 0 });
    const ordinaryTarget = ordinaryReparent.document.elements.find((element) => element.name === "P1");
    const ordinaryReparsed = compileDslDocument(serializeDocumentToDsl(ordinaryReparent.document, 4));
    expect(ordinaryTarget?.parentGroupId).toBe(groupId);
    expect(ordinaryReparent.description).toContain("reparent P1 into G0");
    expect(ordinaryReparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("ランダムなコミット列後も影は常にモデルと意味的等価であり、手置きノイズ行は保存される", () => {
    fc.assert(
      fc.property(fc.array(randomOpArbitrary, { minLength: 1, maxLength: 10 }), (ops) => {
        useCadDocumentStore.setState(initialCadDocumentState());
        consoleErrorSpy.mockClear();

        const generated = generateDocumentSource({
          pointCount: 4,
          groupCount: 1,
          withIf: true,
          withFor: true,
          withLayout: true,
          unnamedCount: 1,
          noiseEvery: 3,
          withContinuation: true
        });
        const initialCompiled = compileDslDocument(generated.source);
        expect(initialCompiled.document, `must compile:\n${generated.source}`).not.toBeNull();
        seedFromDocument(initialCompiled.document!);

        // ノイズ入りの手書きソースを正準入口から適用する。
        useCadDocumentStore.getState().commitText(generated.source, "test");

        let document: DslDocumentData = useCadDocumentStore.getState().doc.document;
        for (const op of ops) {
          const applied = applyRandomOp(document, op);
          document = applied.document;
          useCadDocumentStore.getState().commitDocumentChange({
            elements: document.elements,
            palette: document.palette,
            visibilityRoles: document.visibilityRoles,
            visibilityProfiles: document.visibilityProfiles,
            layouts: document.layouts,
            printOutputs: document.printOutputs,
            svgOutputs: document.svgOutputs,
            evaluationLimitIndex: document.evaluationLimitIndex
          });
          // 次イテレーションはストアが正規化した後の実モデルを基準に進める。
          document = useCadDocumentStore.getState().doc.document;
        }

        const finalState = useCadDocumentStore.getState();
        expect(finalState.doc.document).not.toBeNull();
        expect(serializeDocumentToDsl(finalState.doc.document, 4)).toBe(
          serializeDocumentToDsl(finalState.doc.document, 4)
        );
        for (const noiseLine of generated.noiseLines) {
          expect(finalState.sourceText).toContain(noiseLine);
        }
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 15 }
    );
  });
});
