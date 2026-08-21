import { describe, expect, it } from "vitest";
import {
  dslCallAuthoringContextAt,
  projectDslCallAuthoringRange
} from "./dslCallAuthoringContext";

const snapshotFor = (source: string) => ({ normalizedSource: source, sourceRevision: 1 });

describe("dslCallAuthoringContextAt", () => {
  it("anchors a whitespace-only line to the strict incomplete construction call", () => {
    const source = "nui 4\npoint P = coordinate(\n  \n)";
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
    const labelSource = "nui 4\ninstance Use = M(\n\n  v\n)";
    const labelPosition = labelSource.lastIndexOf("  v") + 3;
    const label = dslCallAuthoringContextAt(snapshotFor(labelSource), labelPosition);
    expect(label?.kind).toBe("module");
    expect(label && label.argument.label && labelSource.slice(label.argument.label.from, label.argument.label.to)).toBe("v");

    const valueSource = "nui 4\nconst a: number = spreadAngle(\n\n  s\n)";
    const valuePosition = valueSource.lastIndexOf("  s") + 3;
    const value = dslCallAuthoringContextAt(snapshotFor(valueSource), valuePosition);
    expect(value?.kind).toBe("builtin");
    expect(value && value.argument.value && valueSource.slice(value.argument.value.from, value.argument.value.to)).toBe("s");
  });

  it("fails closed for comments, quoted text, and unrelated code after the boundary", () => {
    const cases = [
      "nui 4\n// point P = coordinate(\n\n",
      "nui 4\nconst text: string = \"quoted ( text\"\n\n",
      "nui 4\npoint P = coordinate(\n\nconst next: number = "
    ];

    for (const source of cases) {
      expect(dslCallAuthoringContextAt(snapshotFor(source), source.length)).toBeNull();
    }
  });

  it("does not cross a comment line after the containment boundary", () => {
    const source = "nui 4\npoint P = coordinate(\n\n// not a call (\n";
    expect(dslCallAuthoringContextAt(snapshotFor(source), source.length)).toBeNull();
  });
});
