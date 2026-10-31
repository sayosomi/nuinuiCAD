// Test-only synchronous stage observations. The bundler inserts calls in memory;
// no production file or public API is changed.
export type Stage = { calls: number; wallMs: number; cpuMs: number; arrayVisits: Record<string, number> };
export let stages: Record<string, Stage> = {};
export let filters: { stage: string; method: string; length: number; stack: string }[] = [];
export let capturing = false;
export let work = false;
const stack: string[] = [];
export function reset(countWork = false) { stages = {}; filters = []; capturing = true; work = countWork; }
export function stop() { capturing = false; }
export function probe<T>(name: string, run: () => T): T {
  if (!capturing) return run();
  const stage = stages[name] ??= { calls: 0, wallMs: 0, cpuMs: 0, arrayVisits: {} };
  stage.calls++;
  stack.push(name);
  const start = performance.now(), cpu = process.cpuUsage();
  try { return run(); }
  finally {
    const used = process.cpuUsage(cpu);
    stage.cpuMs += (used.user + used.system) / 1000;
    stage.wallMs += performance.now() - start;
    stack.pop();
  }
}
Object.assign(globalThis, { __issue1515Probe: probe });
export function observeArrays<T>(run: () => T): T {
  const keys = ["map", "filter", "find", "findIndex", "some", "forEach"] as const;
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)!] as const);
  try {
    for (const [key, descriptor] of descriptors) Object.defineProperty(Array.prototype, key, {
      ...descriptor,
      value: function(this: unknown[], callback: (...args: unknown[]) => unknown, receiver: unknown) {
        const name = stack.at(-1);
        const stage = name && stages[name];
        if (!work || !stage || !this.length) return Reflect.apply(descriptor.value, this, [callback, receiver]);
        const first = this[0];
        const cad = first !== null && typeof first === "object" && "id" in first && "type" in first;
        const category = `${cad ? "cad" : "other"}.${key}`;
        if (cad) filters.push({ stage: name!, method: key, length: this.length, stack: new Error().stack ?? "" });
        return Reflect.apply(descriptor.value, this, [function(this: unknown, ...args: unknown[]) {
          stage.arrayVisits[category] = (stage.arrayVisits[category] ?? 0) + 1;
          return Reflect.apply(callback, this, args);
        }, receiver]);
      }
    });
    return run();
  } finally { for (const [key, descriptor] of descriptors) Object.defineProperty(Array.prototype, key, descriptor); }
}
