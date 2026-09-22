import { describe, expect, it } from "vitest";
import { SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS } from "./sourceControlFlowTemplateCatalog";
import {
  materializeSourceControlFlowTemplate,
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
});
