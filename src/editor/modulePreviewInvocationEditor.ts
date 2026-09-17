import { autocompletion, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { history, historyKeymap, toggleComment } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  queryDslModulePreviewInvocationCompletion,
  type DslCompletionSemanticSnapshot
} from "@nuinuicad/nui-language";
import {
  modulePreviewInvocationParameterSiteAt,
  parseModulePreviewInvocationBlock,
  type ModulePreviewInvocationBlock,
  type ModulePreviewInvocationParameterSite
} from "../dsl/modulePreviewInvocation";
import { dslCmLanguageExtension } from "./cmLanguage";

export type ModulePreviewInvocationEditorSite = {
  block: ModulePreviewInvocationBlock;
  parameter: ModulePreviewInvocationParameterSite | null;
  selectionStart: number;
  selectionEnd: number;
};

export type ModulePreviewInvocationEditorOptions = {
  parent: HTMLElement;
  block: ModulePreviewInvocationBlock;
  source: { normalizedSource: string; sourceRevision: number };
  semantic: DslCompletionSemanticSnapshot;
  target: { definitionStatementId: string; definitionStatementIndex: number };
  referencePickAvailable?: boolean;
  onChange: (text: string, site: ModulePreviewInvocationEditorSite) => void;
  onSiteChange?: (site: ModulePreviewInvocationEditorSite) => void;
  onValueStep?: (site: ModulePreviewInvocationEditorSite, direction: 1 | -1) => void;
  onReferencePick?: (site: ModulePreviewInvocationEditorSite) => void;
};

const previewEditorTheme = EditorView.theme({
  "&": {
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editor-background)"
  },
  ".cm-scroller": {
    overflow: "visible",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "var(--vscode-editor-font-size)"
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { display: "none" },
  ".cm-tooltip-autocomplete": {
    zIndex: "1000",
    backgroundColor: "var(--vscode-editorSuggestWidget-background, var(--vscode-editor-background))",
    color: "var(--vscode-editorSuggestWidget-foreground, var(--vscode-editor-foreground))",
    border: "1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border))",
    boxShadow: "0 2px 8px var(--vscode-widget-shadow, transparent)"
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground))",
    color: "var(--vscode-editorSuggestWidget-foreground, var(--vscode-editor-foreground))"
  }
});

const completionSourceFor = (
  options: Pick<ModulePreviewInvocationEditorOptions, "source" | "semantic" | "target">,
  getBlock: () => ModulePreviewInvocationBlock
): CompletionSource => (context: CompletionContext) => {
  const block = getBlock();
  const selection = context.state.selection.main;
  const result = queryDslModulePreviewInvocationCompletion({
    source: options.source,
    semantic: options.semantic,
    target: options.target,
    invocationText: context.state.doc.toString(),
    definitionStatementId: block.definitionStatementId,
    parameters: block.parameters,
    selectionStart: selection.from,
    selectionEnd: selection.to
  });
  if (!result || result.candidates.length === 0) return null;
  const optionsForCompletion: Completion[] = result.candidates.map((candidate) => ({
    label: candidate.label,
    type: candidate.kind === "argumentName" ? "property" :
      candidate.kind === "builtin" ? "function" :
        candidate.kind === "literal" ? "constant" : "variable",
    ...(candidate.detail ? { detail: candidate.detail } : {}),
    apply: candidate.insertionText
  }));
  return {
    from: result.replacementRange.from,
    to: result.replacementRange.to,
    options: optionsForCompletion
  };
};

/**
 * CodeMirror-only adapter for a single Preview invocation block. It owns the
 * transient editor history and completion UI; callers receive plain text and
 * semantic-site callbacks and never need to import CodeMirror.
 */
export class ModulePreviewInvocationEditorController {
  private readonly options: ModulePreviewInvocationEditorOptions;
  private block: ModulePreviewInvocationBlock;
  private suppressChange = false;
  private destroyed = false;
  private readonly view: EditorView;

  constructor(options: ModulePreviewInvocationEditorOptions) {
    this.options = options;
    this.block = options.block;
    this.view = new EditorView({
      parent: options.parent,
      state: EditorState.create({
        doc: options.block.text,
        extensions: [
          dslCmLanguageExtension,
          previewEditorTheme,
          history(),
          autocompletion({ override: [completionSourceFor(options, () => this.currentBlock())] }),
          keymap.of([
            { key: "Mod-/", run: toggleComment },
            { key: "Mod-Shift-.", run: () => this.routeValueStep(1) },
            { key: "Mod-Shift-,", run: () => this.routeValueStep(-1) },
            { key: "Alt-Enter", run: () => this.routeReferencePick() },
            ...historyKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (this.destroyed) return;
            const site = this.siteFor(update.state);
            // Publish text first so a following site proof binds to the
            // session revision produced by this edit.
            if (update.docChanged && !this.suppressChange) {
              this.options.onChange(update.state.doc.toString(), site);
            }
            if (update.selectionSet || update.docChanged) this.options.onSiteChange?.(site);
          })
        ] satisfies Extension[]
      })
    });
    this.options.onSiteChange?.(this.siteFor(this.view.state));
  }

