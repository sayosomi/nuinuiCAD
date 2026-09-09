import { dslDocumentValueSpansAt } from "../dsl/dslValueSpans";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { PickModeStatusModel } from "../components/PickModeStatus";
import { referencePickSourceForReference } from "./referencePickProtocol";
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
  const statement = context.compiled.statements[session.target.sourceAnchor.statementIndex];
  if (!statement) return "Reference Pick";

  const valueSpans = dslDocumentValueSpansAt(
    context.source,
    session.target.range.from
  );
  const parameterKey = valueSpans.ok
    ? valueSpans.value.find((span) => valueSpanContainsTarget(span, session.target.range))?.key ?? null
    : null;
  const ownerLabel = statement.name.trim();
  if (ownerLabel && parameterKey) return `${ownerLabel} / ${parameterKey}`;
  return parameterKey ?? (ownerLabel || "Reference Pick");
};

const instructionFor = (session: VscodeReferencePickCanvasSession): string => {
  if (session.target.role === "numericPropertyBase") {
    return "線・曲線を選び、使用する値を明示的に選択";
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
  onFinish
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext;
  onFinish: () => void;
}): PickModeStatusModel => {
  const numericDraft = session.draft.numericProperty?.draft;
  const references = session.draft.draftReferences.map(referencePickSourceForReference);
  return {
    targetLabel: referencePickTargetLabelFor({ session, context }),
    instruction: instructionFor(session),
    currentSelection: numericDraft
      ? null
      : references.length > 0 ? references.join(", ") : null,
    currentValue: numericDraft
      ? `${referencePickSourceForReference(numericDraft.reference)}.${numericDraft.property}`
      : null,
    onFinish
  };
};
