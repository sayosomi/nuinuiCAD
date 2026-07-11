import { codeFolding, foldGutter, foldService } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Text, Transaction } from "@codemirror/state";
import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { dispatchCommand } from "../commands/commands";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore, type CadUiState } from "../state/cadUiStore";
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
import { elementIdAtCursor, createStatementRangeIndex, mapStatementRangeIndex, type StatementRangeIndex } from "./statementRangeIndex";
import { foldProjectionTransaction, foldTargetAtLine, foldTargets } from "./sourceEditorFolding";
import { secondarySelectionEffect, sourceEditorSelectionExtension } from "./sourceEditorSelection";

type SourceStore = {
  getState: () => CadDocumentState;
  subscribe: (listener: (state: CadDocumentState, previous: CadDocumentState) => void) => () => void;
};

type UiStore = {
  getState: () => CadUiState;
  subscribe: (listener: (state: CadUiState, previous: CadUiState) => void) => () => void;
};

const COMMIT_DELAY_MS = 300;
const modelPatchOrigin = Annotation.define<"model-patch">();
const resetOrigin = Annotation.define<"reset">();
const canvasCursorOrigin = Annotation.define<"canvas-cursor">();
const foldProjectionOrigin = Annotation.define<"fold-projection">();

export class SourceEditorController implements SourceEditorHandle {
  private readonly store: SourceStore;
  private readonly unsubscribe: () => void;
  private readonly uiStore: UiStore;
  private readonly unsubscribeUi: () => void;
  private readonly unregisterSession: () => void;
  private readonly historyCompartment = new Compartment();
  private protocol: SourceUpdateProtocolState;
  private format: SourceTextFormat;
  private committedLogicalText: string;
  private committedDoc: Text;
  private commitTimer: number | null = null;
  private flushAfterComposition = false;
  private burstStartCursorLine: number | null = null;
  private statementRanges: StatementRangeIndex = new Map();
  private pendingSelectionSync = false;
  private pendingFoldProjection = false;
  private applyingUiSync = false;
  private publishingCanvasSelection = false;
  private destroyed = false;
  private view: EditorView;

