import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const onePointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 }
]);

const twoPointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
]);

const disabledA = dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "disabled", x: 0, y: 0 }
]);
// commitDocumentChangeが発行する差し替え行は、その文単独のシリアライズ結果と
// 一致するはず(要素の並び全体を書き直すわけではないため)。v2正準形の
// construction callは複数物理行になるため、statement全体(nuiヘッダ以降の
// 全行)を切り出す。置き換え元(A単独, 評価する状態)の行数は置き換え先
// (enabled: false が増えた分)より短いため、範囲(endLine)とreplacementLines
// は別々の文書から算出する。
const disabledALines = disabledA.split("\n").slice(1);
const enabledALineCount = twoPointSource().split("\n").findIndex((line) => line.startsWith("point B")) - 1;

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
      element.name === "A" ? ({ ...element, activity: "disabled" } as CadElement) : element
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
      element.name === "A" ? ({ ...element, activity: "disabled" } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    const update = useCadDocumentStore.getState().sourceUpdate;
    expect(update.kind).toBe("model-patch");
    if (update.kind !== "model-patch") throw new Error("expected model patch");
    expect(update.splices).toEqual([{ startLine: 2, endLine: 1 + enabledALineCount, replacementLines: disabledALines }]);
  });

  it("uses reset metadata for direct text, document replacement, and history restoration", () => {
    useCadDocumentStore.getState().commitText(onePointSource(), "test");
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
  });

  it("commitLineSplices tags model-patch (not reset) with the given splices, in one Undo step", () => {
    const source = ["nui 1", "const base: number = 1", "let derived: number = @base"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const pastLength = useCadDocumentStore.getState().past.length;

    const result = useCadDocumentStore.getState().commitLineSplices([
      { startLine: 2, endLine: 2, replacementLines: ["const renamed: number = 1"] },
      { startLine: 3, endLine: 3, replacementLines: ["let derived: number = @renamed"] }
    ]);

    expect(result).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceText).toBe(
      ["nui 1", "const renamed: number = 1", "let derived: number = @renamed"].join("\n")
    );
    const update = useCadDocumentStore.getState().sourceUpdate;
    expect(update.kind).toBe("model-patch");
    if (update.kind !== "model-patch") throw new Error("expected model patch");
    expect(update.splices).toEqual([
      { startLine: 2, endLine: 2, replacementLines: ["const renamed: number = 1"] },
      { startLine: 3, endLine: 3, replacementLines: ["let derived: number = @renamed"] }
    ]);
    expect(useCadDocumentStore.getState().past.length).toBe(pastLength + 1);
  });

  it("commitLineSplices is a noop when the given splices produce identical text", () => {
    const source = ["nui 1", "const base: number = 1"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const before = useCadDocumentStore.getState();

    const result = useCadDocumentStore.getState().commitLineSplices([
      { startLine: 2, endLine: 2, replacementLines: ["const base: number = 1"] }
    ]);

    expect(result).toEqual({ status: "noop" });
    expect(useCadDocumentStore.getState().past).toBe(before.past);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(before.sourceRevision);
  });

  it("keeps compiledDocumentRevision independent from sourceRevision while fatal text retains last-good doc", () => {
    const valid1 = onePointSource();
    useCadDocumentStore.getState().commitText(valid1, "editor");
    const valid = useCadDocumentStore.getState();
    const compiledRevision = valid.compiledDocumentRevision;
    const sourceRevision = valid.sourceRevision;

    // 意図的な構文エラー(未閉じ呼び出し)。fatal挙動の検証が目的であり、
    // 生成経由化は不可(不正構文を要素配列で表現できない)。
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(", "editor");
    const fatal = useCadDocumentStore.getState();
    expect(fatal.sourceRevision).toBe(sourceRevision + 1);
    expect(fatal.compiledDocumentRevision).toBe(compiledRevision);
    expect(fatal.docText).toBe(valid.sourceText);

    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]), "editor");
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(compiledRevision + 1);
  });
});
