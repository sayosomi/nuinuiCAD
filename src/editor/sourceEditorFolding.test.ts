import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { foldTargetAtLine, foldTargets } from "./sourceEditorFolding";
import { createStatementRangeIndex } from "./statementRangeIndex";

describe("sourceEditorFolding structural rows", () => {
  it("offers an expanded-by-default target for an ordinary multiline statement", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(",
      "  from: A",
      "  dx: 100",
      ")"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    expect(compiled.diagnostics).toEqual([]);
    const doc = Text.of(source.split("\n"));
    const ranges = createStatementRangeIndex(doc, compiled.statementMap!);
    const pointB = compiled.document!.elements.find((element) => element.name === "B")!;

    expect(foldTargetAtLine(ranges, compiled.document!.elements, doc.line(3).from)).toMatchObject({
      elementId: pointB.id,
      branch: "statement",
      from: doc.line(3).to,
      to: doc.line(6).from
    });
    expect(foldTargets(ranges, compiled.document!.elements, new Map())).toEqual([]);
    expect(foldTargets(ranges, compiled.document!.elements, new Map([[pointB.id, { statementExpanded: false }]])))
      .toEqual([expect.objectContaining({ elementId: pointB.id, branch: "statement" })]);
  });

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
    expect(foldTargetAtLine(ranges, compiled.document!.elements, open.from)).toMatchObject({ elementId: element.id, branch: "primary", from: open.to, to: elseLine.from - 1 });
    expect(foldTargetAtLine(ranges, compiled.document!.elements, elseLine.from)).toMatchObject({ elementId: element.id, from: elseLine.to, to: close.from });
  });

  it("projects then and else targets independently when both are collapsed", () => {
    const source = [
      "nui 2",
      "if Choice (1) {",
      "  point T = coordinate(x: 0 y: 0)",
      "} else {",
      "  point E = coordinate(x: 1 y: 1)",
      "}"
    ].join("\n");
    const compiled = compileDslDocument(source, { sourceRevision: 4 });
    const doc = Text.of(source.split("\n"));
    const element = compiled.document!.elements[0]!;
    const targets = foldTargets(
      createStatementRangeIndex(doc, compiled.statementMap!),
      compiled.document!.elements,
      new Map([[element.id, { expanded: false, elseExpanded: false }]])
    );

    expect(targets.map((target) => target.branch)).toEqual(["primary", "else"]);
    expect(targets[0]!.to).toBeLessThan(targets[1]!.from);
  });
});
