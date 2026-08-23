import type { VscodeCanvasObservationSnapshot, VscodeWebviewSurfaceKind } from "../../src/vscode/protocol";
import {
  vscodeObservationState,
  type VscodeObservationHostDocument,
  type VscodeObservationState
} from "./vscodeObservationState";

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
  dispose: () => void;
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
  const whileActive = (action: () => void): void => {
    if (!disposed) action();
  };

  return {
    invalidateDocumentRuntime: (documentUri) => {
      whileActive(() => state.invalidateCanvasRuntime(documentUri));
    },
    removeDocument: (documentUri) => {
      whileActive(() => state.removeDocument(documentUri));
    },
    removeCanvasSession: (documentUri) => {
      whileActive(() => state.invalidateCanvasRuntime(documentUri));
    },
    acceptCanvasPublication: (publication) =>
      disposed ? false : state.acceptCanvasPublication(publication),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      state.setHostDocumentsProvider(null);
      state.reset();
    }
  };
};
