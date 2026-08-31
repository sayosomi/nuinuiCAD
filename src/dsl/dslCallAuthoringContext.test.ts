import { describe, expect, it } from "vitest";
import {
  dslCallAuthoringContextAt,
  projectDslCallAuthoringRange
} from "./dslCallAuthoringContext";
import { dslStatementKeywordCompletions } from "./dslParser";

const snapshotFor = (source: string) => ({ normalizedSource: source, sourceRevision: 1 });

describe("dslCallAuthoringContextAt", () => {
  it("anchors a whitespace-only line to the strict incomplete construction call", () => {
    const source = "nui 1\npoint P = coordinate(\n  \n)";
    const position = source.indexOf("  \n") + 2;
    const context = dslCallAuthoringContextAt(snapshotFor(source), position);

    expect(context).toMatchObject({
      kind: "construction",
      callee: { name: "coordinate" },
      argument: { index: 0, label: null, value: null },
      sourceOrderAnchor: { statementIndex: 1 }
    });
    expect(context && source.slice(context.callee.span.from, context.callee.span.to)).toBe("coordinate");
    expect(context && source[context.callee.openParen]).toBe("(");
    expect(context && projectDslCallAuthoringRange(context, {
      from: context.logicalCursorPosition,
      to: context.logicalCursorPosition
    })).toEqual({ from: position, to: position });
  });

  it("keeps the current partial label and value on physical source spans", () => {
    const labelSource = "nui 1\ninstance Use = M(\n\n  v\n)";
    const labelPosition = labelSource.lastIndexOf("  v") + 3;
    const label = dslCallAuthoringContextAt(snapshotFor(labelSource), labelPosition);
    expect(label?.kind).toBe("module");
    expect(label && label.argument.label && labelSource.slice(label.argument.label.from, label.argument.label.to)).toBe("v");

    const valueSource = "nui 1\nconst a: number = spreadAngle(\n\n  s\n)";
    const valuePosition = valueSource.lastIndexOf("  s") + 3;
    const value = dslCallAuthoringContextAt(snapshotFor(valueSource), valuePosition);
    expect(value?.kind).toBe("builtin");
    expect(value && value.argument.value && valueSource.slice(value.argument.value.from, value.argument.value.to)).toBe("s");
  });

  it("recognizes a multiline final empty labeled Module argument", () => {
    const source = [
      "nui 1",
      "module M(broad: path) {",
      "}",
      "instance X = M(",
      "broad: ",
      ")"
    ].join("\n");
    const position = source.lastIndexOf("broad: ") + "broad: ".length;
    const context = dslCallAuthoringContextAt(snapshotFor(source), position);

    expect(context).toMatchObject({
      kind: "module",
      callee: { name: "M" },
      argument: {
        index: 0,
        label: { from: source.lastIndexOf("broad: "), to: source.lastIndexOf("broad: ") + "broad".length },
        value: { from: position, to: position }
      }
    });
    expect(context && projectDslCallAuthoringRange(context, {
      from: context.logicalCursorPosition,
      to: context.logicalCursorPosition
    })).toEqual({ from: position, to: position });
  });

  it("selects the outer active call after a closed nested coordinate literal", () => {
    const source = [
      "nui 1",
      "line L = segment(",
      "start: (0, 0),",
      "",
      ")"
    ].join("\n");
    const position = source.indexOf("\n\n") + 1;
    const context = dslCallAuthoringContextAt(snapshotFor(source), position);

    expect(context).toMatchObject({
      kind: "construction",
      callee: { name: "segment" },
      argument: { index: 1 },
      usedArgumentNames: new Set(["start"])
    });
    expect(context && source.slice(context.callee.span.from, context.callee.span.to)).toBe("segment");
    expect(context && source[context.callee.openParen]).toBe("(");
  });

  it("selects the outer active builtin after a closed nested scalar call", () => {
    const source = [
      "nui 1",
      "const a: number = spreadAngle(",
      "length: abs(10),",
      "",
      ")"
    ].join("\n");
    const position = source.indexOf("\n\n") + 1;
    const context = dslCallAuthoringContextAt(snapshotFor(source), position);

    expect(context).toMatchObject({
      kind: "builtin",
      callee: { name: "spreadAngle" },
      usedArgumentNames: new Set(["length"])
    });
  });

  it("keeps later arguments inside a proven envelope for used-name filtering", () => {
    const source = [
      "nui 1",
      "point P = coordinate(",
      "",
      "y: 20",
      ")"
    ].join("\n");
    const position = source.indexOf("\n\n") + 1;
    const context = dslCallAuthoringContextAt(snapshotFor(source), position);

    expect(context?.usedArgumentNames).toEqual(new Set(["y"]));
    expect(context?.argument.index).toBe(0);
  });

  it("uses the parser-owned statement keyword authority for tolerant boundaries", () => {
    for (const keyword of dslStatementKeywordCompletions) {
      const source = `nui 1\npoint P = coordinate(\n\n${keyword}\n)`;
      const position = source.length - 1;

      expect(dslCallAuthoringContextAt(snapshotFor(source), position), keyword).toBeNull();
    }
  });

  it("fails closed for comments, quoted text, and unrelated code after the boundary", () => {
    const cases = [
      "nui 1\n// point P = coordinate(\n\n",
      "nui 1\nconst text: string = \"quoted ( text\"\n\n",
      "nui 1\npoint P = coordinate(\n\nconst next: number = "
    ];

    for (const source of cases) {
      expect(dslCallAuthoringContextAt(snapshotFor(source), source.length)).toBeNull();
    }
  });

  it("does not cross a comment line after the containment boundary", () => {
    const source = "nui 1\npoint P = coordinate(\n\n// not a call (\n";
    expect(dslCallAuthoringContextAt(snapshotFor(source), source.length)).toBeNull();
  });
});
