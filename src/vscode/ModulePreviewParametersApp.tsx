import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewParameter,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParameterValueFocus,
  VscodeModulePreviewParameterReferencePickStartRequest,
  VscodeModulePreviewParametersUnavailable,
  VscodeWebviewApi
} from "./protocol";
import { isExtensionToVscodeMessage } from "./vscodeRustTransport";
import {
  useVscodeWebviewPresentation,
  webviewPresentationTextFor,
  type WebviewPresentationParameters
} from "./webviewPresentation";
import "./modulePreviewParameters.css";

type PresentationText = (key: string, fallback: string, parameters?: WebviewPresentationParameters) => string;

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
  text
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  parameter: VscodeModulePreviewParameter;
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
  onValueInputFocus: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputSelection: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputBlur: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputRefresh: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onReferencePick: (parameter: VscodeModulePreviewParameter) => void;
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
        <div className="module-preview-parameter-input-row">
          <input
            ref={inputRef}
            data-module-preview-parameter-identity={rowIdentity}
            className="module-preview-parameter-input"
            aria-label={text("modulePreview.parameters.valueFor", "Value for {name}", { name: parameter.name })}
            aria-invalid={parameter.diagnostic ? "true" : "false"}
            aria-describedby={diagnosticId}
            value={draft}
            onFocus={(event) => onValueInputFocus(parameter, event.currentTarget)}
            onSelect={(event) => onValueInputSelection(parameter, event.currentTarget)}
            onBlur={(event) => onValueInputBlur(parameter, event.currentTarget)}
            onChange={(event) => {
              const expression = event.currentTarget.value;
              pendingDraftRef.current = expression;
              setDraft(expression);
              onValueChange(parameter, expression);
              onValueInputRefresh(parameter, event.currentTarget);
            }}
          />
          {isReferencePickableParameter(parameter) ? (
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
            {parameter.diagnostic.presentation
              ? text(
                  parameter.diagnostic.presentation.key,
                  parameter.diagnostic.message,
                  parameter.diagnostic.presentation.parameters
                )
              : parameter.diagnostic.message}
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
  text
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  group: VscodeModulePreviewParameterSnapshot["parameters"];
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
  onValueInputFocus: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputSelection: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputBlur: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onValueInputRefresh: (parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => void;
  onReferencePick: (parameter: VscodeModulePreviewParameter) => void;
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
            text={text}
          />
        ))}
      </tbody>
    </table>
  </section>
);

