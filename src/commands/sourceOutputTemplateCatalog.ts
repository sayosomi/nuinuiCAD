import type { CompiledDslDocument, StatementInfo } from "@nuinuicad/nui-language";
import { DSL_INDENT } from "@nuinuicad/nui-language";
import {
  resolveSourceCreationInsertion,
  type SourceCreationCursor,
  type SourceCreationInsertion
} from "./sourceCreationInsertion";

export const SOURCE_TEMPLATE_FAMILIES = ["Geometry", "Output / Print"] as const;
export type SourceTemplateFamily = (typeof SOURCE_TEMPLATE_FAMILIES)[number];

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

export type SourceTemplateInsertionScope = "top-level" | "direct-layout-body" | "nested";

export type SourceTemplateInsertionContext = {
  insertion: SourceCreationInsertion;
  scope: SourceTemplateInsertionScope;
};

export type SourceTemplateInsertionResolution =
  | { kind: "safe"; context: SourceTemplateInsertionContext }
  | { kind: "unsafe" };

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

const openingBraceLineFor = (info: StatementInfo): number | undefined =>
  info.openBraceLine ?? (info.range.endLine > info.endLine ? info.endLine : undefined);

const openBlockContainsInsertionLine = (info: StatementInfo, line: number): boolean =>
  openingBraceLineFor(info) !== undefined &&
  info.closeBraceLine !== undefined &&
  openingBraceLineFor(info)! < line &&
  line <= info.closeBraceLine;

/**
 * Resolves the existing statement-safe Source boundary and classifies only
 * the structural scopes needed by the current template catalog. The parser
 * and compiler remain the owners of statement identity and lexical structure.
 */
export const resolveSourceTemplateInsertion = ({
  cursor,
  compiled
}: {
  cursor: SourceCreationCursor;
  compiled: CompiledDslDocument;
}): SourceTemplateInsertionResolution => {
  const insertion = resolveSourceCreationInsertion({
    cursor,
    sourceRevision: compiled.spans.sourceMap.sourceRevision,
    elements: [...compiled.sourceElementsByStatementIndex.values()],
    statementMap: compiled.statementMap
  });
  if (insertion.kind !== "safe") return { kind: "unsafe" };

  const statementMap = compiled.statementMap;
  if (!statementMap) return { kind: "unsafe" };
  const enclosingBlocks = statementMap.statements.filter((info) =>
    openBlockContainsInsertionLine(info, insertion.insertion.sourceInsertionLine)
  );
  if (enclosingBlocks.length === 0) {
    return {
      kind: "safe",
      context: {
        insertion: insertion.insertion,
        scope: insertion.insertion.insertionTarget.parentGroupId === undefined ? "top-level" : "nested"
      }
    };
  }
  if (enclosingBlocks.length === 1 && enclosingBlocks[0]?.kind === "layout") {
    return {
      kind: "safe",
      context: { insertion: insertion.insertion, scope: "direct-layout-body" }
    };
  }
  return {
    kind: "safe",
    context: { insertion: insertion.insertion, scope: "nested" }
  };
};

export const sourceOutputTemplateIsLegalIn = (
  templateId: SourceOutputTemplateId,
  scope: SourceTemplateInsertionScope
): boolean => templateId === "place"
  ? scope === "direct-layout-body"
  : scope === "top-level";
