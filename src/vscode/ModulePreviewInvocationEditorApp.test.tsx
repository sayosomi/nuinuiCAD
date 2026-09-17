import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        proof={{ sessionId: "session", documentUri: "file:///x.nui", documentVersion: 1, sourceRevision: 1, sessionRevision: 1, targetDefinitionStatementId: "module:inner" }}
        onChange={vi.fn()}
        onSiteChange={vi.fn()}
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
        onReferencePick={vi.fn()}
      />
    );
    expect(document.querySelector("[data-module-preview-invocation-surface='true']")).toHaveClass("module-preview-invocation-surface");
    expect(document.querySelectorAll(".module-preview-invocation-cm")).toHaveLength(2);
  });
});
