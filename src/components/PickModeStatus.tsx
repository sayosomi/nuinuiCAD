import { dispatchCommand } from "../commands/commands";
import {
  movePickModeDraftEntryInSession,
  removePickModeDraftEntryFromSession
} from "../commands/pickCommands";
import { findParameterDefinition } from "@nuinuicad/nui-language";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  matchingPickModeSessionForTargets,
  type PickModeDraftEntry
} from "../model/pickModeSession";
import { sourceReferenceText } from "../model/moduleSemanticCandidateBoundary";
import { pointAnchorName } from "./commandLineProgress";
import { CanvasModeStatus } from "./CanvasModeStatus";

export type PickModeStatusOrderedDraftEntry = {
  key: string;
  label: string;
};

export type PickModeStatusModel = {
  targetLabel: string;
  instruction: string;
  currentSelection?: string | null;
  currentValue?: string | null;
  orderedDraft?: {
    entries: readonly PickModeStatusOrderedDraftEntry[];
    count: number;
    onMove: (key: string, toIndex: number) => void;
    onRemove: (key: string) => void;
  };
  onFinish: () => void;
};

export const PickModeStatusView = ({ model }: { model: PickModeStatusModel }) => (
  <CanvasModeStatus model={{
    title: "PICK MODE",
    targetLabel: model.targetLabel,
    instruction: model.instruction,
    currentSelection: model.currentSelection,
    currentValue: model.currentValue,
    orderedDraft: model.orderedDraft,
    finishLabel: "選択を完了",
    finishHint: "Enter で選択を完了",
    onFinish: model.onFinish
  }} />
);

export const PickModeStatus = () => {
  const elements = useCadDocumentStore(effectiveElements);
  const pointTarget = useCadUiStore((state) => state.activePointPickTarget);
  const numericTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const lineTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const pickModeSession = useCadUiStore((state) => matchingPickModeSessionForTargets(state.activePickModeSession, {
    point: state.activePointPickTarget,
    numericReference: state.activeNumericReferencePickTarget,
    line: state.activeLinePickTarget
  }));
  const target = pickModeSession?.kind === "point"
    ? pointTarget
    : pickModeSession?.kind === "numeric-reference"
      ? numericTarget
      : pickModeSession?.kind === "line"
        ? lineTarget
        : null;
  if (!pickModeSession) return null;

  const targetElementId = target?.elementId ?? pickModeSession.targetElementId;
  const targetParameterKey = target?.parameterKey ?? pickModeSession.targetParameterKey;
  const element = targetElementId ? elements.find((candidate) => candidate.id === targetElementId) : null;
  const definition = element
    ? findParameterDefinition(element, targetParameterKey)
    : null;
  const isLineList = pickModeSession.kind === "line" && pickModeSession.selectionCardinality === "ordered-multiple";
  const isPointList = pickModeSession.kind === "point" && pickModeSession.selectionCardinality === "ordered-multiple";
  const draft = pickModeSession?.draft ?? [];
  const selectedLineNames = draft
    .filter((entry): entry is Extract<typeof draft[number], { kind: "line" }> => entry.kind === "line")
    .map((entry) => elements.find((candidate) => candidate.id === entry.lineId)?.name ?? entry.lineId);
  const selectedPointNames = draft
    .filter((entry): entry is Extract<typeof draft[number], { kind: "point" }> => entry.kind === "point")
    .map((entry) => pointAnchorName(entry.anchor, elements));
  const singlePointEntry = !isPointList
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "point" }> => entry.kind === "point")
    : undefined;
  const singleLineEntry = !isLineList
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "line" }> => entry.kind === "line")
    : undefined;
  const numericReferenceEntry = pickModeSession.kind === "numeric-reference"
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "numeric-reference" }> => entry.kind === "numeric-reference")
    : undefined;
  const pointDraftLabel = singlePointEntry
    ? sourceReferenceText(singlePointEntry.sourceReference ?? null) ?? pointAnchorName(singlePointEntry.anchor, elements)
    : null;
  const lineDraftLabel = singleLineEntry
    ? sourceReferenceText(singleLineEntry.sourceReference ?? null) ??
      (elements.find((candidate) => candidate.id === singleLineEntry.lineId)?.name ?? singleLineEntry.lineId)
    : null;
  const selectedCount = selectedLineNames.length;
  const selectedPointCount = selectedPointNames.length;
  const instruction = pickModeSession.kind === "point"
    ? isPointList
      ? `点を順番に仮選択中（${selectedPointCount}件）。Canvas上で追加できます。`
      : "Canvasから点を選択"
    : pickModeSession.kind === "numeric-reference"
      ? "線・曲線を選び、使用する値を明示的に選択"
      : isLineList
        ? `線を仮選択中（${selectedCount}件）。Canvas上で追加・解除できます。`
        : "Canvasから線を選択";
  const finish = () => dispatchCommand("finishPickMode");
  const moveDraftEntry = (key: string, toIndex: number) => {
    movePickModeDraftEntryInSession(key, toIndex);
  };
  const removeDraftEntry = (key: string) => {
    removePickModeDraftEntryFromSession(key);
  };
  return (
    <PickModeStatusView
      model={{
        targetLabel: pickModeSession.targetDisplayLabel ??
          `${element?.name ?? targetElementId ?? "Preview"} / ${definition?.label ?? targetParameterKey}`,
        instruction,
        currentSelection: pointDraftLabel ?? lineDraftLabel,
        currentValue: numericReferenceEntry?.expression,
        orderedDraft: isLineList ? {
          entries: draft
            .filter((entry): entry is Extract<typeof draft[number], { kind: "line" }> => entry.kind === "line")
            .map((entry) => ({
              key: entry.key,
              label: elements.find((candidate) => candidate.id === entry.lineId)?.name ?? entry.lineId
            })),
          count: selectedCount,
          onMove: moveDraftEntry,
          onRemove: removeDraftEntry
        } : isPointList ? {
          entries: draft
            .filter((entry): entry is Extract<typeof draft[number], { kind: "point" }> => entry.kind === "point")
            .map((entry) => ({ key: entry.key, label: pointAnchorName(entry.anchor, elements) })),
          count: selectedPointCount,
          onMove: moveDraftEntry,
          onRemove: removeDraftEntry
        } : undefined,
        onFinish: finish
      }}
    />
  );
};
