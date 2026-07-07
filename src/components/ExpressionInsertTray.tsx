import { useMemo, useState, type PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  numericReferenceCandidates,
  type NumericReferenceCandidate
} from "../geometry/numericReferencePaths";
import { availableNumericVariableReferenceOptions } from "../geometry/variableReferenceOptions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import {
  DEFAULT_REFERENCE_HELPER_POSITION,
  useCadUiStore
} from "../state/cadUiStore";
import type { CadElement, EvaluationResult } from "../types/geometry";

type InsertTargetInput = {
  displayedExpression: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

type ExpressionInsertTrayProps = {
  element: CadElement;
  elements: CadElement[];
  evaluation?: EvaluationResult;
  parameterKey: ParameterKey;
  focusInput: () => void;
  getInputTarget: () => InsertTargetInput;
  onClose?: () => void;
};

const relationLabels: Record<NumericReferenceCandidate["relation"] | "all", string> = {
  all: "すべて",
  self: "self",
  parent: "parents",
  child: "children",
  element: "elements",
  variable: "variables",
  function: "functions"
};

const relationNavItems: Array<NumericReferenceCandidate["relation"] | "all"> = [
  "all",
  "self",
  "parent",
  "child",
  "variable",
  "function"
];

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  computedVariables: new Map(),
  errors: [],
  warnings: []
};

const conditionalOperators = [
  { operator: ">", description: "A > B: AがBより大きいとき真" },
  { operator: ">=", description: "A >= B: AがB以上のとき真" },
  { operator: "<", description: "A < B: AがBより小さいとき真" },
  { operator: "<=", description: "A <= B: AがB以下のとき真" },
  { operator: "==", description: "A == B: AとBが等しいとき真" },
  { operator: "!=", description: "A != B: AとBが等しくないとき真" },
  { operator: "&&", description: "A && B: AとBの両方が真のとき真" },
  { operator: "||", description: "A || B: AとBのどちらかが真のとき真" }
] as const;

const clampReferenceHelperPosition = (position: { x: number; y: number }) => {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - 320)),
    y: Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - 96))
  };
};

