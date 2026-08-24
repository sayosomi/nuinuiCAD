import * as vscode from "vscode";
import type { VscodeCanvasObservationSnapshot, VscodeWebviewSurfaceKind } from "../../src/vscode/protocol";
import {
  vscodeObservationState,
  type VscodeObservationHostDocument,
  type VscodeObservationState
} from "./vscodeObservationState";

export const VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY = "nuinuiCAD.canvasHasSelection";

export type VscodeObservationCanvasPublication = {
  sessionDocumentUri: string;
  sessionSurfaceKind: VscodeWebviewSurfaceKind;
  sessionIsCurrent: boolean;
  currentDocumentVersion: number;
  snapshot: VscodeCanvasObservationSnapshot;
};

export type VscodeObservationFeatureHost = {
  hostDocuments: () => readonly VscodeObservationHostDocument[];
};

export type VscodeObservationFeature = {
  invalidateDocumentRuntime: (documentUri: string) => void;
  removeDocument: (documentUri: string) => void;
  removeCanvasSession: (documentUri: string) => void;
  acceptCanvasPublication: (publication: VscodeObservationCanvasPublication) => boolean;
  refreshCanvasSelectionContext: () => void;
  dispose: () => void;
};

const noopDisposable = (): vscode.Disposable => ({ dispose: () => undefined });

const activeCanvasHasSelection = (state: VscodeObservationState): boolean => {
  const snapshot = state.snapshot();
  if (!snapshot.activeDocumentUri) return false;
  const activeDocument = snapshot.documents.find(
    (document) => document.documentUri === snapshot.activeDocumentUri
  );
  return activeDocument?.activeSurface === "canvas" &&
    (activeDocument.canvas?.selectedElementIds.length ?? 0) > 0;
};

/**
 * Owns attached-observation Extension Host lifecycle/publication wiring while
 * leaving exact-current state semantics in VscodeObservationState.
 *
 * Root activation supplies only the current host-document projection and the
 * already-proven Canvas publication facts. This owner is intentionally not a
 * second session registry or analysis authority.
 */
export const registerVscodeObservationFeature = (
  host: VscodeObservationFeatureHost,
  state: VscodeObservationState = vscodeObservationState
): VscodeObservationFeature => {
  state.reset();
  state.setHostDocumentsProvider(host.hostDocuments);

  let disposed = false;
  let contextUpdate: Promise<void> = Promise.resolve();

  const projectCanvasSelectionContext = (): void => {
    const enabled = !disposed && activeCanvasHasSelection(state);
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand(
        "setContext",
        VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY,
        enabled
      ))
      .then(() => undefined);
  };

  const whileActive = (action: () => void): void => {
    if (!disposed) action();
  };

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => {
    projectCanvasSelectionContext();
  });
  const tabGroups = vscode.window.tabGroups as typeof vscode.window.tabGroups & {
    onDidChangeTabs?: (listener: () => void) => vscode.Disposable;
    onDidChangeTabGroups?: (listener: () => void) => vscode.Disposable;
  };
  const tabListener = tabGroups.onDidChangeTabs?.(() => {
    projectCanvasSelectionContext();
  }) ?? noopDisposable();
  const tabGroupListener = tabGroups.onDidChangeTabGroups?.(() => {
    projectCanvasSelectionContext();
  }) ?? noopDisposable();

  projectCanvasSelectionContext();

  return {
    invalidateDocumentRuntime: (documentUri) => {
      whileActive(() => {
        state.invalidateCanvasRuntime(documentUri);
        projectCanvasSelectionContext();
      });
    },
    removeDocument: (documentUri) => {
      whileActive(() => {
        state.removeDocument(documentUri);
        projectCanvasSelectionContext();
      });
    },
    removeCanvasSession: (documentUri) => {
      whileActive(() => {
        state.invalidateCanvasRuntime(documentUri);
        projectCanvasSelectionContext();
      });
    },
    acceptCanvasPublication: (publication) => {
      if (disposed) return false;
      const accepted = state.acceptCanvasPublication(publication);
      projectCanvasSelectionContext();
      return accepted;
    },
    refreshCanvasSelectionContext: projectCanvasSelectionContext,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeEditorListener.dispose();
      tabListener.dispose();
      tabGroupListener.dispose();
      state.setHostDocumentsProvider(null);
      state.reset();
      projectCanvasSelectionContext();
    }
  };
};
