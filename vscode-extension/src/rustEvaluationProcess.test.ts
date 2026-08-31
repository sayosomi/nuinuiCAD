import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { RustEvaluationProcess } from "./rustEvaluationProcess";

const childFor = () => {
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child as ChildProcessWithoutNullStreams;
};

describe("RustEvaluationProcess lifecycle", () => {
  it("rejects pending requests and reports unexpected termination once", async () => {
    const child = childFor();
    const onTerminated = vi.fn();
    const process = new RustEvaluationProcess("evaluation_stdio", {
      spawnProcess: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      onTerminated
    });
    const request = process.request({ document: "nui 1" });

    child.emit("exit", 1, "SIGTERM");
    await expect(request).rejects.toThrow("evaluation_stdio exited");
    expect(onTerminated).toHaveBeenCalledTimes(1);

    child.emit("error", new Error("late error"));
    expect(onTerminated).toHaveBeenCalledTimes(1);
  });

  it("does not report extension-owned disposal as unexpected termination", () => {
    const child = childFor();
    const onTerminated = vi.fn();
    const process = new RustEvaluationProcess("evaluation_stdio", {
      spawnProcess: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn,
      onTerminated
    });

    process.dispose();
    child.emit("exit", null, "SIGTERM");
    expect(onTerminated).not.toHaveBeenCalled();
  });
});
