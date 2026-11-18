import * as vscode from "vscode";
import type { VscodeCanvasObservationSnapshot, VscodeWebviewSurfaceKind } from "../../src/vscode/protocol";
import {
  vscodeObservationState,
  type VscodeObservationHostFacts,
  type VscodeObservationHostDocument,
  type VscodeObservationState
} from "./vscodeObservationState";

export const VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY = "nuinuiCAD.canvasHasSelection";
export const VSCODE_CANVAS_CAN_SELECT_INSTANCE_CONTEXT_KEY = "nuinuiCAD.canvasCanSelectInstance";
export const VSCODE_CANVAS_HAS_COORDINATE_POINT_CONVERSION_TARGET_CONTEXT_KEY =
  "nuinuiCAD.canvasHasCoordinatePointConversionTarget";

export type VscodeObservationCanvasPublication = {
  sessionDocumentUri: string;
  sessionSurfaceKind: VscodeWebviewSurfaceKind;
  sessionIsCurrent: boolean;
  currentDocumentVersion: number;
  snapshot: VscodeCanvasObservationSnapshot;
};

export type VscodeObservationFeatureHost = {
  hostDocuments: () => readonly VscodeObservationHostDocument[];
  hostFacts: () => readonly VscodeObservationHostFacts[];
};

export type VscodeObservationFeature = {
  invalidateDocumentRuntime: (documentUri: string) => void;
  removeDocument: (documentUri: string) => void;
  removeCanvasSession: (documentUri: string) => void;
  acceptCanvasPublication: (publication: VscodeObservationCanvasPublication) => boolean;
  dispose: () => void;
};

const noopDisposable = (): vscode.Disposable => ({ dispose: () => undefined });

/**
 * Owns attached-observation Extension Host lifecycle/publication wiring while
 * leaving exact-current state semantics in VscodeObservationState.
 *
 * Root activation supplies separate lightweight host facts and full
 * diagnostic-bearing Observation data, plus already-proven Canvas publication
 * facts. This owner is intentionally not a second session registry or
 * analysis authority.
 */
export const registerVscodeObservationFeature = (
  host: VscodeObservationFeatureHost,
  state: VscodeObservationState = vscodeObservationState
): VscodeObservationFeature => {
  state.reset();
  state.setHostDocumentsProvider(host.hostDocuments);
  state.setHostFactsProvider(host.hostFacts);

  let disposed = false;
  let contextUpdate: Promise<void> = Promise.resolve();

  const projectCanvasSelectionContext = (refreshHostProjection = true): void => {
    const snapshot = disposed
      ? null
      : refreshHostProjection
        ? state.canvasContextSnapshot()
        : state.cachedSnapshot();
    const activeDocument = snapshot?.activeDocumentUri
      ? snapshot.documents.find(
        (document) => document.documentUri === snapshot.activeDocumentUri
      )
      : undefined;
    const activeCanvas = activeDocument?.activeSurface === "canvas";
    const hasSelection = activeCanvas &&
      (activeDocument?.canvas?.selectedElementIds.length ?? 0) > 0;
    const canSelectInstance = activeCanvas &&
      activeDocument?.canvas?.canvasCanSelectInstance === true;
    const hasCoordinatePointConversionTarget = activeCanvas &&
      (activeDocument?.canvas?.coordinatePointConversionTargetIds?.length ?? 0) > 0;
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all([
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY,
          hasSelection
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_CANVAS_CAN_SELECT_INSTANCE_CONTEXT_KEY,
          canSelectInstance
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_CANVAS_HAS_COORDINATE_POINT_CONVERSION_TARGET_CONTEXT_KEY,
          hasCoordinatePointConversionTarget
        )
      ]))
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
        projectCanvasSelectionContext(false);
      });
    },
    removeDocument: (documentUri) => {
      whileActive(() => {
        state.removeDocument(documentUri);
        projectCanvasSelectionContext(false);
      });
    },
    removeCanvasSession: (documentUri) => {
      whileActive(() => {
        state.invalidateCanvasRuntime(documentUri);
        projectCanvasSelectionContext(false);
      });
    },
    acceptCanvasPublication: (publication) => {
      if (disposed) return false;
      const accepted = state.acceptCanvasPublication(publication);
      projectCanvasSelectionContext(false);
      return accepted;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeEditorListener.dispose();
      tabListener.dispose();
      tabGroupListener.dispose();
      state.setHostDocumentsProvider(null);
      state.setHostFactsProvider(null);
      state.reset();
      projectCanvasSelectionContext(false);
    }
  };
};
