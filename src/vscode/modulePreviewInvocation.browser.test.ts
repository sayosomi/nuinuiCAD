import { startCompletion } from "@codemirror/autocomplete";
import { createNuiLanguageSession } from "@nuinuicad/nui-language";
import { expect, describe, it, afterEach } from "vitest";
import { modulePreviewInvocationFor, type ModulePreviewInvocationBlockInput } from "../dsl/modulePreviewInvocation";
import { ModulePreviewInvocationEditorController } from "../editor/modulePreviewInvocationEditor";
import "./modulePreviewInvocation.css";

const source = [
  "nui 1",
  "point Top = coordinate(x: 0, y: 0)",
  "module Preview(anchor: point) {",
  "  point P = coordinate(x: 0, y: 0)",
  "}"
].join("\n");

const themes = {
  light: {
    editorBackground: "#ffffff",
    editorForeground: "#1f1f1f",
    suggestBackground: "#f8f8f8",
    suggestForeground: "#1f1f1f",
    suggestBorder: "#c8c8c8",
    selectedBackground: "#d6e8ff"
  },
  dark: {
    editorBackground: "#1e1e1e",
    editorForeground: "#eeeeee",
    suggestBackground: "#252526",
    suggestForeground: "#eeeeee",
    suggestBorder: "#454545",
    selectedBackground: "#094771"
  }
} as const;

const controllers: ModulePreviewInvocationEditorController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
});

describe("Module Preview invocation editor browser presentation", () => {
  it.each(Object.entries(themes))("keeps CodeMirror completion readable in %s VS Code colors", async (_name, theme) => {
    for (const [property, value] of Object.entries({
      "--vscode-editor-background": theme.editorBackground,
      "--vscode-editor-foreground": theme.editorForeground,
      "--vscode-editorSuggestWidget-background": theme.suggestBackground,
      "--vscode-editorSuggestWidget-foreground": theme.suggestForeground,
      "--vscode-editorSuggestWidget-border": theme.suggestBorder,
      "--vscode-editorSuggestWidget-selectedBackground": theme.selectedBackground,
      "--vscode-panel-border": theme.suggestBorder,
      "--vscode-widget-shadow": "#00000066",
      "--vscode-editor-font-family": "monospace",
      "--vscode-editor-font-size": "14px"
    })) document.documentElement.style.setProperty(property, value);

    const region = document.createElement("section");
    region.className = "module-preview-invocation-region";
    region.style.width = "720px";
    region.style.height = "260px";
    const surface = document.createElement("div");
    surface.className = "module-preview-invocation-surface";
    surface.dataset.modulePreviewInvocationSurface = "true";
    const block = document.createElement("section");
    block.className = "module-preview-invocation-block module-preview-invocation-block-target";
    const toolbar = document.createElement("div");
    toolbar.className = "module-preview-invocation-block-toolbar";
    toolbar.textContent = "Target: Preview";
    const editorRow = document.createElement("div");
    editorRow.className = "module-preview-invocation-editor-row";
    const editorMount = document.createElement("div");
    editorMount.className = "module-preview-invocation-cm";
    region.append(surface);
    surface.append(block);
    block.append(toolbar, editorRow);
    editorRow.append(editorMount);
    document.body.append(region);

    const language = createNuiLanguageSession(source);
    const compiled = language.runtimeEvaluationSnapshot()!.compiled;
    const definition = compiled.moduleSemanticAnalysis!.definitions.find((candidate) => candidate.name === "Preview")!;
    const input: ModulePreviewInvocationBlockInput = {
      kind: "target",
      definitionStatementId: definition.statementId,
      definitionStatementIndex: definition.statementIndex,
      declarationScopeId: definition.declarationScopeId,
      name: definition.name,
      parameters: [{
        definitionStatementId: definition.statementId,
        parameterIndex: 0,
        name: "anchor",
        type: { kind: "point" },
        optional: false,
        required: true,
        defaultSourceText: null,
        active: true,
        value: "@",
        caller: {
          statementIndex: definition.statementIndex,
          scopeId: definition.declarationScopeId,
          sourceOrderIndex: definition.statementIndex
        }
      }]
    };
    const blockValue = modulePreviewInvocationFor({ blocks: [input] }).blocks[0]!;
    const longInvocationText = [
      "Preview(",
      "  anchor: @,",
      ...Array.from({ length: 16 }, (_, index) => `  // retained context ${index + 1}`),
      ")"
    ].join("\n");
    const controller = new ModulePreviewInvocationEditorController({
      parent: editorMount,
      block: blockValue,
      source: { normalizedSource: source, sourceRevision: language.getSourceRevision() },
      semantic: { sourceRevision: language.getSourceRevision(), sourceText: source, compiled },
      target: { definitionStatementId: definition.statementId, definitionStatementIndex: definition.statementIndex },
      onChange: () => undefined,
      referencePickAvailable: true
    });
    controllers.push(controller);
    const view = controller.getView()!;
    controller.updateBlock({ ...blockValue, text: longInvocationText });
    view.dispatch({ selection: { anchor: blockValue.parameters[0]!.valueRange.to } });
    view.focus();
    startCompletion(view);

    await expect.poll(() => surface.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    const popup = surface.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!;
    await expect.poll(() => popup.getBoundingClientRect().left).toBeGreaterThan(-100);
    await expect.poll(() => popup.getBoundingClientRect().bottom).toBeGreaterThan(0);
    const cmEditor = editorMount.querySelector<HTMLElement>(".cm-editor")!;
    const scroller = editorMount.querySelector<HTMLElement>(".cm-scroller")!;
    const regionRect = region.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const caret = view.coordsAtPos(blockValue.parameters[0]!.valueRange.to);
    const rows = [...popup.querySelectorAll<HTMLElement>("li")];
    const rowRects = rows.map((row) => row.getBoundingClientRect());

    expect(blockRect.height).toBeGreaterThan(100);
    expect(surface.scrollHeight).toBeGreaterThan(surface.clientHeight);
    expect(getComputedStyle(surface).overflowY).toBe("auto");
    expect(getComputedStyle(scroller).overflowY).toBe("visible");
    expect(getComputedStyle(cmEditor).height).not.toBe("100%");
    expect(caret).not.toBeNull();
    expect(Math.abs(popupRect.left - caret!.left)).toBeLessThan(220);
    expect(popupRect.bottom).toBeGreaterThan(caret!.top - 4);
    expect(popupRect.top).toBeLessThan(caret!.bottom + 220);
    expect(rowRects.length).toBeGreaterThan(0);
    expect(rowRects.every((rect) => rect.height > 0 && rect.width > 0)).toBe(true);
    for (let index = 1; index < rowRects.length; index += 1) {
      expect(rowRects[index]!.top).toBeGreaterThanOrEqual(rowRects[index - 1]!.bottom - 1);
    }
    expect(rowRects.every((rect) =>
      rect.top >= regionRect.top - 1 && rect.bottom <= regionRect.bottom + 1 &&
      rect.top >= surfaceRect.top - 1 && rect.bottom <= surfaceRect.bottom + 1
    )).toBe(true);
    expect(getComputedStyle(popup).backgroundColor).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/i);
  });
});
