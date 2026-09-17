import { describe, expect, it, vi } from "vitest";
import { modulePreviewInvocationFor, type ModulePreviewInvocationBlockInput } from "../dsl/modulePreviewInvocation";
import { ModulePreviewInvocationEditorController } from "./modulePreviewInvocationEditor";

const input: ModulePreviewInvocationBlockInput = {
  kind: "target",
  definitionStatementId: "module:preview",
  definitionStatementIndex: 1,
  declarationScopeId: "scope:root",
  name: "Preview",
  parameters: [{
    definitionStatementId: "module:preview",
    parameterIndex: 0,
    name: "width",
    type: { kind: "number" },
    optional: false,
    required: true,
    defaultSourceText: null,
    active: true,
    value: "12",
    caller: { statementIndex: 1, scopeId: "scope:root", sourceOrderIndex: 1 }
  }]
};

describe("ModulePreviewInvocationEditorController", () => {
  it("owns ordinary editing and exact value replacement without a canonical Source callback", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const block = modulePreviewInvocationFor({ blocks: [input] }).blocks[0]!;
    const onChange = vi.fn();
    const controller = new ModulePreviewInvocationEditorController({
      parent,
      block,
      source: { normalizedSource: "nui 1", sourceRevision: 1 },
      semantic: { sourceRevision: 1, sourceText: "nui 1" },
      target: { definitionStatementId: "module:preview", definitionStatementIndex: 1 },
      onChange
    });
    const view = controller.getView();
    expect(view).not.toBeNull();
    view!.dispatch({ changes: { from: block.parameters[0]!.valueRange.from, insert: "25" } });
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("width: 2512"), expect.objectContaining({
      parameter: null
    }));

    const current = view!.state.doc.toString();
    expect(controller.replaceValueAtSite(0, "40", undefined, current)).toBe(true);
    expect(view!.state.doc.toString()).toContain("width: 40");
    expect(controller.replaceValueAtSite(0, "50", undefined, "stale text")).toBe(false);
    expect(view!.state.doc.toString()).toContain("width: 40");
    controller.destroy();
    expect(controller.replaceValueAtSite(0, "60")).toBe(false);
    parent.remove();
  });

  it("reports the current parameter site as the selection moves and invalidates on disposal", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const block = modulePreviewInvocationFor({ blocks: [input] }).blocks[0]!;
    const onSiteChange = vi.fn();
    const controller = new ModulePreviewInvocationEditorController({
      parent,
      block,
      source: { normalizedSource: "nui 1", sourceRevision: 1 },
      semantic: { sourceRevision: 1 },
      target: { definitionStatementId: "module:preview", definitionStatementIndex: 1 },
      onChange: vi.fn(),
      onSiteChange
    });
    controller.getView()!.dispatch({ selection: { anchor: block.parameters[0]!.valueRange.from } });
    expect(onSiteChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parameter: expect.objectContaining({ name: "width", parameterIndex: 0 })
    }));
    controller.destroy();
    expect(controller.getView()).toBeNull();
    parent.remove();
  });
});
