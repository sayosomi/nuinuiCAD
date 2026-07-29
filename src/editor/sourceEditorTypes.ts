import type { LineSplice } from "../document/textPatch";
import type { BindingId } from "../scalars/bindingCatalog";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
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
  /** Element statement under the primary cursor, resolved through the current range index. */
  currentCursorElementId?: () => ElementId | null;
  /** Typed binding (declaration/reference/set target/template hole) under the
   * primary cursor, if any - see typedRenameTargetAtCursor.ts. Null whenever
   * the cursor is not on a typed construct at all. */
  currentCursorTypedRenameTargetBindingId?: () => BindingId | null;
  /** Current editor text serialized with its uniform source line ending, when one exists. */
  getText: () => string;
  /** Publishes a result together with the compiled-document revision captured when its
   * request began. Callers must never manufacture this from the current source revision. */
  setEvaluation: (publication: SourceEvaluationPublication) => void;
  /** Moves the primary cursor to an element's statement range and scrolls it into view. */
  jumpToElement: (elementId: ElementId) => void;
  /** Moves the primary cursor to an element's structural end and focuses it; false during IME composition. */
  jumpToElementEnd: (elementId: ElementId) => boolean;
  /** Selects a parameter's current DSL value and focuses the editor. Returns false on fallback. */
  jumpToParameterValue: (elementId: ElementId, parameterKey: string) => boolean;
  /** Moves the primary cursor to a typed binding's declaration statement and selects it as
   * the current subject (clearing any active element selection). False during IME
   * composition or if the binding's declaration no longer resolves. */
  jumpToBindingDeclaration: (bindingId: BindingId) => boolean;
  /** Selects a typed binding declaration's type annotation or initializer sub-span
   * (Task 43) and focuses the editor. False if the binding, or that specific field's
   * span, does not currently resolve - callers may fall back to jumpToBindingDeclaration. */
  jumpToBindingDeclarationPart: (bindingId: BindingId, part: "type" | "initializer") => boolean;
  /** Selects a resolved property/control-flow binding's own `@name` value span
   * (Task 45 Inspector consumer rows). `occurrenceKey` is Task 22's
   * `propertyBindingOccurrenceKey(statementIndex, parameterKey)`. False, without
   * moving anything, if that occurrence's span does not currently resolve. */
  jumpToPropertyBindingValue: (occurrenceKey: string) => boolean;
  /** Selects one text-template hole's brace-interior span (Task 45 Inspector
   * consumer rows). `holeIndex` is the hole's position among the compiled
   * TextTemplateAst's hole segments, in source order. False, without moving
   * anything, if that occurrence/hole does not currently resolve. */
  jumpToTemplateHole: (occurrenceKey: string, holeIndex: number) => boolean;
  /** Task 48 correction: selects a diagnostic's own already-resolved
   * physicalSpan directly (a reference occurrence with no dedicated ID-based
   * index - undefined-binding/forward-binding-reference/self-initialization/
   * a reference-origin duplicate-binding). Re-validates the source revision
   * and bounds at call time; false, without moving anything, on IME
   * composition, a dirty/uncommitted buffer, a moved-on revision, or an
   * out-of-bounds span - never falls back to any other position. */
  selectSourceSpan: (span: DslPhysicalSpan) => boolean;
  /** Re-resolves a search result after any required flush before applying it as a pick. */
  applyPickCandidate: (elementId: ElementId) => boolean;
  pickCandidateElementIds: () => readonly ElementId[];
  /** Opens/closes CodeMirror's own text-search panel without leaking CM types to callers. */
  openTextSearch: () => void;
  closeTextSearch: () => void;
  /** Task 48: fresh TS/Rust runtime diagnostics (poison/evaluation errors),
   * live-computed on every call - never a snapshot. Callers that render this
   * outside the editor (the Problems popover) must re-invoke it on every
   * render they want to stay current for, not cache the result. Plain
   * DslDiagnostic data only; no CodeMirror type crosses this boundary. */
  runtimeDiagnostics: () => readonly DslDiagnostic[];
  /** Focuses the DOM editor (used after an external panel finishes opening). */
  focusSearch: () => void;
};

/**
 * Plain callbacks the controller invokes outward. No `@codemirror/*` type may appear
 * here: components outside `src/editor/`/`SourceEditorPane.tsx` receive only these.
 */
export type SourceEditorControllerOptions = {
  onRequestCanvasFocus?: () => void;
  onRequestElementSearch?: () => void;
  onRequestContextMenu?: (elementId: ElementId, clientX: number, clientY: number) => void;
  isSourceSearchOpen?: () => boolean;
  closeSourceSearch?: () => void;
  onEvaluationPresentationChange?: (state: { isLastGood: boolean }) => void;
  /** Task 48 correction: fired synchronously from every CM doc change
   * (before any commit debounce), so a React surface outside the editor
   * (the Problems popover) can re-derive runtimeDiagnostics() immediately -
   * store fields like docText/sourceText only update once the debounced
   * commit completes, which is too late for "clears on the very next
   * keystroke, not the next commit". */
  onEditorBufferChanged?: () => void;
};
