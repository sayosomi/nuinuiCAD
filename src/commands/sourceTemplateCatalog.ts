import type { CompiledDslDocument, StatementInfo } from "@nuinuicad/nui-language";
import {
  resolveSourceCreationInsertion,
  type SourceCreationCursor,
  type SourceCreationInsertion
} from "./sourceCreationInsertion";

export const SOURCE_TEMPLATE_FAMILY_DEFINITIONS = [
  { id: "geometry", label: "Geometry" },
  { id: "geometry-value", label: "Geometry Value" },
  { id: "calculation-measurement", label: "Calculation / Measurement" },
  { id: "control-flow", label: "Control Flow" },
  { id: "value-match", label: "Value / Match" },
  { id: "module", label: "Module" },
  { id: "output-print", label: "Output / Print" }
] as const;

export type SourceTemplateFamilyId = (typeof SOURCE_TEMPLATE_FAMILY_DEFINITIONS)[number]["id"];
export type SourceTemplateFamilyQuickPickItem = (typeof SOURCE_TEMPLATE_FAMILY_DEFINITIONS)[number];

export const SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS: readonly SourceTemplateFamilyQuickPickItem[] =
  SOURCE_TEMPLATE_FAMILY_DEFINITIONS;

export type SourceTemplateFamilyRoute =
  | { familyId: "geometry"; kind: "geometry" }
  | { familyId: "geometry-value"; kind: "geometry-value" }
  | { familyId: "calculation-measurement"; kind: "calculation-measurement" }
  | { familyId: "control-flow"; kind: "control-flow" }
  | { familyId: "value-match"; kind: "value-match" }
  | { familyId: "module"; kind: "module" }
  | { familyId: "output-print"; kind: "output-print" };

const unreachableFamily = (familyId: never): never => {
  throw new Error(`Unsupported Source Template family: ${String(familyId)}`);
};

/**
 * Maps a selected family identity to its canonical flow. Keep this switch
 * exhaustive so a future family cannot silently fall through to Output / Print.
 */
export const sourceTemplateRouteFor = (familyId: SourceTemplateFamilyId): SourceTemplateFamilyRoute => {
  switch (familyId) {
    case "geometry":
      return { familyId, kind: "geometry" };
    case "geometry-value":
      return { familyId, kind: "geometry-value" };
    case "calculation-measurement":
      return { familyId, kind: "calculation-measurement" };
    case "control-flow":
      return { familyId, kind: "control-flow" };
    case "value-match":
      return { familyId, kind: "value-match" };
    case "module":
      return { familyId, kind: "module" };
    case "output-print":
      return { familyId, kind: "output-print" };
  }
  return unreachableFamily(familyId);
};

export type SourceTemplateInsertionScope = "top-level" | "direct-layout-body" | "nested";

export type SourceTemplateInsertionContext = {
  insertion: SourceCreationInsertion;
  scope: SourceTemplateInsertionScope;
};

export type SourceTemplateInsertionResolution =
  | { kind: "safe"; context: SourceTemplateInsertionContext }
  | { kind: "unsafe" };

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
