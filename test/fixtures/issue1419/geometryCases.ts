import { blank, point, type Configuration, type Geometry, type Program, type Slot } from "./model";

export function geometryCase(s: Slot, c: Configuration, alias: boolean): Program {
  const p = blank(), code = ["nui 1", `const Unit: number = ${c.unit}`, `const Delta: number = ${c.delta}`];
  const ticks = Array.from({ length: s.count }, (_, i) => i + 1);
  code.push(`const Ticks: number[] = [${ticks.join(", ")}]`);
  if (alias) code.push("const Padding: number = @Unit + @Delta");
  const first = (origin: number): Geometry => ({ start: point(origin + 3, 9), end: point(origin + 18, 29), length: 25 });
  const later = s.configuration >= 2;
  const second = (origin: number): Geometry => ({ start: point(origin + 40, -8), end: point(origin + (later ? 56 : 64), later ? 55 : -1), length: later ? 65 : 25 });
  const module = s.shape === 2;
  if (module) code.push("module Box(Origin: number, Steps: number[]) {");
  const origin = module ? "@Origin" : "@Unit";
  code.push(`line Seed = segment(start: (${origin}, 2), end: (${origin} + 15, 22))`, "move Seed as shifted (from: (0, 0), to: (3, 7))", "move Seed as later (from: (0, 0), to: (101, 203))", `line Other = segment(start: (${origin} + 40, 0 - 8), end: (${origin} + ${later ? 56 : 64}, ${later ? "55" : "0 - 1"}))`);
  code.push(`for Tick in @${module ? "Steps" : "Ticks"} carry Edge: path = @Seed.shifted carry Spare: path = @Other.base {`, "point IncomingStart = from(source: @Edge.start)", "point IncomingEnd = from(source: @Edge.end)");
  code.push(...(alias ? ["const SendEdge: path = @Spare", "const SendSpare: path = @Edge", "next Edge = @SendEdge", "next Spare = @SendSpare"] : ["next Edge = @Spare", "next Spare = @Edge"]), "}");
  if (module) {
    code.push(...(alias ? ["const Forwarded: path = @Edge", "export const Out: path = @Forwarded"] : ["export const Out: path = @Edge"]), "}", "module Relay(Origin: number, Steps: number[]) {", "instance Child = Box(Origin: @Origin, Steps: @Steps)", "export const Out: path = @Child::Out", "}", `instance One = Relay(Origin: ${c.unit}, Steps: @Ticks)`, `instance Two = Relay(Origin: ${c.unit + c.delta + 107}, Steps: @Ticks)`);
    code.push("const Routes: path[] = [@One::Out, @Two::Out]");
    if (alias) code.push("const ForwardRoutes: path[] = @Routes");
    for (let index = 0; index < 2; index++) code.push(`const Selected${index}: path = @${alias ? "ForwardRoutes" : "Routes"}[${index}]`, `path Result${index} = from(source: @Selected${index})`, `point Start${index} = from(source: @Selected${index}.start)`, `point End${index} = from(source: @Selected${index}.end)`);
  } else {
    code.push("const Routes: path[] = [@Edge, @Spare]");
    if (alias) code.push("const ForwardRoutes: path[] = @Routes");
    for (let index = 0; index < 2; index++) code.push(`const Selected${index}: path = @${alias ? "ForwardRoutes" : "Routes"}[${index}]`, `path Result${index} = from(source: @Selected${index})`, `point Start${index} = from(source: @Selected${index}.start)`, `point End${index} = from(source: @Selected${index}.end)`);
  }
  const origins = module ? [c.unit, c.unit + c.delta + 107] : [c.unit];
  const final: Geometry[] = [];
  for (const [instanceIndex, value] of origins.entries()) {
    let edge = first(value) as Extract<Geometry, { start: unknown }>, spare = second(value) as typeof edge;
    for (let i = 0; i < s.count; i++) {
      const instance = module ? ["One", "Two"][instanceIndex] : undefined;
      p.geometry.push({ name: "IncomingStart", at: [i], instance, value: edge.start }, { name: "IncomingEnd", at: [i], instance, value: edge.end });
      p.trace.push({ loop: `Tick${instanceIndex}`, at: [i], incoming: { Edge: edge, Spare: spare }, next: { Edge: spare, Spare: edge }, final: { Edge: spare, Spare: edge } });
      [edge, spare] = [spare, edge];
    }
    final.push(edge); if (!module) final.push(spare);
  }
  for (const [i, value] of final.entries()) {
    if (!("start" in value)) throw new Error("bad analytic line model");
    p.geometry.push({ name: `Result${i}`, value }, { name: `Start${i}`, value: value.start }, { name: `End${i}`, value: value.end });
  }
  p.source = code.join("\n") + "\n"; p.carries = ["Edge", "Spare"];
  p.templates = ["IncomingStart", "IncomingEnd"];
  p.paths = [module ? "asymmetric-sibling-deferred-Module-carry-exports" : "root-staged-path-carry-indexed-endpoints", "selected-stage:shifted", "other-stage:base", `iterations:${s.count}`, alias ? "typed-alias-forwarding" : "direct-forwarding"];
  return p;
}
