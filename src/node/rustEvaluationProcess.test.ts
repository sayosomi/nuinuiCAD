import { EventEmitter, once } from "node:events";
import type { spawn } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveRustEvaluationBinaryPath,
  RustEvaluationProcess,
  RustEvaluationProcessOwner
} from "./rustEvaluationProcess";

// Frozen traces: test/fixtures/issue-1454/traces.md (seed 1454).
// Authorized oracle corrections: test/fixtures/issue-1454/completion.md.
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
type Observation = { state: "pending" | "fulfilled" | "rejected"; value?: unknown };
const observe = (promise: Promise<unknown>): Observation => {
  const result: Observation = { state: "pending" };
  void promise.then(
    (value) => Object.assign(result, { state: "fulfilled", value }),
    (value: unknown) => Object.assign(result, { state: "rejected", value })
  );
  return result;
};
const states = (observations: Observation[], expected: Observation["state"][]) => {
  expect(observations.map((observation) => observation.state)).toEqual(expected);
};
const values = (observations: Observation[], expected: unknown[]) => {
  expect(observations.map((observation) => observation.value)).toEqual(expected);
};

class ControlledInput extends Writable {
  readonly writes: string[] = [];
  readonly callbacks: Array<(error?: Error | null) => void> = [];
  hold = false;
  throwWrite = false;

  constructor(backpressure = false) {
    super({ highWaterMark: backpressure ? 1 : 16384 });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.throwWrite) throw new Error("sync write failure");
    this.writes.push(String(chunk));
    if (this.hold) this.callbacks.push(callback);
    else callback();
  }

  release(error?: Error): void {
    const callback = this.callbacks.shift();
    expect(callback).toBeDefined();
    callback!(error);
  }
}

type Fixture = ReturnType<typeof fixture>;
const fixtures: Array<() => void> = [];
const owners: RustEvaluationProcessOwner[] = [];
const fixture = (backpressure = false, notify = vi.fn()) => {
  const stdin = new ControlledInput(backpressure);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const streamErrors: Error[] = [];
  // Independent observation consumes expected errors even on the defective Base.
  const observeStreamError = (error: Error) => { streamErrors.push(error); };
  for (const stream of [stdin, stdout, stderr]) stream.on("error", observeStreamError);
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn(() => true) });
  const diagnostic = vi.fn();
  const process = new RustEvaluationProcess("evaluation_stdio", {
    spawnProcess: vi.fn(() => child) as unknown as typeof spawn,
    onTerminated: notify,
    reportDiagnostic: diagnostic
  });
  const result = {
    child, stdin, stdout, stderr, process, notify, diagnostic, streamErrors, observeStreamError,
    frame: (bytes: string) => stdout.write(bytes),
    evaluation: (kind = "E1") => observe(process.request({ kind })),
    output: () => observe(process.exportOutput({ kind: "X2" }))
  };
  fixtures.push(() => {
    process.dispose();
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
  });
  return result;
};
const ownerFixture = () => {
  const generations: Fixture[] = [];
  const callbacks: Array<() => void> = [];
  const owner = new RustEvaluationProcessOwner((callback) => {
    callbacks.push(callback);
    const generation = fixture(false, vi.fn(callback));
    generations.push(generation);
    return generation.process;
  });
  owners.push(owner);
  return { owner, generations, callbacks };
};
const pair = (f: Fixture) => [f.evaluation(), f.output()];
const replyE1 = '{"id":1,"payload":"E1"}\n';
const replyX2 = '{"id":2,"payload":"X2"}\n';
const replyG2 = '{"id":1,"payload":"E3"}\n';
const assertEnvelopes = (f: Fixture) => expect(f.stdin.writes).toEqual([
  '{"id":1,"input":{"kind":"E1"}}\n',
  '{"id":2,"exportOutput":{"kind":"X2"}}\n'
]);
const rejectNew = async (f: Fixture) => {
  const count = f.stdin.writes.length;
  const later = f.evaluation("later");
  await turn();
  states([later], ["rejected"]);
  expect(f.stdin.writes).toHaveLength(count);
  return later;
};
const failedPair = async (f: Fixture, observations: Observation[]) => {
  await turn();
  states(observations, ["rejected", "rejected"]);
  expect(f.notify).toHaveBeenCalledTimes(1);
  await rejectNew(f);
};

