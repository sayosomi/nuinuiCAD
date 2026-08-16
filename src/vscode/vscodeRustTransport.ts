import type { EvaluationPayload } from "../geometry/evaluationPayload";
import type { RustEvaluationTransport } from "../geometry/rustEvaluationRunner";
import type { EvaluateDocumentInput } from "../geometry/rustEvaluationInput";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage } from "./protocol";

type PendingRequest = {
  resolve: (payload: EvaluationPayload) => void;
  reject: (error: Error) => void;
};

export type VscodeWebviewPostMessage = (message: VscodeToExtensionMessage) => void;

export class VscodeRustTransport {
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly postMessage: VscodeWebviewPostMessage) {}

  readonly transport: RustEvaluationTransport = (input) => this.evaluate(input);

  evaluate(input: EvaluateDocumentInput): Promise<EvaluationPayload> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<EvaluationPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.postMessage({ type: "rustEvaluationRequest", id, input });
    });
  }

  handleMessage(message: ExtensionToVscodeMessage): boolean {
    if (message.type !== "rustEvaluationResponse" && message.type !== "rustEvaluationError") return false;
    const request = this.pending.get(message.id);
    if (!request) return false;
    this.pending.delete(message.id);
    if (message.type === "rustEvaluationError") request.reject(new Error(message.error));
    else request.resolve(message.payload as EvaluationPayload);
    return true;
  }

  dispose(): void {
    const error = new Error("VS Code Rust transport disposed");
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

export const isExtensionToVscodeMessage = (value: unknown): value is ExtensionToVscodeMessage =>
  typeof value === "object" && value !== null && "type" in value;
