import type { LineSplice } from "../document/textPatch";

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
};
