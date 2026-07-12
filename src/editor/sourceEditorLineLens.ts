import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightDslLine } from "../dsl/dslHighlight";
import { patchHighlightField } from "./sourceEditorPatchHighlight";

type HighlightRange = { from: number; to: number };

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

/** Splits a token's text at every highlight boundary that falls inside it. A
 * token may need more than one split when multiple merged ranges intersect it.
 * Exported for tests. */
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

/**
 * A read-only, floating projection of the selected source line. Keeping it in
 * the editor view (rather than React state) means it follows CM selections and
 * model patches without introducing a second source of truth.
 */
class SourceEditorLineLens {
  private readonly lens = document.createElement("div");
  private readonly content = document.createElement("div");
  private readonly measure = document.createElement("span");
  private resizeObserver: ResizeObserver | null = null;
  private renderedKey: string | null = null;

  constructor(private view: EditorView) {
    this.lens.className = "cm-source-line-lens";
    this.lens.setAttribute("aria-label", "選択行の全文");
    this.lens.setAttribute("aria-hidden", "true");
    this.content.className = "cm-source-line-lens-content";
    this.measure.className = "cm-source-line-lens-measure";
    this.lens.appendChild(this.content);
    this.view.dom.appendChild(this.lens);
    this.view.dom.appendChild(this.measure);
    this.lens.addEventListener("mousedown", this.onMouseDown);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.view.contentDOM);
    }
    this.render();
  }

  update(update: ViewUpdate) {
    this.view = update.view;
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.focusChanged) {
      this.render();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.lens.removeEventListener("mousedown", this.onMouseDown);
    this.lens.remove();
    this.measure.remove();
  }

  private readonly onMouseDown = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-source-lens-from]") : null;
    if (!target) return;
    const from = Number(target.dataset.sourceLensFrom);
    if (!Number.isInteger(from)) return;
    event.preventDefault();
    this.view.dispatch({ selection: EditorSelection.cursor(from) });
    this.view.focus();
  };

  private render() {
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.head);
    const gutterWidth = this.view.dom.querySelector<HTMLElement>(".cm-gutters-before")?.offsetWidth ?? 0;
    const availableWidth = Math.max(0, this.view.scrollDOM.clientWidth - gutterWidth);
    this.measure.textContent = line.text;
    const isOverflowing = availableWidth > 0 && this.measure.scrollWidth > availableWidth + 1;
    // Gutters are sticky while the content scrolls horizontally. Align the
    // floating lens to their fixed width, not to contentDOM's moving rect.
    const left = gutterWidth;

    const patchHighlight = this.view.state.field(patchHighlightField, false) ?? null;
    const highlightRanges = patchHighlight ? lineLocalHighlightRanges(patchHighlight.marks, line.from, line.to) : [];
    const deletionHighlighted = patchHighlight
      ? patchHighlight.deletionPoints.some((point) => {
        const clamped = Math.min(Math.max(point, 0), this.view.state.doc.length);
        return this.view.state.doc.lineAt(clamped).from === line.from;
      })
      : false;
    const deletionMarkerPositions = patchHighlight
      ? [...new Set(patchHighlight.deletionMarkers.filter((pos) => pos >= line.from && pos <= line.to))].sort((left, right) => left - right)
      : [];
    const highlightKey = `${highlightRanges.map((range) => `${range.from}-${range.to}`).join(",")}|${deletionHighlighted}|${deletionMarkerPositions.join(",")}`;

    const key = `${line.from}:${line.text}\u0000${availableWidth}:${left}:${isOverflowing}:${highlightKey}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.lens.style.left = `${left}px`;
    this.lens.classList.toggle("is-visible", isOverflowing);
    this.lens.setAttribute("aria-hidden", String(!isOverflowing));
    this.content.classList.toggle("is-patch-highlight-line", deletionHighlighted);
    if (!isOverflowing) {
      this.content.replaceChildren();
      return;
    }

    this.content.replaceChildren();
    let offset = line.from;
    let markerIndex = 0;
    const flushMarkersAt = (position: number) => {
      while (markerIndex < deletionMarkerPositions.length && deletionMarkerPositions[markerIndex] === position) {
        const marker = document.createElement("span");
        marker.className = "cm-source-lens-patch-deletion-marker";
        marker.dataset.sourceLensFrom = String(position);
        this.content.appendChild(marker);
        markerIndex += 1;
      }
    };
    for (const token of highlightDslLine(line.text)) {
      flushMarkersAt(offset);
      const tokenClass = token.kind === "plain" ? "cm-source-lens-plain" : `tok-${token.kind}`;
      for (const segment of splitTokenByHighlights(token.text, offset, highlightRanges)) {
        const span = document.createElement("span");
        span.className = segment.highlighted ? `${tokenClass} cm-source-lens-patch-highlight` : tokenClass;
        span.dataset.sourceLensFrom = String(segment.from);
        span.textContent = segment.text;
        this.content.appendChild(span);
      }
      offset += token.text.length;
    }
    flushMarkersAt(offset);
  }
}

export const sourceEditorLineLens = ViewPlugin.fromClass(SourceEditorLineLens);
