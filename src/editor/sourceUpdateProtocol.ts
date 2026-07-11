import type { SourceUpdate } from "./sourceEditorTypes";

export type PendingSourceUpdate = {
  update: SourceUpdate;
  /** Only reset events retain text: normal revisions retain metadata and splices only. */
  resetText?: string;
};

export type SourceUpdateProtocolState = {
  appliedRevision: number;
  composing: boolean;
  pending: PendingSourceUpdate[];
};

export type SourceUpdateProtocolAction =
  | { kind: "consume-editor" }
  | { kind: "apply-model-patch"; update: Extract<SourceUpdate, { kind: "model-patch" }> }
  | { kind: "reset"; text?: string; reason: "reset" | "gap" }
  | null;

export const createSourceUpdateProtocol = (appliedRevision: number): SourceUpdateProtocolState => ({
  appliedRevision,
  composing: false,
  pending: []
});

export const beginSourceComposition = (state: SourceUpdateProtocolState): SourceUpdateProtocolState => ({
  ...state,
  composing: true
});

const applyOne = (
  state: SourceUpdateProtocolState,
  envelope: PendingSourceUpdate,
  recoveryRevision: number
): { state: SourceUpdateProtocolState; action: SourceUpdateProtocolAction } => {
  const { update } = envelope;
  if (update.revision !== state.appliedRevision + 1) {
    return {
      state: { ...state, appliedRevision: recoveryRevision, pending: [] },
      action: { kind: "reset", reason: "gap" }
    };
  }
  const next = { ...state, appliedRevision: update.revision };
  if (update.kind === "editor") return { state: next, action: { kind: "consume-editor" } };
  if (update.kind === "model-patch") return { state: next, action: { kind: "apply-model-patch", update } };
  return { state: next, action: { kind: "reset", text: envelope.resetText, reason: "reset" } };
};

export const receiveSourceUpdate = (
  state: SourceUpdateProtocolState,
  envelope: PendingSourceUpdate,
  recoveryRevision: number
) => {
  if (state.composing) {
    return { state: { ...state, pending: [...state.pending, envelope] }, action: null as SourceUpdateProtocolAction };
  }
  return applyOne(state, envelope, recoveryRevision);
};

export const endSourceComposition = (
  state: SourceUpdateProtocolState,
  recoveryRevision: number
): { state: SourceUpdateProtocolState; actions: SourceUpdateProtocolAction[] } => {
  let next: SourceUpdateProtocolState = { ...state, composing: false, pending: [] };
  const actions: SourceUpdateProtocolAction[] = [];
  for (const envelope of state.pending) {
    const result = applyOne(next, envelope, recoveryRevision);
    next = result.state;
    if (result.action) actions.push(result.action);
    if (result.action?.kind === "reset" && result.action.reason === "gap") break;
  }
  return { state: next, actions };
};
