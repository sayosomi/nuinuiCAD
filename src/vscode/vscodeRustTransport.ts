import type { EvaluationPayload } from "../geometry/evaluationPayload";
import type { RustEvaluationTransport } from "../geometry/rustEvaluationRunner";
import type { EvaluateDocumentInput } from "../geometry/rustEvaluationInput";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage } from "./protocol";
import { continuousDragDiagnostic } from "../performance/continuousDragDiagnostic";

type QueuedRequest = {
  id: number;
  input: EvaluateDocumentInput;
  resolve: (payload: EvaluationPayload) => void;
  reject: (error: Error) => void;
};

export type VscodeWebviewPostMessage = (message: VscodeToExtensionMessage) => void;

export class VscodeRustTransport {
  private nextRequestId = 1;
  private inFlight: QueuedRequest | null = null;
  private latestPending: QueuedRequest | null = null;
  private disposed = false;

  constructor(private readonly postMessage: VscodeWebviewPostMessage) {}

  readonly transport: RustEvaluationTransport = (input) => this.evaluate(input);

  evaluate(input: EvaluateDocumentInput): Promise<EvaluationPayload> {
    if (this.disposed) return Promise.reject(new Error("VS Code Rust transport disposed"));
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request = new Promise<EvaluationPayload>((resolve, reject) => {
      const queuedRequest = { id, input, resolve, reject };
      if (!this.inFlight) {
        this.inFlight = queuedRequest;
        this.send(this.inFlight);
        return;
      }
      this.latestPending?.reject(new Error("VS Code Rust transport request superseded"));
      this.latestPending = queuedRequest;
    });
    return request;
  }

  private send(request: QueuedRequest): void {
    continuousDragDiagnostic.recordTransportSend(
      request.id,
      (this.inFlight ? 1 : 0) + (this.latestPending ? 1 : 0)
    );
    this.postMessage({ type: "rustEvaluationRequest", id: request.id, input: request.input });
  }

  handleMessage(message: ExtensionToVscodeMessage): boolean {
    if (message.type !== "rustEvaluationResponse" && message.type !== "rustEvaluationError") return false;
    const request = this.inFlight;
    if (!request || request.id !== message.id) return false;
    const pendingCount = 1 + (this.latestPending ? 1 : 0);
    this.inFlight = null;
    continuousDragDiagnostic.recordTransportResponse(
      message.id,
      pendingCount,
      this.latestPending ? 1 : 0
    );
    if (message.type === "rustEvaluationError") request.reject(new Error(message.error));
    else request.resolve(message.payload as EvaluationPayload);
    if (this.latestPending) {
      this.inFlight = this.latestPending;
      this.latestPending = null;
      this.send(this.inFlight);
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("VS Code Rust transport disposed");
    this.inFlight?.reject(error);
    this.latestPending?.reject(error);
    this.inFlight = null;
    this.latestPending = null;
  }
}

export const isExtensionToVscodeMessage = (value: unknown): value is ExtensionToVscodeMessage =>
  typeof value === "object" && value !== null && "type" in value;
