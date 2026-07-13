import { defaultKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { dslLineValueSpans, findDslValueSpanAt } from "../dsl/dslValueSpans";
import { dslCmLanguageExtension } from "./cmLanguage";
import {
  patchHighlightField,
  setPatchHighlight,
  sourceEditorPatchHighlightExtension,
  type PatchHighlightPayload
} from "./sourceEditorPatchHighlight";

type HighlightRange = { from: number; to: number };
type LensRenderState = {
  lineFrom: number;
  lineText: string;
  sourceAnchor: number;
  sourceHead: number;
  patchHighlight: PatchHighlightPayload;
};

type MeasuredLensRender = LensRenderState & {
  gutterWidth: number;
  availableWidth: number;
  top: number;
  isVisible: boolean;
};

export type SourceEditorLineLensOptions = {
  /** Key bindings that operate on the owning source editor rather than the projection. */
  sourceKeymap: () => readonly KeyBinding[];
  onFocusChange: (focused: boolean) => void;
  onKeydown: (event: KeyboardEvent, view: EditorView) => void;
  onKeyup: (event: KeyboardEvent, view: EditorView) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onBlur: () => void;
};

/** Reconfigures the nested editor when the owning Source Editor shortcut registry changes. */
export const reconfigureSourceEditorLineLensKeymap = StateEffect.define<readonly KeyBinding[]>();

/** Clips marks to the line, sorts, and merges overlapping/adjacent ranges so
 * token splitting below never sees out-of-order or overlapping boundaries.
 * Exported for tests. */
export const lineLocalHighlightRanges = (marks: readonly HighlightRange[], lineFrom: number, lineTo: number): HighlightRange[] => {
  const clipped = marks
    .map((mark) => ({ from: Math.max(mark.from, lineFrom), to: Math.min(mark.to, lineTo) }))
    .filter((range) => range.from < range.to)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: HighlightRange[] = [];
  for (const range of clipped) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
};

/** Retained as a focused pure helper for line-level patch highlighting tests. */
export const splitTokenByHighlights = (text: string, tokenFrom: number, ranges: readonly HighlightRange[]) => {
  const tokenTo = tokenFrom + text.length;
  const segments: { text: string; from: number; highlighted: boolean }[] = [];
  let cursor = tokenFrom;
  for (const range of ranges) {
    const from = Math.max(range.from, tokenFrom);
    const to = Math.min(range.to, tokenTo);
    if (from >= to) continue;
    if (from > cursor) segments.push({ text: text.slice(cursor - tokenFrom, from - tokenFrom), from: cursor, highlighted: false });
    segments.push({ text: text.slice(from - tokenFrom, to - tokenFrom), from, highlighted: true });
    cursor = to;
  }
  if (cursor < tokenTo) segments.push({ text: text.slice(cursor - tokenFrom), from: cursor, highlighted: false });
  if (segments.length === 0) segments.push({ text, from: tokenFrom, highlighted: false });
  return segments;
};

const linePatchHighlight = (
  payload: PatchHighlightPayload,
  line: { from: number; to: number },
  documentLength: number
): PatchHighlightPayload => {
  if (!payload) return null;
  const belongsToLine = (position: number) => {
    const clamped = Math.min(Math.max(position, 0), documentLength);
    return clamped >= line.from && clamped <= line.to;
  };
  const localPosition = (position: number) => Math.min(Math.max(position, 0), documentLength) - line.from;
  return {
    marks: lineLocalHighlightRanges(payload.marks, line.from, line.to).map((range) => ({
      from: range.from - line.from,
      to: range.to - line.from
    })),
    deletionPoints: payload.deletionPoints.filter(belongsToLine).map(localPosition),
    deletionMarkers: payload.deletionMarkers.filter(belongsToLine).map(localPosition)
  };
};

/**
 * An editable, floating projection of the selected source line. The nested
 * CodeMirror instance is only an input surface: every edit is immediately
 * dispatched to the owning editor, which remains the sole source of truth.
 */
class SourceEditorLineLens {
  private readonly lens = document.createElement("div");
  private readonly measure = document.createElement("span");
  private readonly lensView: EditorView;
  private readonly sourceKeymapCompartment = new Compartment();
  private resizeObserver: ResizeObserver | null = null;
  private renderedKey: string | null = null;
  private lensLineFrom: number | null = null;
  private dispatchingLensUpdate = false;
  private renderQueued = false;
  private destroyed = false;

  constructor(private view: EditorView, private readonly options: SourceEditorLineLensOptions) {
    this.lens.className = "cm-source-line-lens";
    this.lens.setAttribute("aria-label", "選択行を編集");
    this.lens.setAttribute("aria-hidden", "true");
    this.measure.className = "cm-source-line-lens-measure";
    this.view.dom.append(this.lens, this.measure);
    this.lensView = new EditorView({
      parent: this.lens,
      state: EditorState.create({
        extensions: [
          dslCmLanguageExtension,
          sourceEditorPatchHighlightExtension,
          EditorView.lineWrapping,
          this.sourceKeymapCompartment.of(keymap.of([...this.options.sourceKeymap(), ...defaultKeymap])),
          EditorView.updateListener.of((update) => this.handleLensUpdate(update)),
          EditorView.domEventHandlers({
            mouseup: (event, view) => this.handleValueClick(event as MouseEvent, view)
          }),
          // Observers run before CM's keymap even when it consumes the event, so
          // the owning controller can delimit a registry-dispatched repeat gesture.
          EditorView.domEventObservers({
            keydown: (event, view) => this.options.onKeydown(event as KeyboardEvent, view),
            keyup: (event, view) => this.options.onKeyup(event as KeyboardEvent, view),
            compositionstart: () => this.options.onCompositionStart(),
            compositionend: () => this.options.onCompositionEnd(),
            blur: () => this.options.onBlur()
          })
        ]
      })
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.view.contentDOM);
    }
    this.render();
  }

  update(update: ViewUpdate) {
    this.view = update.view;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (!effect.is(reconfigureSourceEditorLineLensKeymap)) continue;
        this.lensView.dispatch({
          effects: this.sourceKeymapCompartment.reconfigure(keymap.of([...effect.value, ...defaultKeymap])),
          annotations: Transaction.addToHistory.of(false)
        });
      }
    }
    if (this.dispatchingLensUpdate) {
      this.queueRender();
      return;
    }
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || update.focusChanged) {
      this.render();
    }
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.options.onFocusChange(false);
    this.lensView.destroy();
    this.lens.remove();
    this.measure.remove();
  }

  private handleLensUpdate(update: ViewUpdate) {
    if (update.focusChanged) this.options.onFocusChange(update.view.hasFocus);
    if (this.dispatchingLensUpdate || (!update.docChanged && !update.selectionSet)) return;
    const lineFrom = this.lensLineFrom;
    if (lineFrom === null) return;

    const selection = EditorSelection.create(update.state.selection.ranges.map((range) =>
      EditorSelection.range(lineFrom + range.anchor, lineFrom + range.head)
    ), update.state.selection.mainIndex);
    this.dispatchingLensUpdate = true;
    try {
      if (update.docChanged) {
        const changes: { from: number; to: number; insert: string }[] = [];
        update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changes.push({ from: lineFrom + fromA, to: lineFrom + toA, insert: inserted.toString() });
        });
        this.view.dispatch({
          changes,
          selection,
          annotations: Transaction.userEvent.of("input.lens")
        });
      } else {
        this.view.dispatch({
          selection,
          annotations: Transaction.userEvent.of("select.lens")
        });
      }
    } finally {
      this.dispatchingLensUpdate = false;
    }
  }

  /**
   * Mirrors the main editor's click-to-select-value handler (sourceEditorController.ts),
   * but against the lens's own document, which is already exactly the projected line's
   * text at offset 0 — no line.from translation is needed here. A selection-only dispatch
   * on lensView is picked up by handleLensUpdate and projected outward automatically.
   */
  private handleValueClick(event: MouseEvent, view: EditorView) {
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    const selection = view.state.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;
    const span = findDslValueSpanAt(dslLineValueSpans(view.state.doc.toString()), selection.main.head);
    if (!span) return false;
    view.dispatch({
      selection: EditorSelection.single(span.start, span.end),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  private queueRender() {
    if (this.renderQueued || this.destroyed) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (!this.destroyed) this.render();
    });
  }

  private render() {
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.head);
    this.measure.textContent = line.text;
    const patchHighlight = this.view.state.field(patchHighlightField, false) ?? null;
    const sourceSelection = this.view.state.selection.main;
    const renderState: LensRenderState = {
      lineFrom: line.from,
      lineText: line.text,
      sourceAnchor: Math.min(Math.max(sourceSelection.anchor - line.from, 0), line.text.length),
      sourceHead: Math.min(Math.max(sourceSelection.head - line.from, 0), line.text.length),
      patchHighlight: linePatchHighlight(patchHighlight, line, this.view.state.doc.length)
    };
    this.view.requestMeasure({
      key: this,
      read: (view) => this.measureRender(view, renderState),
      write: (measured) => this.applyRender(measured)
    });
  }

  private measureRender(view: EditorView, state: LensRenderState): MeasuredLensRender {
    const gutterWidth = view.dom.querySelector<HTMLElement>(".cm-gutters-before")?.offsetWidth ?? 0;
    const availableWidth = Math.max(0, view.scrollDOM.clientWidth - gutterWidth);
    const rootRect = view.dom.getBoundingClientRect();
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const coords = view.coordsAtPos(state.lineFrom);
    const fallbackTop = view.lineBlockAt(state.lineFrom).top - view.scrollDOM.scrollTop + (scrollRect.top - rootRect.top);
    const top = coords ? coords.top - rootRect.top : fallbackTop;
    const isOverflowing = availableWidth > 0 && this.measure.scrollWidth > availableWidth + 1;
    const isInViewport = !coords || scrollRect.height === 0 || (coords.bottom > scrollRect.top && coords.top < scrollRect.bottom);
    return { ...state, gutterWidth, availableWidth, top, isVisible: isOverflowing && isInViewport };
  }

  private applyRender(measured: MeasuredLensRender) {
    if (this.destroyed) return;
    const selectedLine = this.view.state.doc.lineAt(this.view.state.selection.main.head);
    if (selectedLine.from !== measured.lineFrom || selectedLine.text !== measured.lineText) {
      this.render();
      return;
    }
    const key = [
      measured.lineFrom,
      measured.lineText,
      measured.sourceAnchor,
      measured.sourceHead,
      measured.availableWidth,
      measured.gutterWidth,
      measured.top,
      measured.isVisible,
      JSON.stringify(measured.patchHighlight)
    ].join("\u0000");
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.lens.style.left = `${measured.gutterWidth}px`;
    this.lens.style.top = `${measured.top}px`;
    this.lens.style.width = `${measured.availableWidth}px`;
    this.lens.classList.toggle("is-visible", measured.isVisible);
    this.lens.setAttribute("aria-hidden", String(!measured.isVisible));
    if (!measured.isVisible) {
      this.lensLineFrom = null;
      return;
    }

    this.lensLineFrom = measured.lineFrom;
    const lensText = this.lensView.state.doc.toString();
    const lensSelection = this.lensView.state.selection.main;
    const needsDocument = lensText !== measured.lineText;
    const needsSelection = lensSelection.anchor !== measured.sourceAnchor || lensSelection.head !== measured.sourceHead;
    this.dispatchingLensUpdate = true;
    try {
      this.lensView.dispatch({
        ...(needsDocument ? { changes: { from: 0, to: this.lensView.state.doc.length, insert: measured.lineText } } : {}),
        ...(needsSelection ? { selection: EditorSelection.range(measured.sourceAnchor, measured.sourceHead) } : {}),
        effects: setPatchHighlight.of(measured.patchHighlight),
        annotations: Transaction.addToHistory.of(false)
      });
    } finally {
      this.dispatchingLensUpdate = false;
    }
  }
}

export const sourceEditorLineLens = (options: SourceEditorLineLensOptions) =>
  ViewPlugin.fromClass(class extends SourceEditorLineLens {
    constructor(view: EditorView) {
      super(view, options);
    }
  });
