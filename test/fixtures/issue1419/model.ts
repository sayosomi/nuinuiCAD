import fc from "fast-check";
import { collectionCase } from "./collectionCases";
import { geometryCase } from "./geometryCases";
import { diagnosticCase } from "./diagnosticCases";

export type Slot = { id: string; suite: string; shape: number; operation: string; configuration: number; count: number };
export type Point = { x: number; y: number };
export type Geometry = Point | { start: Point; end: Point; length: number };
export type Observation = { name: string; value: Geometry; at?: number[]; instance?: string };
export type Trace = { loop: string; at: number[]; incoming: Record<string, unknown>; next: Record<string, unknown>; final: Record<string, unknown> };
export type Program = {
  source: string;
  scalars: Record<string, bigint | string>;
  geometry: Observation[];
  failedGeometry: { name: string; at: number[]; dependency: string }[];
  templates: string[];
  trace: Trace[];
  carries: string[];
  errors: string[];
  diagnosticBindings: Record<string, string>;
  absent: string[];
  valueErrors: { name: string; message: string }[];
  errorInstances: Record<string, string>;
  selectedControl?: Program;
  paths: string[];
};
export const configuration = fc.record({ unit: fc.integer({ min: 3, max: 997 }), delta: fc.integer({ min: 7, max: 113 }) });
export type Configuration = { unit: number; delta: number };
export const replaySeed = (s: Slot) => 1419000 + "RNGD".indexOf(s.suite) * 10000 + s.shape * 1000 + "ab".indexOf(s.operation) * 100 + s.configuration;
export const slotFor = (id: string): Slot => {
  const [suite, shape, operation, config] = id.split("-");
  const configuration = Number(config);
  return { id, suite, shape: Number(shape), operation, configuration, count: [0, 1, 2, 4][configuration] };
};
export const blank = (): Program => ({ source: "", scalars: {}, geometry: [], failedGeometry: [], templates: [], trace: [], carries: [], errors: [], diagnosticBindings: {}, absent: [], valueErrors: [], errorInstances: {}, paths: [] });
export const json = (v: unknown): string => JSON.stringify(v, (_, value) => typeof value === "bigint" ? Number(value) : value);
export const point = (x: bigint | number, y: bigint | number): Point => ({ x: Number(x), y: Number(y) });

export function makePair(slot: Slot, config: Configuration): [Program, Program] {
  const build = slot.suite === "R" || slot.suite === "N" ? collectionCase : slot.suite === "G" ? geometryCase : diagnosticCase;
  const a = build(slot, config, false), b = build(slot, config, slot.operation === "b");
  if (slot.operation === "a") {
    // All generated owned identifiers start with an uppercase letter. Keywords,
    // builtins, argument keys and member properties are lowercase. This is a
    // generator rewrite of its own tokens, not a source parser/resolver.
    const rename = (s: string) => s.replace(/\b[A-Z][A-Za-z0-9]*\b/g, name => `Renamed${name}`);
    b.source = rename(b.source);
    const names = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k), v]));
    b.scalars = names(b.scalars) as Program["scalars"];
    b.geometry = b.geometry.map(o => ({ ...o, name: rename(o.name), ...(o.instance ? { instance: rename(o.instance) } : {}) }));
    b.templates = b.templates.map(rename);
    b.failedGeometry = b.failedGeometry.map(o => ({ ...o, name: rename(o.name), dependency: rename(o.dependency) }));
    b.carries = b.carries.map(rename); b.errors = b.errors.map(rename); b.absent = b.absent.map(rename);
    b.diagnosticBindings = names(b.diagnosticBindings) as Program["diagnosticBindings"];
    b.valueErrors = b.valueErrors.map(e => ({ ...e, name: rename(e.name) }));
    b.errorInstances = Object.fromEntries(Object.entries(b.errorInstances).map(([name, instance]) => [rename(name), rename(instance)]));
    // Swap two independent generator prerequisites, preserving their bytes.
    const lines = b.source.split("\n");
    [lines[1], lines[2]] = [lines[2], lines[1]];
    b.source = lines.join("\n");
    if (b.selectedControl) {
      const control = b.selectedControl;
      control.source = rename(control.source);
      control.scalars = names(control.scalars) as Program["scalars"];
      control.geometry = control.geometry.map(o => ({ ...o, name: rename(o.name) }));
      control.templates = control.templates.map(rename);
      control.failedGeometry = control.failedGeometry.map(o => ({ ...o, name: rename(o.name), dependency: rename(o.dependency) }));
      control.carries = control.carries.map(rename); control.errors = control.errors.map(rename); control.absent = control.absent.map(rename);
      control.diagnosticBindings = names(control.diagnosticBindings) as Program["diagnosticBindings"];
      control.valueErrors = control.valueErrors.map(e => ({ ...e, name: rename(e.name) }));
      control.errorInstances = Object.fromEntries(Object.entries(control.errorInstances).map(([name, instance]) => [rename(name), rename(instance)]));
    }
  }
  return [a, b];
}
