import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { modulePreviewInvocationFor, type ModulePreviewInvocation } from "../dsl/modulePreviewInvocation";
import { ModulePreviewInvocationEditorApp } from "./ModulePreviewInvocationEditorApp";

const invocation: ModulePreviewInvocation = modulePreviewInvocationFor({ blocks: [
  {
    kind: "ancestor",
    definitionStatementId: "module:outer",
    definitionStatementIndex: 1,
    declarationScopeId: "scope:root",
    name: "Outer",
    parameters: [{
      definitionStatementId: "module:outer", parameterIndex: 0, name: "scale", type: { kind: "number" },
      optional: false, required: true, defaultSourceText: null, active: true, value: "2",
      caller: { statementIndex: 1, scopeId: "scope:root", sourceOrderIndex: 1 }
    }]
  },
  {
    kind: "target",
    definitionStatementId: "module:inner",
    definitionStatementIndex: 3,
    declarationScopeId: "scope:outer",
    name: "Inner",
    parameters: [{
      definitionStatementId: "module:inner", parameterIndex: 0, name: "anchor", type: { kind: "point" },
      optional: false, required: true, defaultSourceText: null, active: true, value: "@P",
      caller: { statementIndex: 3, scopeId: "scope:outer", sourceOrderIndex: 3 }
    }]
  }
]});

afterEach(cleanup);

describe("ModulePreviewInvocationEditorApp", () => {
  it("renders separately labeled Context and Target call blocks with no table surface", () => {
    render(
      <ModulePreviewInvocationEditorApp
        invocation={invocation}
        source={{ normalizedSource: "nui 1", sourceRevision: 1 }}
        semantic={{ sourceRevision: 1 }}
        target={{ definitionStatementId: "module:inner", definitionStatementIndex: 3 }}
        proof={{ sessionId: "session", documentUri: "file:///x.nui", documentVersion: 1, normalizedSource: "nui 1", sourceRevision: 1, sessionRevision: 1, targetDefinitionStatementId: "module:inner", targetDefinitionStatementIndex: 3, targetName: "Inner" }}
        onChange={vi.fn()}
        onSiteChange={vi.fn()}
        onValueStep={vi.fn()}
        onReferencePick={vi.fn()}
      />
    );
    const blocks = [...document.querySelectorAll("[data-module-preview-invocation-block-kind]")];
    expect(blocks.map((block) => block.querySelector("h2")?.textContent)).toEqual(["Context: Outer", "Target: Inner"]);
    expect(screen.queryByRole("columnheader", { name: "Value" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(2);
  });

  it("shows the invocation surface's scroll container and theme-compatible editor classes", () => {
    render(
      <ModulePreviewInvocationEditorApp
        invocation={invocation}
        source={{ normalizedSource: "nui 1", sourceRevision: 1 }}
        semantic={{ sourceRevision: 1 }}
        target={{ definitionStatementId: "module:inner", definitionStatementIndex: 3 }}
        proof={null}
        onChange={vi.fn()}
        onSiteChange={vi.fn()}
        onValueStep={vi.fn()}
        onReferencePick={vi.fn()}
      />
    );
    expect(document.querySelector("[data-module-preview-invocation-surface='true']")).toHaveClass("module-preview-invocation-surface");
    expect(document.querySelectorAll(".module-preview-invocation-cm")).toHaveLength(2);
  });

  it("keeps Pick in the block toolbar instead of taking editor width", () => {
    const onReferencePick = vi.fn();
    render(
      <ModulePreviewInvocationEditorApp
        invocation={invocation}
        source={{ normalizedSource: "nui 1", sourceRevision: 1 }}
        semantic={{ sourceRevision: 1 }}
        target={{ definitionStatementId: "module:inner", definitionStatementIndex: 3 }}
        proof={{ sessionId: "session", documentUri: "file:///x.nui", documentVersion: 1, normalizedSource: "nui 1", sourceRevision: 1, sessionRevision: 1, targetDefinitionStatementId: "module:inner", targetDefinitionStatementIndex: 3, targetName: "Inner" }}
        onChange={vi.fn()}
        onSiteChange={vi.fn()}
        onValueStep={vi.fn()}
        onReferencePick={onReferencePick}
      />
    );
    const editor = document.querySelectorAll<HTMLElement>(".cm-editor")[1]!;
    const view = EditorView.findFromDOM(editor)!;
    const value = invocation.blocks[1]!.parameters[0]!;
    act(() => view.dispatch({ selection: { anchor: value.valueRange.from + 1 } }));

    const pick = screen.getByRole("button", { name: "Pick" });
    expect(pick.closest(".module-preview-invocation-block-toolbar")).not.toBeNull();
    expect(pick.closest(".module-preview-invocation-editor-row")).toBeNull();
    expect(pick.closest(".module-preview-invocation-block-target")?.querySelector(".module-preview-invocation-cm")).not.toBeNull();
    act(() => pick.click());
    expect(onReferencePick).toHaveBeenCalledWith(expect.objectContaining({
      block: expect.objectContaining({ kind: "target", definitionStatementIndex: 3 }),
      parameter: expect.objectContaining({ parameterIndex: 0 })
    }));
  });

  it("shows a disabled Pick control when the current Preview has no coherent candidate context", () => {
    const onReferencePick = vi.fn();
    render(
      <ModulePreviewInvocationEditorApp
        invocation={invocation}
        source={{ normalizedSource: "nui 1", sourceRevision: 1 }}
        semantic={{ sourceRevision: 1 }}
        target={{ definitionStatementId: "module:inner", definitionStatementIndex: 3 }}
        proof={{ sessionId: "session", documentUri: "file:///x.nui", documentVersion: 1, normalizedSource: "nui 1", sourceRevision: 1, sessionRevision: 1, targetDefinitionStatementId: "module:inner", targetDefinitionStatementIndex: 3, targetName: "Inner" }}
        referencePickAvailable={false}
        onChange={vi.fn()}
        onSiteChange={vi.fn()}
        onValueStep={vi.fn()}
        onReferencePick={onReferencePick}
      />
    );
    const editor = document.querySelectorAll<HTMLElement>(".cm-editor")[1]!;
    const view = EditorView.findFromDOM(editor)!;
    const value = invocation.blocks[1]!.parameters[0]!;
    act(() => view.dispatch({ selection: { anchor: value.valueRange.from + 1 } }));
    const pick = screen.getByRole("button", { name: "Pick" });
    expect(pick).toBeDisabled();
    act(() => pick.click());
    expect(onReferencePick).not.toHaveBeenCalled();
  });
});
