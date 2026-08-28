import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { addContainer } from "./containerCreation";

const source = [
  "nui 4",
  "",
  "const ZOOM_RATIO: number = 2",
  "const SA: number = 7 * @ZOOM_RATIO",
  "const SA_NARROW: number = 5 * @ZOOM_RATIO",
  "const BANGS_WIDTH: number = 2 * @ZOOM_RATIO",
  "",
  ""
].join("\n");

describe("container creation from the Source Editor", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it.each(["group", "conditionalGroup", "forGroup"] as const)(
    "inserts a %s block at a trailing blank cursor instead of the evaluation divider",
    (type) => {
      useCadDocumentStore.getState().commitText(source, "test");
      const document = useCadDocumentStore.getState();

      expect(addContainer(type, {
        currentSourceCursor: () => ({
          sourceRevision: document.sourceRevision,
          line: 8,
          lineCount: 8,
          elementId: null
        })
      })).toEqual({ status: "applied" });

      const next = useCadDocumentStore.getState();
      const inserted = next.elements.at(-1)!;
      expect(inserted.type).toBe(type);
      const insertedHeader = type === "group" ? "group" : type === "conditionalGroup" ? "if" : "for";
      expect(next.sourceText.indexOf("const BANGS_WIDTH")).toBeLessThan(next.sourceText.indexOf(insertedHeader));
      expect(useCadUiStore.getState().selectedElementId).toBe(inserted.id);
    }
  );

  it("keeps a declaration cursor's established after-statement behavior", () => {
    useCadDocumentStore.getState().commitText([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n"), "test");
    const document = useCadDocumentStore.getState();
    const pointA = document.elements.find((element) => element.name === "A")!;

    addContainer("group", {
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 2,
        lineCount: 3,
        elementId: pointA.id
      })
    });

    const next = useCadDocumentStore.getState().sourceText;
    expect(next.indexOf("point A =")).toBeLessThan(next.indexOf("group "));
    expect(next.indexOf("group ")).toBeLessThan(next.indexOf("point B ="));
  });

  it("uses the enclosing conditional else branch for a comment-line cursor", () => {
    useCadDocumentStore.getState().commitText([
      "nui 4",
      "if (true) {",
      "  point A = coordinate(x: 0, y: 0)",
      "} else {",
      "  // insert here",
      "  point B = coordinate(x: 10, y: 0)",
      "}"
    ].join("\n"), "test");
    const document = useCadDocumentStore.getState();
    const conditional = document.elements.find((element) => element.type === "conditionalGroup")!;

    addContainer("group", {
      currentSourceCursor: () => ({
        sourceRevision: document.sourceRevision,
        line: 5,
        lineCount: 7,
        elementId: null
      })
    });

    const next = useCadDocumentStore.getState();
    const inserted = next.elements.find((element) => element.type === "group")!;
    expect(inserted.parentGroupId).toBe(conditional.id);
    expect(inserted.conditionalBranch).toBe("else");
    expect(next.sourceText.indexOf("  group ")).toBeLessThan(next.sourceText.indexOf("  // insert here"));
  });

  it("rejects an unsafe Source cursor without using the evaluation-limit fallback", () => {
    useCadDocumentStore.getState().commitText([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n"), "test");
    const before = useCadDocumentStore.getState();
    const documentSnapshot = {
      elements: before.elements,
      sourceText: before.sourceText,
      sourceRevision: before.sourceRevision,
      evaluationLimitIndex: before.evaluationLimitIndex,
      past: before.past,
      future: before.future
    };

    expect(addContainer("group", {
      currentSourceCursor: () => ({
        sourceRevision: before.sourceRevision - 1,
        line: 2,
        lineCount: 2,
        elementId: null
      })
    })).toEqual({ status: "rejected", reason: "invalid-change" });

    const after = useCadDocumentStore.getState();
    expect(after.elements).toBe(documentSnapshot.elements);
    expect(after.sourceText).toBe(documentSnapshot.sourceText);
    expect(after.sourceRevision).toBe(documentSnapshot.sourceRevision);
    expect(after.evaluationLimitIndex).toBe(documentSnapshot.evaluationLimitIndex);
    expect(after.past).toBe(documentSnapshot.past);
    expect(after.future).toBe(documentSnapshot.future);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("安全な挿入境界");
  });
});
