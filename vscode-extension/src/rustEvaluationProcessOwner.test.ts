import { describe, expect, it, vi } from "vitest";
import { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";

describe("RustEvaluationProcessOwner", () => {
  it("shares one lazy process and respawns after unexpected termination", () => {
    const processes = [
      { request: vi.fn(), dispose: vi.fn() },
      { request: vi.fn(), dispose: vi.fn() }
    ];
    const terminationCallbacks: Array<() => void> = [];
    let index = 0;
    const owner = new RustEvaluationProcessOwner((onTerminated) => {
      terminationCallbacks.push(onTerminated);
      return processes[index++] as never;
    });

    const first = owner.get();
    expect(owner.get()).toBe(first);
    expect(terminationCallbacks).toHaveLength(1);

    terminationCallbacks[0]!();
    const second = owner.get();
    expect(second).not.toBe(first);
    expect(terminationCallbacks).toHaveLength(2);
  });

  it("disposes the shared process only when the extension owner disposes", () => {
    const process = { request: vi.fn(), dispose: vi.fn() };
    const owner = new RustEvaluationProcessOwner(() => process as never);
    owner.get();
    owner.dispose();
    expect(process.dispose).toHaveBeenCalledTimes(1);
  });
});
