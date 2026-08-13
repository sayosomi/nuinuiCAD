import { describe, expect, it } from "vitest";
import { insertNumericExpressionSnippet } from "./numericExpressionInsertion";

describe("insertNumericExpressionSnippet", () => {
  it("inserts raw operator snippets at the caret", () => {
    expect(
      insertNumericExpressionSnippet({
        currentExpression: "line.length100",
        snippet: " >= ",
        selectionStart: 11,
        selectionEnd: 11,
        appendMode: "raw"
      })
    ).toBe("line.length >= 100");
  });

  it("replaces the selected range with raw operator snippets", () => {
    expect(
      insertNumericExpressionSnippet({
        currentExpression: "line.length > 100",
        snippet: " != ",
        selectionStart: 11,
        selectionEnd: 14,
        appendMode: "raw"
      })
    ).toBe("line.length != 100");
  });

  it("appends raw operator snippets without adding a sum operator", () => {
    expect(
      insertNumericExpressionSnippet({
        currentExpression: "line.length",
        snippet: "  and  ",
        appendMode: "raw"
      })
    ).toBe("line.length  and  ");
  });

  it("keeps a zero left operand when appending raw operator snippets", () => {
    expect(
      insertNumericExpressionSnippet({
        currentExpression: "0",
        snippet: " > ",
        appendMode: "raw"
      })
    ).toBe("0 > ");
  });
});
