import { vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
});

import { describe, expect, it } from "vitest";
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

describe("ModulePreviewInvocationEditorController on macOS", () => {
  it("routes Meta+Shift+period through the Mod-Shift-period binding", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const block = modulePreviewInvocationFor({ blocks: [input] }).blocks[0]!;
    const onValueStep = vi.fn();
    const controller = new ModulePreviewInvocationEditorController({
      parent,
      block,
      source: { normalizedSource: "nui 1", sourceRevision: 1 },
      semantic: { sourceRevision: 1 },
      target: { definitionStatementId: "module:preview", definitionStatementIndex: 1 },
      onChange: vi.fn(),
      onValueStep
    });
    const view = controller.getView()!;
    const value = block.parameters[0]!;
    view.dispatch({ selection: { anchor: value.valueRange.from + 1 } });
    view.focus();
    const event = new KeyboardEvent("keydown", {
      key: ".",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    expect(view.contentDOM.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(onValueStep).toHaveBeenCalledWith(expect.anything(), 1);
    controller.destroy();
    parent.remove();
  });
});
