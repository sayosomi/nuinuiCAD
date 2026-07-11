/**
 * Small CM-independent bridge used by document mutations and file lifecycle code.
 * Only the currently mounted source editor may register a session.
 */
export type FlushReason =
  | "blur"
  | "command"
  | "canvas-pointerdown"
  | "model-mutation"
  | "save"
  | "unsaved-guard";

export type SourceEditFlushResult = "clean" | "flushed" | "blocked-composition";

export type SourceEditSession = {
  hasPendingText: () => boolean;
  isComposing: () => boolean;
  flush: (reason: FlushReason) => SourceEditFlushResult;
};

let activeSession: SourceEditSession | null = null;

export const registerSourceEditSession = (session: SourceEditSession) => {
  activeSession = session;
  return () => {
    if (activeSession === session) activeSession = null;
  };
};

export const sourceEditSession = {
  hasPendingText: () => activeSession?.hasPendingText() ?? false,
  isComposing: () => activeSession?.isComposing() ?? false,
  flush: (reason: FlushReason): SourceEditFlushResult => activeSession?.flush(reason) ?? "clean"
};
