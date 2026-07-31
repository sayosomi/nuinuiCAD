import { completionStatus } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { dispatchCompletionRetryTransaction } from "./cmCompletionRetryTransaction";

type CompositionCompletionRetryOptions = {
  isComposing: () => boolean;
  isRetryContext: (view: EditorView) => boolean;
};

/**
 * CodeMirror may query a completion source while an IME composition is still
 * active. The source correctly declines then, but CM only restarts some
 * composition shapes on its own. After the composition's text is final, this
 * retriggers CM's ordinary non-explicit typing path only for a changed typed
 * reference context. It never calls startCompletion.
 */
export const cmCompositionCompletionRetry = (options: CompositionCompletionRetryOptions): Extension =>
  ViewPlugin.fromClass(class {
    composing = false;
    changed = false;

    constructor(private readonly view: EditorView) {}

    update(update: { docChanged: boolean }) {
      if (!this.composing || this.changed || !update.docChanged) return;
      this.changed = true;
    }

    retry = () => {
      if (!this.changed || options.isComposing() || this.view.compositionStarted) return;
      this.changed = false;
      if (completionStatus(this.view.state) !== null || !options.isRetryContext(this.view)) return;
      dispatchCompletionRetryTransaction(this.view);
    };
  }, {
    eventHandlers: {
      compositionstart() {
        this.composing = true;
        this.changed = false;
        return false;
      },
      compositionend() {
        this.composing = false;
        setTimeout(() => this.retry(), 20);
        return false;
      }
    }
  });
