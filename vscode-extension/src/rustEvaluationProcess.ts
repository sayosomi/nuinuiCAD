import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

export type RustEvaluationProcessDependencies = {
  spawnProcess?: typeof spawn;
  reportDiagnostic?: (message: string) => void;
};

export class RustEvaluationProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(binaryPath: string, dependencies: RustEvaluationProcessDependencies = {}) {
    const spawnProcess = dependencies.spawnProcess ?? spawn;
    const reportDiagnostic = dependencies.reportDiagnostic ?? ((message) => console.error(message));
    this.child = spawnProcess(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      reportDiagnostic(`evaluation_stdio: ${String(chunk).trimEnd()}`);
    });
    this.child.once("error", (error) => this.rejectAll(error));
    this.child.once("exit", (code, signal) => {
      if (!this.disposed) this.rejectAll(new Error(`evaluation_stdio exited: code=${code}, signal=${signal ?? "none"}`));
    });
  }

  request(input: unknown): Promise<unknown> {
    if (this.disposed || !this.child.stdin.writable) {
      return Promise.reject(new Error("evaluation_stdio is not available"));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, input })}\n`);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new Error("evaluation_stdio disposed"));
    this.child.kill();
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch (error) {
      this.rejectAll(new Error(`Invalid evaluation_stdio response: ${String(error)}`));
      return;
    }
    if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number") {
      this.rejectAll(new Error("Invalid evaluation_stdio response id"));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message && typeof message.error === "string") pending.reject(new Error(message.error));
    else if ("payload" in message) pending.resolve(message.payload);
    else pending.reject(new Error("Invalid evaluation_stdio response payload"));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
