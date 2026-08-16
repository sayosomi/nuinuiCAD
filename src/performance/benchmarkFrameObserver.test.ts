import { describe, expect, it } from "vitest";
import { createBenchmarkFrameObserver } from "./benchmarkFrameObserver";

const harness = () => {
  const frames: Array<() => void> = [];
  const observer = createBenchmarkFrameObserver({ requestAnimationFrame: (callback) => {
    frames.push(() => callback(1));
    return frames.length;
  } });
  return { observer, frames };
};

describe("benchmark frame observer", () => {
  it("settles after current production draw and its first RAF", async () => {
    const { observer, frames } = harness();
    const wait = observer.waitForCurrentDrawAndFrame(4);
    observer.notifyProductionDrawCompleted(4, true);
    expect(frames).toHaveLength(1);
    let settled = false;
    void wait.promise.then(() => { settled = true; });
    expect(settled).toBe(false);
    frames[0]!();
    await wait.promise;
    expect(settled).toBe(true);
  });

  it("ignores stale, non-current, and wrong revisions", async () => {
    const { observer, frames } = harness();
    const wait = observer.waitForCurrentDrawAndFrame(4);
    observer.notifyProductionDrawCompleted(3, true);
    observer.notifyProductionDrawCompleted(4, false);
    expect(frames).toHaveLength(0);
    wait.cancel();
    await expect(wait.promise).rejects.toThrow("cancelled");
  });

  it("does not schedule RAF without a waiter and cancellation beats a late callback", async () => {
    const { observer, frames } = harness();
    observer.notifyProductionDrawCompleted(4, true);
    expect(frames).toHaveLength(0);
    const wait = observer.waitForCurrentDrawAndFrame(4);
    observer.notifyProductionDrawCompleted(4, true);
    wait.cancel();
    frames[0]!();
    await expect(wait.promise).rejects.toThrow("cancelled");
  });
});
