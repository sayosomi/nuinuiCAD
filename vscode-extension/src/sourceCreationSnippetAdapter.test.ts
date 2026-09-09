import { describe, expect, it, vi } from "vitest";

type SnippetEvent =
  | { kind: "text"; text: string }
  | { kind: "tabstop"; index: number };

type TestSnippetString = {
  readonly events: SnippetEvent[];
  value: string;
};

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }

  class SnippetString {
    public readonly events: SnippetEvent[] = [];
    public value = "";

    appendText(text: string): this {
      this.events.push({ kind: "text", text });
      this.value += text;
      return this;
    }

    appendTabstop(index: number): this {
      this.events.push({ kind: "tabstop", index });
      this.value += `$${index}`;
      return this;
    }
  }

  return { Position, SnippetString };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { sourceCreationTemplatePlanForLegacyCommand } from "../../src/commands/sourceCreationTemplatePlan";
import {
  materializeSourceCreationTemplate,
  type SourceCreationTemplateMaterialization
} from "../../src/commands/sourceCreationTemplateMaterializer";
import {
  createSourceCreationSnippet,
  insertSourceCreationSnippet
} from "./sourceCreationSnippetAdapter";

const materializeFor = (commandId: string, formIndex = 0): SourceCreationTemplateMaterialization => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  expect(plan, commandId).not.toBeNull();
  const materialization = materializeSourceCreationTemplate(plan!, formIndex);
  expect(materialization, `${commandId} form ${formIndex}`).not.toBeNull();
  return materialization!;
};

const snippetFor = (materialization: SourceCreationTemplateMaterialization): TestSnippetString =>
  createSourceCreationSnippet(materialization) as unknown as TestSnippetString;

const holeNamesFor = (materialization: SourceCreationTemplateMaterialization): string[] =>
  materialization.parts.flatMap((part) => {
    if (part.kind !== "hole") return [];
    return [part.hole.role === "name" ? "name" : part.hole.argName];
  });

const tabstopEventsFor = (snippet: TestSnippetString) =>
  snippet.events.filter((event): event is Extract<SnippetEvent, { kind: "tabstop" }> => event.kind === "tabstop");

describe("VS Code source creation snippet adapter", () => {
  it("emits addLine literal text and ordered name/argument tabstops", () => {
    const materialization = materializeFor("addLine");
    const snippet = snippetFor(materialization);

    expect(holeNamesFor(materialization)).toEqual(["name", "start", "end"]);
    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2, 3]);
    expect(snippet.events).toEqual([
      { kind: "text", text: "line " },
      { kind: "tabstop", index: 1 },
      { kind: "text", text: " = segment(\n  start: " },
      { kind: "tabstop", index: 2 },
      { kind: "text", text: ",\n  end: " },
      { kind: "tabstop", index: 3 },
      { kind: "text", text: "\n)" }
    ]);
  });

  it("consumes the selected tangentOffset curveSide form without inventing angle", () => {
    const materialization = materializeFor("addLineTangentOffsetPoint", 1);
    const snippet = snippetFor(materialization);

    expect(holeNamesFor(materialization)).toEqual([
      "name", "line", "base", "curveSide", "distance"
    ]);
    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2, 3, 4, 5]);
    expect(snippet.value).toBe([
      "point $1 = tangentOffset(",
      "  line: $2,",
      "  base: $3,",
      "  curveSide: $4,",
      "  distance: $5",
      ")"
    ].join("\n"));
    expect(snippet.value).not.toContain("angle:");
  });

  it("starts mutation tabstops at the first materialized argument hole", () => {
    const materialization = materializeFor("addMove");
    const snippet = snippetFor(materialization);

    expect(holeNamesFor(materialization)).toEqual(["targets", "from", "to", "scale", "angleDeg"]);
    expect(holeNamesFor(materialization)).not.toContain("name");
    expect(snippet.events[0]).toEqual({ kind: "text", text: "move(\n  targets: " });
    expect(snippet.events[1]).toEqual({ kind: "tabstop", index: 1 });
    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2, 3, 4, 5]);
  });

  it("delegates one native snippet insertion at the supplied position and forwards its result", async () => {
    const materialization = materializeFor("addLine");
    const position = new vscode.Position(4, 7);
    const insertionResult = Promise.resolve(true);
    const insertSnippet = vi.fn(() => insertionResult);
    const editor = { insertSnippet } as unknown as vscode.TextEditor;

    const result = insertSourceCreationSnippet(editor, materialization, position);

    expect(insertSnippet).toHaveBeenCalledTimes(1);
    const [snippet, insertionPosition] = insertSnippet.mock.calls[0]!;
    expect(snippet).toBeInstanceOf(vscode.SnippetString);
    expect((snippet as unknown as TestSnippetString).events).toEqual(snippetFor(materialization).events);
    expect(insertionPosition).toBe(position);
    expect(result).toBe(insertionResult);
    await expect(result).resolves.toBe(true);
  });
});
