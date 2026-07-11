import type { LineSplice } from "../document/textPatch";
import type { ElementId, EvaluationResult } from "../types/geometry";

/** Store-to-editor notification. CM implementation types must not cross this boundary. */
export type SourceUpdate =
  | { revision: number; kind: "editor" }
  | { revision: number; kind: "model-patch"; splices: readonly LineSplice[] }
  | { revision: number; kind: "reset" };

/** A text change in CodeMirror's logical (LF-separated) document coordinates. */
export type SourceTextChange = {
  from: number;
  to: number;
  insert: string;
};

export type SourceTransactionOrigin = "model-patch" | "reset";

export type SourceLineEnding = "lf" | "crlf" | "mixed";

export type SourceTextFormat = {
  lineEnding: SourceLineEnding;
  /** Mixed or lone-CR input is normalized only by a future direct editor commit. */
  normalizeToLfOnEditorCommit: boolean;
};

export type SourceEditorHandle = {
  focus: () => void;
  /** Current editor text serialized with its uniform source line ending, when one exists. */
  getText: () => string;
  /**
   * Publishes evaluation results for decoration. `sourceRevision` is the revision the
   * evaluation was computed against; the controller only applies it once CM has caught
   * up to that exact revision, and clears any applied evaluation immediately on reset
   * so a previous document's decorations never paint over new text.
   */
  setEvaluation: (evaluation: EvaluationResult, sourceRevision: number) => void;
  /** Moves the primary cursor to an element's statement range and scrolls it into view. */
  jumpToElement: (elementId: ElementId) => void;
  /** Opens/closes CodeMirror's own text-search panel without leaking CM types to callers. */
  openTextSearch: () => void;
  closeTextSearch: () => void;
  /** Focuses the DOM editor (used after an external panel finishes opening). */
  focusSearch: () => void;
};

/**
 * Plain callbacks the controller invokes outward. No `@codemirror/*` type may appear
 * here: components outside `src/editor/`/`SourceEditorPane.tsx` receive only these.
 */
export type SourceEditorControllerOptions = {
  onRequestCanvasFocus?: () => void;
  onRequestContextMenu?: (elementId: ElementId, clientX: number, clientY: number) => void;
  isSourceSearchOpen?: () => boolean;
  closeSourceSearch?: () => void;
};
