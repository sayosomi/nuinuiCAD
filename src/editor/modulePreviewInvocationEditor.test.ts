import { describe, expect, it, vi } from "vitest";
import { modulePreviewInvocationFor, type ModulePreviewInvocationBlockInput } from "../dsl/modulePreviewInvocation";
import {
  ModulePreviewInvocationEditorController,
  type ModulePreviewInvocationEditorSite
} from "./modulePreviewInvocationEditor";

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

const commentableInput: ModulePreviewInvocationBlockInput = {
  ...input,
  parameters: [
    ...input.parameters,
    {
      definitionStatementId: "module:preview",
      parameterIndex: 1,
      name: "label",
      type: { kind: "string" },
      optional: true,
      required: false,
      defaultSourceText: '"Pocket"',
      active: false,
      value: "",
      caller: { statementIndex: 1, scopeId: "scope:root", sourceOrderIndex: 1 }
    }
  ]
};

const geometryInput: ModulePreviewInvocationBlockInput = {
  ...input,
  parameters: [{
    ...input.parameters[0]!,
    name: "anchor",
    type: { kind: "point" },
    value: "@Top"
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

  it("uses the real CodeMirror comment command to activate and omit a scaffold argument", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const block = modulePreviewInvocationFor({ blocks: [commentableInput] }).blocks[0]!;
    const changes: Array<{ text: string; site: ModulePreviewInvocationEditorSite }> = [];
    const controller = new ModulePreviewInvocationEditorController({
      parent,
      block,
      source: { normalizedSource: "nui 1", sourceRevision: 1 },
      semantic: { sourceRevision: 1 },
      target: { definitionStatementId: "module:preview", definitionStatementIndex: 1 },
      onChange: (text, site) => changes.push({ text, site })
    });
    const view = controller.getView()!;
    const omitted = block.parameters[1]!;

    expect(view.state.doc.toString()).toContain('  // label: "Pocket"');
    view.dispatch({ selection: { anchor: omitted.labelRange.from } });
    view.focus();
    const toggle = () => {
      const event = new KeyboardEvent("keydown", {
        key: "/",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      const dispatched = view.contentDOM.dispatchEvent(event);
      expect(dispatched).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    };

    toggle();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.text).toContain('  label: "Pocket"');
    expect(changes[0]!.text).not.toContain('  // label: "Pocket"');
    expect(changes[0]!.site.block.parameters[1]).toMatchObject({
      active: true,
      omitted: false,
      value: '"Pocket"'
    });
    expect(changes[0]!.site.block.activeArguments).toContainEqual(expect.objectContaining({
      name: "label",
      expression: '"Pocket"'
    }));

    toggle();
    expect(changes).toHaveLength(2);
    expect(changes[1]!.text).toContain('  // label: "Pocket"');
    expect(changes[1]!.site.block.parameters[1]).toMatchObject({
      active: false,
      omitted: true,
      value: ""
    });
    // The controller exposes only ephemeral invocation changes; this test has
    // no canonical Source callback or source mutation path to invoke.
    controller.destroy();
    parent.remove();
  });

  it("routes both Value Step directions from the real CodeMirror keydown surface", () => {
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

    const dispatchChord = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      });
      expect(view.contentDOM.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    };
    dispatchChord(".");
    dispatchChord(",");

    expect(onValueStep).toHaveBeenCalledTimes(2);
    expect(onValueStep.mock.calls[0]![0]).toMatchObject({
      block: expect.objectContaining({ definitionStatementId: "module:preview" }),
      parameter: expect.objectContaining({ parameterIndex: 0 })
    });
    expect(onValueStep.mock.calls.map(([site, direction]) => ({
      direction,
      selectionStart: site.selectionStart,
      selectionEnd: site.selectionEnd
    }))).toEqual([
      { direction: 1, selectionStart: value.valueRange.from + 1, selectionEnd: value.valueRange.from + 1 },
      { direction: -1, selectionStart: value.valueRange.from + 1, selectionEnd: value.valueRange.from + 1 }
    ]);
    controller.destroy();
    parent.remove();
  });

  it("routes Alt+Enter to Reference Pick only for an eligible geometry value", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const block = modulePreviewInvocationFor({ blocks: [geometryInput] }).blocks[0]!;
    const onReferencePick = vi.fn();
    const controller = new ModulePreviewInvocationEditorController({
      parent,
      block,
      source: { normalizedSource: "nui 1", sourceRevision: 1 },
      semantic: { sourceRevision: 1 },
      target: { definitionStatementId: "module:preview", definitionStatementIndex: 1 },
      onChange: vi.fn(),
      onReferencePick
    });
    const view = controller.getView()!;
    const value = block.parameters[0]!;
    view.dispatch({ selection: { anchor: value.valueRange.from + 1 } });
    view.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    expect(view.contentDOM.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(onReferencePick).toHaveBeenCalledTimes(1);
    expect(onReferencePick).toHaveBeenCalledWith(expect.objectContaining({
      parameter: expect.objectContaining({ name: "anchor", type: { kind: "point" } })
    }));

    const scalarBlock = modulePreviewInvocationFor({ blocks: [input] }).blocks[0]!;
    controller.updateBlock(scalarBlock);
    view.dispatch({ selection: { anchor: scalarBlock.parameters[0]!.valueRange.from + 1 } });
    const scalarEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    expect(view.contentDOM.dispatchEvent(scalarEvent)).toBe(true);
    expect(scalarEvent.defaultPrevented).toBe(false);
    expect(onReferencePick).toHaveBeenCalledTimes(1);

    view.dispatch({ selection: { anchor: 0 } });
    const offSiteEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    expect(view.contentDOM.dispatchEvent(offSiteEvent)).toBe(true);
    expect(onReferencePick).toHaveBeenCalledTimes(1);
    controller.destroy();
    parent.remove();
  });
});
