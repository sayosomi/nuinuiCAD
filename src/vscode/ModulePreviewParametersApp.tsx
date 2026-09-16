import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewParameter,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParameterValueFocus,
  VscodeModulePreviewParameterValueCompletionCandidate,
  VscodeModulePreviewParameterValueCompletionResult,
  VscodeModulePreviewParameterReferencePickStartRequest,
  VscodeModulePreviewParametersUnavailable,
  VscodeWebviewApi
} from "./protocol";
import {
  useVscodeWebviewPresentation,
  webviewPresentationTextFor,
  type WebviewPresentationParameters
} from "./webviewPresentation";
import "./modulePreviewParameters.css";

type PresentationText = (key: string, fallback: string, parameters?: WebviewPresentationParameters) => string;

type ModulePreviewCompletionState = {
  rowIdentity: string;
  result: VscodeModulePreviewParameterValueCompletionResult;
  activeIndex: number;
};

const typeLabelFor = (parameter: VscodeModulePreviewParameter, text: PresentationText): string => {
  if (!parameter.type) return text("modulePreview.parameters.unknownType", "unknown");
  return parameter.type.kind;
};

const isReferencePickableParameter = (parameter: VscodeModulePreviewParameter): boolean =>
  parameter.type?.kind === "point" || parameter.type?.kind === "line" || parameter.type?.kind === "path";

const unavailableMessageFor = (
  state: VscodeModulePreviewParametersUnavailable,
  text: PresentationText
): string => {
  switch (state.reason) {
    case "no-session": return text("modulePreview.parameters.unavailable.no-session", "Open Module Preview to edit its parameters.");
    case "not-ready": return text("modulePreview.parameters.unavailable.not-ready", "Module Preview is loading its exact current target.");
    case "source-stale": return text("modulePreview.parameters.unavailable.source-stale", "Module Preview parameters are waiting for the refreshed source.");
    case "target-unavailable": return text("modulePreview.parameters.unavailable.target-unavailable", "The Module Preview target is not available in the current source.");
    case "disposed": return text("modulePreview.parameters.unavailable.disposed", "The Module Preview panel is no longer available.");
  }
};

const previewStatusMessageFor = (
  status: VscodeModulePreviewParameterSnapshot["previewStatus"],
  text: PresentationText
): string => {
  switch (status) {
    case "current": return text("modulePreview.parameters.status.current", "Current preview");
    case "lastGood": return text("modulePreview.parameters.status.lastGood", "Showing the last valid preview while inputs are invalid.");
    case "noValidPreview": return text("modulePreview.parameters.status.noValidPreview", "No valid preview for the current inputs.");
  }
};

const parameterDiagnosticMessageFor = (
  diagnostic: NonNullable<VscodeModulePreviewParameter["diagnostic"]>,
  text: PresentationText
): string => {
  switch (diagnostic.code) {
    case "required-value-missing":
      return text("modulePreview.parameters.diagnostic.requiredValueMissing", "Enter a value.");
    case "invalid-expression":
      return text("modulePreview.parameters.diagnostic.invalidExpression", "Enter a valid expression.");
  }
};

