import { StateEffect } from "@codemirror/state";

/** Refreshes evaluation-derived editor projections without editing source text. */
export const evaluationChanged = StateEffect.define<null>();
