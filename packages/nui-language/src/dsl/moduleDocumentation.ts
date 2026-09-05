import type { StatementIdentity } from "../document/statementIdentity";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import type { DslStatement } from "./dslTypes";
import type {
  ModuleDefinitionSemantic,
  ModuleSemanticAnalysis,
  ResolvedModuleExport,
  ResolvedModuleParameter
} from "./moduleSemanticTypes";

export type ModuleDocumentationLocaleVariant = {
  locale: string;
  markdown: string;
};

export type ModuleDocumentation = {
  /** Non-empty explicit locale variants in first-authored locale order. */
  variants: readonly ModuleDocumentationLocaleVariant[];
};

export type ModuleDocumentationParameter = {
  parameterIndex: number;
  documentation: ModuleDocumentation;
};

export type ModuleDocumentationExport = {
  exportedStatementId: StatementIdentity;
  documentation: ModuleDocumentation;
};

/** Raw documentation attached to one defining Module identity. The public
 * API copies this metadata unchanged through generic re-export entries. */
export type ModuleDocumentationMetadata = {
  definition: ModuleDocumentation | null;
  parameters: readonly ModuleDocumentationParameter[];
  exports: readonly ModuleDocumentationExport[];
};

/**
 * Source-semantic documentation keyed only by existing stable Module identities.
 * No textual name registry is introduced: parameter identity is
 * (definitionStatementId, parameterIndex) and export identity is
 * (ownerModuleDefinitionStatementId, exportedStatementId).
 */
export type ModuleDocumentationIndex = {
  definitions: ReadonlyMap<StatementIdentity, ModuleDocumentation>;
  parameters: ReadonlyMap<StatementIdentity, ReadonlyMap<number, ModuleDocumentation>>;
  exports: ReadonlyMap<StatementIdentity, ReadonlyMap<StatementIdentity, ModuleDocumentation>>;
};

type DocumentationSection = {
  locale: string;
  lines: string[];
};

const payloadForDocComment = (comment: string) => {
  const payload = comment.slice(3);
  return /^[ \t]/.test(payload) ? payload.slice(1) : payload;
};

const localeMarker = (payload: string) => {
  const match = payload.trim().match(/^@(\S+)$/);
  return match?.[1] ?? null;
};

const sectionsForGroup = (comments: readonly string[]): DocumentationSection[] => {
  const sections: DocumentationSection[] = [];
  let current: DocumentationSection | null = null;

  const flush = () => {
    if (!current) return;
    if (current.lines.some((line) => line.trim().length > 0)) sections.push(current);
    current = null;
  };

  for (const comment of comments) {
    const payload = payloadForDocComment(comment);
    const marker = localeMarker(payload);
    if (marker !== null) {
      flush();
      current = { locale: marker, lines: [] };
      continue;
    }
    // No implicit locale: payload before the first explicit marker in each
    // physical /// group is deliberately ignored.
    current?.lines.push(payload);
  }
  flush();
  return sections;
};

export const parseModuleDocumentationGroups = (
  groups: readonly (readonly string[])[]
): ModuleDocumentation | null => {
  const variants: ModuleDocumentationLocaleVariant[] = [];
  const variantIndexByLocale = new Map<string, number>();

  for (const group of groups) {
    for (const section of sectionsForGroup(group)) {
      const markdown = section.lines.join("\n");
      const existingIndex = variantIndexByLocale.get(section.locale);
      if (existingIndex === undefined) {
        variantIndexByLocale.set(section.locale, variants.length);
        variants.push({ locale: section.locale, markdown });
        continue;
      }
      const existing = variants[existingIndex]!;
      variants[existingIndex] = {
        locale: existing.locale,
        markdown: `${existing.markdown}\n${markdown}`
      };
    }
  }

  return variants.length > 0 ? { variants } : null;
};

export const moduleDocumentationLineStarts = (source: string) => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const lineIndexAtOffset = (starts: readonly number[], offset: number) => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
};

