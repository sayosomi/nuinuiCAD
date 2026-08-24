import type { CompilerDiagnostic } from "./compilerDiagnostics";
import type {
  VscodeCanvasObservationSnapshot,
  VscodeWebviewSurfaceKind
} from "../../src/vscode/protocol";

export type VscodeObservationActiveSurface = "source" | "canvas" | "outputPreview" | "none";

export type VscodeObservationPosition = {
  line: number;
  character: number;
};

export type VscodeObservationSelection = {
  anchor: VscodeObservationPosition;
  active: VscodeObservationPosition;
  start: VscodeObservationPosition;
  end: VscodeObservationPosition;
  isEmpty: boolean;
};

export type VscodeObservationHostDocument = {
  documentUri: string;
  documentPath: string;
  documentVersion: number;
  isDirty: boolean;
  activeSurface: VscodeObservationActiveSurface;
  sourceSelection: VscodeObservationSelection | null;
  diagnostics: readonly CompilerDiagnostic[];
  canvasSessionPresent: boolean;
  outputPreviewSessionPresent: boolean;
};

export type VscodeDocumentObservation = VscodeObservationHostDocument & {
  canvas: VscodeCanvasObservationSnapshot | null;
};

export type VscodeObservationSnapshot = {
  activeDocumentUri: string | null;
  documents: readonly VscodeDocumentObservation[];
};

type HostDocumentsProvider = () => readonly VscodeObservationHostDocument[];

export class VscodeObservationState {
  private readonly hostDocuments = new Map<string, VscodeObservationHostDocument>();
  private readonly canvasByDocument = new Map<string, VscodeCanvasObservationSnapshot>();
  private hostDocumentsProvider: HostDocumentsProvider | null = null;

  reset(): void {
    this.hostDocuments.clear();
    this.canvasByDocument.clear();
    this.hostDocumentsProvider = null;
  }

  setHostDocumentsProvider(provider: HostDocumentsProvider | null): void {
    this.hostDocumentsProvider = provider;
  }

  replaceHostDocuments(documents: readonly VscodeObservationHostDocument[]): void {
    const nextUris = new Set(documents.map((document) => document.documentUri));
    for (const uri of this.hostDocuments.keys()) {
      if (!nextUris.has(uri)) this.canvasByDocument.delete(uri);
    }
    this.hostDocuments.clear();
    for (const document of documents) this.hostDocuments.set(document.documentUri, document);
  }

  invalidateCanvasRuntime(documentUri: string): void {
    this.canvasByDocument.delete(documentUri);
  }

  removeDocument(documentUri: string): void {
    this.hostDocuments.delete(documentUri);
    this.canvasByDocument.delete(documentUri);
  }

  acceptCanvasPublication(input: {
    sessionDocumentUri: string;
    sessionSurfaceKind: VscodeWebviewSurfaceKind;
    sessionIsCurrent: boolean;
    currentDocumentVersion: number;
    snapshot: VscodeCanvasObservationSnapshot;
  }): boolean {
    this.refreshHostDocuments();
    if (!input.sessionIsCurrent || input.sessionSurfaceKind !== "canvas") return false;
    const hostDocument = this.hostDocuments.get(input.sessionDocumentUri);
    if (!hostDocument) return false;
    if (hostDocument.documentVersion !== input.currentDocumentVersion) return false;
    if (input.snapshot.documentVersion !== input.currentDocumentVersion) return false;
    if (!hostDocument.canvasSessionPresent) return false;

    this.canvasByDocument.set(input.sessionDocumentUri, input.snapshot);
    return true;
  }

  snapshot(): VscodeObservationSnapshot {
    this.refreshHostDocuments();
    return this.cachedSnapshot();
  }

  /**
   * Returns the last host projection already accepted by this owner without
   * invoking the host provider again. Lifecycle callers use this immediately
   * after an authoritative state mutation so projection cannot re-enter an
   * in-progress TextDocument read/compile path.
   */
  cachedSnapshot(): VscodeObservationSnapshot {
    const documents = [...this.hostDocuments.values()].map((document): VscodeDocumentObservation => {
      const runtime = this.canvasByDocument.get(document.documentUri);
      return {
        ...document,
        diagnostics: [...document.diagnostics],
        canvas: runtime?.documentVersion === document.documentVersion ? runtime : null
      };
    });
    return {
      activeDocumentUri: documents.find((document) => document.activeSurface !== "none")?.documentUri ?? null,
      documents
    };
  }

  private refreshHostDocuments(): void {
    if (!this.hostDocumentsProvider) return;
    this.replaceHostDocuments(this.hostDocumentsProvider());
  }
}

export const vscodeObservationState = new VscodeObservationState();
