export type OutputPreviewHistoryDirection = "undo" | "redo";

export type OutputPreviewHistoryHandoff = {
  isSessionCurrent: () => boolean;
  isPanelActive: () => boolean;
  isDocumentOpen: () => boolean;
  documentVersion: () => number;
  activateMatchingSource: () => Promise<boolean>;
  executeNativeHistory: (direction: OutputPreviewHistoryDirection) => Promise<void>;
  restorePreviewFocus: () => void;
};

const restorePreviewFocusIfSafe = (handoff: OutputPreviewHistoryHandoff): void => {
  if (!handoff.isSessionCurrent() || !handoff.isDocumentOpen()) return;
  handoff.restorePreviewFocus();
};

export const handoffOutputPreviewHistory = async (
  direction: OutputPreviewHistoryDirection,
  handoff: OutputPreviewHistoryHandoff
): Promise<void> => {
  if (!handoff.isSessionCurrent() || !handoff.isPanelActive() || !handoff.isDocumentOpen()) return;

  const expectedDocumentVersion = handoff.documentVersion();
  let sourceActivated = false;
  try {
    sourceActivated = await handoff.activateMatchingSource();
  } catch {
    return;
  }
  if (!sourceActivated) return;

  if (!handoff.isSessionCurrent() || !handoff.isDocumentOpen()) return;
  if (handoff.documentVersion() !== expectedDocumentVersion) {
    restorePreviewFocusIfSafe(handoff);
    return;
  }

  try {
    await handoff.executeNativeHistory(direction);
  } catch {
    restorePreviewFocusIfSafe(handoff);
    return;
  }

  restorePreviewFocusIfSafe(handoff);
};