const firstPhysicalOffset = (span: DslPhysicalSpan | null | undefined) =>
  span?.segments[0]?.from ?? null;

/**
 * Walk upward from a target declaration until the first real code line.
 * Blank lines and ordinary comments therefore do not break association, but
 * they do split physical /// groups so locale state never leaks into a later
 * group that has no explicit locale marker.
 */
const documentationGroupsBeforeLine = (
  spans: DiagnosticSpanContext,
  targetLineIndex: number,
  minimumLineIndex: number
): string[][] => {
  const groupsNearestFirst: string[][] = [];
  let currentNearestFirst: string[] = [];

  const flush = () => {
    if (currentNearestFirst.length === 0) return;
    groupsNearestFirst.push([...currentNearestFirst].reverse());
    currentNearestFirst = [];
  };

  for (let lineIndex = targetLineIndex - 1; lineIndex >= minimumLineIndex; lineIndex -= 1) {
    const line = spans.sourceMap.lexicalLines[lineIndex];
    if (!line) break;
    // A trailing same-line /// has non-empty codeText and is therefore neither
    // backward-attached nor allowed to flow forward across that real code.
    if (line.codeText.trim().length > 0) break;

    const docComment = line.comments.find(
      (comment) => comment.kind === "line" && comment.text.startsWith("///")
    );
    if (docComment) currentNearestFirst.push(docComment.text);
    else flush();
  }
  flush();
  return groupsNearestFirst.reverse();
};

const documentationBeforeLine = (
  spans: DiagnosticSpanContext,
  targetLineIndex: number,
  minimumLineIndex: number
) => parseModuleDocumentationGroups(
  documentationGroupsBeforeLine(spans, targetLineIndex, minimumLineIndex)
);

const statementIsCurrent = (statement: DslStatement | undefined, spans: DiagnosticSpanContext) =>
  Boolean(statement && statement.sourceRevision === spans.sourceMap.sourceRevision);

const setNested = <K1, K2, V>(
  outer: Map<K1, Map<K2, V>>,
  first: K1,
  second: K2,
  value: V
) => {
  const nested = outer.get(first) ?? new Map<K2, V>();
  nested.set(second, value);
  outer.set(first, nested);
};

type ModuleDocumentationSourceExport = {
  statementIndex: number;
  statementId: StatementIdentity;
};

/** Extract raw Module documentation from one exact parsed source artifact.
 * This deliberately uses statement identities supplied by the graph owner;
 * it does not resolve or index documentation by display name. */
export const buildModuleDocumentationMetadata = ({
  statements,
  spans,
  definitionStatementIndex,
  parameterIndexes,
  exports: sourceExports,
  lineStarts = moduleDocumentationLineStarts(spans.sourceMap.source)
}: {
  statements: readonly DslStatement[];
  spans: DiagnosticSpanContext;
  definitionStatementIndex: number;
  parameterIndexes: readonly number[];
  exports: readonly ModuleDocumentationSourceExport[];
  lineStarts?: readonly number[];
}): ModuleDocumentationMetadata | null => {
  const statement = statements[definitionStatementIndex];
  if (!statement || statement.kind !== "moduleDefinition" || !statementIsCurrent(statement, spans)) return null;

  const moduleMinimumLine = Math.max(0, statement.line - 1);
  const definition = documentationBeforeLine(spans, statement.line - 1, 0);
  const parameters: ModuleDocumentationParameter[] = [];
  for (const parameterIndex of parameterIndexes) {
    const sourceParameter = statement.parameters[parameterIndex];
    if (!sourceParameter) continue;
    const physical = sourceParameter.namePhysicalSpan ?? (
      sourceParameter.nameSpan
        ? exactPhysicalSpan(spans, statement, sourceParameter.nameSpan)
        : null
    );
    const offset = firstPhysicalOffset(physical);
    if (offset === null) continue;
    const documentation = documentationBeforeLine(
      spans,
      lineIndexAtOffset(lineStarts, offset),
      moduleMinimumLine
    );
    if (documentation) parameters.push({ parameterIndex, documentation });
  }

  const documentedExports: ModuleDocumentationExport[] = [];
  for (const sourceExport of sourceExports) {
    const exportedStatement = statements[sourceExport.statementIndex];
    if (!exportedStatement || !statementIsCurrent(exportedStatement, spans)) continue;
    const documentation = documentationBeforeLine(
      spans,
      exportedStatement.line - 1,
      moduleMinimumLine
    );
    if (documentation) documentedExports.push({ exportedStatementId: sourceExport.statementId, documentation });
  }

  return {
    definition,
    parameters,
    exports: documentedExports
  };
};

