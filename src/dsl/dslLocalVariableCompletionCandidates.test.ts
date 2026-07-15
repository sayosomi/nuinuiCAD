import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { dslLocalVariableCompletionOptions } from "./dslLocalVariableCompletionCandidates";

const compileOne = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  const element = compiled.document!.elements[0];
  return element;
};

describe("dslLocalVariableCompletionOptions", () => {
  it("offers only earlier entries in the same live vars=[...] list", () => {
    const element = compileOne("nui 1\npoint P = (0, 0) vars=[Width:10;Height:20]");
    const lineText = "point P = (0, 0) vars=[Width:10;Height:@]";
    const pos = lineText.length - 1; // right after the trailing @
    const options = dslLocalVariableCompletionOptions({ lineText, pos, elementId: element.id, elements: [element] });
    expect(options.map((option) => option.variableId)).toEqual([element.numericVariables![0].id]);
  });

  it("offers no local candidates for the first entry in the list", () => {
    const element = compileOne("nui 1\npoint P = (0, 0) vars=[Width:10;Height:20]");
    const lineText = "point P = (0, 0) vars=[Width:@]";
    const pos = lineText.length - 1;
    const options = dslLocalVariableCompletionOptions({ lineText, pos, elementId: element.id, elements: [element] });
    expect(options).toEqual([]);
  });

  it("treats an unrecognized (new or renamed) record name as appending after every committed local variable", () => {
    const element = compileOne("nui 1\npoint P = (0, 0) vars=[Width:10;Height:20]");
    const lineText = "point P = (0, 0) vars=[Width:10;Height:20;Margin:@]";
    const pos = lineText.length - 1;
    const options = dslLocalVariableCompletionOptions({ lineText, pos, elementId: element.id, elements: [element] });
    expect(options.map((option) => option.variableId)).toEqual(element.numericVariables!.map((variable) => variable.id));
  });

  it("returns [] when the cursor is in a record's name field, not its expression", () => {
    const element = compileOne("nui 1\npoint P = (0, 0) vars=[Width:10;Height:20]");
    const lineText = "point P = (0, 0) vars=[Width:10;Height:20]";
    const pos = lineText.indexOf("Height") + 2;
    const options = dslLocalVariableCompletionOptions({ lineText, pos, elementId: element.id, elements: [element] });
    expect(options).toEqual([]);
  });

  it("returns [] for a statement that has never been compiled (no stable elementId to correlate ids against)", () => {
    const element = compileOne("nui 1\npoint P = (0, 0) vars=[Width:10;Height:20]");
    const lineText = "point Q = (0, 0) vars=[Extra:10;More:@]";
    const options = dslLocalVariableCompletionOptions({
      lineText,
      pos: lineText.length - 1,
      elementId: undefined,
      elements: [element]
    });
    expect(options).toEqual([]);
  });

  it("never offers a local variable from a different element", () => {
    const compiled = compileDslDocument("nui 1\npoint P = (0, 0) vars=[Width:10]\npoint Q = (1, 1) vars=[Height:@]");
    expect(compiled.document).not.toBeNull();
    const [p, q] = compiled.document!.elements;
    const lineText = "point Q = (1, 1) vars=[Height:@]";
    const options = dslLocalVariableCompletionOptions({
      lineText,
      pos: lineText.length - 1,
      elementId: q.id,
      elements: [p, q]
    });
    expect(options).toEqual([]);
  });
});
