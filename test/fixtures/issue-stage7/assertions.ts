import { expect } from "vitest";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import type { EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import type { EvaluateDocumentInput } from "../../../src/geometry/rustEvaluationInput";
import { recordsIn } from "../issue1419/assertions";
import type { Cell } from "./model";
import { independentOracle, type Shape } from "./oracles";
export function nameFor(compiled: TextCompileResult, id: string, payload?: EvaluationPayload): string {
  const elements=compiled.doc.document.elements, row=payload?.forGroupGeneratedRows?.find(r=>r.generatedElementId===id),sourceId=row?.templateElementId ?? id;
  const element=elements.find(e=>e.id===sourceId),snapshot=compiled.doc.moduleMaterialization?.instanceBaseGeometrySnapshots.find(s=>s.descendantIds.includes(sourceId));
  return `${snapshot ? elements.find(e=>e.id===snapshot.instanceId)!.name+"::" : ""}${element?.name ?? id}`;
}
export function geometryProof(compiled: TextCompileResult,payload: EvaluationPayload) {
  return payload.computedGeometry.map(g=>{
    const row=payload.forGroupGeneratedRows?.find(r=>r.generatedElementId===g.elementId);
    const shape:Shape=g.kind==="point" ? { kind:"point",x:g.x,y:g.y } : g.kind==="line" ? { kind:"line",vertices:[g.start,g.end].map(({ x,y })=>({ x,y })),length:g.length } : g.kind==="polyline" ? {
      kind:"polyline",vertices:g.segments.length ? [g.segments[0].start,...g.segments.map(s=>s.end)].map(({ x,y })=>({ x,y })) : [],length:g.length
    } : (()=>{ throw new Error(`unexpected geometry kind ${g.kind}`); })();
    return { owner:nameFor(compiled,g.elementId,payload),...(row ? { at:row.occurrencePath.map(s=>s.iterationIndex) } : {}),shape };
  });
}
export function checkGeometry(c:Cell,compiled:TextCompileResult,payload:EvaluationPayload) {
  const oracle=independentOracle(c),actual=geometryProof(compiled,payload);
  const key=(g:{ owner:string;at?:number[] })=>`${g.owner}[${g.at ?? ""}]`;
  expect(actual.map(key).sort(),"exact emitted and suppressed geometry owners/occurrences").toEqual(oracle.geometry.map(key).sort());
  for(const expected of oracle.geometry) {
    const g=actual.find(g=>key(g)===key(expected))!;
    if(expected.shape.kind==="point") expect(g.shape,`${key(expected)} endpoint`).toEqual(expected.shape);
    else { expect(g.shape).toMatchObject({ kind:expected.shape.kind,vertices:expected.shape.vertices }); expect("length" in g.shape ? g.shape.length : undefined).toBeCloseTo(expected.shape.length,7); }
  }
  expect(payload.errors.map(e=>nameFor(compiled,e.elementId,payload)).sort(),"exact selected drawable diagnostic owners").toEqual(oracle.errors);
  if(c.hypothesis==="H1") expect(payload.geometryValueErrors ?? []).toEqual([]);
  else {
    const dormant=compiled.doc.document.elements.find(e=>e.type==="moduleInstance"&&e.name==="Dormant")!;
    for(const error of payload.errors) expect(nameFor(compiled,error.elementId,payload)).not.toContain("Dormant");
    const snapshot=compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.find(s=>s.instanceId===dormant.id)!;
    expect(payload.computedGeometry.some(g=>snapshot.descendantIds.includes(g.elementId))).toBe(false);
  }
}
export function checkCompiler(c:Cell,compiled:TextCompileResult,wire:EvaluateDocumentInput) {
  const doc=compiled.doc;
  expect(doc.bindingAnalysis!.issues).toEqual([]); expect(doc.typedDependencyGraph!.cycles).toEqual([]);
  expect(wire.bindingVersions, "normally eligible Rust input retains compiled carry plans").toBeDefined();
  const plans=wire.bindingVersions!.immutableForGroups!,carries=plans.flatMap(p=>p.geometryCollectionCarries ?? []);
  expect(carries).toHaveLength(c.hypothesis==="H1" ? c.control ? 1 : 2 : 3);
  expect(new Set(carries.map(c=>c.collectionValueId)).size).toBe(carries.length);
  for(const plan of plans) {
    expect(doc.bindingVersions!.immutableForGroups!.has(plan.ownerStatementId),"canonical owner, no test resolver").toBe(true);
    expect(wire.bindingVersions!.forGroupOwners.some(o=>o.ownerStatementId===plan.ownerStatementId)).toBe(true);
  }
  const targets=recordsIn(wire).filter(r=>r.kind==="collectionIndex");
  for(const target of targets) if(String(target.collectionValueId).startsWith("carry-collection:")) expect(carries.some(c=>c.collectionValueId===target.collectionValueId)).toBe(true);
  expect(targets.length).toBeGreaterThan(0);
  if(c.hypothesis==="H1"&&!c.control) {
    const outer=carries.find(c=>c.bindingId.endsWith(":Outer"))!,inner=carries.find(c=>c.bindingId.endsWith(":Inner"))!;
    expect(inner.initializer).toEqual({ kind:"value",valueId:outer.collectionValueId });
    expect(outer.next).toEqual({ kind:"value",valueId:inner.collectionValueId });
  }
}
