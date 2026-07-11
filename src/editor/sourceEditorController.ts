import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { dslCmLanguageExtension } from "./cmLanguage";
import { lineSplicesToSourceTextChanges } from "./lineSpliceChanges";
import { registerSourceEditSession, type FlushReason, type SourceEditFlushResult } from "./sourceEditSession";
import {
  beginSourceComposition,
  createSourceUpdateProtocol,
  endSourceComposition,
  receiveSourceUpdate,
  type PendingSourceUpdate,
  type SourceUpdateProtocolAction,
  type SourceUpdateProtocolState
} from "./sourceUpdateProtocol";
import { normalizeSourceTextForEditor, serializeEditorText, sourceTextFormat } from "./sourceTextFormat";
import type { SourceEditorHandle, SourceTextFormat } from "./sourceEditorTypes";

type SourceStore = {
  getState: () => CadDocumentState;
  subscribe: (listener: (state: CadDocumentState, previous: CadDocumentState) => void) => () => void;
};

const COMMIT_DELAY_MS = 300;
const modelPatchOrigin = Annotation.define<"model-patch">();
const resetOrigin = Annotation.define<"reset">();

export class SourceEditorController implements SourceEditorHandle {
  private readonly store: SourceStore;
  private readonly unsubscribe: () => void;
  private readonly unregisterSession: () => void;
  private readonly historyCompartment = new Compartment();
  private protocol: SourceUpdateProtocolState;
  private format: SourceTextFormat;
  private committedLogicalText: string;
  private commitTimer: number | null = null;
  private flushAfterComposition = false;
  private destroyed = false;
  private view: EditorView;

