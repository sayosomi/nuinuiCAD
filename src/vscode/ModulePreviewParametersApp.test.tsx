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

const snapshotWithValues = (
  sessionRevision: number,
  values: Readonly<Record<string, string>>
): VscodeModulePreviewParameterSnapshot => ({
  ...snapshot,
  sessionRevision,
  parameters: {
    ...snapshot.parameters,
    parameters: snapshot.parameters.parameters.map((parameter) => ({
      ...parameter,
      value: values[parameter.name] ?? parameter.value
    }))
  }
});

const geometrySnapshot: VscodeModulePreviewParameterSnapshot = {
  ...snapshot,
  target: { ...snapshot.target, name: "GeometryModule" },
  ancestorContexts: [{
    kind: "ancestor",
    definitionStatementId: "module:outer",
    name: "Outer",
    parameters: [{
      ...snapshot.parameters.parameters[0]!,
      definitionStatementId: "module:outer",
      name: "contextAnchor",
      parameterIndex: 0,
      type: { kind: "point" },
      diagnostic: null
    }]
  }],
  parameters: {
    kind: "target",
    definitionStatementId: snapshot.target.definitionStatementId,
    name: "GeometryModule",
    parameters: [
      { ...snapshot.parameters.parameters[0]!, name: "anchor", parameterIndex: 0, type: { kind: "point" }, diagnostic: null },
      { ...snapshot.parameters.parameters[0]!, name: "edge", parameterIndex: 1, type: { kind: "line" }, diagnostic: null },
      { ...snapshot.parameters.parameters[0]!, name: "route", parameterIndex: 2, type: { kind: "path" }, diagnostic: null },
      { ...snapshot.parameters.parameters[0]!, name: "count", parameterIndex: 3, type: { kind: "number" }, diagnostic: null }
    ]
  },
  previewStatus: "current"
};

afterEach(() => {
  cleanup();
  vi.mocked(api.postMessage).mockReset();
});

