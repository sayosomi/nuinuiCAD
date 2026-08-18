import type { CompiledDslDocument, DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { formatDslName } from "../dsl/dslTokens";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { CadElement, ElementId } from "../types/geometry";
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
import { applyLineSplices, buildTextPatch } from "./textPatch";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";

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

export type ElementRenameEdit = {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly newText: string;
};

export type ElementRenameEditProjection =
  | { ok: true; edits: readonly ElementRenameEdit[] }
  | { ok: false; reason: string };

export type ElementRenameRequestValidation =
  | { ok: true; target: CadElement; newName: string }
  | { ok: false; rejection: Extract<RenameAnalysisRejected, { reason: "target-not-found" | "invalid-name" | "same-scope-conflict" | "analysis-incomplete" }> };

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

export const validateElementRenameRequest = ({
  compiled,
  targetElementId,
  newName: requestedName
}: {
  compiled: CompiledDslDocument;
  targetElementId: ElementId;
  newName: string;
}): ElementRenameRequestValidation => {
  const target = compiled.document?.elements.find((element) => element.id === targetElementId);
  if (!target) return { ok: false, rejection: { verdict: "rejected", reason: "target-not-found", detail: { targetElementId } } };
  if (!compiled.statementMap) {
    return { ok: false, rejection: { verdict: "rejected", reason: "analysis-incomplete", detail: { message: "完全な compiled document / statementMap が必要です。" } } };
  }
  const ownershipDocument = { ...compiled, statementMap: compiled.statementMap };
  const owner = sourceOwnerForRuntimeElementId(ownershipDocument, targetElementId);
  if (!owner || owner.kind !== "ordinary") {
    return {
      ok: false,
      rejection: { verdict: "rejected", reason: "target-not-found", detail: { targetElementId } }
    };
  }

  const newName = requestedName.trim();
  const nameError = validationError(newName);
  if (nameError) {
    return { ok: false, rejection: { verdict: "rejected", reason: "invalid-name", detail: { input: requestedName, message: nameError } } };
  }
  const sourceElements = compiled.document!.elements.filter((element) =>
    sourceOwnerForRuntimeElementId(ownershipDocument, element.id)?.kind === "ordinary"
  );
  const uniqueName = makeUniqueElementName({
    elements: sourceElements,
    elementId: target.id,
    requestedName,
    fallbackBaseName: fallbackElementName(target.type),
    parentGroupId: target.parentGroupId
  });
  if (uniqueName !== newName) {
    const conflict = sourceElements.find(
      (element) =>
        element.id !== target.id &&
        element.parentGroupId === target.parentGroupId &&
        element.name.trim() === newName
    );
    if (!conflict) {
      return {
        ok: false,
        rejection: { verdict: "rejected", reason: "analysis-incomplete", detail: { message: "同一スコープの衝突要素を特定できません。" } }
      };
    }
    const conflictingLine = compiled.statementMap?.byElementId.get(conflict.id)?.line;
    if (conflictingLine === undefined) {
      return {
        ok: false,
        rejection: { verdict: "rejected", reason: "analysis-incomplete", detail: { message: `衝突要素 ${conflict.id} の行位置を特定できません。` } }
      };
    }
    return {
      ok: false,
      rejection: {
        verdict: "rejected",
        reason: "same-scope-conflict",
        detail: {
          targetElementId: target.id,
          newName,
          conflictingElementId: conflict.id,
          conflictingElementName: conflict.name,
          conflictingLine
        }
      }
    };
  }
  return { ok: true, target, newName };
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
  const validation = validateElementRenameRequest({
    compiled: input.compiled,
    targetElementId: input.targetElementId,
    newName: input.newName
  });
  if (!validation.ok) return validation.rejection;
  const { target, newName } = validation;

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

/**
 * Projects the existing element rename safety result into identifier edits.
 * The serializer remains the safety candidate owner, but only exact
 * old-identifier -> new-identifier substitutions are exposed to host-neutral
 * editors; statement-level patches are never returned as rename edits.
 */
export const projectElementRenameEdits = ({
  sourceText,
  compiled,
  targetElementId,
  analysis
}: {
  sourceText: string;
  compiled: CompiledDslDocument;
  targetElementId: ElementId;
  analysis: Extract<RenameAnalysis, { verdict: "ok" }>;
}): ElementRenameEditProjection => {
  const target = compiled.document?.elements.find((element) => element.id === targetElementId);
  if (!target || !target.name.trim()) return { ok: false, reason: "rename target has no source name" };
  if (analysis.newName === target.name) return { ok: true, edits: [] };
  if (!completeCompiled(compiled)) return { ok: false, reason: "complete compiled document is required" };

  let candidateSource: string;
  try {
    const afterDocument: DslDocumentData = {
      ...compiled.document,
      elements: compiled.document.elements.map((element) =>
        element.id === targetElementId ? { ...element, name: analysis.newName } : element
      )
    };
    candidateSource = applyLineSplices(sourceText, buildTextPatch({ old: compiled, newDocument: afterDocument }));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  const oldSource = sourceText.replace(/\r\n/g, "\n");
  const newSource = candidateSource.replace(/\r\n/g, "\n");
  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");
  if (oldLines.length !== newLines.length) return { ok: false, reason: "rename candidate changed line count" };

  const changedLines = new Set<number>(analysis.expectedPatchedLines);
  const oldIdentifier = formatDslName(target.name);
  const newIdentifier = formatDslName(analysis.newName);
  const edits: ElementRenameEdit[] = [];
  let lineStart = 0;
  for (let lineIndex = 0; lineIndex < oldLines.length; lineIndex += 1) {
    const oldLine = oldLines[lineIndex];
    const newLine = newLines[lineIndex];
    if (oldLine === newLine) {
      lineStart += oldLine.length + 1;
      continue;
    }
    if (!changedLines.has(lineIndex + 1)) return { ok: false, reason: "rename candidate changed an unproved source line" };
    let oldCursor = 0;
    let newCursor = 0;
    while (oldCursor < oldLine.length || newCursor < newLine.length) {
      if (
        oldLine.startsWith(oldIdentifier, oldCursor) &&
        newLine.startsWith(newIdentifier, newCursor)
      ) {
        edits.push({
          from: lineStart + oldCursor,
          to: lineStart + oldCursor + oldIdentifier.length,
          expectedText: oldIdentifier,
          newText: newIdentifier
        });
        oldCursor += oldIdentifier.length;
        newCursor += newIdentifier.length;
        continue;
      }
      if (oldCursor < oldLine.length && newCursor < newLine.length && oldLine[oldCursor] === newLine[newCursor]) {
        oldCursor += 1;
        newCursor += 1;
        continue;
      }
      return { ok: false, reason: "rename candidate contains a non-identifier source change" };
    }
    lineStart += oldLine.length + 1;
  }

  if (edits.length !== 1 + analysis.occurrences.length) {
    return { ok: false, reason: "rename occurrence projection is incomplete" };
  }
  return { ok: true, edits };
};