  constructor(parent: HTMLElement, store: SourceStore = useCadDocumentStore) {
    this.store = store;
    const initial = store.getState();
    this.format = sourceTextFormat(initial.sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(initial.sourceText);
    this.protocol = createSourceUpdateProtocol(initial.sourceRevision);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.committedLogicalText,
        extensions: [
          lineNumbers(),
          dslCmLanguageExtension,
          this.historyCompartment.of(history()),
          keymap.of([
            { key: "Mod-z", run: () => this.runUndo() },
            { key: "Mod-y", run: () => this.runRedo() },
            { key: "Mod-Shift-z", run: () => this.runRedo() }
          ]),
          EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
          EditorView.domEventHandlers({
            compositionstart: () => {
              this.protocol = beginSourceComposition(this.protocol);
              return false;
            },
            compositionend: () => {
              this.drainCompositionQueue();
              this.publishCursorLine();
              if (this.flushAfterComposition) {
                this.flushAfterComposition = false;
                this.flush("blur");
              } else if (this.hasPendingText()) {
                this.scheduleCommit();
              }
              return false;
            },
            blur: () => {
              this.flush("blur");
              return false;
            }
          })
        ]
      })
    });
    this.unregisterSession = registerSourceEditSession({
      hasPendingText: () => this.hasPendingText(),
      isComposing: () => this.protocol.composing,
      flush: (reason) => this.flush(reason)
    });
    this.unsubscribe = store.subscribe((next, previous) => {
      if (next.sourceRevision === previous.sourceRevision) return;
      const update = next.sourceUpdate;
      this.receive({
        update,
        resetText: update.kind === "reset" ? next.sourceText : undefined
      });
    });
  }

  focus = () => this.view.focus();

  getText = () => serializeEditorText(this.view.state.doc.toString(), this.format);

  hasPendingText = () => this.view.state.doc.toString() !== this.committedLogicalText;

  flush = (reason: FlushReason): SourceEditFlushResult => {
    if (this.destroyed || !this.hasPendingText()) return "clean";
    if (this.protocol.composing) {
      this.flushAfterComposition ||= reason === "blur";
      return "blocked-composition";
    }
    this.cancelCommitTimer();
    const nextText = this.getText();
    this.store.getState().commitText(nextText, "editor");
    // A no-op source commit does not produce a source revision, but still closes the local burst.
    this.syncCommittedText(this.store.getState().sourceText);
    this.clearCmHistory();
    return "flushed";
  };

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelCommitTimer();
    this.unregisterSession();
    this.unsubscribe();
    this.view.destroy();
  };

  private handleViewUpdate(update: ViewUpdateLike) {
    if (this.destroyed) return;
    const isExternal = update.transactions.some((transaction) =>
      transaction.annotation(modelPatchOrigin) || transaction.annotation(resetOrigin)
    );
    if (update.docChanged && !isExternal && !this.protocol.composing) {
      if (this.hasPendingText()) this.scheduleCommit();
      else {
        this.cancelCommitTimer();
        this.clearCmHistory();
      }
    }
    if (update.selectionSet && !this.protocol.composing) this.publishCursorLine();
  }

  private runUndo() {
    if (this.protocol.composing) return true;
    if (!this.hasPendingText()) {
      this.store.getState().undo();
      return true;
    }
    const handled = undo(this.view);
    if (!this.hasPendingText()) {
      this.cancelCommitTimer();
      this.clearCmHistory();
    }
    return handled;
  }

  private runRedo() {
    if (this.protocol.composing) return true;
    if (!this.hasPendingText()) {
      this.store.getState().redo();
      return true;
    }
    return redo(this.view);
  }

  private scheduleCommit() {
    this.cancelCommitTimer();
    this.commitTimer = window.setTimeout(() => {
      this.commitTimer = null;
      this.flush("command");
    }, COMMIT_DELAY_MS);
  }

  private cancelCommitTimer() {
    if (this.commitTimer === null) return;
    window.clearTimeout(this.commitTimer);
    this.commitTimer = null;
  }

  private receive(envelope: PendingSourceUpdate) {
    if (this.destroyed) return;
    const result = receiveSourceUpdate(this.protocol, envelope, this.store.getState().sourceRevision);
    this.protocol = result.state;
    this.apply(result.action);
  }

  private drainCompositionQueue() {
    const result = endSourceComposition(this.protocol, this.store.getState().sourceRevision);
    this.protocol = result.state;
    for (const action of result.actions) this.apply(action);
  }

  private apply(action: SourceUpdateProtocolAction) {
    if (!action || this.destroyed) return;
    if (action.kind === "consume-editor") {
      this.syncCommittedText(this.store.getState().sourceText);
      this.clearCmHistory();
      return;
    }
    if (action.kind === "apply-model-patch") {
      const changes = lineSplicesToSourceTextChanges(this.view.state.doc.toString(), action.update.splices);
      this.view.dispatch({
        changes,
        annotations: [modelPatchOrigin.of("model-patch"), Transaction.addToHistory.of(false)]
      });
      this.syncCommittedText(this.store.getState().sourceText);
      this.clearCmHistory();
      return;
    }
    if (action.reason === "gap" || action.text === undefined) {
      const current = this.store.getState();
      this.reset(current.sourceText);
      this.protocol = createSourceUpdateProtocol(current.sourceRevision);
      return;
    }
    this.reset(action.text);
  }

  private reset(sourceText: string) {
    this.cancelCommitTimer();
    this.syncCommittedText(sourceText);
    const cursorLine = useCadUiStore.getState().sourceCursorLine;
    const cursorOffset = cursorLine === null
      ? null
      : this.cursorOffsetForLine(this.committedLogicalText, cursorLine);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.committedLogicalText },
      ...(cursorOffset === null ? {} : { selection: EditorSelection.cursor(cursorOffset) }),
      annotations: [resetOrigin.of("reset"), Transaction.addToHistory.of(false)]
    });
    this.clearCmHistory();
  }

  private syncCommittedText(sourceText: string) {
    this.format = sourceTextFormat(sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(sourceText);
  }

  private publishCursorLine() {
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
    useCadUiStore.getState().setSourceCursorLine(line);
  }

  private cursorOffsetForLine(text: string, requestedLine: number) {
    const lines = text.split("\n");
    const lineIndex = Math.min(Math.max(requestedLine, 1), lines.length) - 1;
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1;
    return offset;
  }

  private clearCmHistory() {
    this.view.dispatch({
      effects: this.historyCompartment.reconfigure([]),
      annotations: Transaction.addToHistory.of(false)
    });
    this.view.dispatch({
      effects: this.historyCompartment.reconfigure(history()),
      annotations: Transaction.addToHistory.of(false)
    });
    if (import.meta.env.DEV && (undoDepth(this.view.state) !== 0 || redoDepth(this.view.state) !== 0)) {
      throw new Error("CodeMirror history clear failed.");
    }
  }
}

type ViewUpdateLike = {
  docChanged: boolean;
  selectionSet: boolean;
  transactions: readonly Transaction[];
};
