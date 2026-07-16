import {
  validateRenameReferenceStability,
  type RenameReferenceStabilityInput
} from "../document/renameAnalysis";
import type { SourceUpdate } from "../editor/sourceEditorTypes";

type RenameBridgeDevAssertInput = RenameReferenceStabilityInput & {
  expectedPatchedLines: readonly number[];
  beforeSourceRevision: number;
  afterSourceRevision: number;
  sourceUpdate: SourceUpdate;
};

const patchedLines = (sourceUpdate: Extract<SourceUpdate, { kind: "model-patch" }>) => {
  const lines = new Set<number>();
  for (const splice of sourceUpdate.splices) {
    if (splice.endLine < splice.startLine) {
      throw new Error("rename bridge inserted lines instead of applying an in-place line patch.");
    }
    for (let line = splice.startLine; line <= splice.endLine; line += 1) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
};

const sameLines = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((line, index) => line === right[index]);

/** Dev/test-only proof that the immediately preceding rename used the expected bridge patch. */
export const assertRenameBridgeCommit = ({
  expectedPatchedLines,
  beforeSourceRevision,
  afterSourceRevision,
  sourceUpdate,
  before,
  after
}: RenameBridgeDevAssertInput) => {
  if (
    afterSourceRevision !== beforeSourceRevision + 1 ||
    sourceUpdate.revision !== afterSourceRevision
  ) {
    throw new Error("rename bridge result cannot be matched to its source revision.");
  }
  if (sourceUpdate.kind !== "model-patch") {
    throw new Error("rename bridge fell back to canonical regeneration instead of line splicing.");
  }

  const actualPatchedLines = patchedLines(sourceUpdate);
  const expectedLines = [...expectedPatchedLines].sort((a, b) => a - b);
  if (!sameLines(actualPatchedLines, expectedLines)) {
    throw new Error(
      `rename bridge patched unexpected lines (expected ${expectedLines.join(", ")}; actual ${actualPatchedLines.join(", ")}).`
    );
  }

  const stability = validateRenameReferenceStability({ before, after });
  if (stability.verdict === "rejected") {
    throw new Error(`rename bridge changed reference resolution: ${stability.reason}.`);
  }
};
