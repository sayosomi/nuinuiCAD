import { describe, expect, it } from "vitest";
import { templateHoleContentSpanAt } from "./dslTemplateHoleCompletionContext";

describe("templateHoleContentSpanAt", () => {
  it("finds the content span of an in-progress hole with nothing typed yet", () => {
    const text = 'label(text: "hi ${';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    expect(templateHoleContentSpanAt(text, valueSpan, text.length)).toEqual({ start: text.length, end: text.length });
  });

  it("finds the content span of an in-progress hole with a partial reference typed", () => {
    const text = 'label(text: "hi ${@fo';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    const holeOpen = text.indexOf("${") + 2;
    expect(templateHoleContentSpanAt(text, valueSpan, text.length)).toEqual({ start: holeOpen, end: text.length });
  });

  it("returns null when the cursor is in plain literal text, not inside a hole", () => {
    const text = 'label(text: "hi there';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    expect(templateHoleContentSpanAt(text, valueSpan, text.length)).toBeNull();
  });

  it("returns null right after a hole has already closed", () => {
    const text = 'label(text: "{@a} more';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    expect(templateHoleContentSpanAt(text, valueSpan, text.length)).toBeNull();
  });

  it("does not treat an escaped brace as an open hole", () => {
    const text = 'label(text: "\\{not a hole';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    expect(templateHoleContentSpanAt(text, valueSpan, text.length)).toBeNull();
  });

  it("returns null outside the value span", () => {
    const text = 'label(text: "{@a';
    const valueSpan = { start: text.indexOf('"'), end: text.length };
    expect(templateHoleContentSpanAt(text, valueSpan, 0)).toBeNull();
  });
});
