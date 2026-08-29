import { useEffect, useState } from "react";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewParameter,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParametersUnavailable,
  VscodeWebviewApi
} from "./protocol";
import { isExtensionToVscodeMessage } from "./vscodeRustTransport";
import "./modulePreviewParameters.css";

const typeLabelFor = (parameter: VscodeModulePreviewParameter): string => {
  if (!parameter.type) return "unknown";
  return parameter.type.kind;
};

const unavailableMessageFor = (state: VscodeModulePreviewParametersUnavailable): string => {
  switch (state.reason) {
    case "no-session": return "Open Module Preview to edit its parameters.";
    case "not-ready": return "Module Preview is loading its exact current target.";
    case "source-stale": return "Module Preview parameters are waiting for the refreshed source.";
    case "target-unavailable": return "The Module Preview target is not available in the current source.";
    case "disposed": return "The Module Preview panel is no longer available.";
  }
};

const previewStatusMessageFor = (status: VscodeModulePreviewParameterSnapshot["previewStatus"]): string => {
  switch (status) {
    case "current": return "Current preview";
    case "lastGood": return "Showing the last valid preview while inputs are invalid.";
    case "noValidPreview": return "No valid preview for the current inputs.";
  }
};

const ParameterRow = ({
  snapshot,
  parameter,
  onValueChange,
  onUseDefault
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  parameter: VscodeModulePreviewParameter;
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
}) => {
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
        <span className="module-preview-parameter-type">{typeLabelFor(parameter)}</span>
        {parameter.required ? <span className="module-preview-parameter-kind">required</span> : null}
        {parameter.optional ? <span className="module-preview-parameter-kind">optional</span> : null}
      </th>
      <td>
        <input
          key={`${snapshot.sessionId}:${snapshot.sessionRevision}:${parameter.definitionStatementId}:${parameter.parameterIndex}`}
          className="module-preview-parameter-input"
          aria-label={`Value for ${parameter.name}`}
          aria-invalid={parameter.diagnostic ? "true" : "false"}
          aria-describedby={diagnosticId}
          defaultValue={parameter.value}
          onChange={(event) => onValueChange(parameter, event.currentTarget.value)}
        />
        {parameter.diagnostic ? (
          <div id={diagnosticId} className="module-preview-parameter-diagnostic" role="alert">
            {parameter.diagnostic.message}
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
              aria-label={`Use default for ${parameter.name}`}
              onClick={() => onUseDefault(parameter)}
            >
              Use default
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
  onUseDefault
}: {
  snapshot: VscodeModulePreviewParameterSnapshot;
  group: VscodeModulePreviewParameterSnapshot["parameters"];
  onValueChange: (parameter: VscodeModulePreviewParameter, expression: string) => void;
  onUseDefault: (parameter: VscodeModulePreviewParameter) => void;
}) => (
  <section
    className="module-preview-parameter-group"
    data-module-preview-parameter-group-kind={group.kind}
    data-module-preview-definition-id={group.definitionStatementId}
  >
    <h2>{group.kind === "target" ? "Target" : "Context"}: {group.name}</h2>
    <table>
      <thead>
        <tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Default</th></tr>
      </thead>
      <tbody>
        {group.parameters.map((parameter) => (
          <ParameterRow
            key={`${parameter.definitionStatementId}:${parameter.parameterIndex}`}
            snapshot={snapshot}
            parameter={parameter}
            onValueChange={onValueChange}
            onUseDefault={onUseDefault}
          />
        ))}
      </tbody>
    </table>
  </section>
);

export const ModulePreviewParametersApp = ({ api }: { api: VscodeWebviewApi }) => {
  const [snapshot, setSnapshot] = useState<VscodeModulePreviewParameterSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState<VscodeModulePreviewParametersUnavailable | null>(null);

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
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "modulePreviewParametersViewReady" });
    return () => window.removeEventListener("message", onMessage);
  }, [api]);

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

  return (
    <main className="module-preview-parameters" data-module-preview-parameter-surface="true">
      <header className="module-preview-parameters-header">
        <h1>Module Preview Parameters</h1>
        {snapshot ? <div className="module-preview-parameters-target">{snapshot.target.name}</div> : null}
      </header>
      {snapshot ? (
        <>
          <div
            className={`module-preview-parameters-status is-${snapshot.previewStatus}`}
            data-module-preview-preview-status={snapshot.previewStatus}
            role="status"
          >
            {previewStatusMessageFor(snapshot.previewStatus)}
          </div>
          <div className="module-preview-parameters-groups">
            {snapshot.ancestorContexts.map((group) => (
              <ParameterGroup
                key={group.definitionStatementId}
                snapshot={snapshot}
                group={group}
                onValueChange={onValueChange}
                onUseDefault={onUseDefault}
              />
            ))}
            <ParameterGroup
              snapshot={snapshot}
              group={snapshot.parameters}
              onValueChange={onValueChange}
              onUseDefault={onUseDefault}
            />
          </div>
        </>
      ) : (
        <div className="module-preview-parameters-unavailable" role="status">
          {unavailable ? unavailableMessageFor(unavailable) : "Open Module Preview to edit its parameters."}
        </div>
      )}
    </main>
  );
};
