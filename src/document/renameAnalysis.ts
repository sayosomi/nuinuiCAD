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
  type RenameReferencePath,
  type RenameReferenceState
} from "./renameReferenceCatalog";

export type { RenameReferenceForm, RenameReferencePath, RenameReferenceState } from "./renameReferenceCatalog";

export type RenameOccurrence = {
  line: number;
  owner: { kind: "element"; elementId: ElementId } | { kind: "print-layout"; layoutId: string };
  referencedElementId: ElementId;
  form: RenameReferenceForm;
  path: RenameReferencePath;
};

export type RenameResolutionChange = {
  line: number;
  form: RenameReferenceForm;
  path: RenameReferencePath;
  before: RenameReferenceState;
  after: RenameReferenceState;
};

export type RenameAnalysisInput = {
  sourceText: string;
  compiled: CompiledDslDocument;
  targetElementId: ElementId;
  newName: string;
};

export type RenameReferenceStabilityInput = {
  before: CompiledDslDocument;
  after: CompiledDslDocument;
  targetElementId: ElementId;
};

export type RenameReferenceStability =
  | { verdict: "ok" }
  | {
      verdict: "rejected";
      reason: "analysis-incomplete" | "resolution-change";
      detail: { changes?: RenameResolutionChange[]; message?: string };
    };

export type RenameAnalysis =
  | {
      verdict: "ok";
      newName: string;
      occurrences: RenameOccurrence[];
      expectedPatchedLines: number[];
    }
  | {
      verdict: "rejected";
      reason:
        | "invalid-source"
        | "target-not-found"
        | "invalid-name"
        | "same-scope-conflict"
        | "analysis-incomplete"
        | "resolution-change";
      detail: Record<string, unknown>;
    };

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
  const probe = parseDsl(`point ${formatDslName(name)} = (0, 0)`);
  const statement = probe.statements[0];
  if (probe.diagnostics.some((diagnostic) => diagnostic.severity === "error") || statement?.name !== name) {
    return "名前を DSL トークンとして安全に表現できません。";
  }
  return null;
};

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
  const affectedIds = descendantIds(input.before.document, input.targetElementId);
  const afterByKey = new Map(afterCatalog.slots.map((slot) => [slot.key, slot]));
  const changes: RenameResolutionChange[] = [];
  for (const before of beforeCatalog.slots) {
    if (before.state.status === "resolved" && affectedIds.has(before.state.elementId)) continue;
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
        form: before.form,
        path: before.path,
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

  // Existing renameElement delegates its requestedName to makeUniqueElementName,
  // which trims input before collision handling. Keep that established rule here.
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
    return {
      verdict: "rejected",
      reason: "same-scope-conflict",
      detail: {
        targetElementId: target.id,
        newName,
        conflictingElementId: conflict?.id,
        conflictingElementName: conflict?.name,
        conflictingLine: conflict ? input.compiled.statementMap.byElementId.get(conflict.id)?.line : undefined
      }
    };
  }

  const afterDocument: DslDocumentData = {
    ...input.compiled.document,
    elements: input.compiled.document.elements.map((element) =>
      element.id === target.id ? { ...element, name: newName } : element
    )
  };
  const expected = serializerChangedStatementLines(input.compiled, afterDocument);
  if (!expected) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: "serializer比較の行集合を作れません。" } };
  }
  const candidate = recompileRenameCandidate(input.compiled, input.sourceText, afterDocument);
  if ("error" in candidate) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: candidate.error } };
  }
  const stability = validateRenameReferenceStability({
    before: input.compiled,
    after: candidate.compiled,
    targetElementId: target.id
  });
  if (stability.verdict === "rejected") {
    return { verdict: "rejected", reason: stability.reason, detail: stability.detail };
  }
  const catalog = collectRenameReferenceCatalog(input.compiled);
  if (!catalog.complete) {
    return { verdict: "rejected", reason: "analysis-incomplete", detail: { message: catalog.message } };
  }
  const affectedIds = descendantIds(input.compiled.document, target.id);
  const occurrences = catalog.slots.flatMap((slot) =>
    slot.state.status === "resolved" && affectedIds.has(slot.state.elementId)
      ? [{
          line: slot.line,
          owner: slot.owner,
          referencedElementId: slot.state.elementId,
          form: slot.form,
          path: slot.path
        }]
      : []
  );
  return { verdict: "ok", newName, occurrences, expectedPatchedLines: expected };
};
