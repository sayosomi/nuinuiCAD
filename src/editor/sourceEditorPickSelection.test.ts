import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { dslLinesForElements } from "../dsl/dslDocumentTestUtils";
import { createLogicalStatementSourceMap } from "../dsl/logicalStatementSourceMap";
import { resolveSourceEditorPickSelection } from "./sourceEditorPickSelection";

const docLines = dslLinesForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "a" }, dx: 10, dy: 20 }
]);
const docSource = docLines.join("\n");
// resolveParameterValueSpan operates on the logical (row-joined) statement
// text, not a single physical line, since offsetPoint's canonical output is
// now a vertical multi-line call.
const sourceMap = createLogicalStatementSourceMap({ normalizedSource: docSource, sourceRevision: 1 });
const line = sourceMap.statements.find((statement) => statement.logicalText.includes("offset("))!.logicalText;

describe("resolveSourceEditorPickSelection", () => {
  it("requires an exact pickable parameter span", () => {
    const result = compileDslToElements(docSource, { elements: [] });
    const element = result.elements.find((candidate) => candidate.name === "B")!;
    const select = (text: string) => {
      const start = line.indexOf(text);
      return { start, end: start + text.length };
    };

    expect(resolveSourceEditorPickSelection({
      lineText: line,
      selection: select("@A"),
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
