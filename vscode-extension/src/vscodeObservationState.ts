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

export type VscodeObservationHostFacts = Omit<VscodeObservationHostDocument, "diagnostics">;

export type VscodeDocumentObservation = VscodeObservationHostDocument & {
  canvas: VscodeCanvasObservationSnapshot | null;
};

export type VscodeObservationContextDocument = VscodeObservationHostFacts & {
  canvas: VscodeCanvasObservationSnapshot | null;
};

export type VscodeObservationContextSnapshot = {
  activeDocumentUri: string | null;
  documents: readonly VscodeObservationContextDocument[];
};

export type VscodeObservationSnapshot = {
  activeDocumentUri: string | null;
  documents: readonly VscodeDocumentObservation[];
};

type HostDocumentsProvider = () => readonly VscodeObservationHostDocument[];
type HostFactsProvider = () => readonly VscodeObservationHostFacts[];

const hostFactsFromObservation = (
  document: VscodeObservationHostDocument
): VscodeObservationHostFacts => {
  const { diagnostics, ...facts } = document;
  void diagnostics;
  return facts;
};

export class VscodeObservationState {
  private readonly hostDocuments = new Map<string, VscodeObservationHostDocument>();
  private readonly hostFacts = new Map<string, VscodeObservationHostFacts>();
  private readonly canvasByDocument = new Map<string, VscodeCanvasObservationSnapshot>();
  private hostDocumentsProvider: HostDocumentsProvider | null = null;
  private hostFactsProvider: HostFactsProvider | null = null;

  reset(): void {
    this.hostDocuments.clear();
    this.hostFacts.clear();
    this.canvasByDocument.clear();
    this.hostDocumentsProvider = null;
    this.hostFactsProvider = null;
  }

  setHostDocumentsProvider(provider: HostDocumentsProvider | null): void {
    this.hostDocumentsProvider = provider;
  }

  setHostFactsProvider(provider: HostFactsProvider | null): void {
    this.hostFactsProvider = provider;
  }

  replaceHostDocuments(documents: readonly VscodeObservationHostDocument[]): void {
    this.replaceHostFacts(documents.map(hostFactsFromObservation));
    this.hostDocuments.clear();
    for (const document of documents) this.hostDocuments.set(document.documentUri, document);
  }

  private replaceHostFacts(documents: readonly VscodeObservationHostFacts[]): void {
    const nextUris = new Set(documents.map((document) => document.documentUri));
    for (const uri of this.hostDocuments.keys()) {
      if (!nextUris.has(uri)) this.hostDocuments.delete(uri);
    }
    for (const uri of this.hostFacts.keys()) {
      if (!nextUris.has(uri)) this.canvasByDocument.delete(uri);
    }
    for (const document of documents) {
      const previous = this.hostFacts.get(document.documentUri);
      if (previous && (
        previous.documentVersion !== document.documentVersion ||
        !document.canvasSessionPresent
      )) {
        this.canvasByDocument.delete(document.documentUri);
      }
    }
    this.hostFacts.clear();
    for (const document of documents) {
      this.hostFacts.set(document.documentUri, document);
    }
  }

  invalidateCanvasRuntime(documentUri: string): void {
    this.canvasByDocument.delete(documentUri);
  }

  removeDocument(documentUri: string): void {
    this.hostDocuments.delete(documentUri);
    this.hostFacts.delete(documentUri);
    this.canvasByDocument.delete(documentUri);
  }

  acceptCanvasPublication(input: {
    sessionDocumentUri: string;
    sessionSurfaceKind: VscodeWebviewSurfaceKind;
    sessionIsCurrent: boolean;
    currentDocumentVersion: number;
    snapshot: VscodeCanvasObservationSnapshot;
  }): boolean {
    this.refreshHostFacts();
    if (!input.sessionIsCurrent || input.sessionSurfaceKind !== "canvas") return false;
    const hostDocument = this.hostFacts.get(input.sessionDocumentUri);
    if (!hostDocument) return false;
    if (hostDocument.documentVersion !== input.currentDocumentVersion) return false;
    if (input.snapshot.documentVersion !== input.currentDocumentVersion) return false;
    if (!hostDocument.canvasSessionPresent) return false;

    this.canvasByDocument.set(input.sessionDocumentUri, input.snapshot);
    return true;
  }

  snapshot(): VscodeObservationSnapshot {
    this.refreshHostDocuments();
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

  /**
   * Returns cached lightweight host facts and Canvas runtime without
   * refreshing either provider. Full Observation diagnostics are intentionally
   * available only through snapshot().
   */
  cachedSnapshot(): VscodeObservationContextSnapshot {
    const documents = [...this.hostFacts.values()].map((document): VscodeObservationContextDocument => {
      const runtime = this.canvasByDocument.get(document.documentUri);
      return {
        ...document,
        canvas: runtime?.documentVersion === document.documentVersion ? runtime : null
      };
    });
    return {
      activeDocumentUri: documents.find((document) => document.activeSurface !== "none")?.documentUri ?? null,
      documents
    };
  }

  canvasContextSnapshot(): VscodeObservationContextSnapshot {
    this.refreshHostFacts();
    return this.cachedSnapshot();
  }

  private refreshHostDocuments(): void {
    if (!this.hostDocumentsProvider) return;
    this.replaceHostDocuments(this.hostDocumentsProvider());
  }

  private refreshHostFacts(): void {
    if (!this.hostFactsProvider) return;
    this.replaceHostFacts(this.hostFactsProvider());
  }
}

export const vscodeObservationState = new VscodeObservationState();
