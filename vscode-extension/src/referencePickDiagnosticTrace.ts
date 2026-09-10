import type {
  VscodeReferencePickDiagnosticEvent,
  VscodeReferencePickDiagnosticMessage
} from "../../src/vscode/referencePickProtocol";

export type VscodeReferencePickDiagnosticTraceEntry = VscodeReferencePickDiagnosticEvent & {
  sequence: number;
};

const MAX_EVENTS_PER_DOCUMENT = 64;

/** Owns the short-lived, observation-only Reference Pick startup trace. */
export class VscodeReferencePickDiagnosticTraceStore {
  private readonly eventsByDocument = new Map<string, VscodeReferencePickDiagnosticTraceEntry[]>();
  private nextSequence = 1;

  reset(): void {
    this.eventsByDocument.clear();
    this.nextSequence = 1;
  }

  record(event: VscodeReferencePickDiagnosticEvent): void {
    const events = this.eventsByDocument.get(event.documentUri) ?? [];
    events.push({ ...event, sequence: this.nextSequence++ });
    if (events.length > MAX_EVENTS_PER_DOCUMENT) events.splice(0, events.length - MAX_EVENTS_PER_DOCUMENT);
    this.eventsByDocument.set(event.documentUri, events);
  }

  recordMessage(message: VscodeReferencePickDiagnosticMessage): void {
    const { type: _type, ...event } = message;
    this.record(event);
  }

  traceFor(documentUri: string): readonly VscodeReferencePickDiagnosticTraceEntry[] {
    return [...(this.eventsByDocument.get(documentUri) ?? [])];
  }

  clearDocument(documentUri: string): void {
    this.eventsByDocument.delete(documentUri);
  }

  retainDocuments(documentUris: ReadonlySet<string>): void {
    for (const documentUri of this.eventsByDocument.keys()) {
      if (!documentUris.has(documentUri)) this.eventsByDocument.delete(documentUri);
    }
  }
}

export const referencePickDiagnosticTraceStore = new VscodeReferencePickDiagnosticTraceStore();
