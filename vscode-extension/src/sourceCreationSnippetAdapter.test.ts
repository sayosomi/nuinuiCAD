import { describe, expect, it, vi } from "vitest";

type SnippetEvent =
  | { kind: "text"; text: string }
  | { kind: "tabstop"; index: number }
  | { kind: "choice"; index: number; choices: readonly string[] };

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

    appendChoice(choices: readonly string[], index?: number): this {
      const tabstopIndex = index ?? 1;
      this.events.push({ kind: "choice", index: tabstopIndex, choices });
      this.value += "${" + tabstopIndex + "|" + choices.join(",") + "|}";
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
import { sourceGeometryValueTemplateGroups } from "../../src/commands/sourceGeometryValueTemplateCatalog";
import { materializeSourceGeometryValueTemplate } from "../../src/commands/sourceGeometryValueTemplateMaterializer";
import { sourceCalculationMeasurementTemplatePlans } from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import { materializeSourceCalculationMeasurementTemplate } from "../../src/commands/sourceCalculationMeasurementTemplateMaterializer";
import { SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS } from "../../src/commands/sourceControlFlowTemplateCatalog";
import { materializeSourceControlFlowTemplate } from "../../src/commands/sourceControlFlowTemplateMaterializer";
import {
  createSourceCalculationMeasurementSnippet,
  createSourceGeometryValueSnippet,
  createSourceCreationSnippet,
  createSourceOutputTemplateSnippet,
  createSourceControlFlowSnippet,
  insertSourceGeometryValueSnippet,
  insertSourceCalculationMeasurementSnippet,
  insertSourceCreationSnippet,
  insertSourceOutputTemplateSnippet
} from "./sourceCreationSnippetAdapter";
import { sourceOutputTemplateSnippetFor } from "../../src/commands/sourceOutputTemplateCatalog";

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

const geometryValueMaterializeFor = (groupId: "point" | "line" | "path", construction: string, formIndex = 0) => {
  const plan = sourceGeometryValueTemplateGroups()
    .find(({ id }) => id === groupId)!.plans
    .find((candidate) => candidate.construction === construction)!;
  const materialization = materializeSourceGeometryValueTemplate(plan, plan.forms[formIndex]!);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const calculationMeasurementMaterializeFor = (builtinName: string) => {
  const plan = sourceCalculationMeasurementTemplatePlans().find(({ builtinName: candidate }) => candidate === builtinName)!;
  const materialization = materializeSourceCalculationMeasurementTemplate(plan);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const expectedControlFlowSnippetValues = {
  group: "group $1 {\n  $2\n}",
  if: "if ($1) {\n  $2\n}",
  "for-range": "for $1 in range(min: $2, max: $3, step: $4) {\n  $5\n}",
  "for-collection": "for $1 in @$2 {\n  $3\n}",
  "for-range-carry": [
    "for $1 in range(min: $2, max: $3, step: $4) carry $5: $6 = $7 {",
    "  $8",
    "  next $5 = $9",
    "}"
  ].join("\n"),
  "for-collection-carry": [
    "for $1 in @$2 carry $3: $4 = $5 {",
    "  $6",
    "  next $3 = $7",
    "}"
  ].join("\n")
} satisfies Record<(typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"], string>;

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

  it("emits Joined Path's canonical closed default without a tabstop", () => {
    const materialization = materializeFor("addJoinedPath");
    const snippet = snippetFor(materialization);

    expect(holeNamesFor(materialization)).toEqual(["name", "paths"]);
    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2]);
    expect(snippet.value).toBe([
      "line $1 = join(",
      "  paths: $2,",
      "  closed: false",
      ")"
    ].join("\n"));
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

  it("turns Geometry Value holes into ordered native tabstops and inserts once", async () => {
    const materialization = geometryValueMaterializeFor("point", "between", 1);
    const snippet = createSourceGeometryValueSnippet(materialization) as unknown as TestSnippetString;

    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2, 3, 4]);
    expect(snippet.value).toBe([
      "const $1: point = between(",
      "  start: $2,",
      "  end: $3,",
      "  ratio: $4",
      ")"
    ].join("\n"));

    const insertSnippet = vi.fn(() => Promise.resolve(true));
    const editor = { insertSnippet } as unknown as vscode.TextEditor;
    const position = new vscode.Position(6, 0);
    await expect(insertSourceGeometryValueSnippet(editor, materialization, position)).resolves.toBe(true);
    expect(insertSnippet).toHaveBeenCalledTimes(1);
    expect(insertSnippet.mock.calls[0]?.[0]).toBeInstanceOf(vscode.SnippetString);
    expect(insertSnippet.mock.calls[0]?.[1]).toBe(position);
  });

  it("turns Calculation / Measurement holes into ordered native tabstops", async () => {
    const materialization = calculationMeasurementMaterializeFor("spreadAngle");
    const snippet = createSourceCalculationMeasurementSnippet(materialization) as unknown as TestSnippetString;

    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([1, 2, 3]);
    expect(snippet.value).toBe("const $1: number = spreadAngle(length: $2, spread: $3)");

    const insertSnippet = vi.fn(() => Promise.resolve(true));
    const editor = { insertSnippet } as unknown as vscode.TextEditor;
    const position = new vscode.Position(6, 0);
    await expect(insertSourceCalculationMeasurementSnippet(editor, materialization, position)).resolves.toBe(true);
    expect(insertSnippet).toHaveBeenCalledTimes(1);
    expect(insertSnippet.mock.calls[0]?.[0]).toBeInstanceOf(vscode.SnippetString);
    expect(insertSnippet.mock.calls[0]?.[1]).toBe(position);
  });

  it.each(SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)(
    "turns %s into the contracted native snippet structure",
    ({ id }) => {
      const materialization = materializeSourceControlFlowTemplate(id);
      expect(materialization).not.toBeNull();
      const snippet = createSourceControlFlowSnippet(materialization!) as unknown as TestSnippetString;
      expect(snippet.value).toBe(expectedControlFlowSnippetValues[id]);
    }
  );

  it("links the carry name and next name to one native tabstop", () => {
    const materialization = materializeSourceControlFlowTemplate("for-range-carry");
    expect(materialization).not.toBeNull();
    const snippet = createSourceControlFlowSnippet(materialization!) as unknown as TestSnippetString;

    expect(snippet.value).toBe([
      "for $1 in range(min: $2, max: $3, step: $4) carry $5: $6 = $7 {",
      "  $8",
      "  next $5 = $9",
      "}"
    ].join("\n"));
    expect(tabstopEventsFor(snippet).map(({ index }) => index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 5, 9
    ]);
  });

  it("uses linked layout-name tabstops and native paper/orientation choices for Layout + Print", () => {
    const snippet = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("layout-print")) as unknown as TestSnippetString;

    expect(snippet.events).toContainEqual({ kind: "tabstop", index: 1 });
    expect(snippet.events).toContainEqual({ kind: "choice", index: 3, choices: ["a4", "a3"] });
    expect(snippet.events).toContainEqual({ kind: "choice", index: 4, choices: ["portrait", "landscape"] });
    expect(snippet.events.filter((event) => event.kind === "tabstop").map((event) => event.index))
      .toEqual([1, 2, 1, 5]);
    expect(snippet.value).toContain("layout $1");
    expect(snippet.value).toContain("layout: @$1");
  });

  it("keeps Print's required fields in output-name, layout, paper, orientation, overlap order", () => {
    const snippet = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("print")) as unknown as TestSnippetString;

    expect(snippet.events.filter((event) => event.kind === "tabstop").map((event) => event.index))
      .toEqual([1, 2, 5]);
    expect(snippet.events.filter((event) => event.kind === "choice").map((event) => event.index))
      .toEqual([3, 4]);
    expect(snippet.value).toContain("paper:");
    expect(snippet.value).toContain("orientation:");
    expect(snippet.value).toContain("overlap: $5");
  });

  it("inserts Output / Print through the same native TextEditor.insertSnippet boundary", async () => {
    const insertSnippet = vi.fn(() => Promise.resolve(true));
    const editor = { insertSnippet } as unknown as vscode.TextEditor;
    const position = new vscode.Position(7, 0);

    await expect(insertSourceOutputTemplateSnippet(
      editor,
      sourceOutputTemplateSnippetFor("svg"),
      position
    )).resolves.toBe(true);
    expect(insertSnippet).toHaveBeenCalledTimes(1);
    expect(insertSnippet.mock.calls[0]?.[0]).toBeInstanceOf(vscode.SnippetString);
    expect(insertSnippet.mock.calls[0]?.[1]).toBe(position);
  });

  it("keeps Place minimal with the group, X, and Y tabstops only", () => {
    const snippet = createSourceOutputTemplateSnippet(sourceOutputTemplateSnippetFor("place")) as unknown as TestSnippetString;

    expect(snippet.value).toBe([
      "  place @$1(",
      "    at: ($2, $3)",
      "  )",
      ""
    ].join("\n"));
    expect(snippet.value).not.toContain("origin:");
    expect(snippet.value).not.toContain("scale:");
    expect(snippet.value).not.toContain("angle:");
    expect(snippet.value).not.toContain("mirror:");
  });
});
