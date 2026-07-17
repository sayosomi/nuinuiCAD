import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { dslLinesForElements } from "../dsl/dslDocumentTestUtils";
import { resolveSourceEditorPickSelection } from "./sourceEditorPickSelection";

const docLines = dslLinesForElements([
  { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "b", name: "B", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 10, dy: 20 }
]);
const line = docLines[1];

describe("resolveSourceEditorPickSelection", () => {
  it("requires an exact pickable parameter span", () => {
    const result = compileDslToElements(docLines.join("\n"), { elements: [] });
    const element = result.elements.find((candidate) => candidate.name === "B")!;
    const select = (text: string) => {
      const start = line.indexOf(text);
      return { start, end: start + text.length };
    };

    expect(resolveSourceEditorPickSelection({
      lineText: line,
      selection: select("A"),
      element,
      committedLineText: line,
    })).toEqual({ parameterKey: "fromPoint", commandId: "startPointPick" });
    expect(resolveSourceEditorPickSelection({
      lineText: line,
      selection: select("10"),
      element,
      committedLineText: line,
    })).toEqual({ parameterKey: "dx", commandId: "startNumericReferencePick" });
    expect(resolveSourceEditorPickSelection({
      lineText: line,
      selection: select("B"),
      element,
      committedLineText: line,
    })).toBeNull();
    expect(resolveSourceEditorPickSelection({
      lineText: line,
      selection: { start: line.indexOf("10"), end: line.indexOf("10") + 1 },
      element,
      committedLineText: line,
    })).toBeNull();
  });
});
