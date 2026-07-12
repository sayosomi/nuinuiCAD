import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightDslLine } from "../dsl/dslHighlight";

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
    const key = `${line.from}:${line.text}\u0000${availableWidth}:${left}:${isOverflowing}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.lens.style.left = `${left}px`;
    this.lens.classList.toggle("is-visible", isOverflowing);
    this.lens.setAttribute("aria-hidden", String(!isOverflowing));
    if (!isOverflowing) {
      this.content.replaceChildren();
      return;
    }

    this.content.replaceChildren();
    let offset = line.from;
    for (const token of highlightDslLine(line.text)) {
      const span = document.createElement("span");
      span.className = token.kind === "plain" ? "cm-source-lens-plain" : `tok-${token.kind}`;
      span.dataset.sourceLensFrom = String(offset);
      span.textContent = token.text;
      this.content.appendChild(span);
      offset += token.text.length;
    }
  }
}

export const sourceEditorLineLens = ViewPlugin.fromClass(SourceEditorLineLens);
