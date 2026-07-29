import { useMemo } from "react";
import type { RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  createDependencyIndex,
  getDependencySummary,
} from "../model/dependencies";
import {
  createElementPresentationStatusIndex,
  type ElementPresentationStatus,
} from "../model/elementPresentationStatus";
import { isRuntimeBindingDisplayFresh } from "../model/runtimeBindingFreshness";
import type { GroupPrintEnabledLookup } from "../geometry/groupPrintEnabledRuntime";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { BindingId } from "../scalars/bindingCatalog";
import { buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { geometryInfoRows } from "./geometryDisplay";
import {
  dependencyInspectorPresentation,
  parameterInspectorRows,
  type InspectorDependencyRow,
  type InspectorParameterRow,
  type InspectorUnresolvedDependencyRow,
} from "./inspectorPresentation";
import { parameterPickCommandId } from "../commands/parameterPickCommand";
import { typedDeclarationInspectorPresentation } from "./typedDeclarationInspectorPresentation";
import { textInspectorPresentation } from "./textInspectorSource";
import {
  typedBindingRuntimeInspectorPresentation,
  type TypedBindingRuntimeConsumerRow,
} from "./typedBindingRuntimeInspectorPresentation";

const statusLabels = (status: ElementPresentationStatus) =>
  [
    status.hasError ? "エラー" : null,
    status.hasWarning ? "警告" : null,
    status.disabledSelf || status.disabledByGroup ? "無効" : null,
    status.hiddenSelf || status.hiddenByGroup || status.hiddenByProfile
      ? "非表示"
      : null,
    status.conditionInactive ? "条件外" : null,
  ].filter((value): value is string => Boolean(value));

const relatedCountBadge = (count: number) => (
  <span className="dependency-count-badge" aria-label={`関連要素 ${count} 件`}>
    {count > 99 ? "99+" : count}
  </span>
);

export const InspectorPanel = ({
  element,
  elements,
  evaluation,
  evaluationEngineLabel,
  isEvaluationFallback = false,
  isEvaluationStale = false,
  sourceEditorRef,
}: {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationEngineLabel?: string | null;
  isEvaluationFallback?: boolean;
  isEvaluationStale?: boolean;
  sourceEditorRef: RefObject<SourceEditorHandle | null>;
}) => {
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const isInspectorExpanded = useCadUiStore(
    (state) => state.isInspectorExpanded,
  );
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadUiStore(
    (state) => state.activeNumericReferencePickTarget,
  );
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const palette = useCadDocumentStore((state) => state.palette);
  const profiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeProfileId = useCadDocumentStore(
    (state) => state.activeVisibilityProfileId,
  );
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const doc = useCadDocumentStore((state) => state.doc);
  const docText = useCadDocumentStore((state) => state.docText);
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const isLastGood = docText !== sourceText;
  const isRuntimeFresh = isRuntimeBindingDisplayFresh({ isSourceDirty: isLastGood, isEvaluationStale });
  const textTemplatesByElementId = useMemo(
    () => doc.textTemplates
      ? buildTextTemplateEntriesByElementId({
          textTemplates: doc.textTemplates,
          elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
        })
      : undefined,
    [doc.statementMap.elementIdByStatementIndex, doc.textTemplates],
  );
  const textPresentation = useMemo(
    () => element?.type === "text"
      ? textInspectorPresentation({
          element,
          textTemplates: doc.textTemplates,
          statementMap: doc.statementMap,
          evaluation,
          isRuntimeFresh,
        })
      : null,
    [doc.statementMap, doc.textTemplates, element, evaluation, isRuntimeFresh],
  );
  const dependencyIndex = useMemo(
    () => createDependencyIndex(elements, { textTemplatesByElementId }),
    [elements, textTemplatesByElementId],
  );
  const dependencySummary = useMemo(
    () =>
      element ? getDependencySummary(element, elements, dependencyIndex) : null,
    [dependencyIndex, element, elements],
  );
  const groupPrintEnabledLookup: GroupPrintEnabledLookup | undefined = useMemo(
    () =>
      isRuntimeFresh
        ? { propertyBindings: doc.propertyBindings, byElementId: doc.statementMap.byElementId }
        : undefined,
    [isRuntimeFresh, doc.propertyBindings, doc.statementMap],
  );
  const presentationStatusIndex = useMemo(
    () =>
      createElementPresentationStatusIndex({
        elements,
        evaluation,
        groupFoldById,
        palette,
        visibilityProfiles: profiles,
        activeVisibilityProfileId: activeProfileId,
        groupPrintEnabledLookup,
      }),
    [activeProfileId, elements, evaluation, groupFoldById, palette, profiles, groupPrintEnabledLookup],
  );
  const status = element
    ? (presentationStatusIndex.get(element.id) ?? null)
    : null;
  const parameterRows = useMemo(
    () => {
      if (!element) return [];
      return parameterInspectorRows(element).map((row) =>
        row.parameterKey === "text" && textPresentation !== null
          ? { ...row, value: textPresentation.source }
          : row,
      );
    },
    [element, textPresentation],
  );
  const evaluatedText = textPresentation?.evaluatedText ?? null;
  const textHasDifferentRuntimeResult = evaluatedText !== null && evaluatedText !== textPresentation?.source;
  const dependencyPresentation = useMemo(
    () =>
      element && dependencySummary
        ? dependencyInspectorPresentation(
            element,
            dependencySummary,
            evaluation,
          )
        : null,
    [dependencySummary, element, evaluation],
  );
  const selectionSubject = useCadUiStore((state) => state.selectionSubject);
  const selectedBindingId = selectionSubject.kind === "binding" ? selectionSubject.bindingId : null;
  const typedDeclarationPresentation = useMemo(
    () =>
      selectedBindingId && doc.bindingAnalysis
        ? typedDeclarationInspectorPresentation(doc.bindingAnalysis, doc.statements, selectedBindingId)
        : null,
    [doc.bindingAnalysis, doc.statements, selectedBindingId],
  );
  const typedBindingRuntimePresentation = useMemo(
    () =>
      selectedBindingId && doc.bindingAnalysis
        ? typedBindingRuntimeInspectorPresentation(
            doc.bindingAnalysis,
            doc.bindingVersions,
            evaluation,
            {
              propertyBindings: doc.propertyBindings,
              conditionalGroupConditions: doc.conditionalGroupConditions,
              textTemplates: doc.textTemplates,
              statementMap: doc.statementMap,
              elements,
            },
            selectedBindingId,
            isRuntimeFresh,
          )
        : null,
    [
      doc.bindingAnalysis,
      doc.bindingVersions,
      doc.propertyBindings,
      doc.conditionalGroupConditions,
      doc.textTemplates,
      doc.statementMap,
      elements,
      evaluation,
      selectedBindingId,
      isRuntimeFresh,
    ],
  );
  const parseIssues = useMemo(() => {
    if (!element || isLastGood) return [];
    const line = doc.statementMap.byElementId.get(element.id)?.line;
    return line ? diagnostics.filter((item) => item.line === line) : [];
  }, [diagnostics, doc.statementMap, element, isLastGood]);
  const infoRows = element
    ? geometryInfoRows(
        evaluation.computedGeometry.get(element.id),
        evaluation.computedVariables.get(element.id),
      )
    : [];
  const jumpToTypedDeclaration = (bindingId: BindingId): boolean =>
    sourceEditorRef.current?.jumpToBindingDeclaration(bindingId) ?? false;
  const jumpToTypedDeclarationPart = (bindingId: BindingId, part: "type" | "initializer"): boolean =>
    sourceEditorRef.current?.jumpToBindingDeclarationPart(bindingId, part)
      ? true
      : jumpToTypedDeclaration(bindingId);
  const jumpToRuntimeValue = (bindingId: BindingId): boolean =>
    sourceEditorRef.current?.jumpToBindingDeclarationPart(bindingId, "initializer")
      ? true
      : jumpToTypedDeclaration(bindingId);
  const jumpToConsumerRow = (row: TypedBindingRuntimeConsumerRow): boolean => {
    // Selection may flush dirty source text - mirrors jumpToDependency.
    if (dispatchCommand("selectElement", { elementId: row.elementId }) === false) return false;
    if (!useCadDocumentStore.getState().elements.some((candidate) => candidate.id === row.elementId)) return false;
    if (row.jump.kind === "property") {
      return sourceEditorRef.current?.jumpToPropertyBindingValue(row.jump.occurrenceKey) ?? false;
    }
    if (row.jump.kind === "templateHole") {
      return sourceEditorRef.current?.jumpToTemplateHole(row.jump.occurrenceKey, row.jump.holeIndex) ?? false;
    }
    sourceEditorRef.current?.jumpToElement(row.elementId);
    return true;
  };
  const jumpToParameter = (row: InspectorParameterRow) => {
    if (!element) return false;
    return (
      sourceEditorRef.current?.jumpToParameterValue(
        element.id,
        row.parameterKey,
      ) ?? false
    );
  };
  const jumpToDependency = (row: InspectorDependencyRow) => {
    // Selection may flush dirty source text. Do not move the editor cursor if IME blocked
    // that command or the row's target disappeared during the flush.
    if (
      dispatchCommand("selectElement", { elementId: row.elementId }) === false
    )
      return false;
    if (
      !useCadDocumentStore
        .getState()
        .elements.some((candidate) => candidate.id === row.elementId)
    )
      return false;
    sourceEditorRef.current?.jumpToElement(row.elementId);
    return true;
  };
  const startParameterPick = (row: InspectorParameterRow): boolean => {
    if (!element) return false;
    const definition = findParameterDefinition(element, row.parameterKey);
    if (!definition) return false;
    const commandId = parameterPickCommandId(definition.kind);
    if (!commandId) return false;
    const context = { elementId: element.id, parameterKey: definition.key };
    return dispatchCommand(commandId, context) !== false;
  };
  const evaluationLabel = isLastGood
    ? "評価: last-good"
    : evaluationEngineLabel;
  const renderDependencyRow = (row: InspectorDependencyRow) => (
    <div
      key={row.key}
      className="inspector-row"
      onClick={() => jumpToDependency(row)}
    >
      <span className="inspector-row-main">
        <span>
          {row.label} {relatedCountBadge(row.relatedCount)}
        </span>
        <small>{row.detail}</small>
      </span>
      {row.issues.length > 0 ? (
        <span className="dependency-issue-list">
          {row.issues.map((issue, index) => (
            <span
              key={`${issue.message}-${index}`}
              className={`dependency-issue ${issue.severity}`}
            >
              {issue.message}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
  const renderUnresolvedRow = (row: InspectorUnresolvedDependencyRow) => (
    <div key={row.key} className="dependency-row unresolved">
      <span className="dependency-row-main">
        <span>
          未解決: {row.id} {relatedCountBadge(row.relatedCount)}
        </span>
        <small>親要素を解決できません。</small>
      </span>
      {row.issues.length > 0 ? (
        <span className="dependency-issue-list">
          {row.issues.map((issue, index) => (
            <span
              key={`${issue.message}-${index}`}
              className={`dependency-issue ${issue.severity}`}
            >
              {issue.message}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );

  return (
    <section
      className="panel-section inspector-panel"
      aria-label="インスペクタ"
    >
      <div className="section-header">
        <div>
          <h2>インスペクタ</h2>
          {element ? (
            <p className="section-subtitle">
              {element.name} ・ {elementTypeLabels[element.type]}
            </p>
          ) : typedDeclarationPresentation ? (
            <p className="section-subtitle">
              {typedDeclarationPresentation.name} ・ {typedDeclarationPresentation.mutabilityLabel}
            </p>
          ) : null}
        </div>
        <div className="section-header-actions">
          {evaluationLabel ? (
            <small
              className={`evaluation-engine-status ${isEvaluationStale || isLastGood ? "stale" : ""} ${isEvaluationFallback ? "fallback" : ""}`}
            >
              {evaluationLabel}
            </small>
          ) : null}
          <button
            type="button"
            onClick={() => dispatchCommand("toggleInspectorPanel")}
          >
            i
          </button>
        </div>
      </div>
      {!isInspectorExpanded ? (
        <p className="empty-state">折り畳み中です。</p>
      ) : !element && !typedDeclarationPresentation ? (
        <p className="empty-state">要素を選択してください。</p>
      ) : (
        <div className="inspector-content">
          {typedDeclarationPresentation ? (
            <div className="dependency-group">
              <h3 className="shortcut-group-title">宣言</h3>
              {typedDeclarationPresentation.invalidMessage ? (
                <div className="inspector-status-badges">
                  <span className="inspector-status invalid">無効</span>
                </div>
              ) : null}
              <div className="dependency-list">
                <div
                  className="inspector-row"
                  onClick={() => jumpToTypedDeclaration(typedDeclarationPresentation.bindingId)}
                >
                  <span className="inspector-row-main">
                    <span>{typedDeclarationPresentation.name}</span>
                    <small>{typedDeclarationPresentation.mutabilityLabel}</small>
                  </span>
                </div>
                {typedDeclarationPresentation.rows.map((row) =>
                  row.key === "type" || row.key === "initializer" ? (
                    <div
                      key={row.key}
                      className="inspector-row"
                      onClick={() =>
                        jumpToTypedDeclarationPart(
                          typedDeclarationPresentation.bindingId,
                          row.key === "type" ? "type" : "initializer",
                        )
                      }
                    >
                      <span className="inspector-row-main">
                        <span>{row.label}</span>
                        <small>{row.value}</small>
                      </span>
                    </div>
                  ) : (
                    <div key={row.key} className="inspector-row">
                      <span className="inspector-row-main">
                        <span>{row.label}</span>
                        <small>{row.value}</small>
                      </span>
                    </div>
                  )
                )}
              </div>
              {typedDeclarationPresentation.invalidMessage ? (
                <p className="inspector-diagnostic error">
                  {typedDeclarationPresentation.invalidMessage}
                </p>
              ) : null}
            </div>
          ) : null}
          {typedBindingRuntimePresentation ? (
            <div className="dependency-group">
              <h3 className="shortcut-group-title">実行時値</h3>
              <div className="dependency-list">
                {typedBindingRuntimePresentation.rows.map((row) =>
                  row.key === "value" ? (
                    <div
                      key={row.key}
                      className="inspector-row"
                      onClick={() => jumpToRuntimeValue(typedBindingRuntimePresentation.bindingId)}
                    >
                      <span className="inspector-row-main">
                        <span>{row.label}</span>
                        <small>{row.value}</small>
                      </span>
                    </div>
                  ) : (
                    <div key={row.key} className="inspector-row">
                      <span className="inspector-row-main">
                        <span>{row.label}</span>
                        <small>{row.value}</small>
                      </span>
                    </div>
                  )
                )}
              </div>
              {typedBindingRuntimePresentation.invalidMessage ? (
                <p className="inspector-diagnostic error">
                  {typedBindingRuntimePresentation.invalidMessage}
                </p>
              ) : null}
              {typedBindingRuntimePresentation.consumerRows.length > 0 ? (
                <>
                  <h3 className="shortcut-group-title">参照元</h3>
                  <div className="dependency-list">
                    {typedBindingRuntimePresentation.consumerRows.map((row) => (
                      <div
                        key={row.key}
                        className="inspector-row"
                        onClick={() => jumpToConsumerRow(row)}
                      >
                        <span className="inspector-row-main">
                          <span>{row.label}</span>
                          <small>{row.detail}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {element ? (
          <>
          {status ? (
            <div className="inspector-status-badges">
              {statusLabels(status).map((label) => (
                <span key={label} className={`inspector-status ${label}`}>
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          {infoRows.length > 0 ? (
            <dl className="element-info-grid">
              {infoRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="empty-state">未評価です。</p>
          )}
          {(dependencyPresentation?.ownIssues.length ?? 0) +
            parseIssues.length >
          0 ? (
            <div className="dependency-group">
              <h3 className="shortcut-group-title">診断</h3>
              {[
                ...(dependencyPresentation?.ownIssues ?? []),
                ...parseIssues,
              ].map((issue, index) => (
                <p
                  key={`${issue.message}-${index}`}
                  className={`inspector-diagnostic ${issue.severity}`}
                >
                  {issue.message}
                </p>
              ))}
            </div>
          ) : null}
          <div className="dependency-group">
            <h3 className="shortcut-group-title">親要素</h3>
            {dependencyPresentation?.parentRows.length ||
            dependencyPresentation?.unresolvedParentRows.length ? (
              <div className="dependency-list">
                {dependencyPresentation.parentRows.map(renderDependencyRow)}
                {dependencyPresentation.unresolvedParentRows.map(
                  renderUnresolvedRow,
                )}
              </div>
            ) : (
              <p className="empty-state">親要素はありません。</p>
            )}
          </div>
          <div className="dependency-group">
            <h3 className="shortcut-group-title">子要素</h3>
            {dependencyPresentation?.childRows.length ? (
              <div className="dependency-list">
                {dependencyPresentation.childRows.map(renderDependencyRow)}
              </div>
            ) : (
              <p className="empty-state">子要素はありません。</p>
            )}
          </div>
          <div className="dependency-group">
            <h3 className="shortcut-group-title">パラメーター</h3>
            <div className="dependency-list">
              {parameterRows.flatMap((row) => [
                <div key={row.key}>
                  <div
                    className="inspector-row inspector-parameter-row"
                    onClick={() => jumpToParameter(row)}
                  >
                    <span className="inspector-row-main">
                      <span>{row.parameterKey === "text" && textHasDifferentRuntimeResult ? "テキスト（ソース）" : row.label}</span>
                      <small>{row.value}</small>
                    </span>
                    {(() => {
                    const definition = findParameterDefinition(
                      element,
                      row.parameterKey,
                    );
                    const pickCommandId = definition
                      ? parameterPickCommandId(definition.kind)
                      : null;
                    const isPicking =
                      activePointPickTarget?.elementId === element.id &&
                        activePointPickTarget.parameterKey === row.parameterKey ||
                      activeNumericReferencePickTarget?.elementId === element.id &&
                        activeNumericReferencePickTarget.parameterKey === row.parameterKey ||
                      activeLinePickTarget?.elementId === element.id &&
                        activeLinePickTarget.parameterKey === row.parameterKey;
                    return pickCommandId ? (
                      <button
                        type="button"
                        className={`inspector-pick-button ${isPicking ? "is-active" : ""}`}
                        aria-label={`${row.label}を${isPicking ? "選択中" : "選択"}`}
                        title={`${row.label}をCanvasで選択`}
                        onClick={(event) => {
                          event.stopPropagation();
                          startParameterPick(row);
                        }}
                      >
                        {isPicking ? "選択中" : "選択"}
                      </button>
                    ) : null;
                    })()}
                  </div>
                </div>,
                ...(row.parameterKey === "text" && textHasDifferentRuntimeResult ? [
                  <div key={`${row.key}:evaluated-text`}>
                    <div className="inspector-row">
                      <span className="inspector-row-main">
                        <span>評価結果</span>
                        <small>{evaluatedText}</small>
                      </span>
                    </div>
                  </div>
                ] : [])
              ])}
            </div>
          </div>
          </>
          ) : null}
        </div>
      )}
    </section>
  );
};
