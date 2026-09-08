import type { ElementId } from "../types/geometry";

export type PickModeKind = "point" | "line" | "numeric-reference";
export type PickModeSelectionCardinality = "single" | "ordered-multiple";

export type PickModeSession = {
  kind: PickModeKind;
  targetElementId: ElementId;
  targetParameterKey: string;
  selectionCardinality: PickModeSelectionCardinality;
};

export type PickModeSemanticTarget = {
  elementId: ElementId;
  parameterKey: string;
  draftPointAnchors?: readonly unknown[];
  draftLineIds?: readonly ElementId[];
};

export type PickModeSemanticTargets = {
  point: PickModeSemanticTarget | null;
  numericReference: PickModeSemanticTarget | null;
  line: PickModeSemanticTarget | null;
};

export const pickModeSelectionCardinalityFor = (
  target: PickModeSemanticTarget
): PickModeSelectionCardinality =>
  target.draftPointAnchors !== undefined || target.draftLineIds !== undefined
    ? "ordered-multiple"
    : "single";

export const pickModeSessionForTarget = (
  kind: PickModeKind,
  target: PickModeSemanticTarget | null,
  selectionCardinality = target ? pickModeSelectionCardinalityFor(target) : "single"
): PickModeSession | null => target ? {
  kind,
  targetElementId: target.elementId,
  targetParameterKey: target.parameterKey,
  selectionCardinality
} : null;

/**
 * Projects an explicit mode session only when it still belongs to one of the
 * current semantic targets. Target fields remain candidate/caller data; this
 * projection is the single active/inactive boundary for Pick Mode consumers.
 */
export const matchingPickModeSessionForTargets = (
  session: PickModeSession | null | undefined,
  targets: PickModeSemanticTargets
): PickModeSession | null => {
  if (!session) return null;
  const target = session.kind === "point"
    ? targets.point
    : session.kind === "line"
      ? targets.line
      : targets.numericReference;
  if (!target) return null;
  return target.elementId === session.targetElementId &&
      target.parameterKey === session.targetParameterKey &&
      pickModeSelectionCardinalityFor(target) === session.selectionCardinality
    ? session
    : null;
};