export const ExpressionInsertTray = ({
  element,
  elements,
  evaluation = emptyEvaluation,
  parameterKey,
  focusInput,
  getInputTarget,
  onClose
}: ExpressionInsertTrayProps) => {
  const [query, setQuery] = useState("");
  const [relationFilter, setRelationFilter] =
    useState<NumericReferenceCandidate["relation"] | "all">("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const referenceHelperPosition = useCadUiStore((state) => state.referenceHelperPosition);
  const setReferenceHelperPosition = useCadUiStore((state) => state.setReferenceHelperPosition);
  const [dragState, setDragState] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const candidates = useMemo(
    () =>
      numericReferenceCandidates({
        elements,
        evaluation,
        currentElement: element,
        currentParameterKey: parameterKey,
        query
      }),
    [element, elements, evaluation, parameterKey, query]
  );
  const variableOptions = useMemo(
    () =>
      availableNumericVariableReferenceOptions({
        element,
        elements,
        parameterKey,
        computedVariables:
          evaluation.computedVariables.size > 0 ? evaluation.computedVariables : undefined
      }),
    [element, elements, evaluation, parameterKey]
  );
  const mergedCandidates: NumericReferenceCandidate[] = [
    ...variableOptions.map((option) => ({
      id: `variable:${option.expression}`,
      relation: "variable" as const,
      expression: option.expression,
      displayExpression: option.displayExpression,
      label: option.label,
      detail: option.detail,
      valueLabel: option.expression,
      insertable: true
    })),
    ...candidates
  ];
  const visibleCandidates = mergedCandidates
    .filter((candidate) => relationFilter === "all" || candidate.relation === relationFilter)
    .slice(0, 120);
  const selectedCandidate =
    visibleCandidates.find((candidate) => candidate.id === selectedCandidateId) ??
    visibleCandidates[0] ??
    null;

  const insertSnippet = (snippet: string, appendMode: "sum" | "raw" = "sum") => {
    const target = getInputTarget();
    dispatchCommand("insertNumericExpressionSnippet", {
      elementId: element.id,
      parameterKey,
      numericExpressionSnippet: snippet,
      numericExpressionAppendMode: appendMode,
      displayedExpression: target.displayedExpression,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    });
    requestAnimationFrame(focusInput);
  };

  const close = () => {
    if (onClose) {
      onClose();
      return;
    }
    dispatchCommand("closeExpressionInsertTray");
  };

  const startLegacyLinePick = () => {
    const target = getInputTarget();
    dispatchCommand("startNumericReferenceInsertPick", {
      elementId: element.id,
      parameterKey,
      numericReferenceProperty: "length",
      displayedExpression: target.displayedExpression,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    });
  };
  const inputTargetContext = () => {
    const target = getInputTarget();
    return {
      elementId: element.id,
      parameterKey,
      displayedExpression: target.displayedExpression,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    };
  };
  const startMeasurementFunction = (candidate: NumericReferenceCandidate) => {
    if (!candidate.measurementMode) return;
    dispatchCommand("startMeasurementFunctionInsert", {
      ...inputTargetContext(),
      measurementInsertMode: candidate.measurementMode
    });
  };
  const applyCandidate = (candidate: NumericReferenceCandidate) => {
    if (!candidate.insertable) return;
    if (candidate.measurementMode) {
      startMeasurementFunction(candidate);
      return;
    }
    insertSnippet(
      element.type === "text" && parameterKey === "text"
        ? candidate.displayExpression
        : candidate.expression
    );
  };
  const helperPosition = clampReferenceHelperPosition(
    referenceHelperPosition ?? DEFAULT_REFERENCE_HELPER_POSITION
  );

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, textarea, select")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: helperPosition.x,
      originY: helperPosition.y
    });
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const nextPosition = clampReferenceHelperPosition({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY
    });
    setReferenceHelperPosition(nextPosition);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragState(null);
  };

  return (
    <div
      className="reference-helper-window"
      role="dialog"
      aria-label="参照ヘルパー"
      style={{ left: helperPosition.x, top: helperPosition.y }}
    >
      <div
        className={`reference-helper-header ${dragState ? "is-dragging" : ""}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div>
          <strong>参照ヘルパー</strong>
          <small>挿入先: {element.name}.{parameterKey}</small>
        </div>
        <button type="button" onClick={close}>閉じる</button>
      </div>

      <div className="reference-helper-search-row">
        <input
          value={query}
          placeholder="要素名 / プロパティ / 値を検索"
          aria-label="参照候補を検索"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            if (event.key === "Enter" && selectedCandidate?.insertable) {
              event.preventDefault();
              insertSnippet(selectedCandidate.expression);
            }
          }}
        />
        <button type="button" onClick={startLegacyLinePick}>キャンバスから選択</button>
      </div>

      <div className="reference-helper-body">
        <nav className="reference-helper-nav" aria-label="参照カテゴリ">
          {relationNavItems.map((relation) => (
            <button
              key={relation}
              type="button"
              className={relationFilter === relation ? "active-toggle" : ""}
              onClick={() => setRelationFilter(relation)}
            >
              {relationLabels[relation]}
            </button>
          ))}
        </nav>

        <div className="reference-helper-results">
          {visibleCandidates.length === 0 ? (
            <p className="empty-state">一致する参照値はありません。</p>
          ) : (
            visibleCandidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`reference-helper-result ${selectedCandidate?.id === candidate.id ? "selected" : ""}`}
                onClick={() => {
                  setSelectedCandidateId(candidate.id);
                  if (
                    candidate.insertable &&
                    (candidate.relation === "variable" || candidate.relation === "function")
                  ) {
                    applyCandidate(candidate);
                  }
                }}
                onDoubleClick={() => {
                  applyCandidate(candidate);
                }}
              >
                <span>
                  <strong>{candidate.label}</strong>
                  <small>{candidate.detail}</small>
                </span>
                <code>{candidate.valueLabel || candidate.displayExpression}</code>
              </button>
            ))
          )}
        </div>

        <aside className="reference-helper-detail">
          {selectedCandidate ? (
            <>
              <span className="reference-helper-chip">{relationLabels[selectedCandidate.relation]}</span>
              <strong>{selectedCandidate.label} を挿入</strong>
              <dl>
                <div>
                  <dt>式</dt>
                  <dd><code>{selectedCandidate.expression}</code></dd>
                </div>
                <div>
                  <dt>値</dt>
                  <dd>{selectedCandidate.valueLabel || "未表示"}</dd>
                </div>
              </dl>
              {selectedCandidate.disabledReason ? (
                <p className="reference-helper-disabled">{selectedCandidate.disabledReason}</p>
              ) : null}
              <button
                type="button"
                className="expression-insert-button"
                disabled={!selectedCandidate.insertable}
                onClick={() => applyCandidate(selectedCandidate)}
              >
                {selectedCandidate.measurementMode ? "選択を開始" : "選択候補を挿入"}
              </button>
            </>
          ) : (
            <p className="empty-state">参照値を選択してください。</p>
          )}
        </aside>
      </div>

      <div className="reference-helper-legacy">
        <button type="button" onClick={startLegacyLinePick}>線・曲線を選択</button>
        {element.type === "conditionalGroup" && parameterKey === "condition" ? (
          <div className="expression-operator-grid" role="group" aria-label="挿入する条件演算子">
            {conditionalOperators.map(({ operator, description }) => (
              <button
                key={operator}
                type="button"
                title={description}
                aria-label={`${operator} ${description}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSnippet(` ${operator} `, "raw")}
              >
                <code>{operator}</code>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
