import { describe, expect, it } from "vitest";
import { createNuiLanguageSession } from "../nuiLanguageSession";
import { queryDslRandomNumberSourceEdit } from "./dslRandomNumberSourceEditQuery";

const compiledFor = (sourceText: string) => {
  const session = createNuiLanguageSession(sourceText);
  const snapshot = session.runtimeEvaluationSnapshot();
  if (!snapshot) throw new Error("expected an exact-current compiled source snapshot");
  return {
    source: { normalizedSource: sourceText, sourceRevision: snapshot.sourceRevision },
    semantic: {
      sourceRevision: snapshot.sourceRevision,
      sourceText,
      compiled: snapshot.compiled
    }
  };
};

const query = (
  sourceText: string,
  selection: { start: number; end: number },
  generatedLiteral = "0.625",
  selections = [selection]
) => {
  const current = compiledFor(sourceText);
  return queryDslRandomNumberSourceEdit({ ...current, selections, generatedLiteral });
};

describe("queryDslRandomNumberSourceEdit", () => {
  it("replaces the whole direct positive numeric literal when the caret is inside", () => {
    const source = "nui 1\nconst width: number = 12.34";
    const start = source.indexOf("12.34");
    expect(query(source, { start: start + 2, end: start + 2 })).toMatchObject({
      edit: { from: start, to: start + 5, expectedText: "12.34", newText: "0.625" },
      selection: { start, end: start + 5 }
    });
  });

  it("replaces the full signed direct numeric literal", () => {
    const source = "nui 1\nconst width: number = -12.34";
    const start = source.indexOf("-12.34");
    expect(query(source, { start: start + 3, end: start + 3 })?.edit).toEqual({
      from: start,
      to: start + 6,
      expectedText: "-12.34",
      newText: "0.625"
    });
  });

  it("replaces an exact non-empty numeric literal selection", () => {
    const source = "nui 1\nconst width: number = 12.34";
    const start = source.indexOf("12.34");
    expect(query(source, { start, end: start + 5 })?.edit).toMatchObject({
      from: start,
      to: start + 5,
      expectedText: "12.34"
    });
  });

  it("inserts at a caret immediately after a literal", () => {
    const source = "nui 1\nconst width: number = 12.34";
    const at = source.length;
    expect(query(source, { start: at, end: at })?.edit).toEqual({
      from: at,
      to: at,
      expectedText: "",
      newText: "0.625"
    });
  });

  it("inserts at an empty caret away from numeric literals", () => {
    const source = "nui 1\nconst width: number = 12.34\n";
    const at = source.length;
    expect(query(source, { start: at, end: at })?.selection).toEqual({ start: at, end: at + 5 });
  });

  it("rejects arbitrary non-empty selections and multiple selections", () => {
    const source = "nui 1\nconst width: number = 12.34";
    const start = source.indexOf("width");
    expect(query(source, { start, end: start + 5 })).toBeNull();
    expect(query(source, { start, end: start }, "0.625", [
      { start, end: start },
      { start: start + 1, end: start + 1 }
    ])).toBeNull();
  });

  it("does not treat number-looking string or comment content as a numeric target", () => {
    const stringSource = 'nui 1\nconst label: string = "piece 123"';
    const stringNumber = stringSource.indexOf("123");
    expect(query(stringSource, { start: stringNumber, end: stringNumber + 3 })).toBeNull();
    expect(query(stringSource, { start: stringNumber + 1, end: stringNumber + 1 })?.edit).toEqual({
      from: stringNumber + 1,
      to: stringNumber + 1,
      expectedText: "",
      newText: "0.625"
    });

    const commentSource = "nui 1\nconst width: number = 2 // 123";
    const commentNumber = commentSource.lastIndexOf("123");
    expect(query(commentSource, { start: commentNumber, end: commentNumber + 3 })).toBeNull();
    expect(query(commentSource, { start: commentNumber + 1, end: commentNumber + 1 })?.edit).toEqual({
      from: commentNumber + 1,
      to: commentNumber + 1,
      expectedText: "",
      newText: "0.625"
    });
  });

  it("rejects a classification when the semantic snapshot is not exact-current", () => {
    const source = "nui 1\nconst width: number = 12.34";
    const current = compiledFor(source);
    const start = source.length;
    expect(queryDslRandomNumberSourceEdit({
      source: { ...current.source, normalizedSource: `${source} ` },
      semantic: current.semantic,
      selections: [{ start, end: start }],
      generatedLiteral: "0.625"
    })).toBeNull();
  });

  it("carries exact expected text and a selection covering only the generated literal", () => {
    const source = "nui 1\nconst width: number = -12.34";
    const start = source.indexOf("-12.34");
    const plan = query(source, { start: start + 1, end: start + 1 }, "0.125");
    expect(plan).toMatchObject({
      sourceRevision: expect.any(Number),
      edit: { from: start, to: start + 6, expectedText: "-12.34", newText: "0.125" },
      selection: { start, end: start + 5 }
    });
  });
});
