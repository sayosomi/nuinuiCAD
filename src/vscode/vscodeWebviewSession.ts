import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import type { VscodeWebviewSurfaceKind } from "./protocol";

export type VscodeWebviewSessionBase = {
  documentUri: string;
  hostDocumentUri?: string;
  surfaceKind: VscodeWebviewSurfaceKind;
  receiveMultiDocumentGraphPublication?: (publication: VscodeMultiDocumentGraphPublication) => void;
  observeMultiDocumentGraphPublication?: VscodeWebviewGraphPublicationObservation;
};

export const vscodeWebviewSessionKey = (
  documentUri: string,
  surfaceKind: VscodeWebviewSurfaceKind
): string => JSON.stringify([documentUri, surfaceKind]);

type PublicationSink = (
  documentUri: string,
  publication: VscodeMultiDocumentGraphPublication
) => void;

export type VscodeWebviewGraphPublicationObservation = (
  kind: "dispatch" | "replay",
  publication: VscodeMultiDocumentGraphPublication
) => void;

type PostableSession = VscodeWebviewSessionBase & {
  panel?: {
    webview?: {
      postMessage?: (message: unknown) => unknown;
    };
  };
  observeMultiDocumentGraphPublication?: VscodeWebviewGraphPublicationObservation;
};

const publicationSinks = new Set<PublicationSink>();
const latestMultiDocumentPublicationByDocument = new Map<string, VscodeMultiDocumentGraphPublication>();

/**
 * Publish one root-owned graph snapshot to every currently registered surface
 * for that document. The latest publication is retained so a Canvas/Output
 * Preview opened later receives the same root snapshot on registration.
 */
export const publishVscodeMultiDocumentGraphPublication = (
  documentUri: string,
  publication: VscodeMultiDocumentGraphPublication
): void => {
  latestMultiDocumentPublicationByDocument.set(documentUri, publication);
  for (const sink of publicationSinks) sink(documentUri, publication);
};

export class VscodeWebviewSessionRegistry<T extends VscodeWebviewSessionBase> {
  private readonly byKey = new Map<string, T>();
  private readonly publicationSink: PublicationSink;

  constructor() {
    this.publicationSink = (documentUri, publication) => {
      for (const session of this.forDocument(documentUri)) this.postPublication(session, publication, "dispatch");
    };
    publicationSinks.add(this.publicationSink);
  }

  get<K extends VscodeWebviewSurfaceKind>(
    documentUri: string,
    surfaceKind: K
  ): Extract<T, { surfaceKind: K }> | undefined {
    return this.byKey.get(vscodeWebviewSessionKey(documentUri, surfaceKind)) as Extract<T, { surfaceKind: K }> | undefined;
  }

  set(session: T): void {
    this.byKey.set(vscodeWebviewSessionKey(session.documentUri, session.surfaceKind), session);
    const publication = latestMultiDocumentPublicationByDocument.get(session.documentUri);
    if (publication) this.postPublication(session, publication, "replay");
  }

  replayLatestMultiDocumentGraphPublication(session: T): void {
    if (this.byKey.get(vscodeWebviewSessionKey(session.documentUri, session.surfaceKind)) !== session) return;
    const publication = latestMultiDocumentPublicationByDocument.get(session.documentUri);
    if (publication) this.postPublication(session, publication, "replay");
  }

  delete(documentUri: string, surfaceKind: VscodeWebviewSurfaceKind): boolean {
    return this.byKey.delete(vscodeWebviewSessionKey(documentUri, surfaceKind));
  }

  forDocument(documentUri: string): T[] {
    return [...this.byKey.values()].filter((session) => session.documentUri === documentUri);
  }

  values(): IterableIterator<T> {
    return this.byKey.values();
  }

  valuesForSurface<K extends VscodeWebviewSurfaceKind>(surfaceKind: K): Extract<T, { surfaceKind: K }>[] {
    return [...this.byKey.values()].filter((session) => session.surfaceKind === surfaceKind) as Extract<T, { surfaceKind: K }>[];
  }

  clear(): void {
    this.byKey.clear();
    publicationSinks.delete(this.publicationSink);
  }

  private postPublication(session: T, publication: VscodeMultiDocumentGraphPublication, kind: "dispatch" | "replay"): void {
    if (session.receiveMultiDocumentGraphPublication) {
      session.receiveMultiDocumentGraphPublication(publication);
      if (session.observeMultiDocumentGraphPublication) this.observePublication(session, kind, publication);
      return;
    }
    const postMessage = (session as PostableSession).panel?.webview?.postMessage;
    if (typeof postMessage !== "function") return;
    const hostDocumentUri = session.hostDocumentUri;
    const message = hostDocumentUri ? { ...publication, hostDocumentUri } : publication;
    void postMessage.call((session as PostableSession).panel!.webview, message);
    if (session.observeMultiDocumentGraphPublication) this.observePublication(session, kind, publication);
  }

  private observePublication(session: T, kind: "dispatch" | "replay", publication: VscodeMultiDocumentGraphPublication): void {
    try {
      session.observeMultiDocumentGraphPublication?.(kind, publication);
    } catch {
      // Optional phase attribution is passive; publication delivery remains authoritative.
    }
  }
}