export const ModulePreviewParametersApp = ({ api }: { api: VscodeWebviewApi }) => {
  const webviewPresentation = useVscodeWebviewPresentation();
  const text = useCallback<PresentationText>(
    (key, fallback, parameters) => webviewPresentationTextFor(webviewPresentation, key, fallback, parameters),
    [webviewPresentation]
  );
  const [snapshot, setSnapshot] = useState<VscodeModulePreviewParameterSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState<VscodeModulePreviewParametersUnavailable | null>(null);
  const snapshotRef = useRef<VscodeModulePreviewParameterSnapshot | null>(null);
  const unavailableRef = useRef<VscodeModulePreviewParametersUnavailable | null>(null);
  const nextFocusGenerationRef = useRef(1);
  const valueFocusRef = useRef<{
    rowIdentity: string;
    message: VscodeModulePreviewParameterValueFocus;
  } | null>(null);
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
  }, [api]);

  const publishValueFocus = useCallback((
    parameter: VscodeModulePreviewParameter,
    input: HTMLInputElement,
    startNewGeneration: boolean
  ): void => {
    if (!snapshot || unavailable) return;
    const rowIdentity = rowIdentityFor(snapshot, parameter);
    const previous = valueFocusRef.current;
    if (previous && (previous.rowIdentity !== rowIdentity || startNewGeneration)) clearValueFocus();
    const focusGeneration = nextFocusGenerationRef.current;
    nextFocusGenerationRef.current += 1;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const message: VscodeModulePreviewParameterValueFocus = {
      type: "modulePreviewParameterValueFocus",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex,
      value: input.value,
      selectionStart,
      selectionEnd,
      focusGeneration
    };
    valueFocusRef.current = { rowIdentity, message };
    api.postMessage(message);
  }, [api, clearValueFocus, rowIdentityFor, snapshot, unavailable]);

  const onValueInputFocus = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    publishValueFocus(parameter, input, true);
  }, [publishValueFocus]);

  const onValueInputSelection = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    if (document.activeElement === input) publishValueFocus(parameter, input, false);
  }, [publishValueFocus]);

  const onValueInputBlur = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    void parameter;
    clearValueFocus(input.dataset.modulePreviewParameterIdentity);
  }, [clearValueFocus]);

  const onValueInputRefresh = useCallback((parameter: VscodeModulePreviewParameter, input: HTMLInputElement) => {
    if (document.activeElement === input) publishValueFocus(parameter, input, false);
  }, [publishValueFocus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtensionToVscodeMessage(event.data)) return;
      const message: ExtensionToVscodeMessage = event.data;
      if (message.type === "modulePreviewParameterSnapshot") {
        setSnapshot((current) => {
          if (
            current &&
            current.sessionId === message.sessionId &&
            message.sessionRevision <= current.sessionRevision
          ) return current;
          return message;
        });
        setUnavailable(null);
        return;
      }
      if (message.type === "modulePreviewParametersUnavailable") {
        setUnavailable(message);
        setSnapshot(null);
        return;
      }
      if (message.type === "modulePreviewRestoreParameterValueSelection") {
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
          current.message.focusGeneration !== message.focusGeneration ||
          message.sessionId !== currentSnapshot.sessionId ||
          message.documentUri !== currentSnapshot.documentUri ||
          message.documentVersion !== currentSnapshot.documentVersion ||
          message.sourceRevision !== currentSnapshot.sourceRevision ||
          message.sessionRevision !== currentSnapshot.sessionRevision ||
          message.targetDefinitionStatementId !== currentSnapshot.target.definitionStatementId ||
          message.definitionStatementId !== parameter.definitionStatementId ||
          message.parameterIndex !== parameter.parameterIndex ||
          input.value !== message.value ||
          !Number.isInteger(message.selectionStart) ||
          !Number.isInteger(message.selectionEnd) ||
          message.selectionStart < 0 ||
          message.selectionEnd < message.selectionStart ||
          message.selectionEnd > input.value.length
        ) return;
        input.setSelectionRange(message.selectionStart, message.selectionEnd);
        publishValueFocus(parameter, input, false);
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "modulePreviewParametersViewReady" });
    return () => window.removeEventListener("message", onMessage);
  }, [api, parameterForRowIdentity, publishValueFocus]);

  useEffect(() => {
    const focused = valueFocusRef.current;
    if (!focused) return;
    if (!snapshot || unavailable || !parameterForRowIdentity(snapshot, focused.rowIdentity)) {
      clearValueFocus();
      return;
    }
    const input = [...document.querySelectorAll<HTMLInputElement>(".module-preview-parameter-input")]
      .find((candidate) => candidate.dataset.modulePreviewParameterIdentity === focused.rowIdentity);
    if (!input || document.activeElement !== input) {
      clearValueFocus();
    }
  }, [clearValueFocus, parameterForRowIdentity, snapshot, unavailable]);

  useEffect(() => () => clearValueFocus(), [clearValueFocus]);

  const onValueChange = (parameter: VscodeModulePreviewParameter, expression: string): void => {
    if (!snapshot) return;
    api.postMessage({
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex,
      expression
    });
  };

  const onUseDefault = (parameter: VscodeModulePreviewParameter): void => {
    if (!snapshot || parameter.defaultSourceText === null) return;
    api.postMessage({
      type: "modulePreviewParameterUseDefault",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex
    });
  };

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
    <main className="module-preview-parameters" data-module-preview-parameter-surface="true">
      <header className="module-preview-parameters-header">
        <h1>{text("modulePreview.parameters.title", "Module Preview Parameters")}</h1>
        {snapshot ? <div className="module-preview-parameters-target">{snapshot.target.name}</div> : null}
      </header>
      {snapshot ? (
        <>
          <div
            className={`module-preview-parameters-status is-${snapshot.previewStatus}`}
            data-module-preview-preview-status={snapshot.previewStatus}
            role="status"
          >
            {previewStatusMessageFor(snapshot.previewStatus, text)}
          </div>
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
    </main>
  );
};
