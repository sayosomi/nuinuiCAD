import type { CompiledDslDocument, DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { formatDslName } from "../dsl/dslTokens";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { ElementId } from "../types/geometry";
import {
  completeCompiled,
  recompileRenameCandidate,
  serializerChangedStatementLines
} from "./renameAnalysisCandidate";
import {
  collectRenameReferenceCatalog,
  type RenameReferenceForm,
  type RenameReferenceState
} from "./renameReferenceCatalog";

export type { RenameReferenceForm, RenameReferenceState } from "./renameReferenceCatalog";

export type RenameOccurrence = {
  line: number;
  owner: { kind: "element"; elementId: ElementId } | { kind: "print-layout"; layoutId: string };
  referencedElementId: ElementId;
  form: RenameReferenceForm;
};

export type RenameResolutionChange = {
  line: number;
  owner: RenameOccurrence["owner"];
  form: RenameReferenceForm;
  before: RenameReferenceState;
  after: RenameReferenceState;
};

export type RenameInvalidSourceDetail = { message: string };
export type RenameTargetNotFoundDetail = { targetElementId: ElementId };
export type RenameInvalidNameDetail = { input: string; message: string };
export type RenameSameScopeConflictDetail = {
  targetElementId: ElementId;
  newName: string;
  conflictingElementId: ElementId;
  conflictingElementName: string;
  conflictingLine: number;
};
export type RenameAnalysisIncompleteDetail = { message: string };
export type RenameResolutionChangeDetail = { changes: RenameResolutionChange[] };

export type RenameAnalysisRejected =
  | { verdict: "rejected"; reason: "invalid-source"; detail: RenameInvalidSourceDetail }
  | { verdict: "rejected"; reason: "target-not-found"; detail: RenameTargetNotFoundDetail }
  | { verdict: "rejected"; reason: "invalid-name"; detail: RenameInvalidNameDetail }
  | { verdict: "rejected"; reason: "same-scope-conflict"; detail: RenameSameScopeConflictDetail }
  | { verdict: "rejected"; reason: "analysis-incomplete"; detail: RenameAnalysisIncompleteDetail }
  | { verdict: "rejected"; reason: "resolution-change"; detail: RenameResolutionChangeDetail };

export type RenameAnalysisInput = {
  sourceText: string;
  compiled: CompiledDslDocument;
  targetElementId: ElementId;
  newName: string;
};

export type RenameReferenceStabilityInput = {
  before: CompiledDslDocument;
  after: CompiledDslDocument;
};

export type RenameReferenceStability =
  | { verdict: "ok" }
  | Extract<RenameAnalysisRejected, { reason: "analysis-incomplete" | "resolution-change" }>;

export type RenameAnalysis =
  | {
      verdict: "ok";
      newName: string;
      occurrences: RenameOccurrence[];
      expectedPatchedLines: number[];
    }
  | RenameAnalysisRejected;

const descendantIds = (document: DslDocumentData, rootId: ElementId) => {
  const ids = new Set<ElementId>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of document.elements) {
      if (!element.parentGroupId || !ids.has(element.parentGroupId) || ids.has(element.id)) continue;
      ids.add(element.id);
      changed = true;
    }
  }
  return ids;
};

const validationError = (name: string) => {
  if (!name) return "名前は空にできません。";
  if (name.includes("::")) return "名前に `::` は使用できません。";
  const probe = parseDsl(`point ${formatDslName(name)} = coordinate(x: 0 ,y: 0)`);
  const statement = probe.statements[0];
  if (probe.diagnostics.some((diagnostic) => diagnostic.severity === "error") || statement?.name !== name) {
    return "名前を DSL トークンとして安全に表現できません。";
  }
  return null;
};

/** Compares every before/after reference slot; rename targets receive no exception. */
export const validateRenameReferenceStability = (
  input: RenameReferenceStabilityInput
): RenameReferenceStability => {
  if (!completeCompiled(input.before) || !completeCompiled(input.after)) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: "完全なコンパイル結果が必要です。" } };
  }
  const beforeCatalog = collectRenameReferenceCatalog(input.before);
  const afterCatalog = collectRenameReferenceCatalog(input.after);
  if (!beforeCatalog.complete) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: beforeCatalog.message } };
  }
  if (!afterCatalog.complete) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: afterCatalog.message } };
  }
  const afterByKey = new Map(afterCatalog.slots.map((slot) => [slot.key, slot]));
  if (
    beforeCatalog.slots.length !== afterCatalog.slots.length ||
    new Set(beforeCatalog.slots.map((slot) => slot.key)).size !== beforeCatalog.slots.length ||
    afterByKey.size !== afterCatalog.slots.length
  ) {
    return {
      verdict: "rejected",
      reason: "analysis-incomplete",
      detail: { message: "参照スロットの総数またはキー集合を対応付けられません。" }
    };
  }
  const beforeKeys = new Set(beforeCatalog.slots.map((slot) => slot.key));
  if ([...afterByKey.keys()].some((key) => !beforeKeys.has(key))) {
    return {
      verdict: "rejected",
      reason: "analysis-incomplete",
      detail: { message: "参照スロットを対応付けられません。" }
    };
  }
  const changes: RenameResolutionChange[] = [];
  for (const before of beforeCatalog.slots) {
    const after = afterByKey.get(before.key);
    if (!after) {
      return {
        verdict: "rejected",
        reason: "analysis-incomplete",
        detail: { message: `参照スロットを対応付けられません: ${before.key}` }
      };
    }
    if (
      before.state.status !== after.state.status ||
      (before.state.status === "resolved" && after.state.status === "resolved" && before.state.elementId !== after.state.elementId) ||
      (before.state.status === "dangling" && after.state.status === "dangling" && before.state.token !== after.state.token)
    ) {
      changes.push({
        line: before.line,
        owner: before.owner,
        form: before.form,
        before: before.state,
        after: after.state
      });
    }
  }
  return changes.length > 0
    ? { verdict: "rejected", reason: "resolution-change", detail: { changes } }
    : { verdict: "ok" };
};

