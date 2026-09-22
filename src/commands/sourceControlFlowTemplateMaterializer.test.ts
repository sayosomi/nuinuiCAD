import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDsl } from "@nuinuicad/nui-language";
import { SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS } from "./sourceControlFlowTemplateCatalog";
import {
  materializeSourceControlFlowTemplate,
  type SourceControlFlowTemplateFieldId,
  type SourceControlFlowTemplatePart
} from "./sourceControlFlowTemplateMaterializer";

const materializeFor = (templateId: (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"]) => {
  const materialization = materializeSourceControlFlowTemplate(templateId);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const render = (parts: readonly SourceControlFlowTemplatePart[]): string => parts.map((part) =>
  part.kind === "text" ? part.text : `<${part.field}>`
).join("");

const fieldsFor = (parts: readonly SourceControlFlowTemplatePart[]) => parts.flatMap((part) =>
  part.kind === "hole" ? [part.field] : []
);

const concreteValueFor = (
  templateId: (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"],
  field: SourceControlFlowTemplateFieldId
): string => {
  switch (field) {
    case "group-name":
      return "G";
    case "condition":
      return "@enabled";
    case "binder":
      return "i";
    case "range-min":
      return "0";
    case "range-max":
      return "1";
    case "range-step":
      return "1";
    case "collection":
      return "values";
    case "carry-name":
      return "total";
    case "carry-type":
      return "number";
    case "carry-initializer":
      return "0";
    case "next-expression":
      return "@total + 1";
    case "body":
      return templateId === "group"
        ? "point P = coordinate(x: 0, y: 0)"
        : templateId === "if"
          ? "const inside: number = 1"
          : "const current: number = @i";
  }
};

const renderConcrete = (
  templateId: (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"],
  parts: readonly SourceControlFlowTemplatePart[]
): string => parts.map((part) => part.kind === "text" ? part.text : concreteValueFor(templateId, part.field)).join("");

const preambleFor = (templateId: (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"]): string => {
  switch (templateId) {
    case "if":
      return "const enabled: boolean = true\n";
    case "for-collection":
    case "for-collection-carry":
      return "const values: number[] = [1, 2]\n";
    default:
      return "";
  }
};

describe("Control Flow template materializer", () => {
  it("exposes only the fixed six rows in order", () => {
    expect(SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS).toEqual([
      { id: "group", label: "Group" },
      { id: "if", label: "If" },
      { id: "for-range", label: "For Range" },
      { id: "for-collection", label: "For Collection" },
      { id: "for-range-carry", label: "For Range + Carry" },
      { id: "for-collection-carry", label: "For Collection + Carry" }
    ]);
  });

  it.each([
    ["group", "group <group-name> {\n  <body>\n}"],
    ["if", "if (<condition>) {\n  <body>\n}"],
    ["for-range", "for <binder> in range(min: <range-min>, max: <range-max>, step: <range-step>) {\n  <body>\n}"],
    ["for-collection", "for <binder> in @<collection> {\n  <body>\n}"],
    [
      "for-range-carry",
      "for <binder> in range(min: <range-min>, max: <range-max>, step: <range-step>)\n  carry <carry-name>: <carry-type> = <carry-initializer> {\n  <body>\n  next <carry-name> = <next-expression>\n}"
    ],
    [
      "for-collection-carry",
      "for <binder> in @<collection>\n  carry <carry-name>: <carry-type> = <carry-initializer> {\n  <body>\n  next <carry-name> = <next-expression>\n}"
    ]
  ] as const)("materializes %s with only the contracted structure", (templateId, expected) => {
    const materialization = materializeFor(templateId);
    expect(render(materialization.parts)).toBe(expected);
    expect(render(materialization.parts)).not.toMatch(/\b(let|set|var|else)\b/);
  });

  it("gives both carry-name occurrences the same stable field identity", () => {
    const materialization = materializeFor("for-range-carry");
    expect(fieldsFor(materialization.parts)).toEqual([
      "binder", "range-min", "range-max", "range-step", "carry-name",
      "carry-type", "carry-initializer", "body", "carry-name", "next-expression"
    ]);
  });

  it.each(SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)(
    "accepts concretized %s through parseDsl and compileDslDocument",
    ({ id }) => {
      const materialization = materializeFor(id);
      const source = [
        "nui 1",
        preambleFor(id).trimEnd(),
        renderConcrete(id, materialization.parts)
      ].filter((line) => line !== "").join("\n");
      const parsed = parseDsl(source);
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

      const assignedStatementIds = new Map(
        parsed.statements.map((_, index) => [index, `control-flow-materializer:${id}:${index}`] as const)
      );
      const compiled = compileDslDocument(source, {
        preparsed: parsed,
        assignedStatementIds
      });

      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(compiled.document).not.toBeNull();
    }
  );
});