const ParameterRow = ({
  snapshot,
  parameter,
  onValueChange,
  onUseDefault,
  onValueInputFocus,
  onValueInputSelection,
  onValueInputBlur,
  onValueInputRefresh,
  onReferencePick,
  completion,
  onCompletionMove,
  onCompletionDismiss,
  onCompletionAccept,
  text
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  parameter: VscodeModulePreviewParameter;
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
  onValueInputFocus: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputSelection: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputBlur: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputRefresh: (
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    requestSuggestions?: boolean
  ) => void;
  onReferencePick: (parameter: VscodeModulePreviewParameter) => void;
  completion: ModulePreviewCompletionState | null;
  onCompletionMove: (delta: 1 | -1) => void;
  onCompletionDismiss: () => void;
  onCompletionAccept: (
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    result: VscodeModulePreviewParameterValueCompletionResult,
    candidate: VscodeModulePreviewParameterValueCompletionCandidate
  ) => boolean;
  text: PresentationText;
}) => {
  const rowIdentity = `${snapshot.sessionId}:${snapshot.target.definitionStatementId}:${parameter.definitionStatementId}:${parameter.parameterIndex}`;
  const [draft, setDraft] = useState(parameter.value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRowIdentityRef = useRef(rowIdentity);
  const authoritativeRef = useRef({ identity: rowIdentity, value: parameter.value });
  const pendingDraftRef = useRef<string | null>(null);
  const shouldRefreshAfterSyncRef = useRef(false);
  useEffect(() => {
    const previous = authoritativeRef.current;
    if (previous.identity !== rowIdentity) {
      pendingDraftRef.current = null;
      shouldRefreshAfterSyncRef.current = false;
      setDraft(parameter.value);
    } else if (pendingDraftRef.current === null) {
      shouldRefreshAfterSyncRef.current = true;
      setDraft(parameter.value);
    } else if (parameter.value === pendingDraftRef.current) {
      pendingDraftRef.current = null;
      shouldRefreshAfterSyncRef.current = true;
      setDraft(parameter.value);
    } else {
      shouldRefreshAfterSyncRef.current = false;
    }
    authoritativeRef.current = {
      identity: rowIdentity,
      value: parameter.value
    };
  }, [parameter, parameter.value, rowIdentity]);
  useEffect(() => {
    if (lastRowIdentityRef.current !== rowIdentity) {
      lastRowIdentityRef.current = rowIdentity;
      return;
    }
    const input = inputRef.current;
    if (
      shouldRefreshAfterSyncRef.current &&
      input &&
      document.activeElement === input &&
      input.value === parameter.value
    ) {
      shouldRefreshAfterSyncRef.current = false;
      onValueInputRefresh(parameter, input);
    }
  }, [draft, onValueInputRefresh, parameter, parameter.value, rowIdentity]);
  const diagnosticId = parameter.diagnostic
    ? `module-preview-parameter-diagnostic-${parameter.definitionStatementId}-${parameter.parameterIndex}`
    : undefined;
  const isReferencePickable = isReferencePickableParameter(parameter);
  const rowCompletion = completion?.rowIdentity === rowIdentity && completion.result.candidates.length > 0
    ? completion
    : null;
  const acceptCompletion = (
    input: HTMLInputElement,
    result: VscodeModulePreviewParameterValueCompletionResult,
    candidate: VscodeModulePreviewParameterValueCompletionCandidate
  ): void => {
    const { from, to } = result.replacementRange;
    if (result.value !== draft || from < 0 || to < from || to > draft.length) return;
    if (!onCompletionAccept(parameter, input, result, candidate)) return;
    const expression = `${draft.slice(0, from)}${candidate.insertionText}${draft.slice(to)}`;
    const caret = from + candidate.insertionText.length;
    pendingDraftRef.current = expression;
    setDraft(expression);
    onValueChange(parameter, expression);
    queueMicrotask(() => {
      if (document.activeElement !== input || input.value !== expression) return;
      input.setSelectionRange(caret, caret);
      onValueInputRefresh(parameter, input, false);
    });
  };
  return (
    <tr
      data-module-preview-parameter-row={`${parameter.definitionStatementId}:${parameter.parameterIndex}`}
      data-parameter-required={parameter.required ? "true" : "false"}
      data-parameter-optional={parameter.optional ? "true" : "false"}
    >
      <th scope="row">
        <span className="module-preview-parameter-name">{parameter.name}</span>
        <span className="module-preview-parameter-type">{typeLabelFor(parameter, text)}</span>
        {parameter.required ? <span className="module-preview-parameter-kind">{text("modulePreview.parameters.required", "required")}</span> : null}
        {parameter.optional ? <span className="module-preview-parameter-kind">{text("modulePreview.parameters.optional", "optional")}</span> : null}
      </th>
      <td>
        <div className={`module-preview-parameter-input-row${isReferencePickable ? " is-reference-pickable" : ""}`}>
          <input
            ref={inputRef}
            data-module-preview-parameter-identity={rowIdentity}
            className="module-preview-parameter-input"
            aria-label={text("modulePreview.parameters.valueFor", "Value for {name}", { name: parameter.name })}
            aria-invalid={parameter.diagnostic ? "true" : "false"}
            aria-describedby={diagnosticId}
            aria-expanded={rowCompletion ? "true" : "false"}
            value={draft}
            onFocus={(event) => {
              shouldRefreshAfterSyncRef.current = false;
              onValueInputFocus(parameter, event.currentTarget);
            }}
            onSelect={(event) => onValueInputSelection(parameter, event.currentTarget)}
            onBlur={(event) => onValueInputBlur(parameter, event.currentTarget)}
            onKeyDown={(event) => {
              if (!rowCompletion) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onCompletionMove(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                onCompletionMove(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                const candidate = rowCompletion.result.candidates[rowCompletion.activeIndex];
                if (candidate) acceptCompletion(event.currentTarget, rowCompletion.result, candidate);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCompletionDismiss();
              }
            }}
            onChange={(event) => {
              const expression = event.currentTarget.value;
              pendingDraftRef.current = expression;
              setDraft(expression);
              onValueChange(parameter, expression);
              onValueInputRefresh(parameter, event.currentTarget);
            }}
          />
          {rowCompletion ? (
            <div
              className="module-preview-parameter-completion-popup"
              role="listbox"
              aria-label={text("modulePreview.parameters.completions", "Completions")}
            >
              {rowCompletion.result.candidates.map((candidate, index) => (
                <button
                  key={`${candidate.kind}:${candidate.identity ?? candidate.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === rowCompletion.activeIndex}
                  className="module-preview-parameter-completion-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const input = inputRef.current;
                    if (input) acceptCompletion(input, rowCompletion.result, candidate);
                  }}
                >
                  <span>{candidate.label}</span>
                  {candidate.detail ? <small>{candidate.detail}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {isReferencePickable ? (
            <button
              type="button"
              className="module-preview-parameter-pick-button"
              data-module-preview-parameter-pick="true"
              aria-label={text("modulePreview.parameters.pickReferenceFor", "Pick reference for {name}", { name: parameter.name })}
              onClick={() => onReferencePick(parameter)}
            >
              {text("modulePreview.parameters.pick", "Pick")}
            </button>
          ) : null}
        </div>
        {parameter.diagnostic ? (
          <div id={diagnosticId} className="module-preview-parameter-diagnostic" role="alert">
            {parameterDiagnosticMessageFor(parameter.diagnostic, text)}
          </div>
        ) : null}
      </td>
      <td className="module-preview-parameter-default-cell">
        {parameter.defaultSourceText !== null ? (
          <>
            <code>{parameter.defaultSourceText}</code>
            <button
              type="button"
              className="module-preview-parameter-default-button"
              aria-label={text("modulePreview.parameters.useDefaultFor", "Use default for {name}", { name: parameter.name })}
              onClick={() => {
                pendingDraftRef.current = null;
                onUseDefault(parameter);
              }}
            >
              {text("modulePreview.parameters.useDefault", "Use default")}
            </button>
          </>
        ) : <span className="module-preview-parameter-no-default">—</span>}
      </td>
    </tr>
  );
};

const ParameterGroup = ({
  snapshot,
  group,
  onValueChange,
  onUseDefault,
  onValueInputFocus,
  onValueInputSelection,
  onValueInputBlur,
  onValueInputRefresh,
  onReferencePick,
  completion,
  onCompletionMove,
  onCompletionDismiss,
  onCompletionAccept,
  text
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  group: VscodeModulePreviewParameterSnapshot["parameters"];
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
  onValueInputFocus: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputSelection: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputBlur: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputRefresh: (
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    requestSuggestions?: boolean
  ) => void;
  onReferencePick: (parameter: VscodeModulePreviewParameter) => void;
  completion: ModulePreviewCompletionState | null;
  onCompletionMove: (delta: 1 | -1) => void;
  onCompletionDismiss: () => void;
  onCompletionAccept: (
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    result: VscodeModulePreviewParameterValueCompletionResult,
    candidate: VscodeModulePreviewParameterValueCompletionCandidate
  ) => boolean;
  text: PresentationText;
}) => (
  <section
    className="module-preview-parameter-group"
    data-module-preview-parameter-group-kind={group.kind}
    data-module-preview-definition-id={group.definitionStatementId}
  >
    <h2>{text(
      group.kind === "target" ? "modulePreview.parameters.target" : "modulePreview.parameters.context",
      group.kind === "target" ? "Target" : "Context"
    )}: {group.name}</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">{text("modulePreview.parameters.parameter", "Parameter")}</th>
          <th scope="col">{text("modulePreview.parameters.value", "Value")}</th>
          <th scope="col">{text("modulePreview.parameters.default", "Default")}</th>
        </tr>
      </thead>
      <tbody>
        {group.parameters.map((parameter) => (
          <ParameterRow
            key={`${parameter.definitionStatementId}:${parameter.parameterIndex}`}
            snapshot={snapshot}
            parameter={parameter}
            onValueChange={onValueChange}
            onUseDefault={onUseDefault}
            onValueInputFocus={onValueInputFocus}
            onValueInputSelection={onValueInputSelection}
            onValueInputBlur={onValueInputBlur}
            onValueInputRefresh={onValueInputRefresh}
            onReferencePick={onReferencePick}
            completion={completion}
            onCompletionMove={onCompletionMove}
            onCompletionDismiss={onCompletionDismiss}
            onCompletionAccept={onCompletionAccept}
            text={text}
          />
        ))}
      </tbody>
    </table>
  </section>
);

export type ModulePreviewParametersSurfaceProps = {
  api: VscodeWebviewApi;
  snapshot: VscodeModulePreviewParameterSnapshot | null;
  unavailable: VscodeModulePreviewParametersUnavailable | null;
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
};

export const ModulePreviewParametersSurface = ({
  api,
  snapshot,
  unavailable,
  onValueChange,
  onUseDefault
}: ModulePreviewParametersSurfaceProps) => {
  const webviewPresentation = useVscodeWebviewPresentation();
  const text = useCallback<PresentationText>(
    (key, fallback, parameters) => webviewPresentationTextFor(webviewPresentation, key, fallback, parameters),
    [webviewPresentation]
  );
  const snapshotRef = useRef<VscodeModulePreviewParameterSnapshot | null>(null);
  const unavailableRef = useRef<VscodeModulePreviewParametersUnavailable | null>(null);
  const nextFocusGenerationRef = useRef(1);
  const valueFocusRef = useRef<{
    rowIdentity: string;
    message: VscodeModulePreviewParameterValueFocus;
  } | null>(null);
  const [completion, setCompletion] = useState<ModulePreviewCompletionState | null>(null);
  const completionRef = useRef<ModulePreviewCompletionState | null>(null);
  const pendingCompletionRef = useRef<{
    requestId: number;
    completionGeneration: number;
    rowIdentity: string;
  } | null>(null);
  const nextCompletionRequestIdRef = useRef(1);
  const nextCompletionGenerationRef = useRef(1);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setCompletionState = useCallback((next: ModulePreviewCompletionState | null): void => {
    completionRef.current = next;
    setCompletion(next);
  }, []);

  const closeCompletion = useCallback((): void => {
    if (completionTimerRef.current !== null) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    pendingCompletionRef.current = null;
    setCompletionState(null);
  }, [setCompletionState]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    unavailableRef.current = unavailable;
  }, [snapshot, unavailable]);

  const rowIdentityFor = useCallback((
    currentSnapshot: VscodeModulePreviewParameterSnapshot,
    parameter: VscodeModulePreviewParameter
  ): string => `${currentSnapshot.sessionId}:${currentSnapshot.target.definitionStatementId}:${parameter.definitionStatementId}:${parameter.parameterIndex}`, []);

  const parameterForRowIdentity = useCallback((
    currentSnapshot: VscodeModulePreviewParameterSnapshot,
    rowIdentity: string
  ): VscodeModulePreviewParameter | null => [
    ...currentSnapshot.ancestorContexts.flatMap((group) => group.parameters),
    ...currentSnapshot.parameters.parameters
  ].find((parameter) => rowIdentityFor(currentSnapshot, parameter) === rowIdentity) ?? null, [rowIdentityFor]);

  const clearValueFocus = useCallback((rowIdentity?: string): void => {
    const focused = valueFocusRef.current;
    if (!focused || (rowIdentity !== undefined && focused.rowIdentity !== rowIdentity)) return;
    closeCompletion();
    valueFocusRef.current = null;
    api.postMessage({
      type: "modulePreviewParameterValueBlur",
      sessionId: focused.message.sessionId,
      documentUri: focused.message.documentUri,
      documentVersion: focused.message.documentVersion,
      sourceRevision: focused.message.sourceRevision,
      sessionRevision: focused.message.sessionRevision,
      targetDefinitionStatementId: focused.message.targetDefinitionStatementId,
      definitionStatementId: focused.message.definitionStatementId,
      parameterIndex: focused.message.parameterIndex,
      focusGeneration: focused.message.focusGeneration
    });
  }, [api, closeCompletion]);

  const publishValueFocus = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    startNewGeneration: boolean
  ): VscodeModulePreviewParameterValueFocus | null => {
    const currentSnapshot = snapshotRef.current ?? snapshot;
    const currentUnavailable = unavailableRef.current ?? unavailable;
    if (!currentSnapshot || currentUnavailable) return null;
    const rowIdentity = rowIdentityFor(currentSnapshot, parameter);
    const previous = valueFocusRef.current;
    if (previous && (previous.rowIdentity !== rowIdentity || startNewGeneration)) clearValueFocus();
    const focusGeneration = nextFocusGenerationRef.current;
    nextFocusGenerationRef.current += 1;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const message: VscodeModulePreviewParameterValueFocus = {
      type: "modulePreviewParameterValueFocus",
      sessionId: currentSnapshot.sessionId,
      documentUri: currentSnapshot.documentUri,
      documentVersion: currentSnapshot.documentVersion,
      sourceRevision: currentSnapshot.sourceRevision,
      sessionRevision: currentSnapshot.sessionRevision,
      targetDefinitionStatementId: currentSnapshot.target.definitionStatementId,
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex,
      value: input.value,
      selectionStart,
      selectionEnd,
      focusGeneration
    };
    valueFocusRef.current = { rowIdentity, message };
    api.postMessage(message);
    return message;
  }, [api, clearValueFocus, rowIdentityFor, snapshot, unavailable]);

  const requestCompletion = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    focusMessage: VscodeModulePreviewParameterValueFocus | null
  ): void => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot || unavailableRef.current || !focusMessage) return;
    const rowIdentity = rowIdentityFor(currentSnapshot, parameter);
    const focused = valueFocusRef.current;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (
      !focused ||
      focused.rowIdentity !== rowIdentity ||
      focused.message !== focusMessage ||
      input.dataset.modulePreviewParameterIdentity !== rowIdentity ||
      focusMessage.value !== input.value ||
      focusMessage.selectionStart !== selectionStart ||
      focusMessage.selectionEnd !== selectionEnd
    ) return;
    const requestId = nextCompletionRequestIdRef.current;
    nextCompletionRequestIdRef.current += 1;
    const completionGeneration = nextCompletionGenerationRef.current;
    nextCompletionGenerationRef.current += 1;
    pendingCompletionRef.current = { requestId, completionGeneration, rowIdentity };
    setCompletionState(null);
    api.postMessage({
      type: "modulePreviewParameterValueCompletion",
      requestId,
      completionGeneration,
      sessionId: focusMessage.sessionId,
      documentUri: focusMessage.documentUri,
      documentVersion: focusMessage.documentVersion,
      sourceRevision: focusMessage.sourceRevision,
      sessionRevision: focusMessage.sessionRevision,
      targetDefinitionStatementId: focusMessage.targetDefinitionStatementId,
      definitionStatementId: focusMessage.definitionStatementId,
      parameterIndex: focusMessage.parameterIndex,
      focusGeneration: focusMessage.focusGeneration,
      value: input.value,
      selectionStart,
      selectionEnd
    });
  }, [api, rowIdentityFor, setCompletionState]);

  const scheduleCompletionRequest = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement
  ): void => {
    if (completionTimerRef.current !== null) clearTimeout(completionTimerRef.current);
    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      const focused = valueFocusRef.current;
      requestCompletion(parameter, input, focused?.message ?? null);
    }, 0);
  }, [requestCompletion]);

  const onValueInputFocus = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    const focusMessage = publishValueFocus(parameter, input, true);
    requestCompletion(parameter, input, focusMessage);
  }, [publishValueFocus, requestCompletion]);

  const onValueInputSelection = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    if (document.activeElement === input) {
      const focused = valueFocusRef.current?.message;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      if (
        focused &&
        focused.value === input.value &&
        focused.selectionStart === selectionStart &&
        focused.selectionEnd === selectionEnd
      ) return;
      const focusMessage = publishValueFocus(parameter, input, false);
      requestCompletion(parameter, input, focusMessage);
    }
  }, [publishValueFocus, requestCompletion]);

  const onValueInputBlur = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    void parameter;
    clearValueFocus(input.dataset.modulePreviewParameterIdentity);
  }, [clearValueFocus]);

  const onValueInputRefresh = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    requestSuggestions = true
  ) => {
    if (document.activeElement === input) {
      publishValueFocus(parameter, input, false);
      if (requestSuggestions) scheduleCompletionRequest(parameter, input);
    }
  }, [publishValueFocus, scheduleCompletionRequest]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: unknown };
      if (message.type === "modulePreviewParameterValueCompletionResult") {
        const result = event.data as VscodeModulePreviewParameterValueCompletionResult;
        const pending = pendingCompletionRef.current;
        const current = valueFocusRef.current;
        const currentSnapshot = snapshotRef.current;
        const parameter = currentSnapshot && current
          ? parameterForRowIdentity(currentSnapshot, current.rowIdentity)
          : null;
        const input = document.activeElement;
        if (
          !pending ||
          !current ||
          !currentSnapshot ||
          unavailableRef.current ||
          !parameter ||
          !(input instanceof HTMLInputElement) ||
          pending.requestId !== result.requestId ||
          pending.completionGeneration !== result.completionGeneration ||
          pending.rowIdentity !== current.rowIdentity ||
          result.sessionId !== currentSnapshot.sessionId ||
          result.documentUri !== currentSnapshot.documentUri ||
          result.documentVersion !== currentSnapshot.documentVersion ||
          result.sourceRevision !== currentSnapshot.sourceRevision ||
          result.sessionRevision !== current.message.sessionRevision ||
          result.targetDefinitionStatementId !== currentSnapshot.target.definitionStatementId ||
          result.definitionStatementId !== parameter.definitionStatementId ||
          result.parameterIndex !== parameter.parameterIndex ||
          result.focusGeneration !== current.message.focusGeneration ||
          result.value !== input.value ||
          result.selectionStart !== (input.selectionStart ?? input.value.length) ||
          result.selectionEnd !== (input.selectionEnd ?? input.value.length) ||
          !Number.isInteger(result.replacementRange?.from) ||
          !Number.isInteger(result.replacementRange?.to) ||
          result.replacementRange.from < 0 ||
          result.replacementRange.to < result.replacementRange.from ||
          result.replacementRange.to > result.value.length ||
          !Array.isArray(result.candidates) ||
          !result.candidates.every((candidate) =>
            typeof candidate.label === "string" && typeof candidate.insertionText === "string"
          )
        ) return;
        const prefix = result.value
          .slice(result.replacementRange.from, result.replacementRange.to)
          .toLocaleLowerCase();
        const candidates = result.candidates.filter((candidate) =>
          candidate.label.toLocaleLowerCase().startsWith(prefix)
        );
        if (completionTimerRef.current !== null) {
          clearTimeout(completionTimerRef.current);
          completionTimerRef.current = null;
        }
        pendingCompletionRef.current = null;
        if (candidates.length === 0) {
          setCompletionState(null);
          return;
        }
        setCompletionState({
          rowIdentity: current.rowIdentity,
          result: { ...result, candidates },
          activeIndex: 0
        });
        return;
      }
      if (message.type !== "modulePreviewRestoreParameterValueSelection") return;
      const restore = event.data as Extract<ExtensionToVscodeMessage, {
        type: "modulePreviewRestoreParameterValueSelection"
      }>;
      const current = valueFocusRef.current;
      const currentSnapshot = snapshotRef.current;
      const parameter = currentSnapshot && current ? parameterForRowIdentity(currentSnapshot, current.rowIdentity) : null;
      const input = document.activeElement;
      if (
        !currentSnapshot ||
        unavailableRef.current ||
        !current ||
        !parameter ||
        !(input instanceof HTMLInputElement) ||
        input.dataset.modulePreviewParameterIdentity !== current.rowIdentity ||
        current.message.focusGeneration !== restore.focusGeneration ||
        restore.sessionId !== currentSnapshot.sessionId ||
        restore.documentUri !== currentSnapshot.documentUri ||
        restore.documentVersion !== currentSnapshot.documentVersion ||
        restore.sourceRevision !== currentSnapshot.sourceRevision ||
        restore.sessionRevision !== currentSnapshot.sessionRevision ||
        restore.targetDefinitionStatementId !== currentSnapshot.target.definitionStatementId ||
        restore.definitionStatementId !== parameter.definitionStatementId ||
        restore.parameterIndex !== parameter.parameterIndex ||
        input.value !== restore.value ||
        !Number.isInteger(restore.selectionStart) ||
        !Number.isInteger(restore.selectionEnd) ||
        restore.selectionStart < 0 ||
        restore.selectionEnd < restore.selectionStart ||
        restore.selectionEnd > input.value.length
      ) return;
      input.setSelectionRange(restore.selectionStart, restore.selectionEnd);
      publishValueFocus(parameter, input, false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [parameterForRowIdentity, publishValueFocus, setCompletionState]);

  const onCompletionMove = useCallback((delta: 1 | -1): void => {
    const current = completionRef.current;
    if (!current || current.result.candidates.length === 0) return;
    const count = current.result.candidates.length;
    const activeIndex = (current.activeIndex + delta + count) % count;
    setCompletionState({ ...current, activeIndex });
  }, [setCompletionState]);

  const onCompletionDismiss = useCallback((): void => {
    closeCompletion();
  }, [closeCompletion]);

  const onCompletionAccept = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    result: VscodeModulePreviewParameterValueCompletionResult,
    candidate: VscodeModulePreviewParameterValueCompletionCandidate
  ): boolean => {
    const current = completionRef.current;
    const currentSnapshot = snapshotRef.current;
    if (
      !current ||
      !currentSnapshot ||
      unavailableRef.current ||
      current.result.requestId !== result.requestId ||
      current.result.completionGeneration !== result.completionGeneration ||
      current.result.focusGeneration !== result.focusGeneration ||
      current.rowIdentity !== rowIdentityFor(currentSnapshot, parameter) ||
      input.dataset.modulePreviewParameterIdentity !== current.rowIdentity ||
      document.activeElement !== input ||
      input.value !== result.value ||
      !current.result.candidates.includes(candidate) ||
      !Number.isInteger(result.replacementRange.from) ||
      !Number.isInteger(result.replacementRange.to) ||
      result.replacementRange.from < 0 ||
      result.replacementRange.to < result.replacementRange.from ||
      result.replacementRange.to > input.value.length
    ) return false;
    closeCompletion();
    return true;
  }, [closeCompletion, rowIdentityFor]);

  useEffect(() => {
    const focused = valueFocusRef.current;
    if (!focused) {
      closeCompletion();
      return;
    }
    if (!snapshot || unavailable || !parameterForRowIdentity(snapshot, focused.rowIdentity)) {
      clearValueFocus();
      return;
    }
    const activeCompletion = completionRef.current;
    if (
      activeCompletion &&
      (activeCompletion.rowIdentity !== focused.rowIdentity ||
        activeCompletion.result.sessionId !== snapshot.sessionId ||
        activeCompletion.result.documentVersion !== snapshot.documentVersion ||
        activeCompletion.result.sourceRevision !== snapshot.sourceRevision ||
        activeCompletion.result.targetDefinitionStatementId !== snapshot.target.definitionStatementId)
    ) closeCompletion();
    const input = [...document.querySelectorAll<HTMLInputElement>(".module-preview-parameter-input")]
      .find((candidate) => candidate.dataset.modulePreviewParameterIdentity === focused.rowIdentity);
    if (!input || document.activeElement !== input) {
      clearValueFocus();
    }
  }, [clearValueFocus, closeCompletion, parameterForRowIdentity, snapshot, unavailable]);

  useEffect(() => () => {
    closeCompletion();
    clearValueFocus();
  }, [clearValueFocus, closeCompletion]);

  const onReferencePick = (parameter: VscodeModulePreviewParameter): void => {
    if (!snapshot || !isReferencePickableParameter(parameter)) return;
    const message: VscodeModulePreviewParameterReferencePickStartRequest = {
      type: "modulePreviewParameterReferencePickStart",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex
    };
    api.postMessage(message);
  };

  return (
    <div className="module-preview-parameters" data-module-preview-parameter-surface="true">
      <header className="module-preview-parameters-header">
        <h1>{text("modulePreview.parameters.title", "Module Preview Parameters")}</h1>
        {snapshot ? <div className="module-preview-parameters-target">{snapshot.target.name}</div> : null}
      </header>
      {snapshot ? (
        <>
          {snapshot.previewStatus !== "noValidPreview" || snapshot.inputDiagnostics.length === 0 ? (
            <div
              className={`module-preview-parameters-status is-${snapshot.previewStatus}`}
              data-module-preview-preview-status={snapshot.previewStatus}
              role="status"
            >
              {previewStatusMessageFor(snapshot.previewStatus, text)}
            </div>
          ) : null}
          <div className="module-preview-parameters-groups">
            {snapshot.ancestorContexts.map((group) => (
              <ParameterGroup
                key={group.definitionStatementId}
                snapshot={snapshot}
                group={group}
                onValueChange={onValueChange}
                onUseDefault={onUseDefault}
                onValueInputFocus={onValueInputFocus}
                onValueInputSelection={onValueInputSelection}
                onValueInputBlur={onValueInputBlur}
                onValueInputRefresh={onValueInputRefresh}
                onReferencePick={onReferencePick}
                completion={completion}
                onCompletionMove={onCompletionMove}
                onCompletionDismiss={onCompletionDismiss}
                onCompletionAccept={onCompletionAccept}
                text={text}
              />
            ))}
            <ParameterGroup
              snapshot={snapshot}
              group={snapshot.parameters}
              onValueChange={onValueChange}
              onUseDefault={onUseDefault}
              onValueInputFocus={onValueInputFocus}
              onValueInputSelection={onValueInputSelection}
              onValueInputBlur={onValueInputBlur}
              onValueInputRefresh={onValueInputRefresh}
              onReferencePick={onReferencePick}
              completion={completion}
              onCompletionMove={onCompletionMove}
              onCompletionDismiss={onCompletionDismiss}
              onCompletionAccept={onCompletionAccept}
              text={text}
            />
          </div>
        </>
      ) : (
        <div className="module-preview-parameters-unavailable" role="status">
          {unavailable
            ? unavailableMessageFor(unavailable, text)
            : text("modulePreview.parameters.unavailable.no-session", "Open Module Preview to edit its parameters.")}
        </div>
      )}
    </div>
  );
};
