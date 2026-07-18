import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { foldTargetAtLine } from "./sourceEditorFolding";
import { createStatementRangeIndex } from "./statementRangeIndex";

describe("sourceEditorFolding structural rows", () => {
  it("places controls on independent brace rows and leaves both markers visible", () => {
    const source = [
      "nui 2",
      "if Choice (1)",
      "{",
      "  point T = coordinate(x: 0 y: 0)",
      "} else {",
      "  point E = coordinate(x: 1 y: 1)",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    expect(compiled.diagnostics).toEqual([]);
    const doc = Text.of(source.split("\n"));
    const ranges = createStatementRangeIndex(doc, compiled.statementMap!);
    const element = compiled.document!.elements[0]!;
    const open = doc.line(3);
    const elseLine = doc.line(5);
    const close = doc.line(7);
    expect(foldTargetAtLine(ranges, compiled.document!.elements, doc.line(2).from)).toBeNull();
    expect(foldTargetAtLine(ranges, compiled.document!.elements, open.from)).toMatchObject({ elementId: element.id, from: open.to, to: elseLine.from });
    expect(foldTargetAtLine(ranges, compiled.document!.elements, elseLine.from)).toMatchObject({ elementId: element.id, from: elseLine.to, to: close.from });
  });
});