export const analyzeRename = (input: RenameAnalysisInput): RenameAnalysis => {
  if (!completeCompiled(input.compiled) || input.compiled.sourceLines.join("\n") !== input.sourceText.replace(/\r\n/g, "\n")) {
    return { verdict: "rejected", reason: "invalid-source", detail: { message: "sourceText と compiled が一致しません。" } };
  }
  const target = input.compiled.document.elements.find((element) => element.id === input.targetElementId);
  if (!target) {
    return { verdict: "rejected", reason: "target-not-found", detail: { targetElementId: input.targetElementId } };
  }

  // The retired store renameElement delegated its requestedName to makeUniqueElementName,
  // which trimmed input before collision handling. Keep that established rule here.
  const newName = input.newName.trim();
  const nameError = validationError(newName);
  if (nameError) return { verdict: "rejected", reason: "invalid-name", detail: { input: input.newName, message: nameError } };

  const uniqueName = makeUniqueElementName({
    elements: input.compiled.document.elements,
    elementId: target.id,
    requestedName: input.newName,
    fallbackBaseName: fallbackElementName(target.type),
    parentGroupId: target.parentGroupId
  });
  if (uniqueName !== newName) {
    const conflict = input.compiled.document.elements.find(
      (element) =>
        element.id !== target.id &&
        element.parentGroupId === target.parentGroupId &&
        element.name.trim() === newName
    );
    if (!conflict) {
      return {
        verdict: "rejected",
        reason: "analysis-incomplete",
        detail: { message: "同一スコープの衝突要素を特定できません。" }
      };
    }
    const conflictingLine = input.compiled.statementMap.byElementId.get(conflict.id)?.line;
    if (conflictingLine === undefined) {
      return {
        verdict: "rejected",
        reason: "analysis-incomplete",
        detail: { message: `衝突要素 ${conflict.id} の行位置を特定できません。` }
      };
    }
    return {
      verdict: "rejected",
      reason: "same-scope-conflict",
      detail: {
        targetElementId: target.id,
        newName,
        conflictingElementId: conflict.id,
        conflictingElementName: conflict.name,
        conflictingLine
      }
    };
  }

  const afterDocument: DslDocumentData = {
    ...input.compiled.document,
    elements: input.compiled.document.elements.map((element) =>
      element.id === target.id ? { ...element, name: newName } : element
    )
  };
  const changedStatements = serializerChangedStatementLines(input.compiled, afterDocument);
  if (!changedStatements) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: "serializer比較の行集合を作れません。" } };
  }
  const candidate = recompileRenameCandidate(input.compiled, input.sourceText, afterDocument);
  if ("error" in candidate) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: candidate.error } };
  }
  const stability = validateRenameReferenceStability({
    before: input.compiled,
    after: candidate.compiled
  });
  if (stability.verdict === "rejected") {
    return stability;
  }
  const catalog = collectRenameReferenceCatalog(input.compiled);
  if (!catalog.complete) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: catalog.message } };
  }
  const affectedIds = descendantIds(input.compiled.document, target.id);
  const occurrences = catalog.slots.flatMap((slot) =>
    slot.state.status === "resolved" &&
    affectedIds.has(slot.state.elementId) &&
    (slot.owner.kind === "element"
      ? changedStatements.changedElementIds.has(slot.owner.elementId)
      : changedStatements.changedPrintLayoutIds.has(slot.owner.layoutId) &&
        (changedStatements.preciselyChangedPrintLayoutLinesById.get(slot.owner.layoutId)?.has(slot.line) ?? true))
      ? [{
          line: slot.line,
          owner: slot.owner,
          referencedElementId: slot.state.elementId,
          form: slot.form
        }]
      : []
  );
  return { verdict: "ok", newName, occurrences, expectedPatchedLines: changedStatements.expectedPatchedLines };
};
