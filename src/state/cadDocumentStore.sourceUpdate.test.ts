import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

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

    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "editor");
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
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\npoint B = (1, 1)", "test");
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "A" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    const update = useCadDocumentStore.getState().sourceUpdate;
    expect(update.kind).toBe("model-patch");
    if (update.kind !== "model-patch") throw new Error("expected model patch");
    expect(update.splices).toEqual([{ startLine: 2, endLine: 2, replacementLines: ["point A = (0, 0) locked=true"] }]);
  });

  it("uses reset metadata for direct text, document replacement, and history restoration", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("reset");
  });

  it("keeps compiledDocumentRevision independent from sourceRevision while fatal text retains last-good doc", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "editor");
    const valid = useCadDocumentStore.getState();
    const compiledRevision = valid.compiledDocumentRevision;
    const sourceRevision = valid.sourceRevision;

    useCadDocumentStore.getState().commitText("nui 1\npoint A = (", "editor");
    const fatal = useCadDocumentStore.getState();
    expect(fatal.sourceRevision).toBe(sourceRevision + 1);
    expect(fatal.compiledDocumentRevision).toBe(compiledRevision);
    expect(fatal.docText).toBe(valid.sourceText);

    useCadDocumentStore.getState().commitText("nui 1\npoint B = (1, 1)", "editor");
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(compiledRevision + 1);
  });
});
