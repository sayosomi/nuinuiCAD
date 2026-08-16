import { RustEvaluationProcess } from "./rustEvaluationProcess";

export type RustEvaluationProcessFactory = (onTerminated: () => void) => RustEvaluationProcess;

/** Extension-wide lazy owner. Panels borrow the process; they never own it. */
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