describe("ModulePreviewParametersApp", () => {
  it("keeps exact current rows when an older source-stale message arrives after the snapshot", () => {
    const requiredDiagnostic = {
      code: "required-value-missing" as const,
      definitionStatementId: snapshot.target.definitionStatementId,
      parameterIndex: 0,
      message: "Parameter 'width' is required."
    };
    const currentSnapshot: VscodeModulePreviewParameterSnapshot = {
      ...snapshot,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) =>
          parameter.name === "width"
            ? { ...parameter, value: "", diagnostic: requiredDiagnostic }
            : parameter
        )
      },
      inputDiagnostics: [requiredDiagnostic],
      previewStatus: "noValidPreview"
    };
    const sourceStale = {
      type: "modulePreviewParametersUnavailable" as const,
      sessionId: currentSnapshot.sessionId,
      documentUri: currentSnapshot.documentUri,
      documentVersion: currentSnapshot.documentVersion,
      sourceRevision: currentSnapshot.sourceRevision,
      sessionRevision: currentSnapshot.sessionRevision - 1,
      targetDefinitionStatementId: currentSnapshot.target.definitionStatementId,
      reason: "source-stale" as const
    };
    render(<ModulePreviewParametersApp api={api} />);

    act(() => window.dispatchEvent(new MessageEvent("message", { data: sourceStale })));
    expect(screen.getByText("Module Preview parameters are waiting for the refreshed source.")).toBeInTheDocument();

    act(() => window.dispatchEvent(new MessageEvent("message", { data: currentSnapshot })));
    expect(screen.getByLabelText("Value for width")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Parameter 'width' is required.");

    act(() => window.dispatchEvent(new MessageEvent("message", { data: sourceStale })));
    expect(screen.getByLabelText("Value for width")).toBeInTheDocument();
    expect(screen.queryByText("Module Preview parameters are waiting for the refreshed source.")).not.toBeInTheDocument();
  });

  it("renders host-published Japanese presentation while preserving authored parameter names", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "webviewPresentation",
          presentation: {
            locale: "ja",
            strings: {
              "modulePreview.parameters.title": "Module Previewパラメータ",
              "modulePreview.parameters.target": "Target",
              "modulePreview.parameters.context": "Context",
              "modulePreview.parameters.parameter": "Parameter",
              "modulePreview.parameters.value": "Value",
              "modulePreview.parameters.default": "Default",
              "modulePreview.parameters.required": "必須",
              "modulePreview.parameters.optional": "任意",
              "modulePreview.parameters.valueFor": "{name}の値",
              "modulePreview.parameters.pickReferenceFor": "{name}の参照を選択",
              "modulePreview.parameters.pick": "選択",
              "modulePreview.parameters.useDefaultFor": "{name}にデフォルトを使用",
              "modulePreview.parameters.useDefault": "デフォルトを使用",
              "modulePreview.parameters.status.lastGood": "入力が不正なため、最後に有効だったプレビューを表示しています。",
              "modulePreview.parameters.diagnostic.invalid-expression": "「{name}」の値はこのコンテキストで有効なModule引数式ではありません。"
            },
            diagnosticTemplates: {}
          }
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          ...snapshot,
          parameters: {
            ...snapshot.parameters,
            parameters: snapshot.parameters.parameters.map((parameter) => parameter.name === "width"
              ? {
                  ...parameter,
                  diagnostic: {
                    ...parameter.diagnostic!,
                    presentation: {
                      key: "modulePreview.parameters.diagnostic.invalid-expression",
                      parameters: { name: parameter.name }
                    }
                  }
                }
              : parameter)
          }
        }
      }));
    });

    expect(screen.getByRole("heading", { name: "Module Previewパラメータ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Inner/ })).toBeInTheDocument();
    expect(screen.getByLabelText("widthの値")).toHaveValue("@scale * 4");
    expect(screen.getByRole("status")).toHaveTextContent("入力が不正");
    expect(screen.getByRole("alert")).toHaveTextContent("このコンテキストで有効なModule引数式ではありません");
  });

  it("exposes contextual Pick actions for geometry rows only and routes the exact row proof", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: geometrySnapshot })));

    const rows = [...document.querySelectorAll<HTMLTableRowElement>("[data-module-preview-parameter-row]")];
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.querySelector("[data-module-preview-parameter-pick='true']"))).toHaveLength(4);
    const countRow = rows.find((row) => row.dataset.modulePreviewParameterRow === "module:inner:3");
    expect(countRow?.querySelector("[data-module-preview-parameter-pick='true']")).toBeNull();

    const anchorRow = rows.find((row) => row.dataset.modulePreviewParameterRow === "module:inner:0");
    const anchorInput = within(anchorRow!).getByLabelText("Value for anchor");
    expect(anchorRow).toHaveAttribute("data-module-preview-parameter-row", "module:inner:0");
    fireEvent.focus(anchorInput);
    expect(within(anchorRow!).getByRole("button", { name: "Pick reference for anchor" })).toBeInTheDocument();
    fireEvent.click(within(anchorRow!).getByRole("button", { name: "Pick reference for anchor" }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewParameterReferencePickStart",
      sessionId: geometrySnapshot.sessionId,
      documentUri: geometrySnapshot.documentUri,
      documentVersion: geometrySnapshot.documentVersion,
      sourceRevision: geometrySnapshot.sourceRevision,
      sessionRevision: geometrySnapshot.sessionRevision,
      targetDefinitionStatementId: geometrySnapshot.target.definitionStatementId,
      definitionStatementId: geometrySnapshot.target.definitionStatementId,
      parameterIndex: 0
    });

    const contextRow = rows.find((row) => row.dataset.modulePreviewParameterRow === "module:outer:0");
    fireEvent.click(within(contextRow!).getByRole("button", { name: "Pick reference for contextAnchor" }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "modulePreviewParameterReferencePickStart",
      sessionId: geometrySnapshot.sessionId,
      documentUri: geometrySnapshot.documentUri,
      documentVersion: geometrySnapshot.documentVersion,
      sourceRevision: geometrySnapshot.sourceRevision,
      sessionRevision: geometrySnapshot.sessionRevision,
      targetDefinitionStatementId: geometrySnapshot.target.definitionStatementId,
      definitionStatementId: "module:outer",
      parameterIndex: 0
    });
  });

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
      type: "modulePreviewParameterValueFocus",
      sessionRevision: snapshot.sessionRevision,
      value: "@scale * 4"
    }));
    expect(api.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "modulePreviewParameterSetValue",
      sessionRevision: snapshot.sessionRevision,
      expression: "@scale * 5"
    }));
    fireEvent.change(input, { target: { value: "@scale * 6" } });
    expect(api.postMessage).toHaveBeenNthCalledWith(4, expect.objectContaining({
      type: "modulePreviewParameterSetValue",
      sessionRevision: snapshot.sessionRevision,
      expression: "@scale * 6"
    }));
    expect(api.postMessage).toHaveBeenNthCalledWith(5, expect.objectContaining({
      type: "modulePreviewParameterValueFocus",
      sessionRevision: snapshot.sessionRevision,
      value: "@scale * 6"
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

  it("publishes a refreshed exact proof after the focused input catches up to a snapshot", () => {
    render(<ModulePreviewParametersApp api={api} />);
    const initialSnapshot = snapshotWithValues(40, { width: "1" });
    act(() => window.dispatchEvent(new MessageEvent("message", { data: initialSnapshot })));

    const input = screen.getByLabelText("Value for width") as HTMLInputElement;
    input.focus();
    vi.mocked(api.postMessage).mockClear();

    const updatedSnapshot = snapshotWithValues(41, { width: "3" });
    act(() => window.dispatchEvent(new MessageEvent("message", { data: updatedSnapshot })));

    expect(screen.getByLabelText("Value for width")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("3");
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterValueFocus",
      sessionRevision: updatedSnapshot.sessionRevision,
      value: "1"
    }));
    const refreshedFocus = vi.mocked(api.postMessage).mock.calls
      .map(([message]) => message as { type?: string; sessionRevision?: number; value?: string; focusGeneration?: number })
      .find((message) =>
        message.type === "modulePreviewParameterValueFocus" &&
        message.sessionRevision === updatedSnapshot.sessionRevision
      );
    expect(refreshedFocus).toMatchObject({
      type: "modulePreviewParameterValueFocus",
      sessionRevision: updatedSnapshot.sessionRevision,
      value: "3"
    });
    if (!refreshedFocus?.focusGeneration) throw new Error("expected refreshed Value focus generation");

    input.setSelectionRange(0, 0);
    vi.mocked(api.postMessage).mockClear();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewRestoreParameterValueSelection",
        sessionId: updatedSnapshot.sessionId,
        documentUri: updatedSnapshot.documentUri,
        documentVersion: updatedSnapshot.documentVersion,
        sourceRevision: updatedSnapshot.sourceRevision,
        sessionRevision: updatedSnapshot.sessionRevision,
        targetDefinitionStatementId: updatedSnapshot.target.definitionStatementId,
        definitionStatementId: "module:inner",
        parameterIndex: 0,
        value: "3",
        selectionStart: 0,
        selectionEnd: 1,
        focusGeneration: refreshedFocus.focusGeneration
      }
    })));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
    expect(api.postMessage).toHaveBeenCalledTimes(1);
    const acknowledgedFocus = vi.mocked(api.postMessage).mock.calls[0]?.[0] as {
      type?: string;
      sessionRevision?: number;
      value?: string;
      selectionStart?: number;
      selectionEnd?: number;
      focusGeneration?: number;
    } | undefined;
    expect(acknowledgedFocus).toMatchObject({
      type: "modulePreviewParameterValueFocus",
      sessionId: updatedSnapshot.sessionId,
      documentUri: updatedSnapshot.documentUri,
      documentVersion: updatedSnapshot.documentVersion,
      sourceRevision: updatedSnapshot.sourceRevision,
      sessionRevision: updatedSnapshot.sessionRevision,
      targetDefinitionStatementId: updatedSnapshot.target.definitionStatementId,
      definitionStatementId: "module:inner",
      parameterIndex: 0,
      value: "3",
      selectionStart: 0,
      selectionEnd: 1
    });
    expect(acknowledgedFocus?.focusGeneration).toBeGreaterThan(refreshedFocus.focusGeneration);
  });

  it("does not leave repeated Default state that can discard a newer rapid draft", () => {
    render(<ModulePreviewParametersApp api={api} />);
    const defaultValueSnapshot = snapshotWithValues(10, { label: '"front"' });
    act(() => window.dispatchEvent(new MessageEvent("message", { data: defaultValueSnapshot })));

    const input = screen.getByLabelText("Value for label");
    fireEvent.click(screen.getByRole("button", { name: "Use default for label" }));
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(11, { label: '"front"' })
    })));
    input.focus();
    fireEvent.change(input, { target: { value: '"back"' } });
    fireEvent.change(input, { target: { value: '"back!"' } });

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(12, { label: '"back"' })
    })));
    expect(screen.getByLabelText("Value for label")).toBe(input);
    expect(input).toHaveValue('"back!"');
    expect(input).toHaveFocus();

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(13, { label: '"back!"' })
    })));
    expect(input).toHaveValue('"back!"');
    expect(input).toHaveFocus();
  });

  it("follows value snapshots before a Default result when Default supersedes the draft", () => {
    render(<ModulePreviewParametersApp api={api} />);
    const initialSnapshot = snapshotWithValues(20, { label: "" });
    act(() => window.dispatchEvent(new MessageEvent("message", { data: initialSnapshot })));

    const input = screen.getByLabelText("Value for label");
    fireEvent.change(input, { target: { value: '"typed-a"' } });
    fireEvent.change(input, { target: { value: '"typed-b"' } });
    fireEvent.click(screen.getByRole("button", { name: "Use default for label" }));

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(21, { label: '"typed-a"' })
    })));
    expect(input).toHaveValue('"typed-a"');
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(22, { label: '"typed-b"' })
    })));
    expect(input).toHaveValue('"typed-b"');
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(23, { label: '"front"' })
    })));
    expect(input).toHaveValue('"front"');
  });

  it("keeps a new value draft after Default until its authoritative snapshot arrives", () => {
    render(<ModulePreviewParametersApp api={api} />);
    const initialSnapshot = snapshotWithValues(30, { label: "" });
    act(() => window.dispatchEvent(new MessageEvent("message", { data: initialSnapshot })));

    const input = screen.getByLabelText("Value for label");
    fireEvent.click(screen.getByRole("button", { name: "Use default for label" }));
    input.focus();
    fireEvent.change(input, { target: { value: '"new-value"' } });

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(31, { label: '"front"' })
    })));
    expect(input).toHaveValue('"new-value"');
    expect(input).toHaveFocus();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: snapshotWithValues(32, { label: '"new-value"' })
    })));
    expect(input).toHaveValue('"new-value"');
    expect(input).toHaveFocus();
  });

  it("publishes exact Value focus, selection, and local draft freshness", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));
    vi.mocked(api.postMessage).mockClear();

    const input = screen.getByLabelText("Value for width") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 7);
    fireEvent.select(input);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterValueFocus",
      sessionId: snapshot.sessionId,
      documentUri: snapshot.documentUri,
      documentVersion: snapshot.documentVersion,
      sourceRevision: snapshot.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: snapshot.target.definitionStatementId,
      definitionStatementId: "module:inner",
      parameterIndex: 0,
      value: "@scale * 4",
      selectionStart: 2,
      selectionEnd: 7,
      focusGeneration: 2
    }));

    fireEvent.change(input, { target: { value: "@scale * 9" } });
    expect(api.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewParameterValueFocus",
      value: "@scale * 9",
      selectionStart: 10,
      selectionEnd: 10,
      focusGeneration: 3
    }));
  });

  it("clears exact focus on blur, unavailable state, and row replacement", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));
    const input = screen.getByLabelText("Value for width");
    input.focus();
    vi.mocked(api.postMessage).mockClear();
    fireEvent.blur(input);
    expect(api.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewParameterValueBlur",
      focusGeneration: 1
    }));

    fireEvent.focus(input);
    vi.mocked(api.postMessage).mockClear();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewParametersUnavailable",
        sessionId: snapshot.sessionId,
        documentUri: snapshot.documentUri,
        documentVersion: snapshot.documentVersion,
        sourceRevision: snapshot.sourceRevision,
        sessionRevision: snapshot.sessionRevision + 1,
        targetDefinitionStatementId: snapshot.target.definitionStatementId,
        reason: "source-stale"
      }
    })));
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewParameterValueBlur" }));

    const refreshedSnapshot = { ...snapshot, sessionRevision: snapshot.sessionRevision + 2 };
    act(() => window.dispatchEvent(new MessageEvent("message", { data: refreshedSnapshot })));
    const replacementInput = screen.getByLabelText("Value for width");
    replacementInput.focus();
    vi.mocked(api.postMessage).mockClear();
    const replacement = {
      ...snapshot,
      sessionId: "module-preview-session:replacement",
      target: { ...snapshot.target, definitionStatementId: "module:replacement" },
      parameters: {
        ...snapshot.parameters,
        definitionStatementId: "module:replacement",
        parameters: snapshot.parameters.parameters.map((parameter) => ({
          ...parameter,
          definitionStatementId: "module:replacement"
        }))
      }
    };
    act(() => window.dispatchEvent(new MessageEvent("message", { data: replacement })));
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewParameterValueBlur" }));
  });

  it("restores selection only for the matching live focus generation and value", () => {
    render(<ModulePreviewParametersApp api={api} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: snapshot })));
    const input = screen.getByLabelText("Value for width") as HTMLInputElement;
    input.focus();
    const focusMessage = vi.mocked(api.postMessage).mock.calls
      .map(([message]) => message as { type?: string; focusGeneration?: number })
      .find((message) => message.type === "modulePreviewParameterValueFocus");
    if (!focusMessage?.focusGeneration) throw new Error("expected Value focus generation");

    input.setSelectionRange(0, 0);
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewRestoreParameterValueSelection",
        sessionId: snapshot.sessionId,
        documentUri: snapshot.documentUri,
        documentVersion: snapshot.documentVersion,
        sourceRevision: snapshot.sourceRevision,
        sessionRevision: snapshot.sessionRevision,
        targetDefinitionStatementId: snapshot.target.definitionStatementId,
        definitionStatementId: "module:inner",
        parameterIndex: 0,
        value: input.value,
        selectionStart: 1,
        selectionEnd: 4,
        focusGeneration: focusMessage.focusGeneration
      }
    })));
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);

    input.setSelectionRange(0, 0);
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewRestoreParameterValueSelection",
        sessionId: snapshot.sessionId,
        documentUri: snapshot.documentUri,
        documentVersion: snapshot.documentVersion,
        sourceRevision: snapshot.sourceRevision,
        sessionRevision: snapshot.sessionRevision,
        targetDefinitionStatementId: snapshot.target.definitionStatementId,
        definitionStatementId: "module:inner",
        parameterIndex: 0,
        value: "stale",
        selectionStart: 2,
        selectionEnd: 5,
        focusGeneration: focusMessage.focusGeneration
      }
    })));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
  });
});
