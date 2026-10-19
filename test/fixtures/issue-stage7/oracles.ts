import type { Cell } from "./model";
export type XY = { x: number; y: number };
export type Shape = { kind: "point"; x: number; y: number } | { kind: "line" | "polyline"; vertices: XY[]; length: number };
export type Expected = { owner: string; at?: number[]; shape: Shape };
export const point = (x: number, y: number): Shape => ({ kind: "point", x, y });
export const shape = (type: string, start: XY, end: XY): Shape => {
  const vertices = type === "line" ? [start,end] : [start,{ x: end.x, y: start.y },end];
  return { kind: type === "line" ? "line" : "polyline", vertices,
    length: type === "line" ? Math.hypot(end.x-start.x,end.y-start.y) : Math.abs(end.x-start.x)+Math.abs(end.y-start.y) };
};
export function independentOracle(c: Cell) {
  const { u,d,f } = c.inputs, geometry: Expected[] = [];
  if (c.hypothesis === "H2") {
    for (const [i,owner] of ["One","Two"].entries()) if (i || c.control) {
      const origin = u+i*(d+17), start = { x: origin+17+(c.type === "line" ? 3 : 0), y: d+(c.type === "line" ? 4 : 0) }, end = { x: origin+2, y: f };
      geometry.push({ owner: `${owner}::Prefix`, shape: point(origin,1) }, { owner: `${owner}::Mark`, shape: shape("line",start,end) }, { owner: `Use${owner}`, shape: shape("line",start,end) });
    }
    geometry.push({ owner: "Survivor", shape: point(u+d,-f) });
    return { geometry, errors: c.control ? [] : ["One::Mark"], suppressed: c.control ? ["Dormant"] : ["One","Dormant"],
      body: "ACTIVE", finalMembers: [1,0], diagnostic: c.control ? undefined : { owner: "One::Chosen", reason: "selected geometry member division by zero" } };
  }
  // Algebraically unrolled independently of a source-generation state machine.
  const initial = [shape(c.type,{ x:u+d,y:2+f },{ x:u+3+d,y:6+f }), shape(c.type,{ x:u+40,y:-8 },{ x:u+64,y:-1 })];
  if (c.type === "path" && initial[1].kind !== "point") initial[1].vertices = [{ x:u+40,y:-8 },{ x:u+40,y:-1 },{ x:u+64,y:-1 }];
  const r11 = shape(c.type,{ x:u+5+d,y:9+f },{ x:u+16,y:15 });
  const r12 = shape(c.type,{ x:u+66,y:2 },{ x:u+19,y:20 });
  const r21 = shape(c.type,{ x:u+18,y:18 },{ x:u+27,y:22 });
  const r22 = shape(c.type,{ x:u+21,y:23 },{ x:u+30,y:27 });
  if (c.type === "path" && c.module) for (const rebuilt of [r11,r12,r21,r22]) {
    if (rebuilt.kind === "point") throw new Error("polyline model");
    rebuilt.vertices[1].y = 3;
    const [a,b,z] = rebuilt.vertices;
    rebuilt.length = Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(z.x-b.x,z.y-b.y);
  }
  const active = !!c.inner && !c.control, finalMembers = active ? [r21,r22] : initial;
  const owner = (s: string) => `${c.module ? "Live::" : ""}${s}`;
  const ends = (s: Shape) => { if (s.kind === "point") throw new Error("non-point model required"); return [s.vertices[0],s.vertices.at(-1)!]; };
  for (const [i,seed] of initial.entries()) {
    if (seed.kind === "point") throw new Error("seed path model");
    const [dx,dy] = i ? [211,307] : [101,203];
    geometry.push({ owner:owner(i ? "SeedB" : "SeedA"),shape:{ ...seed,vertices:seed.vertices.map(p=>({ x:p.x+dx,y:p.y+dy })) } });
  }
  for (let o=0;o<2;o++) {
    const incoming = active && o ? [r11,r12] : initial;
    geometry.push({ owner:owner("OuterStart"),at:[o],shape:point(ends(incoming[0])[0].x,ends(incoming[0])[0].y) },
      { owner:owner("OuterEnd"),at:[o],shape:point(ends(incoming[1])[1].x,ends(incoming[1])[1].y) });
    if (active) for (let j=0;j<2;j++) {
      const inner = o ? (j ? [r12,r21] : [r11,r12]) : (j ? [initial[1],r11] : initial);
      const rebuilt = [r11,r12,r21,r22][o*2+j];
      geometry.push({ owner:owner("InnerStart"),at:[o,j],shape:point(ends(inner[0])[0].x,ends(inner[0])[0].y) },
        { owner:owner("InnerEnd"),at:[o,j],shape:point(ends(inner[1])[1].x,ends(inner[1])[1].y) });
      // Rebuilt's ordinary drawable selects the later final stage, while the
      // carried member selects only shifted. This catches stage conflation.
      if (rebuilt.kind === "point") throw new Error("rebuilt path model");
      geometry.push({ owner:owner("Rebuilt"),at:[o,j],shape:{ ...rebuilt,vertices:rebuilt.vertices.map(p=>({ x:p.x+401,y:p.y+503 })) } });
    }
  }
  for (let i=0;i<2;i++) {
    const [start,end] = ends(finalMembers[i]);
    geometry.push({ owner:owner(`Result${i}`),shape:finalMembers[i] }, { owner:owner(`Start${i}`),shape:point(start.x,start.y) }, { owner:owner(`End${i}`),shape:point(end.x,end.y) });
  }
  if (c.module) { const end=ends(finalMembers[0])[1]; geometry.push({ owner:"Qualified",shape:point(end.x,end.y) }); }
  return { geometry, finalMembers, errors: [], suppressed: [], body: active ? "ACTIVE" : "NOT_COVERED", diagnostic: undefined };
}
