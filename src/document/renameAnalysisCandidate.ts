import {
  compileDslDocument,
  planPrintLayoutSection,
  type CompiledDslDocument,
  type DslDocumentData
} from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { documentDslRefs } from "../dsl/dslSerializer";
import { serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import { applyLineSplices, buildTextPatch } from "./textPatch";
import { reconcileStatements } from "./statementReconciler";
import type { ElementId } from "../types/geometry";

export type CompleteCompiled = CompiledDslDocument & {
  document: DslDocumentData;
  statementMap: NonNullable<CompiledDslDocument["statementMap"]>;
};

export const completeCompiled = (compiled: CompiledDslDocument): compiled is CompleteCompiled =>
  Boolean(compiled.document && compiled.statementMap);

export type SerializerChangedStatements = {
  expectedPatchedLines: number[];
  changedElementIds: Set<ElementId>;
  changedPrintLayoutIds: Set<string>;
  /**
   * Present only when the printLayout plan && the source statement range
   * prove an exact line-for-line correspondence. Callers must retain block
   * granularity when a layout is absent from this map.
   */
  preciselyChangedPrintLayoutLinesById: Map<string, Set<number>>;
};

// This intentionally does not call buildTextPatch. The expected set is an
// independent comparison of existing serializer output in old-text coordinates.
export const serializerChangedStatementLines = (
  before: CompleteCompiled,
  afterDocument: DslDocumentData
): SerializerChangedStatements | null => {
  // `document` non-null guarantees `majorVersion` non-null too (compileDslDocument only
  // returns a document once version validation succeeded); the fallback below is
  // defensive only, to satisfy the nullable static type.
  const refsBefore = documentDslRefs(before.document.elements);
  const refsAfter = documentDslRefs(afterDocument.elements);
  const afterElementsById = new Map(afterDocument.elements.map((element) => [element.id, element]));
  const lines = new Set<number>();
  const changedElementIds = new Set<ElementId>();
  const changedPrintLayoutIds = new Set<string>();
  const preciselyChangedPrintLayoutLinesById = new Map<string, Set<number>>();

  for (const element of before.document.elements) {
    const next = afterElementsById.get(element.id);
    const info = before.statementMap.byElementId.get(element.id);
    if (!next || !info) return null;
    if (serializeElementStatementLogical(element, refsBefore) !== serializeElementStatementLogical(next, refsAfter)) {
      // v2正準出力は縦型callで複数物理行になり得るため、変更statementの
      // range全体(次行単独`{`を伴っていた場合はそれも含む)を期待パッチ行と
      // する — buildTextPatch(textPatch.ts の effectiveEndLine)と同じ範囲。
      const endLine = Math.max(info.endLine, info.openBraceLine ?? 0);
      for (let line = info.line; line <= endLine; line += 1) lines.add(line);
      changedElementIds.add(element.id);
    }
  }

  const beforePlan = planPrintLayoutSection(before.document);
  const afterPlan = planPrintLayoutSection(afterDocument);
  const afterBlocks = new Map(afterPlan.blocks.map((block) => [block.layoutId, block]));
  for (const block of beforePlan.blocks) {
    const next = afterBlocks.get(block.layoutId);
    const info = before.statementMap.byKey.get(`printLayout:${block.layoutId}`);
    if (!next || !info) return null;
    if (block.lines.join("\n") !== next.lines.join("\n")) {
      changedPrintLayoutIds.add(block.layoutId);
      for (let line = info.range.startLine; line <= info.range.endLine; line += 1) lines.add(line);

      // printLayout is patched as one block. We may nevertheless narrow
      // occurrence metadata when (and only when) the generated plan has the
      // exact same number of lines as the source statement range. This is a
      // structural proof, not a best-effort alignment across comments ||
      // other source-only lines.
      const rangeLength = info.range.endLine - info.range.startLine + 1;
      if (rangeLength === block.lines.length && block.lines.length === next.lines.length) {
        const changedLines = new Set<number>();
        block.lines.forEach((line, index) => {
          if (line !== next.lines[index]) changedLines.add(info.range.startLine + index);
        });
        preciselyChangedPrintLayoutLinesById.set(block.layoutId, changedLines);
      }
    }
  }
  return beforePlan.blocks.length === afterPlan.blocks.length
    ? {
        expectedPatchedLines: [...lines].sort((a, b) => a - b),
        changedElementIds,
        changedPrintLayoutIds,
        preciselyChangedPrintLayoutLinesById
      }
    : null;
};

export const recompileRenameCandidate = (
  before: CompleteCompiled,
  sourceText: string,
  afterDocument: DslDocumentData
): { compiled: CompleteCompiled } | { error: string } => {
  let patchedText: string;
  try {
    patchedText = applyLineSplices(sourceText, buildTextPatch({ old: before, newDocument: afterDocument }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const parsed = parseDsl(patchedText);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { error: "rename候補テキストの構文解析に失敗しました。" };
  }
  let reconciled;
  try {
    reconciled = reconcileStatements({
    oldStatements: before.statements,
    oldLines: before.sourceLines,
    oldElementIds: before.statementMap.elementIdByStatementIndex,
    oldStatementIds: before.statementMap.statementIdByStatementIndex,
      newStatements: parsed.statements,
      newLines: patchedText.replace(/\r\n/g, "\n").split("\n")
    }, {
      createId: () => {
        throw new Error("rename候補の再コンパイルで新規IDが必要になりました。");
      }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const compiled = compileDslDocument(patchedText, {
    preparsed: parsed,
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds
  });
  if (!completeCompiled(compiled)) return { error: "rename候補テキストの再コンパイルに失敗しました。" };
  const idsMatch =
    compiled.document.elements.length === afterDocument.elements.length &&
    compiled.document.elements.every((element, index) => element.id === afterDocument.elements[index]?.id);
  return idsMatch
    ? { compiled }
    : { error: "rename候補の再コンパイルで既存IDを継承できませんでした。" };
};
