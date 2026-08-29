import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VscodeModulePreviewParameterSnapshot, VscodeWebviewApi } from "./protocol";
import { ModulePreviewParametersApp } from "./ModulePreviewParametersApp";

const api: VscodeWebviewApi = { postMessage: vi.fn() };

const snapshot: VscodeModulePreviewParameterSnapshot = {
  type: "modulePreviewParameterSnapshot",
  sessionId: "module-preview-session:1",
  documentUri: "file:///workspace/pattern.nui",
  documentVersion: 4,
  sourceRevision: 7,
  sessionRevision: 2,
  target: {
    definitionStatementId: "module:inner",
    definitionStatementIndex: 8,
    name: "Inner"
  },
  ancestorContexts: [{
    kind: "ancestor",
    definitionStatementId: "module:outer",
    name: "Outer",
    parameters: [{
      definitionStatementId: "module:outer",
      parameterIndex: 0,
      name: "scale",
      type: { kind: "number" },
      optional: false,
      required: true,
      defaultSourceText: null,
      value: "2",
      diagnostic: null
    }]
  }],
  parameters: {
    kind: "target",
    definitionStatementId: "module:inner",
    name: "Inner",
    parameters: [
      {
        definitionStatementId: "module:inner",
        parameterIndex: 0,
        name: "width",
        type: { kind: "number" },
        optional: false,
        required: true,
        defaultSourceText: null,
        value: "@scale * 4",
        diagnostic: {
          code: "invalid-expression",
          definitionStatementId: "module:inner",
          parameterIndex: 0,
          message: "Value for width is invalid."
        }
      },
      {
        definitionStatementId: "module:inner",
        parameterIndex: 1,
        name: "label",
        type: { kind: "string" },
        optional: true,
        required: false,
        defaultSourceText: '"front"',
        value: "",
        diagnostic: null
      }
    ]
  },
  inputDiagnostics: [{
    code: "invalid-expression",
    definitionStatementId: "module:inner",
    parameterIndex: 0,
    message: "Value for width is invalid."
  }],
  previewStatus: "lastGood"
};

afterEach(() => {
  cleanup();
  vi.mocked(api.postMessage).mockReset();
});

describe("ModulePreviewParametersApp", () => {
  it("renders ordered ancestor and target groups with exact values, defaults, and diagnostics", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));

    const groups = [...document.querySelectorAll<HTMLElement>("[data-module-preview-parameter-group-kind]")];
    expect(groups.map((group) => group.dataset.modulePreviewParameterGroupKind)).toEqual(["ancestor", "target"]);
    expect(within(groups[0]!).getByRole("heading", { name: /Outer/ })).toBeInTheDocument();
    expect(within(groups[1]!).getByRole("heading", { name: /Inner/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Value for width")).toHaveValue("@scale * 4");
    expect(screen.getByText('"front"')).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Value for width is invalid.");
    expect(screen.getByRole("status")).toHaveTextContent("last valid preview");
    expect(api.postMessage).toHaveBeenCalledWith({ type: "modulePreviewParametersViewReady" });
  });

  it("relays immediate expression edits and explicit default actions with the snapshot proof", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));
    vi.mocked(api.postMessage).mockClear();

    fireEvent.change(screen.getByLabelText("Value for width"), { target: { value: "@scale * 5" } });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: "module:inner",
      parameterIndex: 0,
      expression: "@scale * 5"
    });

    fireEvent.change(screen.getByLabelText("Value for scale"), { target: { value: "3" } });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewParameterSetValue",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: "module:outer",
      parameterIndex: 0,
      expression: "3"
    });

    fireEvent.click(screen.getByRole("button", { name: "Use default for label" }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewParameterUseDefault",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: "module:inner",
      parameterIndex: 1
    });
  });

  it("keeps the value input focused across authoritative revisions and syncs defaults", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));
    vi.mocked(api.postMessage).mockClear();

    const input = screen.getByLabelText("Value for width");
    input.focus();
    fireEvent.change(input, { target: { value: "@scale * 5" } });
    expect(api.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "modulePreviewParameterSetValue",
      sessionRevision: snapshot.sessionRevision,
      expression: "@scale * 5"
    }));
    fireEvent.change(input, { target: { value: "@scale * 6" } });
    expect(api.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "modulePreviewParameterSetValue",
      sessionRevision: snapshot.sessionRevision,
      expression: "@scale * 6"
    }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue("@scale * 6");

    const intermediateSnapshot: VscodeModulePreviewParameterSnapshot = {
      ...snapshot,
      sessionRevision: snapshot.sessionRevision + 1,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) =>
          parameter.name === "width" ? { ...parameter, value: "@scale * 5" } : parameter
        )
      }
    };
    act(() => window.dispatchEvent(new MessageEvent("message", { data: intermediateSnapshot })));

    const sameInput = screen.getByLabelText("Value for width");
    expect(sameInput).toBe(input);
    expect(sameInput).toHaveFocus();
    expect(sameInput).toHaveValue("@scale * 6");

    const finalSnapshot: VscodeModulePreviewParameterSnapshot = {
      ...intermediateSnapshot,
      sessionRevision: intermediateSnapshot.sessionRevision + 1,
      parameters: {
        ...intermediateSnapshot.parameters,
        parameters: intermediateSnapshot.parameters.parameters.map((parameter) =>
          parameter.name === "width" ? { ...parameter, value: "@scale * 6" } : parameter
        )
      }
    };
    act(() => window.dispatchEvent(new MessageEvent("message", { data: finalSnapshot })));
    expect(screen.getByLabelText("Value for width")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("@scale * 6");

    const defaultSnapshot: VscodeModulePreviewParameterSnapshot = {
      ...finalSnapshot,
      sessionRevision: finalSnapshot.sessionRevision + 1,
      parameters: {
        ...finalSnapshot.parameters,
        parameters: finalSnapshot.parameters.parameters.map((parameter) =>
          parameter.name === "label" ? { ...parameter, value: '"front"' } : parameter
        )
      }
    };
    act(() => window.dispatchEvent(new MessageEvent("message", { data: defaultSnapshot })));
    expect(screen.getByLabelText("Value for label")).toHaveValue('"front"');
  });
});