  constructor(
    parent: HTMLElement,
    store: SourceStore = useCadDocumentStore,
    uiStore: UiStore = useCadUiStore
  ) {
    this.store = store;
    this.uiStore = uiStore;
    const initial = store.getState();
    this.format = sourceTextFormat(initial.sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(initial.sourceText);
    this.committedDoc = Text.of(this.committedLogicalText.split("\n"));
    this.protocol = createSourceUpdateProtocol(initial.sourceRevision);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.committedLogicalText,
        extensions: [
          lineNumbers({
            domEventHandlers: {
              mousedown: (_view, line, event) => this.handleSelectionGutterMouseDown(line.from, event as MouseEvent)
            }
          }),
          dslCmLanguageExtension,
          sourceEditorSelectionExtension,
          codeFolding(),
          foldService.of((state, lineStart) => {
            const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineStart);
            return target ? { from: target.from, to: target.to } : null;
          }),
          foldGutter({
            domEventHandlers: {
              mousedown: (_view, line, event) => this.handleFoldGutterMouseDown(line.from, event as MouseEvent)
            }
          }),
          this.historyCompartment.of(history()),
          keymap.of([
            { key: "Mod-z", run: () => this.runUndo() },
            { key: "Mod-y", run: () => this.runRedo() },
            { key: "Mod-Shift-z", run: () => this.runRedo() },
            { key: "Ctrl-Shift-[", mac: "Mod-Alt-[", run: () => this.changeFoldAtCursor("fold") },
            { key: "Ctrl-Shift-]", mac: "Mod-Alt-]", run: () => this.changeFoldAtCursor("unfold") },
            { key: "Ctrl-Alt-[", run: () => this.changeAllFolds(false) },
            { key: "Ctrl-Alt-]", run: () => this.changeAllFolds(true) }
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
    this.unsubscribeUi = uiStore.subscribe((next, previous) => {
      const selectionChanged =
        next.selectedElementId !== previous.selectedElementId ||
        next.selectedElementIds !== previous.selectedElementIds;
      const foldChanged = next.groupFoldById !== previous.groupFoldById;
      if (selectionChanged) this.pendingSelectionSync = true;
      if (foldChanged) this.pendingFoldProjection = true;
      this.applyPendingUiSync();
    });
    this.refreshStatementRanges();
    this.pendingSelectionSync = true;
    this.pendingFoldProjection = true;
    this.applyPendingUiSync();
  }

  focus = () => this.view.focus();

  getText = () => serializeEditorText(this.view.state.doc.toString(), this.format);

  /**
   * Uses CM6's structural Text.eq instead of toString() so a fresh full-string
   * allocation is not made on every check (e.g. on every preview pointermove).
   */
  hasPendingText = () => !this.view.state.doc.eq(this.committedDoc);

  flush = (reason: FlushReason): SourceEditFlushResult => {
    if (this.destroyed || !this.hasPendingText()) return "clean";
    if (this.protocol.composing) {
      this.flushAfterComposition ||= reason === "blur";
      return "blocked-composition";
    }
    this.cancelCommitTimer();
    const nextText = this.getText();
    const cursorLineAtBurstStart = this.burstStartCursorLine;
    this.burstStartCursorLine = null;
    this.store.getState().commitText(nextText, "editor", { cursorLineAtBurstStart });
    // A no-op source commit does not produce a source revision, but still closes the local burst.
    this.syncCommittedText(this.store.getState().sourceText);
    this.clearCmHistory();
    return "flushed";
  };

  destroy = () => {
    if (this.destroyed) return;
    // IME composition state is tied to a live, focused, attached DOM node: once
    // view.destroy() detaches it, there is no JS-level way to recover the
    // in-progress input. The app-level close guards (unsavedChangesGuard) already
    // refuse to close/unmount while composing, so this path should not be
    // reachable in practice; if it is, fail loudly in dev instead of silently
    // losing the composition.
    if (this.protocol.composing) {
      if (import.meta.env.DEV) {
        console.error(
          "SourceEditorController destroyed while an IME composition was active; " +
            "the in-progress input could not be recovered."
        );
      }
    } else if (this.hasPendingText()) {
      this.cancelCommitTimer();
      const nextText = this.getText();
      const cursorLineAtBurstStart = this.burstStartCursorLine;
      this.store.getState().commitText(nextText, "editor", { cursorLineAtBurstStart });
    }
    this.destroyed = true;
    this.unregisterSession();
    this.unsubscribe();
    this.unsubscribeUi();
    this.view.destroy();
  };

  private handleViewUpdate(update: ViewUpdate) {
    if (this.destroyed) return;
    const isExternal = update.transactions.some((transaction) =>
      transaction.annotation(modelPatchOrigin) || transaction.annotation(resetOrigin)
    );
    if (update.docChanged) this.statementRanges = mapStatementRangeIndex(this.statementRanges, update.changes);
    if (update.docChanged && !isExternal && !this.protocol.composing) {
      const wasPendingBeforeThisUpdate = !update.startState.doc.eq(this.committedDoc);
      if (!wasPendingBeforeThisUpdate) {
        this.burstStartCursorLine = useCadUiStore.getState().sourceCursorLine;
      }
      if (this.hasPendingText()) this.scheduleCommit();
      else {
        this.burstStartCursorLine = null;
        this.cancelCommitTimer();
        this.clearCmHistory();
      }
    }
    if (update.selectionSet && !this.protocol.composing) {
      this.publishCursorLine();
      const cursorWasProjected = update.transactions.some((transaction) => transaction.annotation(canvasCursorOrigin));
      if (!isExternal && !cursorWasProjected && this.view.state.selection.ranges.length === 1) {
        const elementId = elementIdAtCursor(this.statementRanges, this.view.state.selection.main.head);
        if (elementId && this.uiStore.getState().selectedElementId !== elementId) {
          this.publishingCanvasSelection = true;
          try {
            this.uiStore.getState().setSelectedElementId(elementId);
          } finally {
            this.publishingCanvasSelection = false;
          }
        }
      }
    }
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
    this.applyPendingUiSync();
  }

  private apply(action: SourceUpdateProtocolAction) {
    if (!action || this.destroyed) return;
    if (action.kind === "consume-editor") {
      this.syncCommittedText(this.store.getState().sourceText);
      this.clearCmHistory();
      this.afterSourceUpdate();
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
      this.afterSourceUpdate();
      return;
    }
    if (action.reason === "gap" || action.text === undefined) {
      const current = this.store.getState();
      this.reset(current.sourceText);
      this.protocol = createSourceUpdateProtocol(current.sourceRevision);
      this.afterSourceUpdate();
      return;
    }
    this.reset(action.text);
    this.afterSourceUpdate();
  }

  private reset(sourceText: string) {
    this.cancelCommitTimer();
    this.burstStartCursorLine = null;
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

  /**
   * A UI projection is allowed only after the matching source revision is in the CM document and
   * its fresh (or safely mapped) ranges have been selected. This is the ordering gate for Canvas
   * selection and fold changes that arrive during source updates.
   */
  private afterSourceUpdate() {
    this.refreshStatementRanges();
    this.pendingSelectionSync = true;
    this.pendingFoldProjection = true;
    this.applyPendingUiSync();
  }

  private refreshStatementRanges() {
    const state = this.store.getState();
    if (state.docText !== state.sourceText) return;
    this.statementRanges = createStatementRangeIndex(this.view.state.doc, state.doc.statementMap);
  }

  private sourceIsApplied() {
    return this.protocol.appliedRevision === this.store.getState().sourceRevision;
  }

  private applyPendingUiSync() {
    if (
      this.destroyed ||
      this.protocol.composing ||
      !this.sourceIsApplied() ||
      this.applyingUiSync ||
      (!this.pendingSelectionSync && !this.pendingFoldProjection)
    ) return;

    this.applyingUiSync = true;
    try {
      if (this.pendingSelectionSync) {
        this.pendingSelectionSync = false;
        this.expandSelectionAncestors();
        this.updateSecondarySelection();
        this.projectPrimaryCursor();
      }
      if (this.pendingFoldProjection) {
        this.pendingFoldProjection = false;
        this.projectFolds();
      }
    } finally {
      this.applyingUiSync = false;
    }
    // Expanding ancestors writes groupFoldById synchronously. Apply the single latest request only
    // after that write has completed, never against the preceding CM revision.
    if ((this.pendingSelectionSync || this.pendingFoldProjection) && this.sourceIsApplied()) {
      this.applyPendingUiSync();
    }
  }

  private updateSecondarySelection() {
    const ui = this.uiStore.getState();
    this.view.dispatch({
      effects: secondarySelectionEffect(ui.selectedElementIds, ui.selectedElementId, this.statementRanges),
      annotations: Transaction.addToHistory.of(false)
    });
  }

  private projectPrimaryCursor() {
    if (this.publishingCanvasSelection) return;
    const primaryId = this.uiStore.getState().selectedElementId;
    const range = primaryId ? this.statementRanges.get(primaryId) : undefined;
    if (!range || this.view.state.selection.main.head === range.from) return;
    this.view.dispatch({
      selection: EditorSelection.cursor(range.from),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
  }

  private expandSelectionAncestors() {
    const selectedId = this.uiStore.getState().selectedElementId;
    if (!selectedId) return;
    const elements = this.store.getState().elements;
    const byId = new Map(elements.map((element) => [element.id, element]));
    let current = byId.get(selectedId);
    while (current?.parentGroupId) {
      const parent = byId.get(current.parentGroupId);
      if (!parent) break;
      const fold = this.uiStore.getState().groupFoldById.get(parent.id);
      const needsGroupExpand = !(fold?.expanded ?? false);
      const needsElseExpand = current.conditionalBranch === "else" && !(fold?.elseExpanded ?? true);
      if (needsGroupExpand || needsElseExpand) {
        this.uiStore.getState().setGroupFold(parent.id, {
          ...(needsGroupExpand ? { expanded: true } : {}),
          ...(needsElseExpand ? { elseExpanded: true } : {})
        });
      }
      current = parent;
    }
  }

  private projectFolds() {
    const state = this.store.getState();
    const desired = foldTargets(this.statementRanges, state.elements, this.uiStore.getState().groupFoldById)
      .sort((left, right) => left.from - right.from || right.to - left.to);
    const projection = foldProjectionTransaction(this.view.state, desired);
    if (!projection) return;
    this.view.dispatch({
      ...projection,
      annotations: [foldProjectionOrigin.of("fold-projection"), Transaction.addToHistory.of(false)]
    });
  }

  private handleSelectionGutterMouseDown(lineFrom: number, event: MouseEvent) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return false;
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId) return false;
    event.preventDefault();
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.metaKey || event.ctrlKey ? "toggle" : "range"
    });
    return true;
  }

  private handleFoldGutterMouseDown(lineFrom: number, event: MouseEvent) {
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    if (!target) return false;
    event.preventDefault();
    return this.changeFold(target, "toggle");
  }

  private changeFoldAtCursor(mode: "fold" | "unfold") {
    const lineFrom = this.view.state.doc.lineAt(this.view.state.selection.main.head).from;
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    return target ? this.changeFold(target, mode) : false;
  }

  private changeFold(target: { elementId: string; branch: "group" | "else" }, mode: "fold" | "unfold" | "toggle") {
    if (this.protocol.composing) return true;
    const fold = this.uiStore.getState().groupFoldById.get(target.elementId);
    const currentExpanded = target.branch === "group" ? (fold?.expanded ?? false) : (fold?.elseExpanded ?? true);
    const expanded = mode === "toggle" ? !currentExpanded : mode === "unfold";
    this.uiStore.getState().setGroupFold(target.elementId, target.branch === "group"
      ? { expanded }
      : { elseExpanded: expanded });
    return true;
  }

  private changeAllFolds(expanded: boolean) {
    if (this.protocol.composing) return true;
    for (const element of this.store.getState().elements) {
      if (!this.statementRanges.get(element.id)?.groupFoldRange) continue;
      this.uiStore.getState().setGroupFold(element.id, { expanded, ...(expanded ? { elseExpanded: true } : {}) });
    }
    return true;
  }

  private syncCommittedText(sourceText: string) {
    this.format = sourceTextFormat(sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(sourceText);
    this.committedDoc = Text.of(this.committedLogicalText.split("\n"));
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
