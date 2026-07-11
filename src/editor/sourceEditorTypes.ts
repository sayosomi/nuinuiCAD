import type { LineSplice } from "../document/textPatch";
import type { ElementId, EvaluationResult } from "../types/geometry";

/** Evaluation identity is deliberately separate from the source notification revision.
 * `compiledDocumentRevision` identifies the last-good document that was evaluated. */
export type SourceEvaluationPublication = {
  evaluation: EvaluationResult;
  compiledDocumentRevision: number;
  /** Monotonic ID assigned when the engine started this request, not a source revision. */
  evaluationRequestRevision: number;
};

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
  /** Publishes a result together with the compiled-document revision captured when its
   * request began. Callers must never manufacture this from the current source revision. */
  setEvaluation: (publication: SourceEvaluationPublication) => void;
  /** Moves the primary cursor to an element's statement range and scrolls it into view. */
  jumpToElement: (elementId: ElementId) => void;
  /** Re-resolves a search result after any required flush before applying it as a pick. */
  applyPickCandidate: (elementId: ElementId) => boolean;
  pickCandidateElementIds: () => readonly ElementId[];
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
  onEvaluationPresentationChange?: (state: { isLastGood: boolean }) => void;
};
