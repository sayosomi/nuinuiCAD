import { dslDocumentValueSpansAt } from "@nuinuicad/nui-language";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import type { PickModeStatusModel } from "../components/PickModeStatus";
import {
  referencePickReferenceKey,
  referencePickSourceForReference
} from "./referencePickProtocol";
import { referencePickSelectedText, referencePickDraftIsConfirmed } from "./referencePickCanvasSession";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";

export type VSCodeReferencePickModeStatusContext = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
};

const valueSpanContainsTarget = (
  span: { from: number; to: number },
  target: { from: number; to: number }
): boolean => target.from >= span.from && (
  target.from === target.to
    ? target.from <= span.to
    : target.to <= span.to
);

/**
 * Projects the exact-current parser/compiler statement into the shared Pick
 * Mode target label. This is presentation-only; the target anchor and edit
 * range remain owned by the Source Reference Pick lifecycle.
 */
export const referencePickTargetLabelFor = ({
  session,
  context
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext;
}): string => {
  if (!session.target) return "参照を閲覧中（挿入先未確定）";
  const statement = context.compiled.statements[session.target.sourceAnchor.statementIndex];
  if (!statement) return "Reference Pick";
  if (statement.kind === "transformation") return `${statement.construction} / target`;

  const valueSpans = dslDocumentValueSpansAt(
    context.source,
    session.target.range.from
  );
  const parameterKey = valueSpans.ok
    ? valueSpans.value.find((span) => valueSpanContainsTarget(span, session.target!.range))?.key ?? null
    : null;
  const ownerLabel = statement.name.trim();
  if (ownerLabel && parameterKey) return `${ownerLabel} / ${parameterKey}`;
  return parameterKey ?? (ownerLabel || "Reference Pick");
};

const instructionFor = (session: VscodeReferencePickCanvasSession): string => {
  if (!session.target) {
    const unknown = session.candidates.filter(c => c.authority?.status === "unidentifiable").length;
    const instruction = session.candidates.some(c => c.options.length) ? "未検証: Canvas の正規参照を選択。Sourceへの挿入には確認が必要です。" : "候補がありません。Sourceで図形を完成し、Canvasを更新して再実行してください。";
    const provenance = session.snapshot?.matchesCurrentSource === false
      ? session.snapshot.origin === "independent-prefix" ? " 独立したSource前方範囲の候補です。現在のSource全体とは異なります。" : " 表示中のCanvasは現在のSourceとは異なります。" : "";
    return instruction + provenance + (unknown ? ` 参照を同定できない図形 ${unknown}件はコピー・挿入できません。` : "");
  }
  if (!session.candidates.some(c => c.options.length)) return "候補がありません。Sourceで独立した図形を完成・評価し、Canvasを更新してPickを再実行してください。";
  if (session.target.syntax === "transformationTarget" && session.target.role === "endpoint") {
    return session.target.selectionCount?.max === 2
      ? "始点・終点から2つの端点を順序付きで選択"
      : "対象の始点または終点を選択";
  }
  if (session.target.role === "numericPropertyBase") {
    return "点・線・曲線を選び、使用する値を明示的に選択";
  }
  if (session.draft.multiplicity === "multiple") {
    const count = session.draft.draftReferences.length;
    return `${session.target.expectedGeometryInterface === "point" ? "点" : "線"}を仮選択中（${count}件）。Canvas上で追加できます。`;
  }
  return session.target.expectedGeometryInterface === "point"
    ? "Canvasから点を選択"
    : "Canvasから線を選択";
};

export const referencePickModeStatusModelFor = ({
  session,
  context,
  onFinish,
  onMoveDraftEntry,
  onRemoveDraftEntry,
  onBrowse,
  onCopy,
  onInsert,
  onCancel
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext;
  onFinish: () => void;
  onMoveDraftEntry: (key: string, toIndex: number) => void;
  onRemoveDraftEntry: (key: string) => void;
  onBrowse?: () => void;
  onCopy?: () => void;
  onInsert?: () => void;
  onCancel?: () => void;
}): PickModeStatusModel => {
  const numericDraft = session.draft.numericProperty?.draft;
  const draftReferences = session.draft.draftReferences;
  const references = draftReferences.map((reference) => referencePickSourceForReference(reference));
  const orderedDraft = session.draft.multiplicity === "multiple" && session.target?.role !== "numericPropertyBase"
    ? {
        entries: draftReferences.map((reference) => ({
          key: referencePickReferenceKey(reference),
          label: referencePickSourceForReference(reference)
        })),
        count: draftReferences.length,
        onMove: onMoveDraftEntry,
        onRemove: onRemoveDraftEntry
      }
    : undefined;
  const selected = referencePickSelectedText(session);
  const confirmed = referencePickDraftIsConfirmed(session);
  const selectedReference = numericDraft?.reference ?? draftReferences[0];
  const option = selectedReference && session.candidates.flatMap(c => c.options).find(o =>
    referencePickReferenceKey(o.reference) === referencePickReferenceKey(selectedReference) &&
    (numericDraft ? o.kind === "numericProperty" && o.properties.includes(numericDraft.property) : o.kind !== "numericProperty"));
  return {
    finishLabel: !session.target || (selected && !confirmed && onInsert) ? "Sourceへ挿入…" : undefined,
    finishDisabled: !session.target ? !selected : undefined,
    actions: onCopy || onCancel ? [
      ...(session.target && onBrowse ? [{ label: "参照を閲覧", onClick: onBrowse }] : []),
      ...(onCopy ? [{ label: "参照をコピー", onClick: onCopy, disabled: !selected }] : []),
      ...(onCancel ? [{ label: "キャンセル", onClick: onCancel }] : [])
    ] : undefined,
    targetLabel: referencePickTargetLabelFor({ session, context }),
    instruction: option?.authority?.status && option.authority.status !== "confirmed"
      ? `${instructionFor(session)} ${option.authority.status === "incompatible" ? "不適合" : "未検証"}: ${option.authority.reason}` : instructionFor(session),
    currentSelection: numericDraft || orderedDraft
      ? null
      : references.length > 0 ? references.join(", ") : null,
    currentValue: numericDraft
      ? `${referencePickSourceForReference(numericDraft.reference)}.${numericDraft.property}`
      : null,
    orderedDraft,
    onFinish: (!session.target || (selected && !confirmed && onInsert)) && onInsert ? onInsert : onFinish
  };
};
