import {
  compileDslDocument,
  serializeDocumentToDsl,
  type CompiledDslDocument,
  type DslDocumentData,
  type StatementMap
} from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { DslDiagnostic } from "../dsl/dslTypes";
import { createCadElementId } from "../model/cadIds";
import type { ElementId } from "../types/geometry";
import { applyLineSplices, buildTextPatch, type LineSplice } from "./textPatch";
import { reconcileStatements } from "./statementReconciler";
import { zipAssignedElementIds } from "./shadowText";

export type LastGoodDslDocument = Omit<CompiledDslDocument, "document" | "statementMap"> & {
  document: DslDocumentData;
  statementMap: StatementMap;
};

export type CanonicalDocumentValue = {
  sourceText: string;
  doc: LastGoodDslDocument;
  docText: string;
  diagnostics: DslDiagnostic[];
};

export type TextCompileResult = CanonicalDocumentValue & {
  status: "valid" | "warning" | "fatal";
};

export type ModelBridgeResult =
  | { status: "committed"; value: CanonicalDocumentValue; splices: LineSplice[] }
  | { status: "noop" }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string };

// sourceTextは保存対象そのもの。改行やBOMをここで正規化しない。
const normalizedText = (text: string) => text;

const compileLines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

export const isLastGoodDslDocument = (
  compiled: CompiledDslDocument
): compiled is LastGoodDslDocument => Boolean(compiled.document && compiled.statementMap);

const adoptElementObjects = (
  compiled: LastGoodDslDocument,
  elements: DslDocumentData["elements"]
): LastGoodDslDocument => ({
  ...compiled,
  document: {
    ...compiled.document,
    elements
  }
});

export const compileCanonicalText = (
  current: CanonicalDocumentValue,
  nextText: string,
  options: { createdElementIds?: readonly ElementId[] } = {}
): TextCompileResult => {
  const sourceText = normalizedText(nextText);
  const parsed = parseDsl(sourceText);
  const createdElementIds = [...(options.createdElementIds ?? [])];
  const reconciled = reconcileStatements({
    oldStatements: current.doc.statements,
    oldLines: current.doc.sourceLines,
    oldElementIds: current.doc.statementMap.elementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: compileLines(sourceText)
  }, {
    createId: (type) => createdElementIds.shift() ?? createCadElementId(type)
  });
  const compiled = compileDslDocument(sourceText, {
    assignedElementIds: reconciled.assignedIds,
    preparsed: parsed
  });

  if (!isLastGoodDslDocument(compiled)) {
    return {
      sourceText,
      doc: current.doc,
      docText: current.docText,
      diagnostics: compiled.diagnostics,
      status: "fatal"
    };
  }

  return {
    sourceText,
    doc: compiled,
    docText: sourceText,
    diagnostics: compiled.diagnostics,
    status: compiled.diagnostics.some((item) => item.severity === "warning")
      ? "warning"
      : "valid"
  };
};

const compileZippedModelText = (
  text: string,
  afterDocument: DslDocumentData
): { ok: true; doc: LastGoodDslDocument } | { ok: false; reason: string } => {
  const sourceText = normalizedText(text);
  const parsed = parseDsl(sourceText);
  if (parsed.diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, reason: "モデル差分テキストの構文解析に失敗しました。" };
  }
  const assignedElementIds = zipAssignedElementIds(parsed.statements, afterDocument.elements);
  if (!assignedElementIds) {
    return { ok: false, reason: "モデル差分テキストと要素列の位置対応が崩れました。" };
  }
  const compiled = compileDslDocument(sourceText, {
    assignedElementIds,
    preparsed: parsed
  });
  if (!isLastGoodDslDocument(compiled)) {
    return { ok: false, reason: "モデル差分テキストのコンパイルに失敗しました。" };
  }
  const compiledIds = compiled.document.elements.map((element) => element.id);
  if (
    compiledIds.length !== afterDocument.elements.length ||
    compiledIds.some((id, index) => id !== afterDocument.elements[index].id)
  ) {
    return { ok: false, reason: "モデル差分テキストの要素ID列が一致しません。" };
  }
  return { ok: true, doc: adoptElementObjects(compiled, afterDocument.elements) };
};

export const commitModelBridge = (
  current: CanonicalDocumentValue,
  afterDocument: DslDocumentData
): ModelBridgeResult => {
  if (current.docText !== current.sourceText) {
    return { status: "rejected", reason: "fatalな編集中テキストがあるためモデル編集を適用できません。" };
  }

  let patchedText: string;
  let splices: LineSplice[];
  try {
    splices = buildTextPatch({ old: current.doc, newDocument: afterDocument });
    patchedText = applyLineSplices(
      current.sourceText,
      splices
    );
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  if (patchedText === current.sourceText) return { status: "noop" };

  const compiled = compileZippedModelText(patchedText, afterDocument);
  if (!compiled.ok) return { status: "failed", reason: compiled.reason };

  return {
    status: "committed",
    value: {
      sourceText: patchedText,
      doc: compiled.doc,
      docText: patchedText,
      diagnostics: compiled.doc.diagnostics
    },
    splices
  };
};

export const regenerateCanonicalFromModel = (
  document: DslDocumentData
): CanonicalDocumentValue => {
  const sourceText = serializeDocumentToDsl(document);
  const compiled = compileZippedModelText(sourceText, document);
  if (!compiled.ok) throw new Error(compiled.reason);
  return {
    sourceText,
    doc: compiled.doc,
    docText: sourceText,
    diagnostics: compiled.doc.diagnostics
  };
};
