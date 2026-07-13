import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { resolveSourceEditorPickSelection } from "./sourceEditorPickSelection";

const line = "point B = offset A dx=10 dy=20";

describe("resolveSourceEditorPickSelection", () => {
  it("requires an exact pickable parameter span", () => {
    const result = compileDslToElements(["point A = (0, 0)", line].join("\n"), { elements: [] });
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