afterEach(async () => {
  for (const owner of owners.splice(0)) owner.dispose();
  for (const cleanup of fixtures.splice(0)) cleanup();
  await turn();
});

describe("Issue 1454 frozen process lifecycle matrix", () => {
  it.each(["reverse", "normal"])("P1 correlates concurrent evaluation/export: %s", async (order) => {
    const f = fixture();
    const work = pair(f);
    assertEnvelopes(f);
    states(work, ["pending", "pending"]);
    f.frame(order === "reverse" ? replyX2 : replyE1);
    await turn();
    states(work, order === "reverse" ? ["pending", "fulfilled"] : ["fulfilled", "pending"]);
    f.frame(order === "reverse" ? replyE1 : replyX2);
    await turn();
    states(work, ["fulfilled", "fulfilled"]);
    values(work, ["E1", "X2"]);
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
  });

  it("P2 isolates export rejection from both evaluations", async () => {
    const f = fixture();
    const work = [...pair(f), f.evaluation("E3")];
    expect(f.stdin.writes[2]).toBe('{"id":3,"input":{"kind":"E3"}}\n');
    f.frame('{"id":2,"error":"X2 failed"}\n');
    await turn();
    states(work, ["pending", "rejected", "pending"]);
    expect(work[1]!.value).toEqual(new Error("X2 failed"));
    f.frame('{"id":3,"payload":"E3"}\n');
    await turn();
    states(work, ["pending", "rejected", "fulfilled"]);
    f.frame(replyE1);
    await turn();
    values([work[0]!, work[2]!], ["E1", "E3"]);
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("P3 ignores unknown and duplicate IDs without cross-settlement", async () => {
    const f = fixture();
    const work = pair(f);
    f.frame('{"id":99,"payload":"wrong"}\n');
    await turn();
    states(work, ["pending", "pending"]);
    f.frame(replyE1);
    await turn();
    states(work, ["fulfilled", "pending"]);
    f.frame('{"id":1,"payload":"duplicate"}\n');
    await turn();
    states(work, ["fulfilled", "pending"]);
    values([work[0]!], ["E1"]);
    f.frame(replyX2);
    await turn();
    values(work, ["E1", "X2"]);
    expect(f.notify).not.toHaveBeenCalled();
  });

  it.each([
    '{broken\n', '{"id":"1","payload":"wrong"}\n',
    '{"id":1.5,"payload":"wrong"}\n', '{"id":-1,"payload":"wrong"}\n',
    '{"id":9007199254740992,"payload":"wrong"}\n',
    '{"id":null,"payload":"wrong"}\n', '{"payload":"wrong"}\n'
  ])("P3 fail-closes untrusted response %j", async (bytes) => {
    const { owner, generations } = ownerFixture();
    owner.get();
    const f = generations[0]!;
    const work = pair(f);
    f.frame(bytes);
    await failedPair(f, work);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
    expect(owner.get()).not.toBe(f.process);
    const replacement = generations[1]!;
    const fresh = replacement.evaluation("E3");
    replacement.frame(replyG2);
    await turn();
    values([fresh], ["E3"]);
  });

  it("P4 exit preserves settled work, rejects the rest and remains terminal", async () => {
    const f = fixture();
    const work = pair(f);
    f.frame(replyE1);
    await turn();
    f.child.emit("exit", 1, null);
    await turn();
    states(work, ["fulfilled", "rejected"]);
    values([work[0]!], ["E1"]);
    f.child.emit("error", new Error("late error"));
    f.frame(replyX2);
    f.child.emit("exit", 1, null);
    await rejectNew(f);
    states(work, ["fulfilled", "rejected"]);
    expect(f.notify).toHaveBeenCalledTimes(1);
  });

  it.each(["error-exit", "exit-error"])("P5 replaces G1 after %s", async (order) => {
    const { owner, generations } = ownerFixture();
    const first = owner.get();
    const f = generations[0]!;
    const work = pair(f);
    const error = () => f.child.emit("error", new Error("child failed"));
    const exit = () => f.child.emit("exit", 1, null);
    if (order === "error-exit") { error(); exit(); } else { exit(); error(); }
    await failedPair(f, work);
    const second = owner.get();
    expect(second).not.toBe(first);
    const g = generations[1]!;
    const fresh = g.evaluation("E3");
    f.frame(replyE1);
    g.frame(replyG2);
    await turn();
    values([fresh], ["E3"]);
    expect(owner.get()).toBe(second);
  });

  it("P6 disposal is intentional, terminal and idempotent", async () => {
    const f = fixture();
    const work = pair(f);
    f.process.dispose();
    f.process.dispose();
    await turn();
    states(work, ["rejected", "rejected"]);
    f.frame(replyE1 + replyX2);
    f.child.emit("error", new Error("late disposal error"));
    f.child.emit("exit", null, "SIGTERM");
    await rejectNew(f);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("P7 synchronous real Writable throw rejects affected work without leaking correlation", async () => {
    const f = fixture();
    const work = [f.evaluation()];
    f.stdin.throwWrite = true;
    work.push(f.output());
    await turn();
    states([work[1]!], ["rejected"]);
    // Both policies are permitted: isolate the failed request or fail-close G1.
    if (work[0]!.state === "pending") {
      f.frame(replyE1);
      await turn();
      states(work, ["fulfilled", "rejected"]);
      values([work[0]!], ["E1"]);
      expect(f.notify).not.toHaveBeenCalled();
    } else {
      await failedPair(f, work);
      expect(f.child.kill).toHaveBeenCalledTimes(1);
    }
    expect(Reflect.get(f.process, "pending").size).toBe(0);
  });

  it.each(["callback", "destroy"])("P7 asynchronous stdin %s failure rejects all pending", async (mode) => {
    const f = fixture();
    f.stdin.hold = true;
    const work = pair(f);
    const closed = once(f.stdin, "close").catch((error: unknown) => error);
    if (mode === "callback") f.stdin.release(new Error("async write failure"));
    else f.stdin.destroy(new Error("async write failure"));
    await closed;
    await failedPair(f, work);
    expect(f.streamErrors).toEqual([new Error("async write failure")]);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });

  it.each(["close", "finish"])("P8 backpressure survives drain; actual stdin %s fails closed", async (mode) => {
    const f = fixture(true);
    f.stdin.hold = true;
    const write = vi.spyOn(f.stdin, "write");
    const work = pair(f);
    expect(write.mock.results.map((result) => result.value)).toEqual([false, false]);
    states(work, ["pending", "pending"]);
    const drained = once(f.stdin, "drain");
    f.stdin.release();
    f.stdin.release();
    await drained;
    assertEnvelopes(f);
    f.frame(replyX2 + replyE1);
    await turn();
    states(work, ["fulfilled", "fulfilled"]);
    values(work, ["E1", "X2"]);
    expect(f.notify).not.toHaveBeenCalled();
    const third = f.evaluation("E3");
    const completed = once(f.stdin, mode === "close" ? "close" : "finish");
    if (mode === "close") f.stdin.destroy();
    else { f.stdin.end(); f.stdin.release(); }
    await completed;
    await turn();
    states([third], ["rejected"]);
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
    await rejectNew(f);
  });

  it("P9 stale G1 callbacks/frames cannot evict or settle G2", async () => {
    const { owner, generations, callbacks } = ownerFixture();
    const first = owner.get();
    expect(owner.get()).toBe(first);
    const f = generations[0]!;
    const work = pair(f);
    f.child.emit("exit", 1, null);
    await turn();
    states(work, ["rejected", "rejected"]);
    const second = owner.get();
    const g = generations[1]!;
    const fresh = g.evaluation("E3");
    callbacks[0]!();
    f.frame(replyE1 + replyX2);
    f.child.emit("error", new Error("late G1"));
    await turn();
    states([fresh], ["pending"]);
    expect(owner.get()).toBe(second);
    g.frame(replyG2);
    await turn();
    values([fresh], ["E3"]);
    expect(g.stdin.writes).toEqual(['{"id":1,"input":{"kind":"E3"}}\n']);
    expect(owner.get()).toBe(second);
    expect(generations).toHaveLength(2);
  });

  it("P10 owner disposal releases G1 and final G2 pending work", async () => {
    const { owner, generations, callbacks } = ownerFixture();
    owner.get();
    const f = generations[0]!;
    const work = pair(f);
    owner.dispose();
    await turn();
    states(work, ["rejected", "rejected"]);
    const second = owner.get();
    const g = generations[1]!;
    const fresh = g.evaluation("E3");
    callbacks[0]!();
    f.frame(replyE1 + replyX2);
    f.child.emit("error", new Error("late G1 disposal"));
    f.child.emit("exit", null, "SIGTERM");
    expect(owner.get()).toBe(second);
    g.frame(replyG2);
    await turn();
    values([fresh], ["E3"]);
    const pending = g.output();
    owner.dispose();
    owner.dispose();
    await turn();
    states([pending], ["rejected"]);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
    expect(g.child.kill).toHaveBeenCalledTimes(1);
    expect(f.notify).not.toHaveBeenCalled();
    expect(g.notify).not.toHaveBeenCalled();
    expect(generations).toHaveLength(2);
  });
});

describe("Issue 1454 evidence-triggered reducers", () => {
  it("A1 idle child exit prevents a later request", async () => {
    const f = fixture();
    f.child.emit("exit", 0, null);
    await rejectNew(f);
    expect(f.notify).toHaveBeenCalledTimes(1);
  });

  it("A2 idle malformed response prevents a later request", async () => {
    const f = fixture();
    f.frame('{broken\n');
    await rejectNew(f);
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });

  it.each(["cycle", "bigint"])("A3 serialization failure (%s) isolates unsent work without leaking correlation", async (mode) => {
    const f = fixture();
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const work = [f.evaluation(), observe(f.process.exportOutput(mode === "cycle" ? cycle : 1n))];
    await turn();
    states(work, ["pending", "rejected"]);
    expect(f.stdin.writes).toEqual(['{"id":1,"input":{"kind":"E1"}}\n']);
    f.frame(replyE1);
    await turn();
    states(work, ["fulfilled", "rejected"]);
    values([work[0]!], ["E1"]);
    const pendingCount = Reflect.get(f.process, "pending").size;
    expect(pendingCount).toBe(0);
    expect(() => expect(pendingCount + 1).toBe(0)).toThrow();
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
  });

  it.each([
    '{"id":1}\n', '{"id":1,"error":3}\n',
    '{"id":1,"payload":"wrong","error":"ambiguous"}\n'
  ])("A4 invalid response envelope %j invalidates all pending", async (bytes) => {
    const f = fixture();
    const work = pair(f);
    f.frame(bytes);
    await failedPair(f, work);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "end"])("A5 lost stdout (%s) rejects all pending", async (mode) => {
    const f = fixture();
    const work = pair(f);
    const completed = once(f.stdout, mode === "error" ? "close" : "end").catch((error: unknown) => error);
    if (mode === "error") f.stdout.destroy(new Error("stdout failed"));
    else f.stdout.end();
    await completed;
    await failedPair(f, work);
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });

  it("A6 consumes stderr errors as diagnostics while evaluation remains usable", async () => {
    const f = fixture();
    const work = pair(f);
    f.stderr.write("diagnostic\n");
    await turn();
    states(work, ["pending", "pending"]);
    expect(f.diagnostic).toHaveBeenCalledWith("evaluation_stdio: diagnostic");
    // The client must consume the error itself; no harness listener masks it.
    f.stderr.removeListener("error", f.observeStreamError);
    expect(f.stderr.listenerCount("error")).toBeGreaterThan(0);
    const closed = new Promise<void>((resolve) => f.stderr.once("close", resolve));
    f.stderr.destroy(new Error("stderr failed"));
    await closed;
    await turn();
    states(work, ["pending", "pending"]);
    expect(f.diagnostic).toHaveBeenCalledWith("evaluation_stdio stderr: stderr failed");
    f.frame(replyE1 + replyX2);
    await turn();
    states(work, ["fulfilled", "fulfilled"]);
    values(work, ["E1", "X2"]);
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
  });
});

describe("independent oracle sensitivity controls", () => {
  it("rejects deliberately wrong observations from a genuine P1/P3/P9 control", async () => {
    const { owner, generations, callbacks } = ownerFixture();
    owner.get();
    const f = generations[0]!;
    const work = pair(f);
    f.frame('{"id":99,"payload":"wrong"}\n');
    await turn();
    states(work, ["pending", "pending"]);
    expect(() => states([{ state: "fulfilled", value: "wrong" }, work[1]!], ["pending", "pending"])).toThrow();
    f.frame(replyE1);
    await turn();
    f.frame('{"id":1,"payload":"duplicate"}\n');
    await turn();
    states(work, ["fulfilled", "pending"]);
    expect(() => states([work[0]!, { state: "fulfilled" }], ["fulfilled", "pending"])).toThrow();
    f.frame(replyX2);
    await turn();
    values(work, ["E1", "X2"]);
    expect(() => values([work[1]!, work[0]!], ["E1", "X2"])).toThrow();
    expect(() => states([work[0]!, { state: "pending" }], ["fulfilled", "fulfilled"])).toThrow();
    f.child.emit("exit", 0, null);
    const second = owner.get();
    callbacks[0]!();
    expect(owner.get()).toBe(second);
    expect(() => expect(f.process).toBe(second)).toThrow();
    expect(f.notify).toHaveBeenCalledTimes(1);
    const notificationCount = f.notify.mock.calls.length;
    expect(notificationCount).toBe(1);
    expect(() => expect(notificationCount + 1).toBe(1)).toThrow();
  });

  it("detects post-terminal, write-error and backpressure misclassification", async () => {
    const f = fixture(true);
    f.stdin.hold = true;
    const work = pair(f);
    const drained = once(f.stdin, "drain");
    f.stdin.release(); f.stdin.release();
    await drained;
    f.frame(replyE1 + replyX2);
    await turn();
    states(work, ["fulfilled", "fulfilled"]);
    expect(() => states([{ state: "rejected" }, work[1]!], ["fulfilled", "fulfilled"])).toThrow();
    const failed = f.evaluation("E3");
    const closed = once(f.stdin, "close").catch((error: unknown) => error);
    f.stdin.destroy(new Error("write failed"));
    await closed;
    await turn();
    states([failed], ["rejected"]);
    expect(() => states([{ state: "fulfilled" }], ["rejected"])).toThrow();
    const later = await rejectNew(f);
    expect(() => states([{ ...later, state: "pending" }], ["rejected"])).toThrow();
  });
});

it("uses the environment binary override before the repository debug fallback", () => {
  expect(resolveRustEvaluationBinaryPath("/repo", {
    NUINUICAD_RUST_EVALUATION_BINARY: "/custom/evaluation_stdio"
  })).toBe("/custom/evaluation_stdio");
  expect(resolveRustEvaluationBinaryPath("/repo", {})).toContain("rust-evaluator");
  expect(resolveRustEvaluationBinaryPath("/repo", {})).toContain("evaluation_stdio");
});
