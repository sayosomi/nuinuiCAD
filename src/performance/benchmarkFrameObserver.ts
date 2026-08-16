export type BenchmarkFrameWaitHandle = {
  revision: number;
  promise: Promise<void>;
  cancel: () => void;
};

export type BenchmarkFrameObserverDependencies = {
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
};

type Waiter = {
  revision: number;
  scheduled: boolean;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

const cancelledError = () => new Error("Benchmark frame waiter was cancelled");

export type BenchmarkFrameObserver = {
  waitForCurrentDrawAndFrame: (compiledDocumentRevision: number) => BenchmarkFrameWaitHandle;
  notifyProductionDrawCompleted: (compiledDocumentRevision: number, isCurrent: boolean) => void;
};

export const createBenchmarkFrameObserver = ({
  requestAnimationFrame = (callback) => window.requestAnimationFrame(callback)
}: BenchmarkFrameObserverDependencies = {}): BenchmarkFrameObserver => {
  const waiters = new Set<Waiter>();

  const finish = (waiter: Waiter, error?: Error): void => {
    if (waiter.settled) return;
    waiter.settled = true;
    waiters.delete(waiter);
    if (error) waiter.reject(error);
    else waiter.resolve();
  };

  const waitForCurrentDrawAndFrame = (compiledDocumentRevision: number): BenchmarkFrameWaitHandle => {
    let waiter!: Waiter;
    const promise = new Promise<void>((resolve, reject) => {
      waiter = {
        revision: compiledDocumentRevision,
        scheduled: false,
        settled: false,
        resolve,
        reject
      };
      waiters.add(waiter);
    });
    return {
      revision: compiledDocumentRevision,
      promise,
      cancel: () => finish(waiter, cancelledError())
    };
  };

  const notifyProductionDrawCompleted = (
    compiledDocumentRevision: number,
    isCurrent: boolean
  ): void => {
    if (!isCurrent) return;
    for (const waiter of waiters) {
      if (waiter.settled || waiter.scheduled || waiter.revision !== compiledDocumentRevision) continue;
      waiter.scheduled = true;
      requestAnimationFrame(() => finish(waiter));
    }
  };

  return { waitForCurrentDrawAndFrame, notifyProductionDrawCompleted };
};

const productionBenchmarkFrameObserver = createBenchmarkFrameObserver();

export const {
  waitForCurrentDrawAndFrame,
  notifyProductionDrawCompleted
} = productionBenchmarkFrameObserver;
