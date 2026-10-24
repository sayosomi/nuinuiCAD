import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

export type RustEvaluationProcessDependencies = {
  spawnProcess?: typeof spawn;
  reportDiagnostic?: (message: string) => void;
  onTerminated?: () => void;
};

export class RustEvaluationProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly lines: Interface;
  private readonly onTerminated: () => void;
  private killed = false;
  private nextRequestId = 1;
  private disposed = false;
  private terminated = false;

  constructor(binaryPath: string, dependencies: RustEvaluationProcessDependencies = {}) {
    const spawnProcess = dependencies.spawnProcess ?? spawn;
    const reportDiagnostic = dependencies.reportDiagnostic ?? ((message) => console.error(message));
    this.onTerminated = dependencies.onTerminated ?? (() => undefined);
    this.child = spawnProcess(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout });
    const fail = (error: Error) => this.terminate(error);
    this.lines.on("error", fail);
    this.lines.on("line", (line) => this.handleLine(line));
    this.lines.once("close", () => fail(new Error("evaluation_stdio stdout closed")));
    // Keep stream error listeners after readline closes, including during disposal.
    this.child.stdout.on("error", fail);
    this.child.stdout.once("close", () => fail(new Error("evaluation_stdio stdout closed")));
    this.child.stdin.on("error", fail);
    this.child.stdin.once("close", () => fail(new Error("evaluation_stdio stdin closed")));
    this.child.stdin.once("finish", () => fail(new Error("evaluation_stdio stdin finished")));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      reportDiagnostic(`evaluation_stdio: ${String(chunk).trimEnd()}`);
    });
    // Diagnostics are independent of the request/response transport.
    this.child.stderr.on("error", (error) => {
      reportDiagnostic(`evaluation_stdio stderr: ${error.message}`);
    });
    this.child.on("error", (error) => this.terminate(error, false));
    this.child.once("exit", (code, signal) => {
      this.terminate(new Error(`evaluation_stdio exited: code=${code}, signal=${signal ?? "none"}`), false);
    });
  }

  request(input: unknown): Promise<unknown> {
    return this.requestEnvelope({ input });
  }

  exportOutput(exportOutput: unknown): Promise<unknown> {
    return this.requestEnvelope({ exportOutput });
  }

  private requestEnvelope(envelope: { input: unknown } | { exportOutput: unknown }): Promise<unknown> {
    if (this.disposed || this.terminated) {
      return Promise.reject(new Error("evaluation_stdio is not available"));
    }
    if (!this.child.stdin.writable) {
      const error = new Error("evaluation_stdio stdin is not writable");
      this.terminate(error);
      return Promise.reject(error);
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    let frame: string;
    try {
      // Serialization failure is local to this request; never register unsent work.
      frame = `${JSON.stringify({ id, ...envelope })}\n`;
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise<unknown>((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject });
      try {
        // false is backpressure: the frame is still buffered by the Writable.
        this.child.stdin.write(frame, (error) => {
          if (error) this.terminate(error);
        });
      } catch (error) {
        this.terminate(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(new Error("evaluation_stdio disposed"));
    this.lines.close();
    this.killChild();
  }

  private handleLine(line: string): void {
    if (this.disposed || this.terminated) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch (error) {
      this.terminate(new Error(`Invalid evaluation_stdio response: ${String(error)}`));
      return;
    }
    if (typeof message !== "object" || message === null || !("id" in message) ||
        typeof message.id !== "number" || !Number.isSafeInteger(message.id) || message.id < 0) {
      this.terminate(new Error("Invalid evaluation_stdio response id"));
      return;
    }
    const hasPayload = "payload" in message;
    const hasError = "error" in message;
    if (hasPayload === hasError || ("error" in message && typeof message.error !== "string")) {
      this.terminate(new Error("Invalid evaluation_stdio response payload"));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message && typeof message.error === "string") pending.reject(new Error(message.error));
    else if ("payload" in message) pending.resolve(message.payload);
  }

  private terminate(error: Error, kill = true): void {
    if (this.disposed || this.terminated) return;
    this.terminated = true;
    this.rejectAll(error);
    this.lines.close();
    if (kill) this.killChild();
    this.onTerminated();
  }

  private killChild(): void {
    if (this.killed) return;
    this.killed = true;
    this.child.kill();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export type RustEvaluationProcessFactory = (onTerminated: () => void) => RustEvaluationProcess;

/** Lazy owner shared by Node production hosts. */
export class RustEvaluationProcessOwner {
  private process: RustEvaluationProcess | null = null;

  constructor(private readonly create: RustEvaluationProcessFactory) {}

  get(): RustEvaluationProcess {
    if (this.process) return this.process;
    const created = this.create(() => {
      if (this.process === created) this.process = null;
    });
    this.process = created;
    return created;
  }

  dispose(): void {
    this.process?.dispose();
    this.process = null;
  }
}

export const resolveRustEvaluationBinaryPath = (
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env
): string => environment.NUINUICAD_RUST_EVALUATION_BINARY ??
  resolve(repositoryRoot, "rust-evaluator", "target", "debug", "evaluation_stdio");
