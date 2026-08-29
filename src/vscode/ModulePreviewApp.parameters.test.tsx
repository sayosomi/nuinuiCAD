import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type { ModulePreviewTarget } from "../dsl/modulePreviewTarget";

const mocks = vi.hoisted(() => ({
  queryModulePreviewTarget: vi.fn(),
  session: {
    activate: vi.fn(),
    getState: vi.fn(),
    setValue: vi.fn(),
    useDefaultExplicitly: vi.fn()
  },
  postMessage: vi.fn()
}));

vi.mock("../dsl/modulePreviewState", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
  return { ...actual, createModulePreviewSession: () => mocks.session };
});

vi.mock("../dsl/modulePreviewTarget", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewTarget")>("../dsl/modulePreviewTarget");
  return { ...actual, queryModulePreviewTarget: mocks.queryModulePreviewTarget };
});

import { ModulePreviewApp } from "./ModulePreviewApp";

const target: ModulePreviewTarget = {
  definitionStatementId: "module:preview",
  definitionStatementIndex: 1,
  name: "Preview"
};

const snapshot = {
  sourceRevision: 1,
  target,
  ancestorContexts: [{
    kind: "ancestor" as const,
    definitionStatementId: "module:outer",
    name: "Outer",
    parameters: [{
      definitionStatementId: "module:outer",
      parameterIndex: 0,
      name: "scale",
      type: { kind: "number" as const },
      optional: false,
      required: true,
      defaultSourceText: null,
      value: "2",
      diagnostic: null
    }]
  }],
  parameters: {
    kind: "target" as const,
    definitionStatementId: target.definitionStatementId,
    name: target.name,
    parameters: [{
      definitionStatementId: target.definitionStatementId,
      parameterIndex: 0,
      name: "width",
      type: { kind: "number" as const },
      optional: false,
      required: true,
      defaultSourceText: null,
      value: "3",
      diagnostic: null
    }]
  },
  inputDiagnostics: [],
  preview: { kind: "noValidPreview" as const, result: null }
} satisfies ModulePreviewSessionSnapshot;

const source = "nui 4\nmodule Preview(width: number) {\n}\n";

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setValue.mockReset();
  mocks.session.useDefaultExplicitly.mockReset();
  mocks.postMessage.mockReset();
});

describe("ModulePreviewApp parameter relay", () => {
  it("routes accepted value and unavailable-default actions through the live session", () => {
    mocks.queryModulePreviewTarget.mockReturnValue(target);
    mocks.session.activate.mockReturnValue(snapshot);
    mocks.session.getState.mockReturnValue(snapshot);
    mocks.session.setValue.mockReturnValue(snapshot);
    mocks.session.useDefaultExplicitly.mockReturnValue({ applied: false, state: snapshot });
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: source.indexOf("module Preview") }
      }));
    });

    expect(mocks.session.activate).toHaveBeenCalledWith(expect.objectContaining({ target }));
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionId: "module-preview-session:1",
      target
    }));

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewSetValue",
        sessionId: "module-preview-session:1",
        documentUri: "file:///pattern.nui",
        documentVersion: 1,
        sourceRevision: 1,
        sessionRevision: 2,
        targetDefinitionStatementId: target.definitionStatementId,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: 0,
        expression: "4"
      }
    })));
    expect(mocks.session.setValue).toHaveBeenCalledWith(target.definitionStatementId, 0, "4");

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewUseDefault",
        sessionId: "module-preview-session:1",
        documentUri: "file:///pattern.nui",
        documentVersion: 1,
        sourceRevision: 1,
        sessionRevision: 3,
        targetDefinitionStatementId: target.definitionStatementId,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: 0
      }
    })));
    expect(mocks.session.useDefaultExplicitly).toHaveBeenCalledWith(target.definitionStatementId, 0);
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionRevision: 4
    }));
  });

  it("applies consecutive same-revision value actions in order", () => {
    mocks.queryModulePreviewTarget.mockReturnValue(target);
    mocks.session.activate.mockReturnValue(snapshot);
    mocks.session.getState.mockReturnValue(snapshot);
    mocks.session.setValue.mockImplementation((_definitionStatementId, _parameterIndex, expression) => ({
      ...snapshot,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) =>
          parameter.parameterIndex === 0 ? { ...parameter, value: expression } : parameter
        )
      }
    }));
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: source.indexOf("module Preview") }
      }));
    });
    mocks.postMessage.mockClear();

    const valueAction = (expression: string) => ({
      type: "modulePreviewSetValue" as const,
      sessionId: "module-preview-session:1",
      documentUri: "file:///pattern.nui",
      documentVersion: 1,
      sourceRevision: 1,
      sessionRevision: 2,
      targetDefinitionStatementId: target.definitionStatementId,
      definitionStatementId: target.definitionStatementId,
      parameterIndex: 0,
      expression
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: valueAction("4") }));
      window.dispatchEvent(new MessageEvent("message", { data: valueAction("5") }));
    });

    expect(mocks.session.setValue).toHaveBeenNthCalledWith(1, target.definitionStatementId, 0, "4");
    expect(mocks.session.setValue).toHaveBeenNthCalledWith(2, target.definitionStatementId, 0, "5");
    expect(mocks.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionRevision: 4,
      parameters: expect.objectContaining({
        parameters: expect.arrayContaining([expect.objectContaining({ value: "5" })])
      })
    }));
  });
});
