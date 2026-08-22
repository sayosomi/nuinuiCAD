import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

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
  private nextRequestId = 1;
  private disposed = false;
  private terminated = false;

  constructor(binaryPath: string, dependencies: RustEvaluationProcessDependencies = {}) {
    const spawnProcess = dependencies.spawnProcess ?? spawn;
    const reportDiagnostic = dependencies.reportDiagnostic ?? ((message) => console.error(message));
    const onTerminated = dependencies.onTerminated ?? (() => undefined);
    this.child = spawnProcess(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      reportDiagnostic(`evaluation_stdio: ${String(chunk).trimEnd()}`);
    });
    this.child.once("error", (error) => {
      this.rejectAll(error);
      this.notifyTerminated(onTerminated);
    });
    this.child.once("exit", (code, signal) => {
      if (this.disposed) return;
      this.rejectAll(new Error(`evaluation_stdio exited: code=${code}, signal=${signal ?? "none"}`));
      this.notifyTerminated(onTerminated);
    });
  }

  request(input: unknown): Promise<unknown> {
    if (this.disposed || !this.child.stdin.writable) {
      return Promise.reject(new Error("evaluation_stdio is not available"));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<unknown>((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject });
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

  private notifyTerminated(onTerminated: () => void): void {
    if (this.terminated) return;
    this.terminated = true;
    onTerminated();
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
