import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { dslCmLanguageExtension } from "./cmLanguage";
import { lineSplicesToSourceTextChanges } from "./lineSpliceChanges";
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
import type { SourceEditorHandle } from "./sourceEditorTypes";

type SourceStore = {
  getState: () => CadDocumentState;
  subscribe: (listener: (state: CadDocumentState, previous: CadDocumentState) => void) => () => void;
};

const modelPatchOrigin = Annotation.define<"model-patch">();
const resetOrigin = Annotation.define<"reset">();

export class SourceEditorController implements SourceEditorHandle {
  private readonly store: SourceStore;
  private readonly unsubscribe: () => void;
  private protocol: SourceUpdateProtocolState;
  private format;
  private destroyed = false;
  private view: EditorView;

  constructor(parent: HTMLElement, store: SourceStore = useCadDocumentStore) {
    this.store = store;
    const initial = store.getState();
    this.format = sourceTextFormat(initial.sourceText);
    this.protocol = createSourceUpdateProtocol(initial.sourceRevision);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: normalizeSourceTextForEditor(initial.sourceText),
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          dslCmLanguageExtension,
          EditorView.domEventHandlers({
            compositionstart: () => {
              this.protocol = beginSourceComposition(this.protocol);
              return false;
            },
            compositionend: () => {
              this.drainCompositionQueue();
              return false;
            }
          })
        ]
      })
    });
    this.unsubscribe = store.subscribe((next, previous) => {
      if (next.sourceRevision === previous.sourceRevision) return;
      const update = next.sourceUpdate;
      this.receive({
        update,
        // Normal updates remain metadata-only. A reset needs an exact historical source while composing.
        resetText: update.kind === "reset" ? next.sourceText : undefined
      });
    });
  }

  focus = () => this.view.focus();

  getText = () => serializeEditorText(this.view.state.doc.toString(), this.format);

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.view.destroy();
  };

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
    if (action.kind === "consume-editor") return;
    if (action.kind === "apply-model-patch") {
      const changes = lineSplicesToSourceTextChanges(this.view.state.doc.toString(), action.update.splices);
      this.view.dispatch({
        changes,
        annotations: [modelPatchOrigin.of("model-patch"), Transaction.addToHistory.of(false)]
      });
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
    this.format = sourceTextFormat(sourceText);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: normalizeSourceTextForEditor(sourceText) },
      annotations: [resetOrigin.of("reset"), Transaction.addToHistory.of(false)]
    });
  }
}
