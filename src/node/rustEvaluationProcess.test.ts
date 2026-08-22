import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  resolveRustEvaluationBinaryPath,
  RustEvaluationProcess,
  RustEvaluationProcessOwner
} from "./rustEvaluationProcess";

const childFor = () => {
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child as ChildProcessWithoutNullStreams;
};

describe("shared RustEvaluationProcess", () => {
  it("rejects pending work and reports an unexpected termination once", async () => {
    const child = childFor();
    const onTerminated = vi.fn();
    const process = new RustEvaluationProcess("evaluation_stdio", {
      spawnProcess: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      onTerminated
    });
    const request = process.request({ document: "nui 4" });

    child.emit("exit", 1, "SIGTERM");
    await expect(request).rejects.toThrow("evaluation_stdio exited");
    child.emit("error", new Error("late error"));
    expect(onTerminated).toHaveBeenCalledTimes(1);
  });

  it("shares one lazy process and replaces it after termination", () => {
    const processes = [
      { request: vi.fn(), dispose: vi.fn() },
      { request: vi.fn(), dispose: vi.fn() }
    ];
    const callbacks: Array<() => void> = [];
    let index = 0;
    const owner = new RustEvaluationProcessOwner((onTerminated) => {
      callbacks.push(onTerminated);
      return processes[index++] as never;
    });

    const first = owner.get();
    expect(owner.get()).toBe(first);
    callbacks[0]!();
    expect(owner.get()).not.toBe(first);
  });

  it("uses the existing environment override before the repository debug fallback", () => {
    expect(resolveRustEvaluationBinaryPath("/repo", {
      NUINUICAD_RUST_EVALUATION_BINARY: "/custom/evaluation_stdio"
    })).toBe("/custom/evaluation_stdio");
    expect(resolveRustEvaluationBinaryPath("/repo", {})).toContain("rust-evaluator");
    expect(resolveRustEvaluationBinaryPath("/repo", {})).toContain("evaluation_stdio");
  });
});
