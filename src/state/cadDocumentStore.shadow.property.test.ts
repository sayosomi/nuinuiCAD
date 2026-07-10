import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type DslDocumentData } from "../dsl/dslDocument";
import { applyRandomOp, generateDocumentSource, type RandomOp } from "../document/documentTestGenerators";
import { snapshotToDslData } from "../document/shadowText";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import {
  currentDocumentSnapshot,
  initialCadDocumentState,
  useCadDocumentStore,
  type CadDocumentSnapshot
} from "./cadDocumentStore";
import { useCadUiStore } from "./cadUiStore";

// Phase 1b: ランダムなストア操作列後、影テキストが常にモデルと意味的等価で
// あり(equivalence assertが一度も発火しない)、かつ手置きノイズ行が
// バイト単位で保存されることを検証するプロパティテスト
// (docs/overhaul/tasks/phase-1b-shadow-text.md 必須テスト)。

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

const seedFromDocument = (doc: DslDocumentData) => {
  const printLayouts = doc.printLayouts.length ? doc.printLayouts : [DEFAULT_PRINT_LAYOUT];
  const activePrintLayoutId = doc.activePrintLayoutId || printLayouts[0].id;
  const snapshot: CadDocumentSnapshot = {
    elements: doc.elements,
    palette: doc.palette,
    visibilityRoles: doc.visibilityRoles,
    visibilityProfiles: doc.visibilityProfiles,
    activeVisibilityProfileId: doc.activeVisibilityProfileId,
    printLayouts,
    activePrintLayoutId,
    printLayout: printLayouts.find((layout) => layout.id === activePrintLayoutId) ?? printLayouts[0],
    evaluationLimitIndex: doc.evaluationLimitIndex,
    selectedElementId: doc.elements[0]?.id ?? null,
    selectedElementIds: doc.elements[0] ? [doc.elements[0].id] : [],
    selectionAnchorElementId: doc.elements[0]?.id ?? null,
    selectedParameterKey: null
  };
  useCadDocumentStore.getState().replaceDocument(snapshot, null);
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
          noiseEvery: 3
        });
        const initialCompiled = compileDslDocument(generated.source);
        expect(initialCompiled.document, `must compile:\n${generated.source}`).not.toBeNull();
        seedFromDocument(initialCompiled.document!);

        // ノイズ入りの手書きソースを正準入口から適用する。
        useCadDocumentStore.getState().commitText(generated.source, "test");

        let document: DslDocumentData = snapshotToDslData(currentDocumentSnapshot(useCadDocumentStore.getState(), useCadUiStore.getState()));
        for (const op of ops) {
          const applied = applyRandomOp(document, op);
          document = applied.document;
          useCadDocumentStore.getState().commitDocumentChange({
            elements: document.elements,
            palette: document.palette,
            visibilityRoles: document.visibilityRoles,
            visibilityProfiles: document.visibilityProfiles,
            printLayouts: document.printLayouts,
            evaluationLimitIndex: document.evaluationLimitIndex
          });
          // 次イテレーションはストアが正規化した後の実モデルを基準に進める。
          document = snapshotToDslData(currentDocumentSnapshot(useCadDocumentStore.getState(), useCadUiStore.getState()));
        }

        const finalState = useCadDocumentStore.getState();
        expect(finalState.doc.document).not.toBeNull();
        expect(serializeDocumentToDsl(finalState.doc.document)).toBe(
          serializeDocumentToDsl(snapshotToDslData(currentDocumentSnapshot(finalState, useCadUiStore.getState())))
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
