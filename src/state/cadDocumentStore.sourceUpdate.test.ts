import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const onePointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 }
]);

const twoPointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 1, y: 1 }
]);

const lockedA = dslTextForElements([
  { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0, locked: true }
]);
// commitDocumentChangeが発行する差し替え行は、その文単独のシリアライズ結果と
// 一致するはず(要素の並び全体を書き直すわけではないため)。
const lockedALine = lockedA.split("\n")[1];

describe("cadDocumentStore source updates", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("notifies synchronous subscribers about every source revision in order", () => {
    const received: Array<{ revision: number; kind: string }> = [];
    const unsubscribe = useCadDocumentStore.subscribe((state, previous) => {
      if (state.sourceRevision !== previous.sourceRevision) {
        received.push({ revision: state.sourceRevision, kind: state.sourceUpdate.kind });
      }
    });

    useCadDocumentStore.getState().commitText(onePointSource(), "editor");
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    useCadDocumentStore.getState().undo();
    unsubscribe();

    expect(received).toEqual([
      { revision: 1, kind: "editor" },
      { revision: 2, kind: "model-patch" },
      { revision: 3, kind: "reset" }
    ]);
  });

  it("publishes the actual model bridge LineSplice rather than a full source replacement", () => {
    useCadDocumentStore.getState().commitText(twoPointSource(), "test");
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    const update = useCadDocumentStore.getState().sourceUpdate;
    expect(update.kind).toBe("model-patch");
    if (update.kind !== "model-patch") throw new Error("expected model patch");
    expect(update.splices).toEqual([{ startLine: 2, endLine: 2, replacementLines: [lockedALine] }]);
  });

  it("uses reset metadata for direct text, document replacement, and history restoration", () => {
    useCadDocumentStore.getState().commitText(onePointSource(), "test");
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
  });

  it("keeps compiledDocumentRevision independent from sourceRevision while fatal text retains last-good doc", () => {
    const valid1 = onePointSource();
    useCadDocumentStore.getState().commitText(valid1, "editor");
    const valid = useCadDocumentStore.getState();
    const compiledRevision = valid.compiledDocumentRevision;
    const sourceRevision = valid.sourceRevision;

    // dsl2-cutover: v1-literal — 意図的な構文エラー(未閉じ括弧)。fatal挙動の
    // 検証が目的であり、生成経由化は不可(不正構文を要素配列で表現できない)。
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (", "editor");
    const fatal = useCadDocumentStore.getState();
    expect(fatal.sourceRevision).toBe(sourceRevision + 1);
    expect(fatal.compiledDocumentRevision).toBe(compiledRevision);
    expect(fatal.docText).toBe(valid.sourceText);

    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 1, y: 1 }
    ]), "editor");
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(compiledRevision + 1);
  });
});