export const buildModuleDocumentationIndex = ({
  statements,
  spans,
  semanticAnalysis
}: {
  statements: readonly DslStatement[];
  spans: DiagnosticSpanContext;
  semanticAnalysis: ModuleSemanticAnalysis;
}): ModuleDocumentationIndex => {
  const definitions = new Map<StatementIdentity, ModuleDocumentation>();
  const parameters = new Map<StatementIdentity, Map<number, ModuleDocumentation>>();
  const exports = new Map<StatementIdentity, Map<StatementIdentity, ModuleDocumentation>>();
  const lineStarts = moduleDocumentationLineStarts(spans.sourceMap.source);

  for (const definition of semanticAnalysis.definitions) {
    const statement = statements[definition.statementIndex];
    if (!statementIsCurrent(statement, spans) || statement?.kind !== "moduleDefinition") continue;
    const metadata = buildModuleDocumentationMetadata({
      statements,
      spans,
      definitionStatementIndex: definition.statementIndex,
      parameterIndexes: definition.parameters.map((parameter) => parameter.parameterIndex),
      exports: definition.exports.map((exported) => ({
        statementIndex: exported.exportedStatementIndex,
        statementId: exported.exportedStatementId
      })),
      lineStarts
    });
    if (!metadata) continue;
    if (metadata.definition) definitions.set(definition.statementId, metadata.definition);
    for (const parameter of metadata.parameters) {
      setNested(parameters, definition.statementId, parameter.parameterIndex, parameter.documentation);
    }
    for (const exported of metadata.exports) {
      setNested(exports, definition.statementId, exported.exportedStatementId, exported.documentation);
    }
  }

  return { definitions, parameters, exports };
};

export const documentationForModuleDefinition = (
  index: ModuleDocumentationIndex,
  definition: Pick<ModuleDefinitionSemantic, "statementId">
) => index.definitions.get(definition.statementId) ?? null;

export const documentationForModuleParameter = (
  index: ModuleDocumentationIndex,
  parameter: Pick<ResolvedModuleParameter, "definitionStatementId" | "parameterIndex">
) => index.parameters.get(parameter.definitionStatementId)?.get(parameter.parameterIndex) ?? null;

export const documentationForModuleExport = (
  index: ModuleDocumentationIndex,
  exported: Pick<ResolvedModuleExport, "ownerModuleDefinitionStatementId" | "exportedStatementId">
) => index.exports.get(exported.ownerModuleDefinitionStatementId)?.get(exported.exportedStatementId) ?? null;

export const documentationForModuleDefinitionMetadata = (
  metadata: ModuleDocumentationMetadata | null | undefined
) => metadata?.definition ?? null;

export const documentationForModuleParameterMetadata = (
  metadata: ModuleDocumentationMetadata | null | undefined,
  parameter: Pick<ResolvedModuleParameter, "parameterIndex">
) => metadata?.parameters.find((candidate) => candidate.parameterIndex === parameter.parameterIndex)?.documentation ?? null;

export const documentationForModuleExportMetadata = (
  metadata: ModuleDocumentationMetadata | null | undefined,
  exported: Pick<ResolvedModuleExport, "exportedStatementId">
) => metadata?.exports.find((candidate) => candidate.exportedStatementId === exported.exportedStatementId)?.documentation ?? null;
