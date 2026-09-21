import { DSL_INDENT } from "@nuinuicad/nui-language";
import type { SourceTemplateInsertionScope } from "./sourceTemplateCatalog";

export const SOURCE_OUTPUT_TEMPLATE_DEFINITIONS = [
  { id: "layout-print", label: "Layout + Print" },
  { id: "layout", label: "Layout" },
  { id: "place", label: "Place" },
  { id: "print", label: "Print" },
  { id: "svg", label: "SVG" }
] as const;

export type SourceOutputTemplateId = (typeof SOURCE_OUTPUT_TEMPLATE_DEFINITIONS)[number]["id"];

export type SourceOutputTemplateSnippetPart =
  | { kind: "text"; text: string }
  | { kind: "tabstop"; index: number }
  | { kind: "choice"; index: number; choices: readonly string[] };

export type SourceOutputTemplateSnippet = {
  templateId: SourceOutputTemplateId;
  parts: readonly SourceOutputTemplateSnippetPart[];
};

const text = (value: string): SourceOutputTemplateSnippetPart => ({ kind: "text", text: value });
const tabstop = (index: number): SourceOutputTemplateSnippetPart => ({ kind: "tabstop", index });
const choice = (index: number, choices: readonly string[]): SourceOutputTemplateSnippetPart => ({
  kind: "choice",
  index,
  choices
});

const sourceOutputTemplateSnippetPartsFor = (
  templateId: SourceOutputTemplateId
): readonly SourceOutputTemplateSnippetPart[] => {
  switch (templateId) {
    case "layout-print":
      return [
        text("layout "),
        tabstop(1),
        text(" {\n}\n\nprint "),
        tabstop(2),
        text("(\n"),
        text(`${DSL_INDENT}layout: @`),
        tabstop(1),
        text(",\n"),
        text(`${DSL_INDENT}paper: `),
        choice(3, ["a4", "a3"]),
        text(",\n"),
        text(`${DSL_INDENT}orientation: `),
        choice(4, ["portrait", "landscape"]),
        text(",\n"),
        text(`${DSL_INDENT}overlap: `),
        tabstop(5),
        text(",\n)\n")
      ];
    case "layout":
      return [text("layout "), tabstop(1), text(" {\n}\n")];
    case "place":
      return [
        text(`${DSL_INDENT}place @`),
        tabstop(1),
        text("(\n"),
        text(`${DSL_INDENT.repeat(2)}at: (`),
        tabstop(2),
        text(", "),
        tabstop(3),
        text(")\n"),
        text(`${DSL_INDENT})\n`)
      ];
    case "print":
      return [
        text("print "),
        tabstop(1),
        text("(\n"),
        text(`${DSL_INDENT}layout: @`),
        tabstop(2),
        text(",\n"),
        text(`${DSL_INDENT}paper: `),
        choice(3, ["a4", "a3"]),
        text(",\n"),
        text(`${DSL_INDENT}orientation: `),
        choice(4, ["portrait", "landscape"]),
        text(",\n"),
        text(`${DSL_INDENT}overlap: `),
        tabstop(5),
        text(",\n)\n")
      ];
    case "svg":
      return [
        text("svg "),
        tabstop(1),
        text("(\n"),
        text(`${DSL_INDENT}layout: @`),
        tabstop(2),
        text(",\n)\n")
      ];
  }
};

export const sourceOutputTemplateSnippetFor = (
  templateId: SourceOutputTemplateId
): SourceOutputTemplateSnippet => ({
  templateId,
  parts: sourceOutputTemplateSnippetPartsFor(templateId)
});

export const sourceOutputTemplateIsLegalIn = (
  templateId: SourceOutputTemplateId,
  scope: SourceTemplateInsertionScope
): boolean => templateId === "place"
  ? scope === "direct-layout-body"
  : scope === "top-level";
