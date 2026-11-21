import type { EvaluationPayload } from "../geometry/evaluationPayload";
import type { RustEvaluationTransport } from "../geometry/rustEvaluationRunner";
import type { EvaluateDocumentInput } from "../geometry/rustEvaluationInput";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage } from "./protocol";

type QueuedRequest = {
  id: number;
  input: EvaluateDocumentInput;
  resolve: (payload: EvaluationPayload) => void;
  reject: (error: Error) => void;
  sourceAutomatic: boolean;
  waitForSourceQuiet: boolean;
};

export type VscodeWebviewPostMessage = (message: VscodeToExtensionMessage) => void;

const SOURCE_QUIET_WINDOW_MS = 200;

export class VscodeRustTransport {
  private nextRequestId = 1;
  private inFlight: QueuedRequest | null = null;
  private latestPending: QueuedRequest | null = null;
  private retainedSourcePending: QueuedRequest | null = null;
  private sourceQuietTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly postMessage: VscodeWebviewPostMessage) {}

  readonly transport: RustEvaluationTransport = (input) => this.evaluate(input);
  readonly automaticSourceTransport: RustEvaluationTransport = (input) => this.evaluateSource(input);

  evaluate(input: EvaluateDocumentInput): Promise<EvaluationPayload> {
    return this.enqueue(input, false);
  }

  evaluateSource(input: EvaluateDocumentInput): Promise<EvaluationPayload> {
    return this.enqueue(input, true);
  }

  private enqueue(input: EvaluateDocumentInput, sourceAutomatic: boolean): Promise<EvaluationPayload> {
    if (this.disposed) return Promise.reject(new Error("VS Code Rust transport disposed"));
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const waitForSourceQuiet = sourceAutomatic && this.sourceQuietTimer !== null;
    const request = new Promise<EvaluationPayload>((resolve, reject) => {
      const queuedRequest = { id, input, resolve, reject, sourceAutomatic, waitForSourceQuiet };
      const superseded = () => new Error("VS Code Rust transport request superseded");
      if (sourceAutomatic) {
        if (this.latestPending?.sourceAutomatic) {
          this.latestPending.reject(superseded());
          this.latestPending = null;
        }
        this.retainedSourcePending?.reject(superseded());
        this.retainedSourcePending = null;
        this.resetSourceQuietTimer();
        if (this.latestPending) this.retainedSourcePending = queuedRequest;
        else this.latestPending = queuedRequest;
      } else {
        if (this.latestPending?.sourceAutomatic) {
          this.retainedSourcePending?.reject(superseded());
          this.retainedSourcePending = this.latestPending;
          this.latestPending = null;
        } else if (this.latestPending) {
          this.latestPending.reject(superseded());
          this.latestPending = null;
        }
        if (this.inFlight) this.latestPending = queuedRequest;
        else {
          this.inFlight = queuedRequest;
          this.send(queuedRequest);
        }
      }
      this.flushLatestPending();
    });
    return request;
  }

  private send(request: QueuedRequest): void {
    this.postMessage({ type: "rustEvaluationRequest", id: request.id, input: request.input });
  }

  handleMessage(message: ExtensionToVscodeMessage): boolean {
    if (message.type !== "rustEvaluationResponse" && message.type !== "rustEvaluationError") return false;
    const request = this.inFlight;
    if (!request || request.id !== message.id) return false;
    this.inFlight = null;
    if (message.type === "rustEvaluationError") request.reject(new Error(message.error));
    else request.resolve(message.payload as EvaluationPayload);
    this.flushLatestPending();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearSourceQuietTimer();
    const error = new Error("VS Code Rust transport disposed");
    this.inFlight?.reject(error);
    this.latestPending?.reject(error);
    this.retainedSourcePending?.reject(error);
    this.inFlight = null;
    this.latestPending = null;
    this.retainedSourcePending = null;
  }

  private resetSourceQuietTimer(): void {
    this.clearSourceQuietTimer();
    this.sourceQuietTimer = setTimeout(() => {
      this.sourceQuietTimer = null;
      if (this.latestPending?.sourceAutomatic) this.latestPending.waitForSourceQuiet = false;
      if (this.retainedSourcePending) this.retainedSourcePending.waitForSourceQuiet = false;
      this.flushLatestPending();
    }, SOURCE_QUIET_WINDOW_MS);
  }

  private clearSourceQuietTimer(): void {
    if (this.sourceQuietTimer === null) return;
    clearTimeout(this.sourceQuietTimer);
    this.sourceQuietTimer = null;
  }

  private flushLatestPending(): void {
    if (this.disposed || this.inFlight) return;
    const request = this.latestPending ?? this.retainedSourcePending;
    if (!request || request.waitForSourceQuiet) return;
    if (request === this.latestPending) this.latestPending = null;
    else this.retainedSourcePending = null;
    this.inFlight = request;
    this.send(request);
  }
}

export const isExtensionToVscodeMessage = (value: unknown): value is ExtensionToVscodeMessage =>
  typeof value === "object" && value !== null && "type" in value;