  private currentBlock(): ModulePreviewInvocationBlock {
    return parseModulePreviewInvocationBlock({ ...this.block, text: this.view.state.doc.toString() });
  }

  private siteFor(state: EditorState): ModulePreviewInvocationEditorSite {
    const block = parseModulePreviewInvocationBlock({ ...this.block, text: state.doc.toString() });
    const selection = state.selection.main;
    return {
      block,
      parameter: modulePreviewInvocationParameterSiteAt(blocksFor(block), block.definitionStatementId, selection.from),
      selectionStart: selection.from,
      selectionEnd: selection.to
    };
  }

  private routeValueStep(direction: 1 | -1): boolean {
    const site = this.siteFor(this.view.state);
    const parameter = site.parameter;
    if (!this.options.onValueStep || !parameter?.active ||
      site.selectionStart < parameter.valueRange.from ||
      site.selectionEnd > parameter.valueRange.to) return false;
    this.options.onValueStep(site, direction);
    return true;
  }

  private routeReferencePick(): boolean {
    const site = this.siteFor(this.view.state);
    const parameter = site.parameter;
    const kind = parameter?.type?.kind;
    if (!this.options.onReferencePick || this.options.referencePickAvailable === false || !parameter?.active ||
      (kind !== "point" && kind !== "line" && kind !== "path") ||
      site.selectionStart < parameter.valueRange.from ||
      site.selectionEnd > parameter.valueRange.to) return false;
    this.options.onReferencePick(site);
    return true;
  }

  updateBlock(block: ModulePreviewInvocationBlock): void {
    if (this.destroyed) return;
    this.block = block;
    const nextText = block.text;
    if (this.view.state.doc.toString() === nextText) return;
    const selection = Math.min(this.view.state.selection.main.head, nextText.length);
    this.suppressChange = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: nextText },
        selection: { anchor: selection }
      });
    } finally {
      this.suppressChange = false;
    }
  }

  updateContext(context: Pick<ModulePreviewInvocationEditorOptions, "source" | "semantic" | "target" | "referencePickAvailable">): void {
    if (this.destroyed) return;
    this.options.source = context.source;
    this.options.semantic = context.semantic;
    this.options.target = context.target;
    this.options.referencePickAvailable = context.referencePickAvailable;
  }

  replaceCurrentValue(expression: string, selection?: { start: number; end: number }): boolean {
    if (this.destroyed) return false;
    const site = this.siteFor(this.view.state);
    if (!site.parameter || !site.parameter.active) return false;
    const from = site.parameter.valueRange.from;
    const to = site.parameter.valueRange.to;
    const nextSelection = selection ?? { start: from + expression.length, end: from + expression.length };
    this.view.dispatch({
      changes: { from, to, insert: expression },
      selection: { anchor: nextSelection.start, head: nextSelection.end }
    });
    return true;
  }

  replaceValueAtSite(
    parameterIndex: number,
    expression: string,
    selection?: { start: number; end: number },
    expectedText?: string
  ): boolean {
    if (this.destroyed) return false;
    const block = this.currentBlock();
    if (expectedText !== undefined && block.text !== expectedText) return false;
    const parameter = block.parameters.find((candidate) => candidate.parameterIndex === parameterIndex);
    if (!parameter || !parameter.active) return false;
    const from = parameter.valueRange.from;
    const to = parameter.valueRange.to;
    const nextSelection = selection ?? { start: from + expression.length, end: from + expression.length };
    this.view.dispatch({
      changes: { from, to, insert: expression },
      selection: { anchor: nextSelection.start, head: nextSelection.end }
    });
    return true;
  }

  focus(): void {
    if (!this.destroyed) this.view.focus();
  }

  getView(): EditorView | null {
    return this.destroyed ? null : this.view;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.view.destroy();
  }
}

// The site helper accepts an invocation-shaped value. Keeping this adapter
// local avoids exposing a CodeMirror-specific representation to the Webview.
const blocksFor = (block: ModulePreviewInvocationBlock) => ({ blocks: [block] });
